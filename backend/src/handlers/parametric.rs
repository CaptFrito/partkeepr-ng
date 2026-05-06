//! Slice 11a: parametric search — find parts by parameter predicates.
//!
//! Three endpoints:
//!
//! - `GET /api/part_parameters/names` — distinct parameter names with
//!   value_type, dominant unit (when consistent across rows), and count.
//!   Powers the parameter-name dropdown in the filter pane.
//! - `GET /api/part_parameters/values?name=X&value_type=…` — distinct
//!   values for a given parameter, for autocomplete. String-type returns
//!   alphabetical strings; numeric-type returns `(value, si_prefix_symbol)`
//!   pairs sorted by `normalizedValue`.
//! - `POST /api/parts/parametric` — body carries `predicates[]` plus the
//!   same filter+pagination shape as `GET /api/parts`. Each predicate
//!   becomes an `EXISTS (… PartParameter …)` clause, AND-combined.
//!   Numeric comparisons go against `normalizedValue` so cross-prefix
//!   matching works (e.g. `C = 100 nF` finds parts stored as `0.1 µF`).
//!
//! Operators: `=`, `!=`, `<`, `<=`, `>`, `>=` (scalar, string or numeric);
//! `like` (string only); `in` (string or numeric, with values array).

use std::collections::HashMap;

use axum::{
    extract::{Path, Query, State},
    Json,
};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, MySqlPool};

use crate::error::AppError;
use crate::handlers::parts::PartRow;

// ---------------------------------------------------------------------------
//  GET /api/part_parameters/names
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, FromRow)]
pub struct ParameterNameRow {
    pub name: String,
    pub value_type: String,
    /// Dominant unit id for this (name, value_type) — non-NULL only when
    /// every row of this name agrees on a single unit (or every row is
    /// unitless). When NULL, the UI shouldn't pre-select a prefix.
    pub dom_unit_id: Option<i32>,
    pub dom_unit_name: Option<String>,
    pub dom_unit_symbol: Option<String>,
    pub count: i64,
}

pub async fn list_names(
    State(pool): State<MySqlPool>,
) -> Result<Json<Vec<ParameterNameRow>>, AppError> {
    let rows: Vec<ParameterNameRow> = sqlx::query_as(
        "SELECT t.name, t.valueType AS value_type, t.dom_unit_id, \
                u.name   AS dom_unit_name, \
                u.symbol AS dom_unit_symbol, \
                t.cnt    AS count \
         FROM ( \
            SELECT name, valueType, \
                   CASE WHEN COUNT(DISTINCT IFNULL(unit_id, -1)) = 1 \
                        THEN MAX(unit_id) ELSE NULL END AS dom_unit_id, \
                   COUNT(*) AS cnt \
            FROM PartParameter \
            WHERE name IS NOT NULL AND name <> '' \
            GROUP BY name, valueType \
         ) t \
         LEFT JOIN Unit u ON u.id = t.dom_unit_id \
         ORDER BY t.name, t.valueType",
    )
    .fetch_all(&pool)
    .await?;
    Ok(Json(rows))
}

// ---------------------------------------------------------------------------
//  GET /api/part_parameters/values
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct ValuesQuery {
    pub name: String,
    pub value_type: String, // "string" | "numeric"
}

#[derive(Debug, Serialize, FromRow)]
pub struct StringValueRow {
    pub string_value: String,
}

#[derive(Debug, Serialize, FromRow)]
pub struct NumericValueRow {
    pub value: f64,
    pub si_prefix_id: Option<i32>,
    pub si_prefix_symbol: Option<String>,
    pub normalized_value: Option<f64>,
}

#[derive(Debug, Serialize)]
#[serde(untagged)]
pub enum ValuesResponse {
    Strings(Vec<StringValueRow>),
    Numerics(Vec<NumericValueRow>),
}

pub async fn list_values(
    State(pool): State<MySqlPool>,
    Query(q): Query<ValuesQuery>,
) -> Result<Json<ValuesResponse>, AppError> {
    match q.value_type.as_str() {
        "string" => {
            let rows: Vec<StringValueRow> = sqlx::query_as(
                "SELECT DISTINCT stringValue AS string_value \
                 FROM PartParameter \
                 WHERE name = ? AND valueType = 'string' \
                       AND stringValue IS NOT NULL AND stringValue != '' \
                 ORDER BY stringValue",
            )
            .bind(&q.name)
            .fetch_all(&pool)
            .await?;
            Ok(Json(ValuesResponse::Strings(rows)))
        }
        "numeric" => {
            let rows: Vec<NumericValueRow> = sqlx::query_as(
                "SELECT DISTINCT pp.value, \
                        pp.siPrefix_id      AS si_prefix_id, \
                        sp.symbol           AS si_prefix_symbol, \
                        pp.normalizedValue  AS normalized_value \
                 FROM PartParameter pp \
                 LEFT JOIN SiPrefix sp ON sp.id = pp.siPrefix_id \
                 WHERE pp.name = ? AND pp.valueType = 'numeric' AND pp.value IS NOT NULL \
                 ORDER BY pp.normalizedValue, pp.value",
            )
            .bind(&q.name)
            .fetch_all(&pool)
            .await?;
            Ok(Json(ValuesResponse::Numerics(rows)))
        }
        _ => Err(AppError::BadRequest(
            "value_type must be 'string' or 'numeric'",
        )),
    }
}

// ---------------------------------------------------------------------------
//  POST /api/parts/parametric
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct Predicate {
    pub name: String,
    /// One of `=`, `!=`, `<`, `<=`, `>`, `>=`, `like`, `in`.
    pub op: String,
    /// "string" | "numeric".
    pub value_type: String,
    /// Single string operand (eq/ne/lt/le/gt/ge/like).
    #[serde(default)]
    pub string_value: Option<String>,
    /// String operand list (in).
    #[serde(default)]
    pub string_values: Option<Vec<String>>,
    /// Single numeric operand.
    #[serde(default)]
    pub value: Option<f64>,
    /// Numeric operand list (in).
    #[serde(default)]
    pub values: Option<Vec<f64>>,
    /// Optional SI prefix scaling for numeric values; same prefix applies
    /// to the whole `values` list when `in`.
    #[serde(default)]
    pub si_prefix_id: Option<i32>,
}

#[derive(Debug, Default, Deserialize)]
pub struct ParametricBody {
    #[serde(default)]
    pub predicates: Vec<Predicate>,
    #[serde(default)]
    pub category: Option<i32>,
    #[serde(default)]
    pub storage_folder: Option<i32>,
    #[serde(default)]
    pub storage_location: Option<i32>,
    #[serde(default)]
    pub footprint_folder: Option<i32>,
    #[serde(default)]
    pub footprint: Option<i32>,
    #[serde(default)]
    pub search: Option<String>,
    /// Slice 11 follow-up: meta-part filter, mirrors the equivalent on
    /// `/api/parts`. None = both, Some(true) = only meta, Some(false) = only real.
    #[serde(default)]
    pub meta_only: Option<bool>,
    #[serde(default)]
    pub limit: Option<u32>,
    #[serde(default)]
    pub offset: Option<u32>,
    #[serde(default)]
    pub sort: Option<String>,
    #[serde(default)]
    pub dir: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ParametricResponse {
    pub items: Vec<PartRow>,
    pub total: i64,
    pub limit: u32,
    pub offset: u32,
}

/// Built bind values for a single predicate's EXISTS clause. Bound
/// positionally on top of the standard list-filter binds.
enum BindValue {
    F64(f64),
    Str(String),
}

fn op_is_valid(op: &str) -> bool {
    matches!(op, "=" | "!=" | "<" | "<=" | ">" | ">=" | "like" | "in")
}

/// Build one predicate's `EXISTS (...)` clause + its binds (in order).
/// Numeric predicates pre-normalize their operand(s) using the supplied
/// SiPrefix's base/exponent so the comparison can target `normalizedValue`
/// directly.
fn build_predicate_clause(
    p: &Predicate,
    idx: usize,
    prefixes: &HashMap<i32, (i32, i32)>,
) -> Result<(String, Vec<BindValue>), AppError> {
    if !op_is_valid(&p.op) {
        return Err(AppError::BadRequest(
            "predicate op must be one of: =, !=, <, <=, >, >=, like, in",
        ));
    }
    if !matches!(p.value_type.as_str(), "string" | "numeric") {
        return Err(AppError::BadRequest(
            "predicate value_type must be 'string' or 'numeric'",
        ));
    }
    if p.value_type == "numeric" && p.op == "like" {
        return Err(AppError::BadRequest(
            "operator 'like' is only valid for string predicates",
        ));
    }
    if p.name.trim().is_empty() {
        return Err(AppError::BadRequest("predicate.name is required"));
    }

    let alias = format!("ppx{idx}");
    let mut binds: Vec<BindValue> = Vec::new();
    binds.push(BindValue::Str(p.name.clone()));
    binds.push(BindValue::Str(p.value_type.clone()));

    let body = match (p.value_type.as_str(), p.op.as_str()) {
        // ----- string -----
        ("string", "=") | ("string", "!=") | ("string", "<") | ("string", "<=")
        | ("string", ">") | ("string", ">=") => {
            let v = p.string_value.as_deref().ok_or(AppError::BadRequest(
                "predicate.string_value required for this op",
            ))?;
            binds.push(BindValue::Str(v.to_string()));
            format!("AND {alias}.stringValue {} ?", p.op)
        }
        ("string", "like") => {
            let v = p.string_value.as_deref().ok_or(AppError::BadRequest(
                "predicate.string_value required for 'like'",
            ))?;
            binds.push(BindValue::Str(v.to_string()));
            format!("AND {alias}.stringValue LIKE ?")
        }
        ("string", "in") => {
            let vs = p.string_values.as_ref().ok_or(AppError::BadRequest(
                "predicate.string_values required for 'in'",
            ))?;
            if vs.is_empty() {
                return Err(AppError::BadRequest(
                    "predicate.string_values must not be empty",
                ));
            }
            let placeholders = vec!["?"; vs.len()].join(",");
            for v in vs {
                binds.push(BindValue::Str(v.clone()));
            }
            format!("AND {alias}.stringValue IN ({placeholders})")
        }
        // ----- numeric -----
        // Strict-inequality cases — binary float comparison is fine; the
        // predicate value's float-representation drift is well below any
        // boundary the user can express.
        ("numeric", "<") | ("numeric", ">") => {
            let v = p
                .value
                .ok_or(AppError::BadRequest("predicate.value required for this op"))?;
            let nv = normalize(v, p.si_prefix_id, prefixes);
            binds.push(BindValue::F64(nv));
            format!("AND {alias}.normalizedValue {} ?", p.op)
        }
        // Equality and bounded inequality — must be tolerance-fuzzed.
        // The legacy data has values like 100 × 10⁻⁹ stored as exactly
        // 1e-7 (from PHP), but our Rust normalize produces
        // 1.0000000000000002e-7 due to binary-float drift in
        // (10.0_f64).powi(-9). A strict `=` would miss those rows.
        // Relative tolerance of 1e-9 is comfortably below any meaningful
        // electrical-component precision (5%/10%/20%) yet handles the
        // float drift cleanly across the full storable range.
        ("numeric", "=") => {
            let v = p
                .value
                .ok_or(AppError::BadRequest("predicate.value required for '='"))?;
            let nv = normalize(v, p.si_prefix_id, prefixes);
            binds.push(BindValue::F64(nv));
            binds.push(BindValue::F64(nv));
            format!("AND ABS({alias}.normalizedValue - ?) <= GREATEST(ABS(?), 1e-300) * 1e-9")
        }
        ("numeric", "!=") => {
            let v = p.value.ok_or(AppError::BadRequest(
                "predicate.value required for '!='",
            ))?;
            let nv = normalize(v, p.si_prefix_id, prefixes);
            binds.push(BindValue::F64(nv));
            binds.push(BindValue::F64(nv));
            format!("AND ABS({alias}.normalizedValue - ?) > GREATEST(ABS(?), 1e-300) * 1e-9")
        }
        ("numeric", "<=") => {
            let v = p.value.ok_or(AppError::BadRequest(
                "predicate.value required for '<='",
            ))?;
            let nv = normalize(v, p.si_prefix_id, prefixes);
            binds.push(BindValue::F64(nv));
            binds.push(BindValue::F64(nv));
            format!("AND {alias}.normalizedValue <= ? + GREATEST(ABS(?), 1e-300) * 1e-9")
        }
        ("numeric", ">=") => {
            let v = p.value.ok_or(AppError::BadRequest(
                "predicate.value required for '>='",
            ))?;
            let nv = normalize(v, p.si_prefix_id, prefixes);
            binds.push(BindValue::F64(nv));
            binds.push(BindValue::F64(nv));
            format!("AND {alias}.normalizedValue >= ? - GREATEST(ABS(?), 1e-300) * 1e-9")
        }
        ("numeric", "in") => {
            let vs = p.values.as_ref().ok_or(AppError::BadRequest(
                "predicate.values required for 'in'",
            ))?;
            if vs.is_empty() {
                return Err(AppError::BadRequest(
                    "predicate.values must not be empty",
                ));
            }
            // OR-of-tolerance-eq, mirroring `=` semantics so an `in`
            // list of [100, 220] nF doesn't silently miss values that
            // suffer the same float drift the legacy data has.
            let mut ors = Vec::with_capacity(vs.len());
            for v in vs {
                let nv = normalize(*v, p.si_prefix_id, prefixes);
                binds.push(BindValue::F64(nv));
                binds.push(BindValue::F64(nv));
                ors.push(format!(
                    "ABS({alias}.normalizedValue - ?) <= GREATEST(ABS(?), 1e-300) * 1e-9"
                ));
            }
            format!("AND ({})", ors.join(" OR "))
        }
        _ => unreachable!("invalid op/value_type combo passed earlier validation"),
    };

    let clause = format!(
        "EXISTS ( \
            SELECT 1 FROM PartParameter {alias} \
            WHERE {alias}.part_id = p.id \
              AND {alias}.name = ? AND {alias}.valueType = ? \
              {body} \
         )"
    );
    Ok((clause, binds))
}

fn normalize(v: f64, prefix_id: Option<i32>, prefixes: &HashMap<i32, (i32, i32)>) -> f64 {
    match prefix_id.and_then(|id| prefixes.get(&id)) {
        Some(&(base, exp)) => v * (base as f64).powi(exp),
        None => v,
    }
}

pub async fn parametric_search(
    State(pool): State<MySqlPool>,
    Json(body): Json<ParametricBody>,
) -> Result<Json<ParametricResponse>, AppError> {
    run_parametric_search(&pool, body).await
}

/// `GET /api/parts/{id}/matches?limit=&offset=` — load the meta-part's
/// stored criteria, translate them to predicates, and run the parametric
/// search. Returns the same shape as `parametric_search`. The part must
/// be flagged `metaPart=1`; for non-meta parts we return an empty list
/// rather than 400 (the UI can still call this idempotently).
pub async fn meta_part_matches(
    State(pool): State<MySqlPool>,
    Path(part_id): Path<i32>,
    Query(q): Query<MatchesQuery>,
) -> Result<Json<ParametricResponse>, AppError> {
    let limit = q.limit.unwrap_or(50).min(200);
    let offset = q.offset.unwrap_or(0);

    let head: Option<(i32, bool)> = sqlx::query_as(
        "SELECT id, metaPart FROM Part WHERE id = ?",
    )
    .bind(part_id)
    .fetch_optional(&pool)
    .await?;
    let (_, is_meta) = head.ok_or(AppError::NotFound("part"))?;
    if !is_meta {
        return Ok(Json(ParametricResponse {
            items: Vec::new(),
            total: 0,
            limit,
            offset,
        }));
    }

    #[derive(FromRow)]
    struct Crit {
        name: String,
        op: String,
        value_type: String,
        value: Option<f64>,
        string_value: String,
        si_prefix_id: Option<i32>,
    }
    let crits: Vec<Crit> = sqlx::query_as(
        "SELECT partParameterName AS name, operator AS op, \
                valueType AS value_type, value, \
                stringValue AS string_value, siPrefix_id AS si_prefix_id \
         FROM MetaPartParameterCriteria WHERE part_id = ?",
    )
    .bind(part_id)
    .fetch_all(&pool)
    .await?;
    if crits.is_empty() {
        return Ok(Json(ParametricResponse {
            items: Vec::new(),
            total: 0,
            limit,
            offset,
        }));
    }

    // Translate each criterion to a Predicate. `in` predicates would
    // need a values list — meta-criteria are scalar in the schema, so
    // it shouldn't fire here; if it does, treat the single value as a
    // 1-element list.
    let mut predicates = Vec::with_capacity(crits.len());
    for c in crits {
        let mut p = Predicate {
            name: c.name,
            op: c.op,
            value_type: c.value_type.clone(),
            string_value: None,
            string_values: None,
            value: None,
            values: None,
            si_prefix_id: c.si_prefix_id,
        };
        if c.value_type == "numeric" {
            if p.op == "in" {
                p.values = Some(c.value.into_iter().collect());
            } else {
                p.value = c.value;
            }
        } else if p.op == "in" {
            p.string_values = Some(vec![c.string_value]);
        } else {
            p.string_value = Some(c.string_value);
        }
        predicates.push(p);
    }

    // The meta-part itself shouldn't show up in its own match list.
    // We exclude by using a fake category filter? No — there's no
    // simple way; instead, filter client-side, or post-filter here.
    let body = ParametricBody {
        predicates,
        limit: Some(limit),
        offset: Some(offset),
        ..Default::default()
    };
    let mut resp = run_parametric_search(&pool, body).await?.0;
    // Drop the meta-part from its own results (it has parameters that
    // would match its own criteria, by definition for a useful one).
    let before = resp.items.len();
    resp.items.retain(|r| r.part.id != part_id);
    resp.total -= (before - resp.items.len()) as i64;
    Ok(Json(resp))
}

#[derive(Debug, Deserialize)]
pub struct MatchesQuery {
    pub limit: Option<u32>,
    pub offset: Option<u32>,
}

/// Shared core: builds the parametric SQL and runs it. Used by both
/// `parametric_search` (POST endpoint) and `meta_part_matches` (which
/// constructs a Body from saved criteria and then defers to this).
async fn run_parametric_search(
    pool: &MySqlPool,
    body: ParametricBody,
) -> Result<Json<ParametricResponse>, AppError> {
    let limit = body.limit.unwrap_or(50).min(200);
    let offset = body.offset.unwrap_or(0);

    // Pre-fetch SI prefixes so we can normalize each numeric predicate
    // without a per-predicate DB round-trip. ~30 rows; cheap.
    let prefixes: HashMap<i32, (i32, i32)> = {
        let rows: Vec<(i32, i32, i32)> =
            sqlx::query_as("SELECT id, base, exponent FROM SiPrefix")
                .fetch_all(pool)
                .await?;
        rows.into_iter().map(|(id, b, e)| (id, (b, e))).collect()
    };

    // Build predicate clauses + binds.
    let mut pred_clauses: Vec<String> = Vec::with_capacity(body.predicates.len());
    let mut pred_binds: Vec<BindValue> = Vec::new();
    for (i, p) in body.predicates.iter().enumerate() {
        let (clause, binds) = build_predicate_clause(p, i, &prefixes)?;
        pred_clauses.push(clause);
        pred_binds.extend(binds);
    }

    // Standard list-filter machinery (mirrors handlers::parts::list).
    let from_join_select = if body.category.is_some() {
        "FROM Part p \
         LEFT JOIN PartCategory cp ON cp.id = p.category_id \
         JOIN PartCategory cf ON cf.id = ?"
    } else {
        "FROM Part p \
         LEFT JOIN PartCategory cp ON cp.id = p.category_id"
    };
    let from_join_count = if body.category.is_some() {
        "FROM Part p \
         JOIN PartCategory cp ON cp.id = p.category_id \
         JOIN PartCategory cf ON cf.id = ?"
    } else {
        "FROM Part p"
    };

    let mut where_clauses: Vec<String> = Vec::new();
    if body.category.is_some() {
        where_clauses.push("cp.lft >= cf.lft AND cp.rgt <= cf.rgt".to_string());
    }
    if body.storage_location.is_some() {
        where_clauses.push("p.storageLocation_id = ?".to_string());
    }
    if body.storage_folder.is_some() {
        where_clauses.push(
            "p.storageLocation_id IN (\
                SELECT sl.id FROM StorageLocation sl \
                JOIN StorageLocationCategory slc ON slc.id = sl.category_id \
                JOIN StorageLocationCategory sf ON sf.id = ? \
                WHERE slc.lft >= sf.lft AND slc.rgt <= sf.rgt)"
                .to_string(),
        );
    }
    if body.footprint.is_some() {
        where_clauses.push("p.footprint_id = ?".to_string());
    }
    if body.footprint_folder.is_some() {
        where_clauses.push(
            "p.footprint_id IN (\
                SELECT f.id FROM Footprint f \
                JOIN FootprintCategory fc ON fc.id = f.category_id \
                JOIN FootprintCategory ff ON ff.id = ? \
                WHERE fc.lft >= ff.lft AND fc.rgt <= ff.rgt)"
                .to_string(),
        );
    }
    if body.search.is_some() {
        where_clauses
            .push("(p.name LIKE ? OR p.description LIKE ? OR p.internalPartNumber LIKE ?)".into());
    }
    if let Some(only) = body.meta_only {
        where_clauses.push(if only {
            "p.metaPart = 1".into()
        } else {
            "(p.metaPart = 0 OR p.metaPart IS NULL)".into()
        });
    }
    where_clauses.extend(pred_clauses.into_iter());
    let where_part = if where_clauses.is_empty() {
        String::new()
    } else {
        format!(" WHERE {}", where_clauses.join(" AND "))
    };

    let sort_col = match body.sort.as_deref() {
        Some("id") => "p.id",
        Some("description") => "p.description",
        Some("stock_level") => "p.stockLevel",
        Some("min_stock_level") => "p.minStockLevel",
        Some("average_price") => "p.averagePrice",
        Some("status") => "p.status",
        Some("part_condition") => "p.partCondition",
        Some("internal_part_number") => "p.internalPartNumber",
        _ => "p.name",
    };
    let dir_str = if body.dir.as_deref() == Some("desc") {
        "DESC"
    } else {
        "ASC"
    };

    let select_sql = format!(
        "SELECT p.*, cp.categoryPath AS category_path {from_join_select}{where_part} \
         ORDER BY cp.categoryPath ASC, {sort_col} {dir_str} LIMIT ? OFFSET ?"
    );
    let count_sql = format!("SELECT COUNT(*) {from_join_count}{where_part}");

    let mut sel = sqlx::query_as::<_, PartRow>(&select_sql);
    let mut cnt = sqlx::query_scalar::<_, i64>(&count_sql);
    // Bind order matches the `?` placeholders in the SQL above:
    // 1. category (twice — once per query) if present
    // 2. standard filter binds
    // 3. predicate binds
    // 4. limit/offset (sel only)
    if let Some(cat) = body.category {
        sel = sel.bind(cat);
        cnt = cnt.bind(cat);
    }
    if let Some(loc) = body.storage_location {
        sel = sel.bind(loc);
        cnt = cnt.bind(loc);
    }
    if let Some(folder) = body.storage_folder {
        sel = sel.bind(folder);
        cnt = cnt.bind(folder);
    }
    if let Some(fp) = body.footprint {
        sel = sel.bind(fp);
        cnt = cnt.bind(fp);
    }
    if let Some(folder) = body.footprint_folder {
        sel = sel.bind(folder);
        cnt = cnt.bind(folder);
    }
    if let Some(s) = body.search.as_deref() {
        let pat = format!("%{s}%");
        sel = sel.bind(pat.clone()).bind(pat.clone()).bind(pat.clone());
        cnt = cnt.bind(pat.clone()).bind(pat.clone()).bind(pat);
    }
    for b in &pred_binds {
        match b {
            BindValue::F64(v) => {
                sel = sel.bind(*v);
                cnt = cnt.bind(*v);
            }
            BindValue::Str(v) => {
                sel = sel.bind(v.clone());
                cnt = cnt.bind(v.clone());
            }
        }
    }
    sel = sel.bind(limit as i64).bind(offset as i64);

    let items = sel.fetch_all(pool).await?;
    let total = cnt.fetch_one(pool).await?;

    Ok(Json(ParametricResponse {
        items,
        total,
        limit,
        offset,
    }))
}

