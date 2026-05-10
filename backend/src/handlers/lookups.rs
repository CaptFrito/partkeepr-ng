// SPDX-License-Identifier: GPL-3.0-or-later

//! Slice 5c-4: flat-lookup CRUD for Manufacturer, Distributor, PartUnit
//! (a.k.a. PartMeasurementUnit), Unit, SiPrefix, plus the `UnitSiPrefixes`
//! many-to-many join.
//!
//! Every entity here is a flat lookup — no tree, no leaf-of-folder
//! relationship. The hand-written list endpoints attach a `part_count`
//! (or `unit_count` for SiPrefix) so the delete dialog can refuse
//! upfront when references exist.

use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::MySqlPool;

use crate::error::AppError;

// ===========================================================================
//  Manufacturer
// ===========================================================================

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct ManufacturerRow {
    pub id: i32,
    pub name: String,
    pub address: Option<String>,
    pub url: Option<String>,
    pub email: Option<String>,
    pub phone: Option<String>,
    pub fax: Option<String>,
    pub comment: Option<String>,
    pub part_count: i64,
}

#[derive(Debug, Deserialize)]
pub struct ManufacturerWrite {
    pub name: String,
    pub address: Option<String>,
    pub url: Option<String>,
    pub email: Option<String>,
    pub phone: Option<String>,
    pub fax: Option<String>,
    pub comment: Option<String>,
}

pub async fn mfg_list(
    State(pool): State<MySqlPool>,
) -> Result<Json<Vec<ManufacturerRow>>, AppError> {
    let rows = sqlx::query_as::<_, ManufacturerRow>(
        "SELECT m.id, m.name, m.address, m.url, m.email, m.phone, m.fax, m.comment, \
                COALESCE(c.cnt, 0) AS part_count \
         FROM Manufacturer m \
         LEFT JOIN (SELECT manufacturer_id, COUNT(*) AS cnt \
                    FROM PartManufacturer GROUP BY manufacturer_id) c \
           ON c.manufacturer_id = m.id \
         ORDER BY m.name",
    )
    .fetch_all(&pool)
    .await?;
    Ok(Json(rows))
}

pub async fn mfg_create(
    State(pool): State<MySqlPool>,
    Json(req): Json<ManufacturerWrite>,
) -> Result<Json<serde_json::Value>, AppError> {
    let name = req.name.trim();
    if name.is_empty() {
        return Err(AppError::BadRequest("name is required"));
    }
    let res = sqlx::query(
        "INSERT INTO Manufacturer (name, address, url, email, phone, fax, comment) \
         VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(name)
    .bind(&req.address)
    .bind(&req.url)
    .bind(&req.email)
    .bind(&req.phone)
    .bind(&req.fax)
    .bind(&req.comment)
    .execute(&pool)
    .await
    .map_err(map_unique_err)?;
    Ok(Json(json!({"id": res.last_insert_id() as i32})))
}

pub async fn mfg_update(
    State(pool): State<MySqlPool>,
    Path(id): Path<i32>,
    Json(req): Json<ManufacturerWrite>,
) -> Result<Json<serde_json::Value>, AppError> {
    let name = req.name.trim();
    if name.is_empty() {
        return Err(AppError::BadRequest("name is required"));
    }
    let res = sqlx::query(
        "UPDATE Manufacturer SET name = ?, address = ?, url = ?, email = ?, \
                                  phone = ?, fax = ?, comment = ? \
         WHERE id = ?",
    )
    .bind(name)
    .bind(&req.address)
    .bind(&req.url)
    .bind(&req.email)
    .bind(&req.phone)
    .bind(&req.fax)
    .bind(&req.comment)
    .bind(id)
    .execute(&pool)
    .await
    .map_err(map_unique_err)?;
    if res.rows_affected() == 0 {
        return Err(AppError::NotFound("manufacturer"));
    }
    Ok(Json(json!({"id": id})))
}

pub async fn mfg_delete(
    State(pool): State<MySqlPool>,
    Path(id): Path<i32>,
) -> Result<StatusCode, AppError> {
    let part_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM PartManufacturer WHERE manufacturer_id = ?",
    )
    .bind(id)
    .fetch_one(&pool)
    .await?;
    if part_count > 0 {
        return Err(AppError::Conflict(json!({
            "error": "manufacturer is referenced by parts",
            "part_count": part_count,
        })));
    }
    // Also clear ICLogo references if any exist (these are inline images
    // attached to manufacturers, not reverse FKs from parts).
    sqlx::query("DELETE FROM ManufacturerICLogo WHERE manufacturer_id = ?")
        .bind(id)
        .execute(&pool)
        .await?;
    let res = sqlx::query("DELETE FROM Manufacturer WHERE id = ?")
        .bind(id)
        .execute(&pool)
        .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::NotFound("manufacturer"));
    }
    Ok(StatusCode::NO_CONTENT)
}

// ===========================================================================
//  Distributor
// ===========================================================================

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct DistributorRow {
    pub id: i32,
    pub name: String,
    pub address: Option<String>,
    pub url: Option<String>,
    pub phone: Option<String>,
    pub fax: Option<String>,
    pub email: Option<String>,
    pub comment: Option<String>,
    pub skuurl: Option<String>,
    #[sqlx(rename = "enabledForReports")]
    pub enabled_for_reports: bool,
    pub part_count: i64,
}

#[derive(Debug, Deserialize)]
pub struct DistributorWrite {
    pub name: String,
    pub address: Option<String>,
    pub url: Option<String>,
    pub phone: Option<String>,
    pub fax: Option<String>,
    pub email: Option<String>,
    pub comment: Option<String>,
    pub skuurl: Option<String>,
    #[serde(default = "default_true")]
    pub enabled_for_reports: bool,
}

fn default_true() -> bool { true }

pub async fn dist_list(
    State(pool): State<MySqlPool>,
) -> Result<Json<Vec<DistributorRow>>, AppError> {
    let rows = sqlx::query_as::<_, DistributorRow>(
        "SELECT d.id, d.name, d.address, d.url, d.phone, d.fax, d.email, \
                d.comment, d.skuurl, d.enabledForReports, \
                COALESCE(c.cnt, 0) AS part_count \
         FROM Distributor d \
         LEFT JOIN (SELECT distributor_id, COUNT(*) AS cnt \
                    FROM PartDistributor GROUP BY distributor_id) c \
           ON c.distributor_id = d.id \
         ORDER BY d.name",
    )
    .fetch_all(&pool)
    .await?;
    Ok(Json(rows))
}

pub async fn dist_create(
    State(pool): State<MySqlPool>,
    Json(req): Json<DistributorWrite>,
) -> Result<Json<serde_json::Value>, AppError> {
    let name = req.name.trim();
    if name.is_empty() {
        return Err(AppError::BadRequest("name is required"));
    }
    let res = sqlx::query(
        "INSERT INTO Distributor \
            (name, address, url, phone, fax, email, comment, skuurl, enabledForReports) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(name)
    .bind(&req.address)
    .bind(&req.url)
    .bind(&req.phone)
    .bind(&req.fax)
    .bind(&req.email)
    .bind(&req.comment)
    .bind(&req.skuurl)
    .bind(req.enabled_for_reports)
    .execute(&pool)
    .await
    .map_err(map_unique_err)?;
    Ok(Json(json!({"id": res.last_insert_id() as i32})))
}

pub async fn dist_update(
    State(pool): State<MySqlPool>,
    Path(id): Path<i32>,
    Json(req): Json<DistributorWrite>,
) -> Result<Json<serde_json::Value>, AppError> {
    let name = req.name.trim();
    if name.is_empty() {
        return Err(AppError::BadRequest("name is required"));
    }
    let res = sqlx::query(
        "UPDATE Distributor SET name = ?, address = ?, url = ?, phone = ?, fax = ?, \
                                 email = ?, comment = ?, skuurl = ?, \
                                 enabledForReports = ? \
         WHERE id = ?",
    )
    .bind(name)
    .bind(&req.address)
    .bind(&req.url)
    .bind(&req.phone)
    .bind(&req.fax)
    .bind(&req.email)
    .bind(&req.comment)
    .bind(&req.skuurl)
    .bind(req.enabled_for_reports)
    .bind(id)
    .execute(&pool)
    .await
    .map_err(map_unique_err)?;
    if res.rows_affected() == 0 {
        return Err(AppError::NotFound("distributor"));
    }
    Ok(Json(json!({"id": id})))
}

pub async fn dist_delete(
    State(pool): State<MySqlPool>,
    Path(id): Path<i32>,
) -> Result<StatusCode, AppError> {
    let part_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM PartDistributor WHERE distributor_id = ?",
    )
    .bind(id)
    .fetch_one(&pool)
    .await?;
    if part_count > 0 {
        return Err(AppError::Conflict(json!({
            "error": "distributor is referenced by parts",
            "part_count": part_count,
        })));
    }
    let res = sqlx::query("DELETE FROM Distributor WHERE id = ?")
        .bind(id)
        .execute(&pool)
        .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::NotFound("distributor"));
    }
    Ok(StatusCode::NO_CONTENT)
}

// ===========================================================================
//  PartUnit (a.k.a. PartMeasurementUnit) — measurement units like "Pieces",
//  "Grams". Exactly one row should have is_default = 1.
// ===========================================================================

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct PartUnitRow {
    pub id: i32,
    pub name: String,
    #[sqlx(rename = "shortName")]
    pub short_name: String,
    pub is_default: bool,
    pub part_count: i64,
}

#[derive(Debug, Deserialize)]
pub struct PartUnitWrite {
    pub name: String,
    pub short_name: String,
    #[serde(default)]
    pub is_default: bool,
}

pub async fn part_unit_list(
    State(pool): State<MySqlPool>,
) -> Result<Json<Vec<PartUnitRow>>, AppError> {
    let rows = sqlx::query_as::<_, PartUnitRow>(
        "SELECT pu.id, pu.name, pu.shortName, pu.is_default, \
                COALESCE(c.cnt, 0) AS part_count \
         FROM PartUnit pu \
         LEFT JOIN (SELECT partUnit_id, COUNT(*) AS cnt \
                    FROM Part GROUP BY partUnit_id) c \
           ON c.partUnit_id = pu.id \
         ORDER BY pu.name",
    )
    .fetch_all(&pool)
    .await?;
    Ok(Json(rows))
}

pub async fn part_unit_create(
    State(pool): State<MySqlPool>,
    Json(req): Json<PartUnitWrite>,
) -> Result<Json<serde_json::Value>, AppError> {
    let name = req.name.trim();
    let short = req.short_name.trim();
    if name.is_empty() || short.is_empty() {
        return Err(AppError::BadRequest("name and short_name are required"));
    }
    let mut tx = pool.begin().await?;
    if req.is_default {
        sqlx::query("UPDATE PartUnit SET is_default = 0").execute(&mut *tx).await?;
    }
    let res = sqlx::query(
        "INSERT INTO PartUnit (name, shortName, is_default) VALUES (?, ?, ?)",
    )
    .bind(name)
    .bind(short)
    .bind(req.is_default)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(json!({"id": res.last_insert_id() as i32})))
}

pub async fn part_unit_update(
    State(pool): State<MySqlPool>,
    Path(id): Path<i32>,
    Json(req): Json<PartUnitWrite>,
) -> Result<Json<serde_json::Value>, AppError> {
    let name = req.name.trim();
    let short = req.short_name.trim();
    if name.is_empty() || short.is_empty() {
        return Err(AppError::BadRequest("name and short_name are required"));
    }
    let mut tx = pool.begin().await?;
    if req.is_default {
        sqlx::query("UPDATE PartUnit SET is_default = 0 WHERE id <> ?")
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    let res = sqlx::query(
        "UPDATE PartUnit SET name = ?, shortName = ?, is_default = ? WHERE id = ?",
    )
    .bind(name)
    .bind(short)
    .bind(req.is_default)
    .bind(id)
    .execute(&mut *tx)
    .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::NotFound("part unit"));
    }
    tx.commit().await?;
    Ok(Json(json!({"id": id})))
}

pub async fn part_unit_delete(
    State(pool): State<MySqlPool>,
    Path(id): Path<i32>,
) -> Result<StatusCode, AppError> {
    let part_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM Part WHERE partUnit_id = ?")
            .bind(id)
            .fetch_one(&pool)
            .await?;
    if part_count > 0 {
        return Err(AppError::Conflict(json!({
            "error": "part unit is referenced by parts",
            "part_count": part_count,
        })));
    }
    let res = sqlx::query("DELETE FROM PartUnit WHERE id = ?")
        .bind(id)
        .execute(&pool)
        .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::NotFound("part unit"));
    }
    Ok(StatusCode::NO_CONTENT)
}

// ===========================================================================
//  Unit + UnitSiPrefixes (M:M)
// ===========================================================================

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct UnitRow {
    pub id: i32,
    pub name: String,
    pub symbol: String,
    pub parameter_count: i64,
    /// Comma-separated list of allowed SiPrefix ids. Empty string when
    /// none. Decoded into Vec<i32> by `unit_list_with_prefixes`.
    #[serde(skip)]
    pub _allowed: String,
}

/// Public-facing shape with allowed_prefix_ids materialised as a Vec.
#[derive(Debug, Serialize)]
pub struct UnitView {
    pub id: i32,
    pub name: String,
    pub symbol: String,
    pub parameter_count: i64,
    /// Which SiPrefix ids are valid for this unit. Used both to display
    /// the M:M editor and to constrain prefix dropdowns in the param
    /// editor.
    pub allowed_prefix_ids: Vec<i32>,
}

#[derive(Debug, Deserialize)]
pub struct UnitWrite {
    pub name: String,
    pub symbol: String,
    /// SiPrefix ids that should be valid for this unit. The full set is
    /// rewritten on each PUT (DELETE + INSERT in the join table).
    #[serde(default)]
    pub allowed_prefix_ids: Vec<i32>,
}

pub async fn unit_list(
    State(pool): State<MySqlPool>,
) -> Result<Json<Vec<UnitView>>, AppError> {
    let rows: Vec<UnitRow> = sqlx::query_as(
        "SELECT u.id, u.name, u.symbol, \
                COALESCE(c.cnt, 0) AS parameter_count, \
                COALESCE(GROUP_CONCAT(usp.siprefix_id), '') AS _allowed \
         FROM Unit u \
         LEFT JOIN UnitSiPrefixes usp ON usp.unit_id = u.id \
         LEFT JOIN (SELECT unit_id, COUNT(*) AS cnt \
                    FROM PartParameter GROUP BY unit_id) c \
           ON c.unit_id = u.id \
         GROUP BY u.id, u.name, u.symbol \
         ORDER BY u.name",
    )
    .fetch_all(&pool)
    .await?;
    let views = rows
        .into_iter()
        .map(|r| {
            let allowed_prefix_ids = if r._allowed.is_empty() {
                Vec::new()
            } else {
                r._allowed
                    .split(',')
                    .filter_map(|s| s.parse().ok())
                    .collect()
            };
            UnitView {
                id: r.id,
                name: r.name,
                symbol: r.symbol,
                parameter_count: r.parameter_count,
                allowed_prefix_ids,
            }
        })
        .collect();
    Ok(Json(views))
}

pub async fn unit_create(
    State(pool): State<MySqlPool>,
    Json(req): Json<UnitWrite>,
) -> Result<Json<serde_json::Value>, AppError> {
    let name = req.name.trim();
    let symbol = req.symbol.trim();
    if name.is_empty() || symbol.is_empty() {
        return Err(AppError::BadRequest("name and symbol are required"));
    }
    let mut tx = pool.begin().await?;
    let res = sqlx::query("INSERT INTO Unit (name, symbol) VALUES (?, ?)")
        .bind(name)
        .bind(symbol)
        .execute(&mut *tx)
        .await?;
    let new_id = res.last_insert_id() as i32;
    for &pid in &req.allowed_prefix_ids {
        sqlx::query("INSERT INTO UnitSiPrefixes (unit_id, siprefix_id) VALUES (?, ?)")
            .bind(new_id)
            .bind(pid)
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    Ok(Json(json!({"id": new_id})))
}

pub async fn unit_update(
    State(pool): State<MySqlPool>,
    Path(id): Path<i32>,
    Json(req): Json<UnitWrite>,
) -> Result<Json<serde_json::Value>, AppError> {
    let name = req.name.trim();
    let symbol = req.symbol.trim();
    if name.is_empty() || symbol.is_empty() {
        return Err(AppError::BadRequest("name and symbol are required"));
    }
    let mut tx = pool.begin().await?;
    let res = sqlx::query("UPDATE Unit SET name = ?, symbol = ? WHERE id = ?")
        .bind(name)
        .bind(symbol)
        .bind(id)
        .execute(&mut *tx)
        .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::NotFound("unit"));
    }
    sqlx::query("DELETE FROM UnitSiPrefixes WHERE unit_id = ?")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    for &pid in &req.allowed_prefix_ids {
        sqlx::query("INSERT INTO UnitSiPrefixes (unit_id, siprefix_id) VALUES (?, ?)")
            .bind(id)
            .bind(pid)
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    Ok(Json(json!({"id": id})))
}

pub async fn unit_delete(
    State(pool): State<MySqlPool>,
    Path(id): Path<i32>,
) -> Result<StatusCode, AppError> {
    let parameter_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM PartParameter WHERE unit_id = ?")
            .bind(id)
            .fetch_one(&pool)
            .await?;
    if parameter_count > 0 {
        return Err(AppError::Conflict(json!({
            "error": "unit is referenced by part parameters",
            "parameter_count": parameter_count,
        })));
    }
    let mut tx = pool.begin().await?;
    sqlx::query("DELETE FROM UnitSiPrefixes WHERE unit_id = ?")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    let res = sqlx::query("DELETE FROM Unit WHERE id = ?")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::NotFound("unit"));
    }
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

// ===========================================================================
//  SiPrefix
// ===========================================================================

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct SiPrefixRow {
    pub id: i32,
    pub prefix: String,
    pub symbol: String,
    pub base: i32,
    pub exponent: i32,
    /// PartParameter rows that reference this prefix as si_prefix /
    /// min_si_prefix / max_si_prefix combined.
    pub parameter_count: i64,
    /// Units that allow this prefix.
    pub unit_count: i64,
}

#[derive(Debug, Deserialize)]
pub struct SiPrefixWrite {
    pub prefix: String,
    pub symbol: String,
    pub base: i32,
    pub exponent: i32,
}

pub async fn siprefix_list(
    State(pool): State<MySqlPool>,
) -> Result<Json<Vec<SiPrefixRow>>, AppError> {
    // parameter_count counts distinct PartParameter rows that reference
    // this SI prefix in ANY of the three columns (siPrefix_id /
    // minSiPrefix_id / maxSiPrefix_id). Matches the delete-conflict
    // check semantics so the UI shows consistent numbers.
    // unit_count is the UnitSiPrefixes row count.
    let rows = sqlx::query_as::<_, SiPrefixRow>(
        "SELECT sp.id, sp.prefix, sp.symbol, sp.base, sp.exponent, \
                ( \
                  SELECT COUNT(*) FROM PartParameter pp \
                  WHERE pp.siPrefix_id = sp.id \
                     OR pp.minSiPrefix_id = sp.id \
                     OR pp.maxSiPrefix_id = sp.id \
                ) AS parameter_count, \
                ( \
                  SELECT COUNT(*) FROM UnitSiPrefixes \
                  WHERE siprefix_id = sp.id \
                ) AS unit_count \
         FROM SiPrefix sp \
         ORDER BY sp.exponent",
    )
    .fetch_all(&pool)
    .await?;
    Ok(Json(rows))
}

pub async fn siprefix_create(
    State(pool): State<MySqlPool>,
    Json(req): Json<SiPrefixWrite>,
) -> Result<Json<serde_json::Value>, AppError> {
    if req.prefix.trim().is_empty() {
        return Err(AppError::BadRequest("prefix is required"));
    }
    if req.base < 2 {
        return Err(AppError::BadRequest("base must be >= 2"));
    }
    let res = sqlx::query(
        "INSERT INTO SiPrefix (prefix, symbol, base, exponent) VALUES (?, ?, ?, ?)",
    )
    .bind(req.prefix.trim())
    .bind(req.symbol.trim())
    .bind(req.base)
    .bind(req.exponent)
    .execute(&pool)
    .await?;
    Ok(Json(json!({"id": res.last_insert_id() as i32})))
}

pub async fn siprefix_update(
    State(pool): State<MySqlPool>,
    Path(id): Path<i32>,
    Json(req): Json<SiPrefixWrite>,
) -> Result<Json<serde_json::Value>, AppError> {
    if req.prefix.trim().is_empty() {
        return Err(AppError::BadRequest("prefix is required"));
    }
    let res = sqlx::query(
        "UPDATE SiPrefix SET prefix = ?, symbol = ?, base = ?, exponent = ? WHERE id = ?",
    )
    .bind(req.prefix.trim())
    .bind(req.symbol.trim())
    .bind(req.base)
    .bind(req.exponent)
    .bind(id)
    .execute(&pool)
    .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::NotFound("si prefix"));
    }
    Ok(Json(json!({"id": id})))
}

pub async fn siprefix_delete(
    State(pool): State<MySqlPool>,
    Path(id): Path<i32>,
) -> Result<StatusCode, AppError> {
    // Block on any reference: PartParameter (any of three columns) or
    // UnitSiPrefixes. These are different magnitudes of "blocking" but
    // collapsing them keeps the dialog simple.
    let param_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM PartParameter \
         WHERE siPrefix_id = ? OR minSiPrefix_id = ? OR maxSiPrefix_id = ?",
    )
    .bind(id).bind(id).bind(id)
    .fetch_one(&pool)
    .await?;
    let unit_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM UnitSiPrefixes WHERE siprefix_id = ?")
            .bind(id)
            .fetch_one(&pool)
            .await?;
    if param_count > 0 || unit_count > 0 {
        return Err(AppError::Conflict(json!({
            "error": "si prefix is in use",
            "parameter_count": param_count,
            "unit_count": unit_count,
        })));
    }
    let res = sqlx::query("DELETE FROM SiPrefix WHERE id = ?")
        .bind(id)
        .execute(&pool)
        .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::NotFound("si prefix"));
    }
    Ok(StatusCode::NO_CONTENT)
}

// ===========================================================================
//  Slice 5d — Merge / reassign
//
//  Each merge endpoint moves all FK references from a *source* row to
//  a *target* row of the same type, then deletes the source. Atomic
//  per type. The response carries per-table reassignment counts so the
//  UI can confirm exactly what moved.
//
//  PartManufacturer / PartDistributor have no UNIQUE on (part, mfg/dist)
//  so the same part can carry multiple rows for the same vendor — merge
//  preserves them all (different partNumber/sku columns).
//
//  UnitSiPrefixes is the only M:M with a composite PK; merging units or
//  prefixes can collide on (unit_id, siprefix_id). Pattern: DELETE
//  conflicting source rows first, then UPDATE remaining source rows to
//  point at target. (MySQL won't let DELETE/UPDATE reference the same
//  table directly, so the IN-subquery is wrapped in a derived table.)
// ===========================================================================

#[derive(Debug, Deserialize)]
pub struct MergeRequest {
    pub target_id: i32,
}

pub async fn mfg_merge(
    State(pool): State<MySqlPool>,
    Path(source_id): Path<i32>,
    Json(req): Json<MergeRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let target_id = req.target_id;
    if source_id == target_id {
        return Err(AppError::BadRequest("source and target are the same row"));
    }
    let mut tx = pool.begin().await?;

    let src_exists: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM Manufacturer WHERE id = ?")
        .bind(source_id).fetch_one(&mut *tx).await?;
    if src_exists == 0 {
        return Err(AppError::NotFound("manufacturer"));
    }
    let tgt_exists: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM Manufacturer WHERE id = ?")
        .bind(target_id).fetch_one(&mut *tx).await?;
    if tgt_exists == 0 {
        return Err(AppError::BadRequest("target manufacturer not found"));
    }

    let parts_moved = sqlx::query(
        "UPDATE PartManufacturer SET manufacturer_id = ? WHERE manufacturer_id = ?",
    )
    .bind(target_id).bind(source_id).execute(&mut *tx).await?
    .rows_affected();

    let logos_moved = sqlx::query(
        "UPDATE ManufacturerICLogo SET manufacturer_id = ? WHERE manufacturer_id = ?",
    )
    .bind(target_id).bind(source_id).execute(&mut *tx).await?
    .rows_affected();

    sqlx::query("DELETE FROM Manufacturer WHERE id = ?")
        .bind(source_id).execute(&mut *tx).await?;

    tx.commit().await?;
    Ok(Json(json!({
        "moved": {
            "part_links": parts_moved,
            "ic_logos": logos_moved,
        },
    })))
}

pub async fn dist_merge(
    State(pool): State<MySqlPool>,
    Path(source_id): Path<i32>,
    Json(req): Json<MergeRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let target_id = req.target_id;
    if source_id == target_id {
        return Err(AppError::BadRequest("source and target are the same row"));
    }
    let mut tx = pool.begin().await?;

    let src_exists: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM Distributor WHERE id = ?")
        .bind(source_id).fetch_one(&mut *tx).await?;
    if src_exists == 0 {
        return Err(AppError::NotFound("distributor"));
    }
    let tgt_exists: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM Distributor WHERE id = ?")
        .bind(target_id).fetch_one(&mut *tx).await?;
    if tgt_exists == 0 {
        return Err(AppError::BadRequest("target distributor not found"));
    }

    let parts_moved = sqlx::query(
        "UPDATE PartDistributor SET distributor_id = ? WHERE distributor_id = ?",
    )
    .bind(target_id).bind(source_id).execute(&mut *tx).await?
    .rows_affected();

    sqlx::query("DELETE FROM Distributor WHERE id = ?")
        .bind(source_id).execute(&mut *tx).await?;

    tx.commit().await?;
    Ok(Json(json!({
        "moved": {
            "part_links": parts_moved,
        },
    })))
}

pub async fn part_unit_merge(
    State(pool): State<MySqlPool>,
    Path(source_id): Path<i32>,
    Json(req): Json<MergeRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let target_id = req.target_id;
    if source_id == target_id {
        return Err(AppError::BadRequest("source and target are the same row"));
    }
    let mut tx = pool.begin().await?;

    let src_exists: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM PartUnit WHERE id = ?")
        .bind(source_id).fetch_one(&mut *tx).await?;
    if src_exists == 0 {
        return Err(AppError::NotFound("part unit"));
    }
    let tgt_exists: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM PartUnit WHERE id = ?")
        .bind(target_id).fetch_one(&mut *tx).await?;
    if tgt_exists == 0 {
        return Err(AppError::BadRequest("target part unit not found"));
    }

    let parts_moved = sqlx::query(
        "UPDATE Part SET partUnit_id = ? WHERE partUnit_id = ?",
    )
    .bind(target_id).bind(source_id).execute(&mut *tx).await?
    .rows_affected();

    sqlx::query("DELETE FROM PartUnit WHERE id = ?")
        .bind(source_id).execute(&mut *tx).await?;

    tx.commit().await?;
    Ok(Json(json!({
        "moved": {
            "parts": parts_moved,
        },
    })))
}

pub async fn unit_merge(
    State(pool): State<MySqlPool>,
    Path(source_id): Path<i32>,
    Json(req): Json<MergeRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let target_id = req.target_id;
    if source_id == target_id {
        return Err(AppError::BadRequest("source and target are the same row"));
    }
    let mut tx = pool.begin().await?;

    let src_exists: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM Unit WHERE id = ?")
        .bind(source_id).fetch_one(&mut *tx).await?;
    if src_exists == 0 {
        return Err(AppError::NotFound("unit"));
    }
    let tgt_exists: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM Unit WHERE id = ?")
        .bind(target_id).fetch_one(&mut *tx).await?;
    if tgt_exists == 0 {
        return Err(AppError::BadRequest("target unit not found"));
    }

    let pparams_moved = sqlx::query(
        "UPDATE PartParameter SET unit_id = ? WHERE unit_id = ?",
    )
    .bind(target_id).bind(source_id).execute(&mut *tx).await?
    .rows_affected();

    let mcrit_moved = sqlx::query(
        "UPDATE MetaPartParameterCriteria SET unit_id = ? WHERE unit_id = ?",
    )
    .bind(target_id).bind(source_id).execute(&mut *tx).await?
    .rows_affected();

    // UnitSiPrefixes M:M — drop source rows that would collide with
    // existing target rows, then point the rest at target.
    sqlx::query(
        "DELETE FROM UnitSiPrefixes \
         WHERE unit_id = ? \
         AND siprefix_id IN (\
             SELECT siprefix_id FROM \
             (SELECT siprefix_id FROM UnitSiPrefixes WHERE unit_id = ?) t\
         )",
    )
    .bind(source_id).bind(target_id).execute(&mut *tx).await?;

    let prefix_links_moved = sqlx::query(
        "UPDATE UnitSiPrefixes SET unit_id = ? WHERE unit_id = ?",
    )
    .bind(target_id).bind(source_id).execute(&mut *tx).await?
    .rows_affected();

    sqlx::query("DELETE FROM Unit WHERE id = ?")
        .bind(source_id).execute(&mut *tx).await?;

    tx.commit().await?;
    Ok(Json(json!({
        "moved": {
            "part_parameters": pparams_moved,
            "meta_part_criteria": mcrit_moved,
            "allowed_prefix_links": prefix_links_moved,
        },
    })))
}

pub async fn siprefix_merge(
    State(pool): State<MySqlPool>,
    Path(source_id): Path<i32>,
    Json(req): Json<MergeRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let target_id = req.target_id;
    if source_id == target_id {
        return Err(AppError::BadRequest("source and target are the same row"));
    }
    let mut tx = pool.begin().await?;

    let src_exists: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM SiPrefix WHERE id = ?")
        .bind(source_id).fetch_one(&mut *tx).await?;
    if src_exists == 0 {
        return Err(AppError::NotFound("si prefix"));
    }
    let tgt_exists: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM SiPrefix WHERE id = ?")
        .bind(target_id).fetch_one(&mut *tx).await?;
    if tgt_exists == 0 {
        return Err(AppError::BadRequest("target si prefix not found"));
    }

    // Three columns on PartParameter referencing SiPrefix.id, three on
    // MetaPartParameterCriteria, plus UnitSiPrefixes M:M. All in
    // parallel — none of them have intra-row UNIQUE constraints that
    // could collide.
    let mut moved = serde_json::Map::new();
    for (table, col, key) in &[
        ("PartParameter",            "siPrefix_id",    "part_parameters_value"),
        ("PartParameter",            "minSiPrefix_id", "part_parameters_min"),
        ("PartParameter",            "maxSiPrefix_id", "part_parameters_max"),
        ("MetaPartParameterCriteria","siPrefix_id",    "meta_criteria_value"),
        ("MetaPartParameterCriteria","minSiPrefix_id", "meta_criteria_min"),
        ("MetaPartParameterCriteria","maxSiPrefix_id", "meta_criteria_max"),
    ] {
        let q = format!("UPDATE {table} SET {col} = ? WHERE {col} = ?");
        let n = sqlx::query(&q)
            .bind(target_id).bind(source_id).execute(&mut *tx).await?
            .rows_affected();
        moved.insert(key.to_string(), serde_json::json!(n));
    }

    // UnitSiPrefixes M:M — drop source rows that would collide with
    // existing target rows, then point the rest at target.
    sqlx::query(
        "DELETE FROM UnitSiPrefixes \
         WHERE siprefix_id = ? \
         AND unit_id IN (\
             SELECT unit_id FROM \
             (SELECT unit_id FROM UnitSiPrefixes WHERE siprefix_id = ?) t\
         )",
    )
    .bind(source_id).bind(target_id).execute(&mut *tx).await?;

    let unit_links_moved = sqlx::query(
        "UPDATE UnitSiPrefixes SET siprefix_id = ? WHERE siprefix_id = ?",
    )
    .bind(target_id).bind(source_id).execute(&mut *tx).await?
    .rows_affected();
    moved.insert("unit_links".to_string(), serde_json::json!(unit_links_moved));

    sqlx::query("DELETE FROM SiPrefix WHERE id = ?")
        .bind(source_id).execute(&mut *tx).await?;

    tx.commit().await?;
    Ok(Json(json!({ "moved": moved })))
}

// ===========================================================================
//  Helpers
// ===========================================================================

/// Map MySQL/MariaDB error 1062 (duplicate-key on UNIQUE) to a friendly
/// 400. Manufacturer.name and Distributor.name are unique columns.
fn map_unique_err(e: sqlx::Error) -> AppError {
    if let sqlx::Error::Database(db) = &e {
        let code = db.code();
        if code.as_deref() == Some("23000")
            && db.message().to_lowercase().contains("duplicate")
        {
            return AppError::BadRequest("a row with that name already exists");
        }
    }
    AppError::Db(e)
}

