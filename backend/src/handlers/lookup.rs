//! Slice 12a — Distributor / catalog lookups (Mouser today, Digi-Key
//! and Nexar later). This module defines the unified result shape
//! every source maps into, plus the `/api/lookup/capabilities`
//! endpoint frontends hit at boot to decide which "+ Add via …"
//! buttons to render.
//!
//! Per-source code lives in sibling modules: `mouser.rs`, eventually
//! `digikey.rs`, `nexar.rs`. They all produce `LookupResult` rows
//! mapped from their native API.

use axum::{extract::State, Json};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use sqlx::MySqlPool;

use crate::error::AppError;
use crate::handlers::attachments::{fetch_url_core, AttachmentKind, FetchByUrl};
use crate::handlers::digikey::DigiKeyConfig;
use crate::handlers::mouser::MouserConfig;
use crate::handlers::storage::StorageConfig;

/// Unified search-result shape across all lookup sources. Designed
/// to fit Mouser today, Digi-Key + Nexar without changes later.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LookupResult {
    /// Which source produced this result. "mouser", "digikey", "nexar".
    pub source: String,
    pub mpn: String,
    pub manufacturer_name: String,
    pub description: String,
    /// Free-form category string from the source. Frontend uses it
    /// for a best-effort match against `lookupsCache.categories_tree`.
    pub category_name: Option<String>,
    pub image_url: Option<String>,
    pub datasheet_url: Option<String>,
    /// "View on Mouser/Digi-Key" link for the operator.
    pub detail_url: Option<String>,
    /// The source's own SKU. For Mouser this is the Mouser P/N
    /// (goes into PartDistributor.orderNumber).
    pub distributor_pn: String,
    pub price_breaks: Vec<PriceBreak>,
    pub availability: Option<String>,
    pub min_order_qty: Option<i32>,
    pub order_qty_multiple: Option<i32>,
    pub standard_pack_qty: Option<i32>,
    pub lifecycle_status: Option<String>,
    pub rohs_status: Option<String>,
    pub lead_time_days: Option<i32>,
    /// Source-provided parameters / product attributes. v1 imports
    /// every entry as a string PartParameter (no unit/prefix
    /// inference). Mouser's are typically packaging-only; future
    /// sources (Digi-Key, Nexar) carry richer parametric data.
    #[serde(default)]
    pub parameters: Vec<LookupResultParameter>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LookupResultParameter {
    pub name: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PriceBreak {
    pub quantity: i32,
    /// Decimal as string to avoid serialization edge cases.
    pub price: String,
    pub currency: String,
}

#[derive(Debug, Serialize)]
pub struct CapabilitiesResponse {
    /// One entry per source. `null` when unconfigured.
    pub mouser: Option<SourceCaps>,
    pub digikey: Option<SourceCaps>,
}

#[derive(Debug, Serialize)]
pub struct SourceCaps {
    pub available: bool,
    pub calls_per_minute: u32,
    pub calls_per_day: u32,
}

pub async fn capabilities(
    State(mouser): State<MouserConfig>,
    State(digikey): State<DigiKeyConfig>,
) -> Json<CapabilitiesResponse> {
    Json(CapabilitiesResponse {
        mouser: Some(SourceCaps {
            available: mouser.search_key.is_some(),
            calls_per_minute: 30,
            calls_per_day: 1000,
        }),
        digikey: Some(SourceCaps {
            available: digikey.available(),
            calls_per_minute: 60, // Digi-Key historical: ~1/sec.
            calls_per_day: 1000,
        }),
    })
}

// ===========================================================================
//  Import — shared across all lookup sources
// ===========================================================================

#[derive(Debug, Deserialize)]
pub struct ImportRequest {
    pub result: LookupResult,
    pub category_id: i32,
    pub part_unit_id: i32,
}

#[derive(Debug, Serialize)]
pub struct ImportResponse {
    pub part_id: i32,
    pub manufacturer_id: i32,
    pub distributor_id: i32,
    /// Was the manufacturer just created (vs. matched to an existing
    /// row)? Frontend uses this to decide whether to bother with the
    /// image fetch.
    pub manufacturer_created: bool,
    pub datasheet_attachment_id: Option<i32>,
    pub datasheet_error: Option<String>,
    pub logo_attachment_id: Option<i32>,
    pub logo_error: Option<String>,
}

/// Identity of the distributor we're importing through. Determines
/// the Distributor row name + URL used in the auto-create / lookup
/// step.
pub struct DistributorIdentity {
    pub name: &'static str,    // "Mouser", "Digi-Key"
    pub url:  &'static str,    // "https://www.mouser.com" etc.
}

/// Shared import path used by both `handlers::mouser::import` and
/// `handlers::digikey::import`. Atomically creates a Part + its
/// PartManufacturer / PartDistributor / PartParameter children;
/// post-commit, fetches the datasheet (PartAttachment) and the
/// manufacturer logo (ManufacturerICLogo, only on freshly-created
/// manufacturers) via the slice-7 by-URL pipeline.
///
/// Attachment-fetch failures don't roll back the part — operator
/// can attach manually if a remote site rejects our fetch
/// (bot-protection sites do this routinely).
pub async fn import_lookup_result(
    pool: &MySqlPool,
    store: &StorageConfig,
    req: ImportRequest,
    distributor: DistributorIdentity,
) -> Result<ImportResponse, AppError> {
    let r = &req.result;
    if r.mpn.trim().is_empty() {
        return Err(AppError::BadRequest("result.mpn is required"));
    }
    if r.manufacturer_name.trim().is_empty() {
        return Err(AppError::BadRequest("result.manufacturer_name is required"));
    }

    let mut tx = pool.begin().await?;

    // 1. Manufacturer — find by case-insensitive exact name; create
    //    if missing.
    let mfg_name = r.manufacturer_name.trim();
    let existing_mfg: Option<(i32,)> = sqlx::query_as(
        "SELECT id FROM Manufacturer WHERE LOWER(name) = LOWER(?) LIMIT 1",
    )
    .bind(mfg_name)
    .fetch_optional(&mut *tx)
    .await?;
    let (manufacturer_id, manufacturer_created) = match existing_mfg {
        Some((id,)) => (id, false),
        None => {
            let res = sqlx::query("INSERT INTO Manufacturer (name) VALUES (?)")
                .bind(mfg_name)
                .execute(&mut *tx)
                .await?;
            (res.last_insert_id() as i32, true)
        }
    };

    // 2. Distributor — find by case-insensitive name; auto-create if
    //    missing. Source-specific (Mouser / Digi-Key / etc.).
    let dist_existing: Option<(i32,)> = sqlx::query_as(
        "SELECT id FROM Distributor WHERE LOWER(name) = LOWER(?) LIMIT 1",
    )
    .bind(distributor.name)
    .fetch_optional(&mut *tx)
    .await?;
    let distributor_id = match dist_existing {
        Some((id,)) => id,
        None => {
            let res = sqlx::query(
                "INSERT INTO Distributor (name, url, enabledForReports) \
                 VALUES (?, ?, 1)",
            )
            .bind(distributor.name)
            .bind(distributor.url)
            .execute(&mut *tx)
            .await?;
            res.last_insert_id() as i32
        }
    };

    // 3. Part — Name = MPN (matches existing convention; longer text
    //    lives in description).
    let desc_full = r.description.trim();
    let part_name = if !r.mpn.trim().is_empty() {
        r.mpn.trim().to_string()
    } else {
        let mut buf = String::new();
        for ch in desc_full.chars() {
            if buf.chars().count() >= 80 { break; }
            buf.push(ch);
        }
        buf
    };

    let now = Utc::now().naive_utc();
    let part_res = sqlx::query(
        "INSERT INTO Part \
            (category_id, name, description, comment, stockLevel, \
             minStockLevel, averagePrice, status, needsReview, \
             partCondition, createDate, partUnit_id, \
             removals, lowStock, productionRemarks, \
             internalPartNumber, metaPart) \
         VALUES (?, ?, ?, '', 0, 0, 0, NULL, 0, NULL, ?, ?, 0, 1, NULL, NULL, 0)",
    )
    .bind(req.category_id)
    .bind(&part_name)
    .bind(desc_full)
    .bind(now)
    .bind(req.part_unit_id)
    .execute(&mut *tx)
    .await?;
    let part_id = part_res.last_insert_id() as i32;

    // 4. PartManufacturer link.
    sqlx::query(
        "INSERT INTO PartManufacturer (part_id, manufacturer_id, partNumber) \
         VALUES (?, ?, ?)",
    )
    .bind(part_id)
    .bind(manufacturer_id)
    .bind(&r.mpn)
    .execute(&mut *tx)
    .await?;

    // 5. PartDistributor link. Use the cheapest / lowest-quantity
    //    price break as the primary; standard_pack_qty (if set)
    //    drives packagingUnit.
    let primary_break = r.price_breaks.iter().min_by_key(|pb| pb.quantity);
    let unit_price: Option<rust_decimal::Decimal> = primary_break
        .and_then(|pb| pb.price.parse().ok());
    let currency: Option<&str> = primary_break.map(|pb| pb.currency.as_str());
    let packaging_unit = r.standard_pack_qty
        .or(r.order_qty_multiple)
        .filter(|n| *n > 0)
        .unwrap_or(1);

    sqlx::query(
        "INSERT INTO PartDistributor \
            (part_id, distributor_id, orderNumber, price, currency, \
             sku, packagingUnit, ignoreForReports) \
         VALUES (?, ?, ?, ?, ?, ?, ?, 0)",
    )
    .bind(part_id)
    .bind(distributor_id)
    .bind(&r.distributor_pn)
    .bind(unit_price)
    .bind(currency)
    .bind(&r.mpn)
    .bind(packaging_unit)
    .execute(&mut *tx)
    .await?;

    // 6. PartParameter rows for each source-supplied parameter. v1
    //    imports everything as string params — operator can re-type
    //    individual ones as numeric+unit afterwards.
    for param in &r.parameters {
        let name = param.name.trim();
        let value = param.value.trim();
        if name.is_empty() || value.is_empty() { continue; }
        sqlx::query(
            "INSERT INTO PartParameter \
                (part_id, unit_id, name, description, value, siPrefix_id, \
                 normalizedValue, maximumValue, normalizedMaxValue, \
                 minimumValue, normalizedMinValue, stringValue, valueType, \
                 minSiPrefix_id, maxSiPrefix_id) \
             VALUES (?, NULL, ?, '', NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?, 'string', NULL, NULL)",
        )
        .bind(part_id)
        .bind(name)
        .bind(value)
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;
    tracing::info!(part_id, mpn = %r.mpn, source = %r.source, "imported part");

    // 7. Datasheet fetch (best-effort, post-commit).
    let (datasheet_attachment_id, datasheet_error) = match r.datasheet_url.as_deref() {
        Some(url) if !url.trim().is_empty() => {
            match fetch_url_core(
                pool, store, AttachmentKind::PartAttachment, part_id,
                FetchByUrl { url: url.to_string(), filename: None },
            ).await {
                Ok(rows) => (rows.0.first().map(|r| r.id), None),
                Err(e) => {
                    let msg = format!("{e:?}");
                    tracing::warn!(part_id, %msg, "datasheet fetch failed");
                    (None, Some(strip_apperror(&msg)))
                }
            }
        }
        _ => (None, None),
    };

    // 8. Manufacturer image fetch — only on newly-created mfgs.
    let (logo_attachment_id, logo_error) = if manufacturer_created {
        match r.image_url.as_deref() {
            Some(url) if !url.trim().is_empty() => {
                match fetch_url_core(
                    pool, store, AttachmentKind::ManufacturerICLogo, manufacturer_id,
                    FetchByUrl { url: url.to_string(), filename: None },
                ).await {
                    Ok(rows) => (rows.0.first().map(|r| r.id), None),
                    Err(e) => {
                        let msg = format!("{e:?}");
                        tracing::warn!(manufacturer_id, %msg, "logo fetch failed");
                        (None, Some(strip_apperror(&msg)))
                    }
                }
            }
            _ => (None, None),
        }
    } else {
        (None, None)
    };

    Ok(ImportResponse {
        part_id,
        manufacturer_id,
        distributor_id,
        manufacturer_created,
        datasheet_attachment_id,
        datasheet_error,
        logo_attachment_id,
        logo_error,
    })
}

fn strip_apperror(dbg: &str) -> String {
    if let Some(start) = dbg.find('"') {
        let rest = &dbg[start + 1..];
        if let Some(end) = rest.rfind('"') {
            return rest[..end].to_string();
        }
    }
    dbg.to_string()
}
