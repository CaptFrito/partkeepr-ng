//! Multi-location parts (`PartStorageLocation`).
//!
//! Per-row CRUD for the descriptive breakdown of where a part's stock
//! physically lives. Existing `Part.storageLocation_id` and `Part.stockLevel`
//! continue to be the "primary location" + "total on hand"; rows here
//! describe the physical breakdown (loose / reel / cut tape / etc.).
//!
//! Source-of-truth: `Part.stockLevel` (managed by StockEntry). The sum
//! of `quantity` across rows is informational; the operator keeps it
//! in sync. The frontend warns when sum != stockLevel.

use axum::{
    extract::{Path, State},
    http::StatusCode,
    Extension, Json,
};
use chrono::{NaiveDateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::MySqlPool;

use crate::error::AppError;
use crate::handlers::auth::CurrentUser;

/// The valid `form` enum values. Keep in sync with the SQL column
/// definition (scripts/migrations/multi-location-parts.sql) and the
/// frontend's mirror list in `frontend/app.js`.
const VALID_FORMS: &[&str] = &[
    "Loose", "Reel", "CutTape", "Tray", "Tube", "Feeder", "Bag", "Other",
];

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct PartLocationView {
    pub id: i32,
    #[sqlx(rename = "storageLocation_id")]
    pub storage_location_id: i32,
    pub storage_location_name: String,
    /// Breadcrumb path of the storage location's category (e.g.
    /// "Root ➤ Office ➤ Shelf B"), via StorageLocationCategory.categoryPath.
    pub storage_location_path: Option<String>,
    pub form: String,
    pub quantity: i32,
    #[sqlx(rename = "lotNumber")]
    pub lot_number: Option<String>,
    pub comment: Option<String>,
    pub created: Option<NaiveDateTime>,
    #[sqlx(rename = "lastModified")]
    pub last_modified: Option<NaiveDateTime>,
    pub user_id: Option<i32>,
}

#[derive(Debug, Deserialize)]
pub struct PartLocationWrite {
    pub storage_location_id: i32,
    pub form: String,
    pub quantity: i32,
    #[serde(default)]
    pub lot_number: Option<String>,
    #[serde(default)]
    pub comment: Option<String>,
}

/// SQL fragment used by both `list` here and `parts::detail` (for the
/// embedded `locations` field). Keeping it as one literal so the
/// shape can't drift.
pub const LIST_SELECT_SQL: &str = "
    SELECT psl.id, \
           psl.storageLocation_id, \
           sl.name AS storage_location_name, \
           slc.categoryPath AS storage_location_path, \
           psl.form, \
           psl.quantity, \
           psl.lotNumber, \
           psl.comment, \
           psl.created, \
           psl.lastModified, \
           psl.user_id \
      FROM PartStorageLocation psl \
      JOIN StorageLocation sl ON sl.id = psl.storageLocation_id \
      LEFT JOIN StorageLocationCategory slc ON slc.id = sl.category_id \
     WHERE psl.part_id = ? \
     ORDER BY psl.form ASC, psl.quantity DESC, psl.id ASC";

pub async fn list(
    State(pool): State<MySqlPool>,
    Path(part_id): Path<i32>,
) -> Result<Json<Vec<PartLocationView>>, AppError> {
    let rows = sqlx::query_as::<_, PartLocationView>(LIST_SELECT_SQL)
        .bind(part_id)
        .fetch_all(&pool)
        .await?;
    Ok(Json(rows))
}

pub async fn create(
    State(pool): State<MySqlPool>,
    Extension(user): Extension<CurrentUser>,
    Path(part_id): Path<i32>,
    Json(req): Json<PartLocationWrite>,
) -> Result<Json<serde_json::Value>, AppError> {
    validate_write(&req)?;

    let mut tx = pool.begin().await?;
    let part_exists: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM Part WHERE id = ?")
            .bind(part_id).fetch_one(&mut *tx).await?;
    if part_exists == 0 {
        return Err(AppError::NotFound("part"));
    }
    let loc_exists: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM StorageLocation WHERE id = ?",
    )
    .bind(req.storage_location_id)
    .fetch_one(&mut *tx)
    .await?;
    if loc_exists == 0 {
        return Err(AppError::BadRequest("storage location not found"));
    }

    let now = Utc::now().naive_utc();
    let res = sqlx::query(
        "INSERT INTO PartStorageLocation \
            (part_id, storageLocation_id, form, quantity, lotNumber, \
             comment, created, lastModified, user_id) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(part_id)
    .bind(req.storage_location_id)
    .bind(&req.form)
    .bind(req.quantity)
    .bind(req.lot_number.as_deref())
    .bind(req.comment.as_deref())
    .bind(now)
    .bind(now)
    .bind(user.user_id)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(Json(json!({"id": res.last_insert_id() as i32})))
}

pub async fn update(
    State(pool): State<MySqlPool>,
    Extension(user): Extension<CurrentUser>,
    Path((part_id, lid)): Path<(i32, i32)>,
    Json(req): Json<PartLocationWrite>,
) -> Result<Json<serde_json::Value>, AppError> {
    validate_write(&req)?;

    let mut tx = pool.begin().await?;
    let loc_exists: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM StorageLocation WHERE id = ?",
    )
    .bind(req.storage_location_id)
    .fetch_one(&mut *tx)
    .await?;
    if loc_exists == 0 {
        return Err(AppError::BadRequest("storage location not found"));
    }

    let now = Utc::now().naive_utc();
    let res = sqlx::query(
        "UPDATE PartStorageLocation SET \
            storageLocation_id = ?, form = ?, quantity = ?, \
            lotNumber = ?, comment = ?, lastModified = ?, user_id = ? \
         WHERE id = ? AND part_id = ?",
    )
    .bind(req.storage_location_id)
    .bind(&req.form)
    .bind(req.quantity)
    .bind(req.lot_number.as_deref())
    .bind(req.comment.as_deref())
    .bind(now)
    .bind(user.user_id)
    .bind(lid)
    .bind(part_id)
    .execute(&mut *tx)
    .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::NotFound("part location"));
    }

    tx.commit().await?;
    Ok(Json(json!({"id": lid})))
}

pub async fn delete(
    State(pool): State<MySqlPool>,
    Path((part_id, lid)): Path<(i32, i32)>,
) -> Result<StatusCode, AppError> {
    let res = sqlx::query(
        "DELETE FROM PartStorageLocation WHERE id = ? AND part_id = ?",
    )
    .bind(lid)
    .bind(part_id)
    .execute(&pool)
    .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::NotFound("part location"));
    }
    Ok(StatusCode::NO_CONTENT)
}

fn validate_write(r: &PartLocationWrite) -> Result<(), AppError> {
    if !VALID_FORMS.iter().any(|&f| f == r.form) {
        return Err(AppError::BadRequest(
            "form must be one of Loose / Reel / CutTape / Tray / Tube / Feeder / Bag / Other",
        ));
    }
    if r.quantity < 0 {
        return Err(AppError::BadRequest("quantity must be >= 0"));
    }
    if r.storage_location_id <= 0 {
        return Err(AppError::BadRequest("storage_location_id is required"));
    }
    Ok(())
}
