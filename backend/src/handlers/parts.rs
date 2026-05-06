//! Slice 4a: hand-written endpoints powering the PartManager screen.
//!
//! - `GET /api/part_categories/tree`  — category nested-set as a JSON tree
//! - `GET /api/parts?category=&search=&limit=&offset=`  — paginated list
//! - `GET /api/parts/{id}`  — single Part with related rows expanded
//!
//! All read-only. Writes land in later slices.

use std::collections::HashMap;

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use chrono::{NaiveDateTime, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, MySqlPool};

use crate::error::AppError;
use crate::models::part::Part;

// ---------------------------------------------------------------------------
//  GET /api/part_categories/tree
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
pub struct PartCategoryNode {
    pub id: i32,
    pub name: String,
    pub lvl: i32,
    pub category_path: String,
    pub children: Vec<PartCategoryNode>,
}

pub async fn category_tree(
    State(pool): State<MySqlPool>,
) -> Result<Json<Vec<PartCategoryNode>>, AppError> {
    #[derive(FromRow)]
    struct Row {
        id: i32,
        parent_id: Option<i32>,
        name: String,
        lvl: i32,
        category_path: Option<String>,
    }

    let rows: Vec<Row> = sqlx::query_as(
        "SELECT id, parent_id, name, lvl, categoryPath AS category_path \
         FROM PartCategory ORDER BY lft",
    )
    .fetch_all(&pool)
    .await?;

    // Adjacency map: parent_id → indices of children in `rows`. Walking the
    // map recursively builds the tree without fighting the borrow checker.
    let mut children_idx: HashMap<Option<i32>, Vec<usize>> = HashMap::new();
    for (i, r) in rows.iter().enumerate() {
        children_idx.entry(r.parent_id).or_default().push(i);
    }

    fn build(
        idx: usize,
        rows: &[Row],
        children_idx: &HashMap<Option<i32>, Vec<usize>>,
    ) -> PartCategoryNode {
        let r = &rows[idx];
        let children = children_idx
            .get(&Some(r.id))
            .map(|cs| cs.iter().map(|&ci| build(ci, rows, children_idx)).collect())
            .unwrap_or_default();
        PartCategoryNode {
            id: r.id,
            name: r.name.clone(),
            lvl: r.lvl,
            category_path: r.category_path.clone().unwrap_or_default(),
            children,
        }
    }

    let roots: Vec<PartCategoryNode> = children_idx
        .get(&None)
        .map(|cs| cs.iter().map(|&ci| build(ci, &rows, &children_idx)).collect())
        .unwrap_or_default();

    Ok(Json(roots))
}

// ---------------------------------------------------------------------------
//  GET /api/parts  (paginated, filterable)
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct ListQuery {
    /// Category id to filter by. Includes descendants via lft/rgt containment.
    pub category: Option<i32>,
    /// LIKE-search across name / description / internalPartNumber.
    pub search: Option<String>,
    pub limit: Option<u32>,
    pub offset: Option<u32>,
    /// Sort column. One of: id, name, description, stock_level,
    /// min_stock_level, average_price, status, part_condition,
    /// internal_part_number. Default: name. Anything else falls back.
    pub sort: Option<String>,
    /// "asc" (default) or "desc".
    pub dir: Option<String>,
}

/// One row of the paginated parts list. Wraps Part with its category path
/// resolved (so the frontend can group by leaf category breadcrumb without
/// a separate per-row lookup).
#[derive(Debug, Serialize, FromRow)]
pub struct PartRow {
    #[serde(flatten)]
    #[sqlx(flatten)]
    pub part: Part,
    pub category_path: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ListResponse {
    pub items: Vec<PartRow>,
    pub total: i64,
    pub limit: u32,
    pub offset: u32,
}

pub async fn list(
    State(pool): State<MySqlPool>,
    Query(q): Query<ListQuery>,
) -> Result<Json<ListResponse>, AppError> {
    let limit = q.limit.unwrap_or(50).min(200);
    let offset = q.offset.unwrap_or(0);

    // The SELECT always LEFT-JOINs PartCategory so we can return
    // category_path on every row; the frontend groups by it.
    // For category-filter, we additionally JOIN against the requested
    // category and keep only descendants via lft/rgt containment.
    let from_join_select = if q.category.is_some() {
        "FROM Part p \
         LEFT JOIN PartCategory cp ON cp.id = p.category_id \
         JOIN PartCategory cf ON cf.id = ?"
    } else {
        "FROM Part p \
         LEFT JOIN PartCategory cp ON cp.id = p.category_id"
    };
    // The COUNT query doesn't need the path JOIN, but it does need the
    // descendant-filter JOIN so the count matches the SELECT.
    let from_join_count = if q.category.is_some() {
        "FROM Part p \
         JOIN PartCategory cp ON cp.id = p.category_id \
         JOIN PartCategory cf ON cf.id = ?"
    } else {
        "FROM Part p"
    };

    let mut where_clauses: Vec<&str> = Vec::new();
    if q.category.is_some() {
        where_clauses.push("cp.lft >= cf.lft AND cp.rgt <= cf.rgt");
    }
    if q.search.is_some() {
        where_clauses
            .push("(p.name LIKE ? OR p.description LIKE ? OR p.internalPartNumber LIKE ?)");
    }
    let where_part = if where_clauses.is_empty() {
        String::new()
    } else {
        format!(" WHERE {}", where_clauses.join(" AND "))
    };

    // Whitelist sort column (avoid SQL injection — sort is a free-form
    // user param). Falls back to name on unknown.
    let sort_col = match q.sort.as_deref() {
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
    let dir_str = if q.dir.as_deref() == Some("desc") { "DESC" } else { "ASC" };

    // Always group by category path first (sticky section headers in the
    // UI rely on contiguous groups); within a group, apply the user-chosen
    // sort.
    let select_sql = format!(
        "SELECT p.*, cp.categoryPath AS category_path {from_join_select}{where_part} \
         ORDER BY cp.categoryPath ASC, {sort_col} {dir_str} LIMIT ? OFFSET ?"
    );
    let count_sql = format!("SELECT COUNT(*) {from_join_count}{where_part}");

    let mut sel = sqlx::query_as::<_, PartRow>(&select_sql);
    let mut cnt = sqlx::query_scalar::<_, i64>(&count_sql);
    if let Some(cat) = q.category {
        sel = sel.bind(cat);
        cnt = cnt.bind(cat);
    }
    if let Some(s) = q.search.as_deref() {
        let pat = format!("%{s}%");
        sel = sel.bind(pat.clone()).bind(pat.clone()).bind(pat.clone());
        cnt = cnt.bind(pat.clone()).bind(pat.clone()).bind(pat);
    }
    sel = sel.bind(limit as i64).bind(offset as i64);

    let items = sel.fetch_all(&pool).await?;
    let total = cnt.fetch_one(&pool).await?;

    Ok(Json(ListResponse {
        items,
        total,
        limit,
        offset,
    }))
}

// ---------------------------------------------------------------------------
//  GET /api/parts/{id}  (with related rows expanded)
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, FromRow)]
pub struct CategorySummary {
    pub id: i32,
    pub name: String,
    #[sqlx(rename = "categoryPath")]
    pub category_path: Option<String>,
    pub lvl: i32,
}

#[derive(Debug, Serialize, FromRow)]
pub struct StorageLocationSummary {
    pub id: i32,
    pub name: String,
    pub category_id: Option<i32>,
    pub category_path: Option<String>,
}

#[derive(Debug, Serialize, FromRow)]
pub struct FootprintSummary {
    pub id: i32,
    pub name: String,
}

#[derive(Debug, Serialize, FromRow)]
pub struct PartUnitSummary {
    pub id: i32,
    pub name: String,
    #[sqlx(rename = "shortName")]
    pub short_name: String,
    pub is_default: bool,
}

#[derive(Debug, Serialize, FromRow)]
pub struct PartManufacturerView {
    pub id: i32,
    pub manufacturer_id: i32,
    pub manufacturer_name: String,
    #[sqlx(rename = "partNumber")]
    pub part_number: Option<String>,
}

#[derive(Debug, Serialize, FromRow)]
pub struct PartDistributorView {
    pub id: i32,
    pub distributor_id: i32,
    pub distributor_name: String,
    #[sqlx(rename = "orderNumber")]
    pub order_number: Option<String>,
    pub price: Option<Decimal>,
    pub currency: Option<String>,
    pub sku: Option<String>,
    #[sqlx(rename = "packagingUnit")]
    pub packaging_unit: i32,
    #[sqlx(rename = "ignoreForReports")]
    pub ignore_for_reports: Option<bool>,
}

#[derive(Debug, Serialize, FromRow)]
pub struct PartParameterView {
    pub id: i32,
    pub name: String,
    pub description: String,
    #[sqlx(rename = "valueType")]
    pub value_type: String,
    pub value: Option<f64>,
    #[sqlx(rename = "stringValue")]
    pub string_value: String,
    #[sqlx(rename = "minimumValue")]
    pub minimum_value: Option<f64>,
    #[sqlx(rename = "maximumValue")]
    pub maximum_value: Option<f64>,
    pub unit_id: Option<i32>,
    pub unit_name: Option<String>,
    pub unit_symbol: Option<String>,
    #[sqlx(rename = "siPrefix_id")]
    pub si_prefix_id: Option<i32>,
    pub si_prefix_name: Option<String>,
    pub si_prefix_symbol: Option<String>,
    #[sqlx(rename = "minSiPrefix_id")]
    pub min_si_prefix_id: Option<i32>,
    #[sqlx(rename = "maxSiPrefix_id")]
    pub max_si_prefix_id: Option<i32>,
}

#[derive(Debug, Serialize, FromRow)]
pub struct PartAttachmentView {
    pub id: i32,
    pub filename: String,
    #[sqlx(rename = "originalname")]
    pub original_filename: Option<String>,
    pub mimetype: String,
    pub size: i32,
    pub description: Option<String>,
    #[sqlx(rename = "isImage")]
    pub is_image: Option<bool>,
    pub extension: Option<String>,
    /// Optional even though DDL says NOT NULL — see CLAUDE.md "zero-datetime"
    /// note. ~571 of 1164 PartAttachment rows have `0000-00-00 00:00:00`.
    pub created: Option<NaiveDateTime>,
}

#[derive(Debug, Serialize, FromRow)]
pub struct StockEntryView {
    pub id: i32,
    #[sqlx(rename = "stockLevel")]
    pub stock_level: i32, // delta — negative for removal
    pub price: Option<Decimal>,
    #[sqlx(rename = "dateTime")]
    pub date_time: Option<NaiveDateTime>,
    pub correction: bool,
    pub comment: Option<String>,
    pub user_id: Option<i32>,
    pub username: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct PartDetail {
    #[serde(flatten)]
    pub part: Part,

    pub category: Option<CategorySummary>,
    pub storage_location: Option<StorageLocationSummary>,
    pub footprint: Option<FootprintSummary>,
    pub part_unit: Option<PartUnitSummary>,
    pub manufacturers: Vec<PartManufacturerView>,
    pub distributors: Vec<PartDistributorView>,
    pub parameters: Vec<PartParameterView>,
    pub attachments: Vec<PartAttachmentView>,
    pub stock_entries: Vec<StockEntryView>,
}

const STOCK_ENTRY_LIMIT: i64 = 50;

pub async fn detail(
    State(pool): State<MySqlPool>,
    Path(id): Path<i32>,
) -> Result<Json<PartDetail>, AppError> {
    let part: Part = sqlx::query_as("SELECT * FROM Part WHERE id = ?")
        .bind(id)
        .fetch_optional(&pool)
        .await?
        .ok_or(AppError::NotFound("part"))?;

    let category = match part.category_id {
        Some(cid) => sqlx::query_as::<_, CategorySummary>(
            "SELECT id, name, categoryPath, lvl FROM PartCategory WHERE id = ?",
        )
        .bind(cid)
        .fetch_optional(&pool)
        .await?,
        None => None,
    };

    let storage_location = match part.storage_location_id {
        Some(sid) => sqlx::query_as::<_, StorageLocationSummary>(
            "SELECT s.id, s.name, s.category_id, c.categoryPath AS category_path \
             FROM StorageLocation s \
             LEFT JOIN StorageLocationCategory c ON c.id = s.category_id \
             WHERE s.id = ?",
        )
        .bind(sid)
        .fetch_optional(&pool)
        .await?,
        None => None,
    };

    let footprint = match part.footprint_id {
        Some(fid) => sqlx::query_as::<_, FootprintSummary>(
            "SELECT id, name FROM Footprint WHERE id = ?",
        )
        .bind(fid)
        .fetch_optional(&pool)
        .await?,
        None => None,
    };

    let part_unit = match part.part_unit_id {
        Some(uid) => sqlx::query_as::<_, PartUnitSummary>(
            "SELECT id, name, shortName, is_default FROM PartUnit WHERE id = ?",
        )
        .bind(uid)
        .fetch_optional(&pool)
        .await?,
        None => None,
    };

    let manufacturers: Vec<PartManufacturerView> = sqlx::query_as(
        "SELECT pm.id, m.id AS manufacturer_id, m.name AS manufacturer_name, pm.partNumber \
         FROM PartManufacturer pm \
         JOIN Manufacturer m ON m.id = pm.manufacturer_id \
         WHERE pm.part_id = ? \
         ORDER BY m.name",
    )
    .bind(id)
    .fetch_all(&pool)
    .await?;

    let distributors: Vec<PartDistributorView> = sqlx::query_as(
        "SELECT pd.id, d.id AS distributor_id, d.name AS distributor_name, \
                pd.orderNumber, pd.price, pd.currency, pd.sku, \
                pd.packagingUnit, pd.ignoreForReports \
         FROM PartDistributor pd \
         JOIN Distributor d ON d.id = pd.distributor_id \
         WHERE pd.part_id = ? \
         ORDER BY d.name",
    )
    .bind(id)
    .fetch_all(&pool)
    .await?;

    let parameters: Vec<PartParameterView> = sqlx::query_as(
        "SELECT pp.id, pp.name, pp.description, pp.valueType, pp.value, pp.stringValue, \
                pp.minimumValue, pp.maximumValue, \
                u.id AS unit_id, u.name AS unit_name, u.symbol AS unit_symbol, \
                pp.siPrefix_id, sp.prefix AS si_prefix_name, sp.symbol AS si_prefix_symbol, \
                pp.minSiPrefix_id, pp.maxSiPrefix_id \
         FROM PartParameter pp \
         LEFT JOIN Unit u ON u.id = pp.unit_id \
         LEFT JOIN SiPrefix sp ON sp.id = pp.siPrefix_id \
         WHERE pp.part_id = ? \
         ORDER BY pp.name",
    )
    .bind(id)
    .fetch_all(&pool)
    .await?;

    let attachments: Vec<PartAttachmentView> = sqlx::query_as(
        "SELECT id, filename, originalname, mimetype, size, description, \
                isImage, extension, created \
         FROM PartAttachment WHERE part_id = ? ORDER BY created DESC",
    )
    .bind(id)
    .fetch_all(&pool)
    .await?;

    let stock_entries: Vec<StockEntryView> = sqlx::query_as(
        "SELECT se.id, se.stockLevel, se.price, se.dateTime, se.correction, se.comment, \
                se.user_id, u.username \
         FROM StockEntry se \
         LEFT JOIN PartKeeprUser u ON u.id = se.user_id \
         WHERE se.part_id = ? \
         ORDER BY se.dateTime DESC \
         LIMIT ?",
    )
    .bind(id)
    .bind(STOCK_ENTRY_LIMIT)
    .fetch_all(&pool)
    .await?;

    Ok(Json(PartDetail {
        part,
        category,
        storage_location,
        footprint,
        part_unit,
        manufacturers,
        distributors,
        parameters,
        attachments,
        stock_entries,
    }))
}

// ---------------------------------------------------------------------------
//  POST / PUT / DELETE /api/parts (slice 5b — Part editing)
// ---------------------------------------------------------------------------

/// Editable fields of a Part plus its child collections. Used as the body
/// of both POST (create) and PUT (update).
///
/// Fields not in this struct (`stock_level`, `average_price`, `low_stock`,
/// `removals`, `create_date`) are derived/auto-set by the server and
/// should never come from the client. `id` is path-only on PUT, server-
/// assigned on POST.
#[derive(Debug, Deserialize)]
pub struct PartWrite {
    pub name: String,
    pub description: Option<String>,
    pub comment: String,
    pub category_id: Option<i32>,
    pub footprint_id: Option<i32>,
    pub storage_location_id: Option<i32>,
    pub part_unit_id: Option<i32>,
    pub internal_part_number: Option<String>,
    pub status: Option<String>,
    pub part_condition: Option<String>,
    pub production_remarks: Option<String>,
    #[serde(default)]
    pub needs_review: bool,
    pub min_stock_level: i32,
    #[serde(default)]
    pub meta_part: bool,
    /// If `None` on PUT, leave existing children alone. If `Some(vec)`,
    /// replace atomically. (POST treats None as empty.)
    pub manufacturers: Option<Vec<PartManufacturerWrite>>,
    pub distributors: Option<Vec<PartDistributorWrite>>,
    pub parameters: Option<Vec<PartParameterWrite>>,
}

#[derive(Debug, Deserialize)]
pub struct PartManufacturerWrite {
    pub manufacturer_id: i32,
    pub part_number: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct PartDistributorWrite {
    pub distributor_id: i32,
    pub order_number: Option<String>,
    pub price: Option<Decimal>,
    pub currency: Option<String>,
    pub sku: Option<String>,
    pub packaging_unit: i32,
    #[serde(default)]
    pub ignore_for_reports: bool,
}

#[derive(Debug, Deserialize)]
pub struct PartParameterWrite {
    pub name: String,
    #[serde(default)]
    pub description: String,
    /// "string" or "numeric"
    pub value_type: String,
    pub value: Option<f64>,
    #[serde(default)]
    pub string_value: String,
    pub minimum_value: Option<f64>,
    pub maximum_value: Option<f64>,
    pub unit_id: Option<i32>,
    pub si_prefix_id: Option<i32>,
    pub min_si_prefix_id: Option<i32>,
    pub max_si_prefix_id: Option<i32>,
}

fn validate_part(p: &PartWrite) -> Result<(), AppError> {
    if p.name.trim().is_empty() {
        return Err(AppError::BadRequest("name is required"));
    }
    if p.min_stock_level < 0 {
        return Err(AppError::BadRequest("min_stock_level must be >= 0"));
    }
    Ok(())
}

pub async fn create(
    State(pool): State<MySqlPool>,
    Json(req): Json<PartWrite>,
) -> Result<impl IntoResponse, AppError> {
    validate_part(&req)?;
    let mut tx = pool.begin().await?;

    let now = Utc::now().naive_utc();
    let result = sqlx::query(
        "INSERT INTO Part \
            (category_id, footprint_id, name, description, comment, \
             stockLevel, minStockLevel, averagePrice, status, needsReview, \
             partCondition, createDate, partUnit_id, storageLocation_id, \
             removals, lowStock, productionRemarks, internalPartNumber, metaPart) \
         VALUES (?, ?, ?, ?, ?, 0, ?, 0, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)",
    )
    .bind(req.category_id)
    .bind(req.footprint_id)
    .bind(&req.name)
    .bind(&req.description)
    .bind(&req.comment)
    .bind(req.min_stock_level)
    .bind(&req.status)
    .bind(req.needs_review)
    .bind(&req.part_condition)
    .bind(now)
    .bind(req.part_unit_id)
    .bind(req.storage_location_id)
    .bind(req.min_stock_level == 0) // lowStock: arbitrary at create-time
    .bind(&req.production_remarks)
    .bind(&req.internal_part_number)
    .bind(req.meta_part)
    .execute(&mut *tx)
    .await
    .map_err(map_fk_err)?;

    let new_id = result.last_insert_id() as i32;

    insert_children(&mut tx, new_id, &req).await?;

    tx.commit().await?;
    Ok((StatusCode::CREATED, Json(serde_json::json!({"id": new_id}))))
}

pub async fn update(
    State(pool): State<MySqlPool>,
    Path(id): Path<i32>,
    Json(req): Json<PartWrite>,
) -> Result<Json<serde_json::Value>, AppError> {
    validate_part(&req)?;
    let mut tx = pool.begin().await?;

    let exists: Option<(i32,)> = sqlx::query_as("SELECT id FROM Part WHERE id = ?")
        .bind(id)
        .fetch_optional(&mut *tx)
        .await?;
    if exists.is_none() {
        return Err(AppError::NotFound("part"));
    }

    sqlx::query(
        "UPDATE Part SET \
            category_id = ?, footprint_id = ?, name = ?, description = ?, comment = ?, \
            minStockLevel = ?, status = ?, needsReview = ?, partCondition = ?, \
            partUnit_id = ?, storageLocation_id = ?, productionRemarks = ?, \
            internalPartNumber = ?, metaPart = ? \
         WHERE id = ?",
    )
    .bind(req.category_id)
    .bind(req.footprint_id)
    .bind(&req.name)
    .bind(&req.description)
    .bind(&req.comment)
    .bind(req.min_stock_level)
    .bind(&req.status)
    .bind(req.needs_review)
    .bind(&req.part_condition)
    .bind(req.part_unit_id)
    .bind(req.storage_location_id)
    .bind(&req.production_remarks)
    .bind(&req.internal_part_number)
    .bind(req.meta_part)
    .bind(id)
    .execute(&mut *tx)
    .await
    .map_err(map_fk_err)?;

    // Replace nested children atomically *only for fields the request
    // actually provided*. None = "leave alone", Some = "replace". This
    // lets the frontend edit top-level fields without having to round-trip
    // the children. DELETE+INSERT is cheap; no diff'ing needed since
    // these tables have no external references.
    if req.manufacturers.is_some() {
        sqlx::query("DELETE FROM PartManufacturer WHERE part_id = ?")
            .bind(id).execute(&mut *tx).await?;
    }
    if req.distributors.is_some() {
        sqlx::query("DELETE FROM PartDistributor WHERE part_id = ?")
            .bind(id).execute(&mut *tx).await?;
    }
    if req.parameters.is_some() {
        sqlx::query("DELETE FROM PartParameter WHERE part_id = ?")
            .bind(id).execute(&mut *tx).await?;
    }

    insert_children(&mut tx, id, &req).await?;

    // lowStock flag follows from the *current* stockLevel (unchanged here)
    // and the new minStockLevel. Recompute it.
    sqlx::query(
        "UPDATE Part SET lowStock = (stockLevel < minStockLevel) WHERE id = ?",
    )
    .bind(id)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(Json(serde_json::json!({"id": id})))
}

async fn insert_children(
    tx: &mut sqlx::Transaction<'_, sqlx::MySql>,
    part_id: i32,
    req: &PartWrite,
) -> Result<(), AppError> {
    // Pre-fetch SiPrefix base/exponent so we can compute normalizedValue
    // without an extra round-trip per parameter. Used by parametric
    // filtering (slice 11) — comparing values across prefixes (e.g., "all
    // caps < 1 nF" finds both 500 pF and 0.5 nF) requires the
    // normalized representation to be stored at write time.
    let mut prefixes: HashMap<i32, (i32, i32)> = HashMap::new();
    if req.parameters.as_ref().is_some_and(|v| !v.is_empty()) {
        let rows: Vec<(i32, i32, i32)> = sqlx::query_as(
            "SELECT id, base, exponent FROM SiPrefix",
        )
        .fetch_all(&mut **tx)
        .await?;
        for (id, base, exp) in rows {
            prefixes.insert(id, (base, exp));
        }
    }
    let normalize = |v: Option<f64>, prefix_id: Option<i32>| -> Option<f64> {
        let v = v?;
        match prefix_id.and_then(|id| prefixes.get(&id)) {
            Some(&(base, exp)) => Some(v * (base as f64).powi(exp)),
            None => Some(v),
        }
    };

    for m in req.manufacturers.iter().flatten() {
        sqlx::query(
            "INSERT INTO PartManufacturer (part_id, manufacturer_id, partNumber) \
             VALUES (?, ?, ?)",
        )
        .bind(part_id)
        .bind(m.manufacturer_id)
        .bind(&m.part_number)
        .execute(&mut **tx)
        .await
        .map_err(map_fk_err)?;
    }
    for d in req.distributors.iter().flatten() {
        sqlx::query(
            "INSERT INTO PartDistributor \
                (part_id, distributor_id, orderNumber, price, currency, sku, \
                 packagingUnit, ignoreForReports) \
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(part_id)
        .bind(d.distributor_id)
        .bind(&d.order_number)
        .bind(d.price)
        .bind(&d.currency)
        .bind(&d.sku)
        .bind(d.packaging_unit)
        .bind(d.ignore_for_reports)
        .execute(&mut **tx)
        .await
        .map_err(map_fk_err)?;
    }
    for p in req.parameters.iter().flatten() {
        if p.value_type != "string" && p.value_type != "numeric" {
            return Err(AppError::BadRequest(
                "parameter value_type must be 'string' or 'numeric'",
            ));
        }
        let normalized_value = normalize(p.value, p.si_prefix_id);
        let normalized_min = normalize(p.minimum_value, p.min_si_prefix_id);
        let normalized_max = normalize(p.maximum_value, p.max_si_prefix_id);
        sqlx::query(
            "INSERT INTO PartParameter \
                (part_id, unit_id, name, description, value, siPrefix_id, \
                 normalizedValue, maximumValue, normalizedMaxValue, \
                 minimumValue, normalizedMinValue, stringValue, valueType, \
                 minSiPrefix_id, maxSiPrefix_id) \
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(part_id)
        .bind(p.unit_id)
        .bind(&p.name)
        .bind(&p.description)
        .bind(p.value)
        .bind(p.si_prefix_id)
        .bind(normalized_value)
        .bind(p.maximum_value)
        .bind(normalized_max)
        .bind(p.minimum_value)
        .bind(normalized_min)
        .bind(&p.string_value)
        .bind(&p.value_type)
        .bind(p.min_si_prefix_id)
        .bind(p.max_si_prefix_id)
        .execute(&mut **tx)
        .await
        .map_err(map_fk_err)?;
    }
    Ok(())
}

pub async fn delete(
    State(pool): State<MySqlPool>,
    Path(id): Path<i32>,
) -> Result<StatusCode, AppError> {
    let mut tx = pool.begin().await?;

    let exists: Option<(i32,)> = sqlx::query_as("SELECT id FROM Part WHERE id = ?")
        .bind(id)
        .fetch_optional(&mut *tx)
        .await?;
    if exists.is_none() {
        return Err(AppError::NotFound("part"));
    }

    // Cascade-delete the part's private children. Anything referencing the
    // part from cross-cutting tables (ProjectPart, ProjectRunPart,
    // ReportPart) is deliberately NOT cleaned up here — those are audit /
    // history rows that should require explicit removal via project
    // workflows. The final DELETE FROM Part will fail with a 409 if any
    // such reference still exists.
    for sql in [
        "DELETE FROM PartManufacturer WHERE part_id = ?",
        "DELETE FROM PartDistributor WHERE part_id = ?",
        "DELETE FROM PartParameter WHERE part_id = ?",
        "DELETE FROM PartAttachment WHERE part_id = ?",
        "DELETE FROM StockEntry WHERE part_id = ?",
        "DELETE FROM MetaPartParameterCriteria WHERE part_id = ?",
    ] {
        sqlx::query(sql).bind(id).execute(&mut *tx).await?;
    }

    sqlx::query("DELETE FROM Part WHERE id = ?")
        .bind(id)
        .execute(&mut *tx)
        .await
        .map_err(|e| match &e {
            sqlx::Error::Database(db) if is_fk_violation(db.as_ref()) => {
                AppError::BadRequest(
                    "part is referenced by projects/reports — remove those first",
                )
            }
            _ => AppError::Db(e),
        })?;

    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

fn is_fk_violation(err: &dyn sqlx::error::DatabaseError) -> bool {
    // MySQL/MariaDB FK constraint violation is error code 1452 (insert/update)
    // or 1451 (delete). The string code is "23000".
    matches!(err.code().as_deref(), Some("23000"))
}

fn map_fk_err(e: sqlx::Error) -> AppError {
    if let sqlx::Error::Database(db) = &e {
        if is_fk_violation(db.as_ref()) {
            return AppError::BadRequest(
                "referenced category, storage location, footprint, unit, manufacturer, \
                 distributor, or SI prefix does not exist",
            );
        }
    }
    AppError::Db(e)
}
