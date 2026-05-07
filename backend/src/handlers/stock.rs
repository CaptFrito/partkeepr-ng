//! Stock add/remove. One endpoint, one big transaction.
//!
//! `POST /api/parts/{id}/stock-entries` inserts a new StockEntry row,
//! re-derives `Part.stockLevel` / `averagePrice` / `lowStock` from the
//! full history, and returns the updated Part. Recompute logic is a
//! direct port of PartKeepr's `Part::recomputeStockLevels()` so existing
//! data stays self-consistent if both apps were ever to write to the
//! same DB.

use axum::{
    extract::{Path, State},
    Json,
};
use chrono::Utc;
use rust_decimal::Decimal;
use serde::Deserialize;
use sqlx::MySqlPool;

use crate::error::AppError;
use crate::handlers::auth::CurrentUser;
use crate::models::part::Part;

#[derive(Debug, Deserialize)]
pub struct StockChange {
    /// Delta to apply. Positive = add stock, negative = remove stock.
    pub stock_level: i32,
    /// Per-piece price. Optional. Used by the avg-price recompute.
    pub price: Option<Decimal>,
    pub comment: Option<String>,
    /// True if this is a correction (recount) rather than a real
    /// add/remove. Doesn't affect math, only the history flag.
    #[serde(default)]
    pub correction: bool,
}

pub async fn create_stock_entry(
    State(pool): State<MySqlPool>,
    axum::Extension(user): axum::Extension<CurrentUser>,
    Path(part_id): Path<i32>,
    Json(req): Json<StockChange>,
) -> Result<Json<Part>, AppError> {
    if req.stock_level == 0 {
        return Err(AppError::BadRequest("stock_level cannot be zero"));
    }

    let mut tx = pool.begin().await?;
    apply_stock_change_in_tx(
        &mut tx,
        part_id,
        req.stock_level,
        req.price,
        req.comment.as_deref(),
        req.correction,
        user.user_id,
    )
    .await?;
    let updated: Part = sqlx::query_as("SELECT * FROM Part WHERE id = ?")
        .bind(part_id)
        .fetch_one(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(Json(updated))
}

/// Insert a StockEntry and re-derive `Part.stockLevel` /
/// `averagePrice` / `lowStock`. Reused by the project-run handler so a
/// run's per-line stock decrements use exactly the same accounting as
/// manual stock add/remove. Caller owns the transaction.
///
/// Returns (current_stock_after, low_stock_after) for convenience —
/// run_project surfaces these in the response so the UI can confirm
/// shortfalls without a second roundtrip.
pub async fn apply_stock_change_in_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::MySql>,
    part_id: i32,
    delta: i32,
    price: Option<Decimal>,
    comment: Option<&str>,
    correction: bool,
    user_id: i32,
) -> Result<(i32, bool), AppError> {
    if delta == 0 {
        return Err(AppError::BadRequest("stock delta cannot be zero"));
    }

    let exists: Option<(i32, i32)> = sqlx::query_as(
        "SELECT id, minStockLevel FROM Part WHERE id = ?",
    )
    .bind(part_id)
    .fetch_optional(&mut **tx)
    .await?;
    let (_, min_stock_level) = exists.ok_or(AppError::NotFound("part"))?;

    let now = Utc::now().naive_utc();
    sqlx::query(
        "INSERT INTO StockEntry \
            (part_id, user_id, stockLevel, price, dateTime, correction, comment) \
         VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(part_id)
    .bind(user_id)
    .bind(delta)
    .bind(price)
    .bind(now)
    .bind(correction)
    .bind(comment)
    .execute(&mut **tx)
    .await?;

    let entries: Vec<(i32, Option<Decimal>, bool)> = sqlx::query_as(
        "SELECT stockLevel, price, correction FROM StockEntry \
         WHERE part_id = ? ORDER BY dateTime ASC, id ASC",
    )
    .bind(part_id)
    .fetch_all(&mut **tx)
    .await?;

    let (current_stock, avg_price) = recompute(&entries);
    let low_stock = current_stock < min_stock_level;

    sqlx::query(
        "UPDATE Part SET stockLevel = ?, averagePrice = ?, lowStock = ? \
         WHERE id = ?",
    )
    .bind(current_stock)
    .bind(avg_price)
    .bind(low_stock)
    .bind(part_id)
    .execute(&mut **tx)
    .await?;

    Ok((current_stock, low_stock))
}

/// Walk chronological stock entries to derive current stock + avg price.
///
/// **Correction entries** (recount/reconciliation adjustments) preserve
/// the running avg_price: they change the quantity on hand without
/// implying a value transaction. The rolling total cost gets re-spread
/// across the new quantity at the same per-piece cost basis.
/// This intentionally diverges from upstream PartKeepr's PHP, which
/// folds correction deltas into the cost-basis math and produces
/// counterintuitive avg-price drops on simple recounts.
///
/// **Non-correction entries** follow PartKeepr's logic: positive entries
/// (adds) accumulate `price × qty` into the rolling total; negative
/// entries (removes) either snap to the last positive entry's price (if
/// stock dropped below the last add's quantity) or scale the rolling
/// total proportionally. Negative-stock states zero out the average.
fn recompute(entries: &[(i32, Option<Decimal>, bool)]) -> (i32, Decimal) {
    let mut current_stock: i32 = 0;
    let mut avg_price: Decimal = Decimal::ZERO;
    let mut total_part_stock_price: Decimal = Decimal::ZERO;
    let mut last_pos_entry_quant: i32 = 0;
    let mut last_pos_entry_price: Decimal = Decimal::ZERO;
    let mut negative_stock: i32 = 0;

    for &(level, price, correction) in entries {
        current_stock += level;

        if correction {
            // Recount/reconciliation: avg_price stays put, total cost
            // re-spread proportionally across the new quantity.
            if current_stock <= 0 {
                avg_price = Decimal::ZERO;
                total_part_stock_price = Decimal::ZERO;
                negative_stock = current_stock;
            } else {
                total_part_stock_price = avg_price * Decimal::from(current_stock);
                negative_stock = 0;
            }
            continue;
        }

        let price = price.unwrap_or(Decimal::ZERO);

        if current_stock <= 0 {
            avg_price = Decimal::ZERO;
            total_part_stock_price = Decimal::ZERO;
            negative_stock = current_stock;
        } else if level > 0 {
            // Adding stock.
            last_pos_entry_quant = level;
            last_pos_entry_price = price;
            let added = last_pos_entry_quant + negative_stock; // negative_stock is <=0
            total_part_stock_price += last_pos_entry_price * Decimal::from(added);
            avg_price = total_part_stock_price / Decimal::from(current_stock);
            negative_stock = 0;
        } else {
            // Removing stock (level < 0) and current_stock still > 0.
            if current_stock < last_pos_entry_quant {
                total_part_stock_price = Decimal::from(current_stock) * last_pos_entry_price;
                avg_price = total_part_stock_price / Decimal::from(current_stock);
            } else {
                total_part_stock_price += Decimal::from(level) * avg_price;
                avg_price = total_part_stock_price / Decimal::from(current_stock);
            }
            negative_stock = 0;
        }
    }

    (current_stock, avg_price)
}
