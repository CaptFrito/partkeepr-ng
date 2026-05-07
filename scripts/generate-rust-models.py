#!/usr/bin/env python3
"""
Generate Rust model files from docs/schema.json.

For each concrete @ORM\\Entity in the schema:
  - One file at backend/src/models/<snake_name>.rs
  - Contains a `pub struct <Name> { ... }` deriving FromRow + Serialize
  - If the entity has a @TargetService URI, also a `list` handler returning
    GET <uri> as JSON

Plus a single backend/src/models/mod.rs that re-exports each module and
exposes a `routes()` Router builder.

Tables explicitly skipped:
  - SchemaVersions  (Doctrine internal, no entity)
  - PartImage       (orphan in live DB, removed feature upstream)
  - PageBasicLayout (orphan in live DB, removed feature upstream)
  - UnitSiPrefixes  (M:M join, no entity, hand-written when we need it)

Re-runnable. Overwrites everything under backend/src/models/.
"""

from __future__ import annotations

import json
import keyword
import re
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SCHEMA_JSON = REPO / "docs" / "schema.json"
OUT_DIR = REPO / "backend" / "src" / "models"

# Doctrine column type → Rust type. Defaults to String when unknown.
DOCTRINE_TO_RUST = {
    "integer": "i32",
    "smallint": "i16",
    "bigint": "i64",
    "string": "String",
    "text": "String",
    "boolean": "bool",
    "datetime": "chrono::NaiveDateTime",
    "date": "chrono::NaiveDate",
    "time": "chrono::NaiveTime",
    "decimal": "rust_decimal::Decimal",
    "float": "f64",
    "json": "serde_json::Value",
    "blob": "Vec<u8>",
}

# Tables we don't want a Rust model for at all.
SKIP_ENTITY_CLASSES = {
    # FOSUser inherits from FOS\UserBundle\Model\User (external bundle); the
    # parent class adds ~15 columns we don't have annotations for. Defer until
    # we tackle auth.
    "FOSUser",
}

# Entities whose Rust struct should be generated, but whose auto-generated
# list handler should NOT be (and not registered as a route). These have
# hand-written handlers with richer shapes (filtering, pagination, expanded
# relations, write endpoints) in `backend/src/handlers/`.
SKIP_HANDLER_CLASSES = {
    "Part",                    # paginated list with filters + detail-with-relations live in handlers/parts.rs
    "PartCategory",            # tree GET + flat list + CRUD + move all live in handlers/categories.rs
    "StorageLocation",         # combined storage tree + flat list + CRUD live in handlers/storage_locations.rs
    "StorageLocationCategory", # ditto
    "Footprint",               # combined footprint tree + flat list + CRUD live in handlers/footprints.rs
    "FootprintCategory",       # ditto
    "Manufacturer",            # all flat-lookup CRUD lives in handlers/lookups.rs
    "Distributor",             # ditto
    "PartMeasurementUnit",     # ditto (table=PartUnit)
    "Unit",                    # ditto (with UnitSiPrefixes M:M)
    "SiPrefix",                # ditto
    "Project",                 # slice 8a: Project + BOM CRUD in handlers/projects.rs
    "ProjectPart",             # ditto (BOM lines as sub-resource on /api/projects/{pid}/parts)
    "ProjectAttachment",       # slice 7/8a: served via attachments pipeline + project-detail join
    "GridPreset",              # W8c.X: per-grid named layout CRUD in handlers/grid_presets.rs
}


def to_snake_case(name: str) -> str:
    """camelCase / PascalCase → snake_case. Preserves runs of caps as one
    word: `IDLogo` → `id_logo`, not `i_d_logo`."""
    s = re.sub(r"([A-Z]+)([A-Z][a-z])", r"\1_\2", name)
    s = re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", s)
    return s.lower().replace("__", "_")


def rust_field_name(column_name: str) -> tuple[str, bool]:
    """Returns (rust_name, needs_rename) where needs_rename means the rust
    name differs from the SQL column name (so we need #[sqlx(rename = ...)])."""
    snake = to_snake_case(column_name)
    # Reserved keyword? Use raw identifier.
    if keyword.iskeyword(snake) or snake in {"type", "match", "move", "ref", "self", "Self"}:
        return f"r#{snake}", snake != column_name
    return snake, snake != column_name


def column_rust_type(field: dict) -> str:
    base = DOCTRINE_TO_RUST.get(field.get("type", "string"), "String")
    # Defensive override: any datetime/date/time column gets wrapped in
    # Option<...> regardless of declared nullability. Reason: PartKeepr's
    # old migration scripts left ~1000 rows across the database with the
    # MariaDB zero-datetime sentinel `0000-00-00 00:00:00`, which sqlx
    # correctly refuses to parse as a real NaiveDateTime. We treat such
    # values as None on read; write-side strictness comes back when we
    # implement INSERT/UPDATE handlers in a later slice.
    if field.get("type") in ("datetime", "date", "time"):
        return f"Option<{base}>"
    if field.get("nullable"):
        return f"Option<{base}>"
    # Primary keys are never NULL even if generated.
    return base


def render_field(field: dict) -> str | None:
    """Render one struct field. Returns None if the field shouldn't be on
    the struct (e.g., it's an inverse OneToMany collection)."""
    kind = field["kind"]
    if kind == "one_to_many":
        # Inverse side — no FK column on this table. Skip.
        return None
    if kind == "many_to_many":
        # Either join-table-owned (UnitSiPrefixes) or inverse. Skip from struct;
        # callers can JOIN as needed.
        return None
    if kind == "one_to_one" and field.get("mapped_by"):
        # Inverse side of a OneToOne — the FK lives on the OTHER table.
        # E.g. Footprint::image is `mappedBy="footprint"`, so the FK is on
        # FootprintImage.footprint_id, not on Footprint.
        return None

    if kind == "column":
        sql_name = field.get("column_name") or field["name"]
        rust_name, needs_rename = rust_field_name(sql_name)
        rust_type = column_rust_type(field)
        attrs = []
        if needs_rename:
            attrs.append(f'#[sqlx(rename = "{sql_name}")]')
        prefix = "\n    ".join(attrs + [""]) if attrs else ""
        return f"    {prefix}pub {rust_name}: {rust_type},"

    if kind in ("many_to_one", "one_to_one"):
        # Doctrine convention: FK column is `<property>_id`. JoinColumn can
        # override the column name; we honor that if present.
        sql_name = (field.get("join_column") or {}).get("name") or f"{field['name']}_id"
        rust_name, needs_rename = rust_field_name(sql_name)
        # ManyToOne defaults to nullable=true unless JoinColumn says otherwise
        nullable = (field.get("join_column") or {}).get("nullable", True)
        rust_type = "i32" if not nullable else "Option<i32>"
        attrs = []
        if needs_rename:
            attrs.append(f'#[sqlx(rename = "{sql_name}")]')
        prefix = "\n    ".join(attrs + [""]) if attrs else ""
        return f"    {prefix}pub {rust_name}: {rust_type},"

    return None


def needs_chrono(fields: list) -> bool:
    return any(
        f.get("type", "").startswith("datetime")
        or f.get("type") in ("date", "time")
        for f in fields
        if f["kind"] == "column"
    )


def needs_decimal(fields: list) -> bool:
    return any(f.get("type") == "decimal" for f in fields if f["kind"] == "column")


def render_entity(entity: dict) -> str:
    cls = entity["class"]
    table = entity["table_name"] or cls
    fields = entity["effective_fields"]

    # Order: id and FKs first (by convention), then columns. Keep original
    # order otherwise — it tends to read sensibly already.
    field_lines = []
    for f in fields:
        line = render_field(f)
        if line is not None:
            field_lines.append(line)

    imports = ["use serde::Serialize;", "use sqlx::FromRow;"]
    if needs_chrono(fields):
        # chrono types are referenced by full path in the field types, so no
        # `use` needed — but we do need the crate to be present. Cargo handles.
        pass

    # Emit a handler iff the entity has a REST URI AND we're not deferring to
    # a hand-written handler in handlers/.
    has_target = bool(entity.get("target_service")) and cls not in SKIP_HANDLER_CLASSES
    if has_target:
        imports = [
            "use axum::{extract::State, http::StatusCode, Json};",
            *imports,
            "use sqlx::MySqlPool;",
        ]

    imports_block = "\n".join(imports)

    field_block = "\n".join(field_lines) if field_lines else "    // (no fields — placeholder)"

    # Whenever the codegen doesn't emit a handler, mark the struct
    # `#[allow(dead_code)]` — if a hand-written handler in handlers/ ends up
    # using the struct anyway (e.g. as a field in a richer response type),
    # the attribute is harmless.
    dead_code_attr = "#[allow(dead_code)]\n" if not has_target else ""

    body = [
        "// AUTO-GENERATED by scripts/generate-rust-models.py — do not edit by hand.",
        f"// Source: {entity['file']}",
        f"// Table: `{table}`"
        + (f", REST: `{entity['target_service']}`" if has_target else ""),
        "",
        imports_block,
        "",
        f"{dead_code_attr}#[derive(Debug, Serialize, FromRow)]",
        f"pub struct {cls} {{",
        field_block,
        "}",
        "",
    ]

    if has_target:
        # Some entities (UserPreference, SystemPreference) have composite PKs
        # and no `id` column — don't ORDER BY id when there isn't one.
        has_id = any(f["name"] == "id" and f["kind"] == "column" for f in fields)
        order_clause = " ORDER BY id" if has_id else ""
        body.extend([
            f"pub async fn list(State(pool): State<MySqlPool>)",
            f"    -> Result<Json<Vec<{cls}>>, (StatusCode, String)>",
            "{",
            f'    sqlx::query_as::<_, {cls}>("SELECT * FROM `{table}`{order_clause} LIMIT 100")',
            f"        .fetch_all(&pool).await",
            f"        .map(Json)",
            f"        .map_err(|e| {{",
            f'            tracing::error!(error = %e, "db error in {cls}::list");',
            f'            (StatusCode::INTERNAL_SERVER_ERROR, "internal error".into())',
            f"        }})",
            "}",
            "",
        ])

    return "\n".join(body)


def render_mod(modules: list[tuple[str, str, str | None]]) -> str:
    """modules: list of (mod_name, struct_name, target_service_or_None)."""
    lines = [
        "// AUTO-GENERATED by scripts/generate-rust-models.py — do not edit.",
        "",
        "use axum::{routing::get, Router};",
        "",
        "use crate::AppState;",
        "",
    ]
    for mod_name, _, _ in sorted(modules):
        lines.append(f"pub mod {mod_name};")
    lines.append("")
    lines.extend([
        "/// Build a router with all generated GET-list endpoints registered.",
        "pub fn routes() -> Router<AppState> {",
        "    Router::new()",
    ])
    for mod_name, _struct, target in sorted(modules):
        if target:
            lines.append(f'        .route("{target}", get({mod_name}::list))')
    lines.append("}")
    lines.append("")
    return "\n".join(lines)


def main() -> int:
    schema = json.loads(SCHEMA_JSON.read_text())
    entities = [
        e for e in schema["entities"]
        if e["is_entity"] and e["class"] not in SKIP_ENTITY_CLASSES
    ]

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    # Wipe existing model files (but not mod.rs yet — we'll overwrite it).
    for old in OUT_DIR.glob("*.rs"):
        old.unlink()

    modules = []
    for e in entities:
        mod_name = to_snake_case(e["class"])
        out_path = OUT_DIR / f"{mod_name}.rs"
        out_path.write_text(render_entity(e))
        # Suppress route registration for entities whose handler we replaced
        # with a hand-written one in handlers/. The struct still gets exported
        # for use by the hand-written handler; only the route is skipped here.
        target = (
            None
            if e["class"] in SKIP_HANDLER_CLASSES
            else e.get("target_service")
        )
        modules.append((mod_name, e["class"], target))

    (OUT_DIR / "mod.rs").write_text(render_mod(modules))

    print(f"wrote {len(modules)} model files to {OUT_DIR}")
    print(f"  with handlers: {sum(1 for _, _, t in modules if t)}")
    print(f"  struct-only:   {sum(1 for _, _, t in modules if not t)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
