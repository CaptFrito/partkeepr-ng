#!/usr/bin/env python3
"""
Parse Doctrine 2 ORM annotations from PartKeepr entity classes and produce a
structured schema reference (docs/schema.json + docs/schema.md).

This is a pragmatic regex-based parser, not a real PHP/Doctrine implementation.
The output is meant for human review during the rewrite planning, not as
authoritative DDL. Authoritative DDL should come from mysqldump --no-data
against a live database.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Optional

REPO_ROOT = Path(__file__).resolve().parent.parent
ENTITY_ROOT = REPO_ROOT / "reference" / "PartKeepr" / "src" / "PartKeepr"
DOCS_DIR = REPO_ROOT / "docs"

# ---------- regex helpers ----------

RE_NAMESPACE = re.compile(r"^namespace\s+([^;]+);", re.M)
RE_CLASS = re.compile(
    r"^(?:abstract\s+)?class\s+(\w+)(?:\s+extends\s+([\w\\]+))?(?:\s+implements\s+[^\{]+)?\s*\{",
    re.M,
)
RE_ORM_ALIAS = re.compile(
    r"^use\s+Doctrine\\ORM\\Mapping\s+as\s+(\w+)\s*;", re.M
)

# Doctrine attribute pair extractor — handles key=value with quoted strings,
# nested {...} blocks, and bare identifiers.
def extract_attrs(s: str) -> dict:
    """Parse k=v,k=v inside a Doctrine annotation argument list."""
    attrs: dict = {}
    i = 0
    n = len(s)
    while i < n:
        # skip whitespace and commas
        while i < n and s[i] in " \t\r\n,":
            i += 1
        if i >= n:
            break
        # read key
        m = re.match(r"(\w+)\s*=\s*", s[i:])
        if not m:
            # could be a bare value (positional arg) — skip rest
            break
        key = m.group(1)
        i += m.end()
        # read value
        if i < n and s[i] == '"':
            # quoted string. Backslash is the PHP namespace separator and
            # appears literally in annotations like
            # targetEntity="PartKeepr\PartBundle\Entity\Part" — only treat
            # \" and \\ as escapes, otherwise preserve the backslash verbatim.
            j = i + 1
            buf = []
            while j < n and s[j] != '"':
                if s[j] == "\\" and j + 1 < n and s[j + 1] in ('"', '\\'):
                    buf.append(s[j + 1])
                    j += 2
                else:
                    buf.append(s[j])
                    j += 1
            attrs[key] = "".join(buf)
            i = j + 1
        elif i < n and s[i] == "{":
            # balanced {...} block — capture raw
            depth = 0
            j = i
            while j < n:
                if s[j] == "{":
                    depth += 1
                elif s[j] == "}":
                    depth -= 1
                    if depth == 0:
                        j += 1
                        break
                j += 1
            attrs[key] = s[i:j]
            i = j
        else:
            # bare identifier or number
            m2 = re.match(r"[\w\\.]+", s[i:])
            if m2:
                v = m2.group(0)
                if v in ("true", "false"):
                    attrs[key] = v == "true"
                elif re.fullmatch(r"-?\d+", v):
                    attrs[key] = int(v)
                else:
                    attrs[key] = v
                i += m2.end()
            else:
                break
    return attrs


def find_annotation(docblock: str, name: str, alias: str = "ORM") -> Optional[dict]:
    """Find @<alias>\\<name>(...) in a docblock; return the parsed attrs dict
    or {} if present without args, or None if absent."""
    pat = re.compile(r"@" + re.escape(alias) + r"\\" + re.escape(name) + r"\b")
    m = pat.search(docblock)
    if not m:
        return None
    end = m.end()
    if end >= len(docblock) or docblock[end] != "(":
        return {}
    # capture balanced parens
    depth = 0
    i = end
    while i < len(docblock):
        if docblock[i] == "(":
            depth += 1
        elif docblock[i] == ")":
            depth -= 1
            if depth == 0:
                break
        i += 1
    inner = docblock[end + 1 : i]
    # Multi-line PHP docblocks continue with ` * ` on each line. Strip those
    # so our key=value parser sees a clean string (e.g. `@ORM\Table(\n *
    # name="...",\n *  uniqueConstraints=...)` was failing on the `*`).
    inner = re.sub(r"\n\s*\*\s?", "\n", inner)
    return extract_attrs(inner)


# ---------- per-entity parsing ----------

PROP_RE = re.compile(
    r"/\*\*(?P<doc>.*?)\*/\s*(?:public|private|protected)\s+\$(?P<name>\w+)\s*[=;]",
    re.S,
)


def parse_entity_file(path: Path) -> Optional[dict]:
    text = path.read_text()
    ns_m = RE_NAMESPACE.search(text)
    cls_m = RE_CLASS.search(text)
    if not cls_m:
        return None
    namespace = ns_m.group(1) if ns_m else ""
    class_name = cls_m.group(1)
    parent = cls_m.group(2) or None

    # The Doctrine ORM alias from `use Doctrine\ORM\Mapping as XXX;`.
    # Most files use "ORM"; StatisticSnapshot* use "Mapping".
    alias_m = RE_ORM_ALIAS.search(text)
    alias = alias_m.group(1) if alias_m else "ORM"

    # Class-level docblock: the comment immediately before `class ...`
    class_pos = cls_m.start()
    pre = text[:class_pos]
    cls_doc = ""
    cm = re.search(r"/\*\*(.*?)\*/\s*$", pre, re.S)
    if cm:
        cls_doc = cm.group(1)

    is_entity = bool(re.search(r"@" + re.escape(alias) + r"\\Entity\b", cls_doc))
    is_mapped_super = bool(re.search(
        r"@" + re.escape(alias) + r"\\MappedSuperclass\b", cls_doc))

    table_attrs = find_annotation(cls_doc, "Table", alias)
    target_service = None
    tsm = re.search(r"@TargetService\(uri=\"([^\"]+)\"", cls_doc)
    if tsm:
        target_service = tsm.group(1)

    # walk properties — only inside the class body (after `class ... {`)
    body = text[cls_m.end() :]
    fields: list[dict] = []
    for pm in PROP_RE.finditer(body):
        doc = pm.group("doc")
        name = pm.group("name")
        col = find_annotation(doc, "Column", alias)
        m2o = find_annotation(doc, "ManyToOne", alias)
        o2m = find_annotation(doc, "OneToMany", alias)
        m2m = find_annotation(doc, "ManyToMany", alias)
        o2o = find_annotation(doc, "OneToOne", alias)
        join_col = find_annotation(doc, "JoinColumn", alias)
        join_tbl = find_annotation(doc, "JoinTable", alias)
        is_id = bool(re.search(r"@" + re.escape(alias) + r"\\Id\b", doc))
        is_gen = find_annotation(doc, "GeneratedValue", alias)
        # Skip purely transient/virtual properties (no ORM annotation at all)
        if not any([col is not None, m2o is not None, o2m is not None,
                    m2m is not None, o2o is not None]):
            continue
        f: dict = {"name": name}
        if col is not None:
            f["kind"] = "column"
            f["type"] = col.get("type", "string")
            if "length" in col:
                f["length"] = col["length"]
            if "nullable" in col:
                f["nullable"] = col["nullable"]
            if "name" in col:
                f["column_name"] = col["name"]
            if "precision" in col:
                f["precision"] = col["precision"]
            if "scale" in col:
                f["scale"] = col["scale"]
            if "unique" in col:
                f["unique"] = col["unique"]
            if "options" in col:
                f["options"] = col["options"]
            if is_id:
                f["primary_key"] = True
            if is_gen is not None:
                f["generated"] = is_gen.get("strategy", "AUTO")
        elif m2o is not None:
            f["kind"] = "many_to_one"
            f["target"] = m2o.get("targetEntity", "")
            if "inversedBy" in m2o:
                f["inversed_by"] = m2o["inversedBy"]
            if join_col:
                f["join_column"] = join_col
        elif o2m is not None:
            f["kind"] = "one_to_many"
            f["target"] = o2m.get("targetEntity", "")
            if "mappedBy" in o2m:
                f["mapped_by"] = o2m["mappedBy"]
            if "cascade" in o2m:
                f["cascade"] = o2m["cascade"]
            if "orphanRemoval" in o2m:
                f["orphan_removal"] = o2m["orphanRemoval"]
        elif m2m is not None:
            f["kind"] = "many_to_many"
            f["target"] = m2m.get("targetEntity", "")
            if "mappedBy" in m2m:
                f["mapped_by"] = m2m["mappedBy"]
            if "inversedBy" in m2m:
                f["inversed_by"] = m2m["inversedBy"]
            if join_tbl:
                f["join_table"] = join_tbl
        elif o2o is not None:
            f["kind"] = "one_to_one"
            f["target"] = o2o.get("targetEntity", "")
            if "mappedBy" in o2o:
                f["mapped_by"] = o2o["mappedBy"]
            if "inversedBy" in o2o:
                f["inversed_by"] = o2o["inversedBy"]
        fields.append(f)

    return {
        "file": str(path.relative_to(REPO_ROOT)),
        "namespace": namespace,
        "class": class_name,
        "fqcn": f"{namespace}\\{class_name}",
        "parent": parent,
        "bundle": path.parts[-3],  # .../<Bundle>/Entity/<file>
        "is_entity": is_entity,
        "is_mapped_superclass": is_mapped_super,
        "table_name": (table_attrs or {}).get("name") if table_attrs else None,
        "table_extras": table_attrs if table_attrs else None,
        "target_service": target_service,
        "fields": fields,
    }


def default_table_name(class_name: str) -> str:
    # Doctrine 2 default naming strategy = class short name (no transformation).
    # PartKeepr uses the default underscore strategy in some places via custom
    # naming strategy. Without inspecting the Symfony config we err on simple.
    return class_name


# ---------- aggregate ----------

def main() -> int:
    files = sorted(ENTITY_ROOT.glob("*/Entity/*.php"))
    parsed = []
    for f in files:
        info = parse_entity_file(f)
        if info:
            parsed.append(info)

    by_fqcn = {e["fqcn"]: e for e in parsed}

    # Resolve parent chain → effective field set for each concrete @ORM\Entity
    def resolve_parent(parent_str: Optional[str], current_ns: str) -> Optional[str]:
        if not parent_str:
            return None
        parent_str = parent_str.strip()
        if parent_str.startswith("\\"):
            parent_str = parent_str[1:]
        # If parent is a fully-qualified name we already track, return it
        if parent_str in by_fqcn:
            return parent_str
        # If it's a relative name in current namespace
        cand = f"{current_ns}\\{parent_str}"
        if cand in by_fqcn:
            return cand
        # Search by short name (last segment)
        short = parent_str.split("\\")[-1]
        for fqcn in by_fqcn:
            if fqcn.endswith("\\" + short):
                return fqcn
        return None  # external parent (e.g. FOSUser → FOS\UserBundle\Model\User)

    for e in parsed:
        e["parent_fqcn"] = resolve_parent(e["parent"], e["namespace"])

    def collect_fields(fqcn: str) -> list[dict]:
        e = by_fqcn[fqcn]
        if e["parent_fqcn"]:
            inherited = collect_fields(e["parent_fqcn"])
        else:
            inherited = []
        # subclass fields override inherited fields with same name
        own_names = {f["name"] for f in e["fields"]}
        return [f for f in inherited if f["name"] not in own_names] + e["fields"]

    for e in parsed:
        e["effective_fields"] = collect_fields(e["fqcn"])

    # Concrete tables = @ORM\Entity classes (ignore MappedSuperclass)
    tables = [e for e in parsed if e["is_entity"]]
    supers = [e for e in parsed if e["is_mapped_superclass"]]

    # Write JSON
    DOCS_DIR.mkdir(parents=True, exist_ok=True)
    out_json = DOCS_DIR / "schema.json"
    out_json.write_text(json.dumps(
        {"entities": parsed},
        indent=2, ensure_ascii=False,
    ))

    # Write Markdown
    md = []
    md.append("# PartKeepr Schema Reference (extracted from Doctrine annotations)\n")
    md.append(
        "_Generated by `scripts/extract-schema.py` from "
        "`reference/PartKeepr/src/PartKeepr/`._\n\n"
        "This is a pragmatic regex-based parse of Doctrine 2 annotations, "
        "intended as a **rewrite planning reference**. It is not authoritative "
        "DDL — for that, dump the live DB schema with `mysqldump --no-data`.\n\n"
        "Concrete entities below are the actual tables. Mapped superclasses "
        "(BaseEntity, AbstractCategory) contribute inherited columns to their "
        "subclasses; their effective fields are merged into each concrete "
        "entity's listing.\n"
    )
    md.append(f"**Total entities (concrete tables):** {len(tables)}  ")
    md.append(f"**Mapped superclasses:** {len(supers)}\n\n")

    # Group by bundle
    by_bundle: dict[str, list] = {}
    for e in tables:
        by_bundle.setdefault(e["bundle"], []).append(e)
    for sc in supers:
        by_bundle.setdefault(sc["bundle"], [])

    md.append("## Mapped superclasses\n")
    for sc in supers:
        md.append(f"### `{sc['class']}` ({sc['bundle']})\n")
        if sc["parent_fqcn"]:
            parent_short = sc["parent_fqcn"].split("\\")[-1]
            md.append(f"_extends `{parent_short}`_\n\n")
        if sc["fields"]:
            md.append("Contributes:\n\n")
            for f in sc["fields"]:
                md.append(f"- {render_field(f)}\n")
            md.append("\n")
    md.append("\n")

    md.append("## Concrete entities by bundle\n")
    for bundle in sorted(by_bundle.keys()):
        ents = [e for e in by_bundle[bundle] if e["is_entity"]]
        if not ents:
            continue
        md.append(f"### {bundle}\n")
        for e in ents:
            tbl = e["table_name"] or default_table_name(e["class"])
            md.append(f"#### `{e['class']}` → table `{tbl}`\n")
            extras = []
            if e["target_service"]:
                extras.append(f"REST: `{e['target_service']}`")
            if e["parent_fqcn"]:
                extras.append(f"extends `{e['parent_fqcn'].split(chr(92))[-1]}`")
            elif e["parent"]:
                extras.append(f"extends `{e['parent']}` _(external)_")
            if extras:
                md.append("_" + " · ".join(extras) + "_\n\n")
            md.append("| Field | Kind | Type / Target | Notes |\n")
            md.append("|---|---|---|---|\n")
            for f in e["effective_fields"]:
                md.append(render_field_row(f) + "\n")
            md.append("\n")
            if e["table_extras"]:
                md.append("<details><summary>Raw `@ORM\\Table` extras</summary>\n\n")
                md.append("```\n")
                md.append(json.dumps(e["table_extras"], indent=2))
                md.append("\n```\n\n</details>\n\n")
        md.append("\n")

    # Relationship summary
    md.append("## Relationship summary\n\n")
    md.append("Owning side (ManyToOne / OneToOne owning) relationships only — "
              "these are where a foreign-key column lives.\n\n")
    md.append("| From entity | Field | → | Target |\n|---|---|---|---|\n")
    rels = []
    for e in tables:
        for f in e["effective_fields"]:
            if f["kind"] in ("many_to_one", "one_to_one"):
                target_short = (f.get("target") or "?").split("\\")[-1]
                rels.append((e["class"], f["name"], f["kind"], target_short))
    rels.sort()
    for src, fld, kind, tgt in rels:
        arrow = "→" if kind == "many_to_one" else "↔"
        md.append(f"| {src} | `{fld}` | {arrow} | {tgt} |\n")
    md.append("\n")

    # Reverse / collection summary
    md.append("## Inverse (OneToMany / ManyToMany) collections\n\n")
    md.append("These are the *inverse* sides — no FK column lives on this "
              "table; they're driven by the `mappedBy` field on the target.\n\n")
    md.append("| From entity | Field | Target | Mapped by |\n|---|---|---|---|\n")
    invs = []
    for e in tables:
        for f in e["effective_fields"]:
            if f["kind"] in ("one_to_many", "many_to_many") and f.get("mapped_by"):
                target_short = (f.get("target") or "?").split("\\")[-1]
                invs.append((e["class"], f["name"], target_short, f["mapped_by"]))
    invs.sort()
    for src, fld, tgt, mb in invs:
        md.append(f"| {src} | `{fld}` | {tgt} | `{mb}` |\n")
    md.append("\n")

    out_md = DOCS_DIR / "schema.md"
    out_md.write_text("".join(md))

    print(f"wrote {out_json} ({out_json.stat().st_size} bytes)")
    print(f"wrote {out_md}  ({out_md.stat().st_size} bytes)")
    print(f"entities: {len(tables)} concrete, {len(supers)} mapped superclass")
    print(f"owning relationships: {len(rels)}")
    print(f"inverse collections:  {len(invs)}")
    return 0


def render_field(f: dict) -> str:
    if f["kind"] == "column":
        bits = [f"`{f['name']}` ({f['type']})"]
        attrs = []
        if f.get("primary_key"):
            attrs.append("PK")
        if f.get("generated"):
            attrs.append(f"auto/{f['generated']}")
        if f.get("nullable"):
            attrs.append("nullable")
        if "length" in f:
            attrs.append(f"len={f['length']}")
        if "precision" in f:
            attrs.append(f"prec={f['precision']},scale={f['scale']}")
        if f.get("column_name"):
            attrs.append(f"col=`{f['column_name']}`")
        if attrs:
            bits.append("[" + ", ".join(attrs) + "]")
        return " ".join(bits)
    target = (f.get("target") or "?").split("\\")[-1]
    if f["kind"] == "many_to_one":
        return f"`{f['name']}` → ManyToOne `{target}`"
    if f["kind"] == "one_to_many":
        return f"`{f['name']}` ↤ OneToMany `{target}` (mappedBy `{f.get('mapped_by','?')}`)"
    if f["kind"] == "many_to_many":
        return f"`{f['name']}` ⇄ ManyToMany `{target}`"
    if f["kind"] == "one_to_one":
        return f"`{f['name']}` ↔ OneToOne `{target}`"
    return f"`{f['name']}` ({f['kind']})"


def render_field_row(f: dict) -> str:
    name = f"`{f['name']}`"
    if f["kind"] == "column":
        type_str = f["type"]
        if "length" in f:
            type_str += f"({f['length']})"
        if "precision" in f:
            type_str += f"({f['precision']},{f['scale']})"
        notes = []
        if f.get("primary_key"):
            notes.append("PK")
        if f.get("generated"):
            notes.append(f"auto/{f['generated']}")
        if f.get("nullable"):
            notes.append("null")
        if f.get("unique"):
            notes.append("unique")
        if f.get("column_name"):
            notes.append(f"col=`{f['column_name']}`")
        if "options" in f:
            notes.append("opts")
        return f"| {name} | column | `{type_str}` | {', '.join(notes)} |"
    target = (f.get("target") or "?").split("\\")[-1]
    if f["kind"] == "many_to_one":
        return f"| {name} | M:1 | `{target}` | FK on this table |"
    if f["kind"] == "one_to_many":
        mb = f.get("mapped_by", "?")
        return f"| {name} | 1:M | `{target}` | inverse, mappedBy `{mb}` |"
    if f["kind"] == "many_to_many":
        mb = f.get("mapped_by") or f.get("inversed_by") or ""
        return f"| {name} | M:M | `{target}` | {('mappedBy ' + mb) if mb else ''} |"
    if f["kind"] == "one_to_one":
        return f"| {name} | 1:1 | `{target}` |  |"
    return f"| {name} | {f['kind']} | | |"


if __name__ == "__main__":
    sys.exit(main())
