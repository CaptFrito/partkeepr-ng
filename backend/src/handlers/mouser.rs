//! Slice 12a.1 — Mouser Search API integration.
//!
//! Three things:
//! 1. `MouserConfig` — env-var-driven feature flag (search key
//!    present = feature enabled). Held in `AppState`; `lookup.rs`
//!    surfaces it as `capabilities`.
//! 2. `search` handler — calls Mouser's v2 Search API (keyword or
//!    partnumber), maps the response into our `LookupResult` shape.
//! 3. `import` handler — given a `LookupResult` + operator-supplied
//!    category/unit, creates Part + PartManufacturer + PartDistributor
//!    in one transaction; auto-creates the Manufacturer and the
//!    "Mouser" Distributor row if either is missing. After commit,
//!    fetches the datasheet (PartAttachment) and the manufacturer
//!    image (ManufacturerICLogo for newly-created mfgs only) via the
//!    existing slice-7 by-URL pipeline. Attachment-fetch failures
//!    don't roll back the part — operator can attach manually later.

use axum::{extract::State, Json};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::MySqlPool;

use crate::error::AppError;
use crate::handlers::attachments::{fetch_url_core, AttachmentKind, FetchByUrl};
use crate::handlers::lookup::{LookupResult, LookupResultParameter, PriceBreak};
use crate::handlers::storage::StorageConfig;

const MOUSER_SEARCH_BASE: &str = "https://api.mouser.com/api/v2/search";
const HTTP_TIMEOUT_SECS: u64 = 15;

#[derive(Clone, Debug, Default)]
pub struct MouserConfig {
    /// Search API key (env: PARTKEEPR_MOUSER_SEARCH_KEY).
    pub search_key: Option<String>,
}

impl MouserConfig {
    pub fn from_env() -> Self {
        let search_key = std::env::var("PARTKEEPR_MOUSER_SEARCH_KEY")
            .ok()
            .filter(|s| !s.trim().is_empty());
        if search_key.is_some() {
            tracing::info!("mouser search api enabled");
        } else {
            tracing::info!("mouser search api disabled (set PARTKEEPR_MOUSER_SEARCH_KEY to enable)");
        }
        Self { search_key }
    }
}

// ===========================================================================
//  Wire-format types — what Mouser actually returns
// ===========================================================================

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct MouserSearchResponse {
    #[serde(default)]
    errors: Vec<MouserError>,
    search_results: Option<MouserSearchResults>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct MouserSearchResults {
    #[serde(default)]
    number_of_result: i32,
    #[serde(default)]
    parts: Vec<MouserPart>,
}

#[derive(Debug, Deserialize)]
struct MouserError {
    #[serde(default)]
    #[serde(rename = "Code")]
    code: String,
    #[serde(default)]
    #[serde(rename = "Message")]
    message: String,
    #[serde(default)]
    #[serde(rename = "PropertyName")]
    property_name: Option<String>,
}

/// Mouser sends `null` for many string fields rather than omitting
/// them, and serde's `#[serde(default)]` only kicks in for *missing*
/// fields, not nulls. This deserializer coerces both null and missing
/// to an empty string so downstream code can treat all "no value"
/// cases uniformly.
fn null_to_empty_string<'de, D>(de: D) -> Result<String, D::Error>
where D: serde::Deserializer<'de> {
    Ok(Option::<String>::deserialize(de)?.unwrap_or_default())
}

fn null_to_empty_vec<'de, D, T>(de: D) -> Result<Vec<T>, D::Error>
where D: serde::Deserializer<'de>, T: serde::Deserialize<'de> {
    Ok(Option::<Vec<T>>::deserialize(de)?.unwrap_or_default())
}

/// What Mouser returns per part. Field names are PascalCase per their
/// API; we use serde rename to map. Only the fields we actually consume
/// are listed — Mouser sends more (UnitWeightKg etc.) that we ignore.
/// Most string fields use `null_to_empty_string` because Mouser sends
/// JSON null for "no value" rather than omitting the field.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct MouserPart {
    #[serde(default, deserialize_with = "null_to_empty_string")]
    mouser_part_number: String,
    #[serde(default, deserialize_with = "null_to_empty_string")]
    manufacturer_part_number: String,
    #[serde(default, deserialize_with = "null_to_empty_string")]
    manufacturer: String,
    #[serde(default, deserialize_with = "null_to_empty_string")]
    description: String,
    #[serde(default, deserialize_with = "null_to_empty_string")]
    category: String,
    #[serde(default, deserialize_with = "null_to_empty_string")]
    data_sheet_url: String,
    #[serde(default, deserialize_with = "null_to_empty_string")]
    image_path: String,
    #[serde(default, deserialize_with = "null_to_empty_string")]
    product_detail_url: String,
    #[serde(default, deserialize_with = "null_to_empty_string")]
    availability: String, // free-form string e.g. "45298 In Stock"
    #[serde(default, deserialize_with = "null_to_empty_string")]
    availability_in_stock: String, // clean integer-as-string e.g. "45298"
    #[serde(default, deserialize_with = "null_to_empty_string")]
    min: String, // Mouser sends "1" / "10" — string, not int.
    #[serde(default, deserialize_with = "null_to_empty_string")]
    mult: String, // Order multiple, also string.
    #[serde(default, deserialize_with = "null_to_empty_string")]
    lifecycle_status: String,
    #[serde(default, deserialize_with = "null_to_empty_string")]
    rohs_status: String,
    #[serde(default, deserialize_with = "null_to_empty_string")]
    lead_time: String, // Free-form, e.g. "5 Weeks". Parse best-effort.
    #[serde(default, deserialize_with = "null_to_empty_vec")]
    price_breaks: Vec<MouserPriceBreak>,
    /// Mouser's ProductAttributes — typically packaging info
    /// (Packaging, Standard Pack Qty). The full parametric data
    /// (capacitance, voltage rating, etc.) is *not* in this field;
    /// it's parsed out of the description text on Mouser's website.
    /// We import what's here as string PartParameter rows.
    #[serde(default, deserialize_with = "null_to_empty_vec")]
    product_attributes: Vec<MouserProductAttribute>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct MouserProductAttribute {
    #[serde(default, deserialize_with = "null_to_empty_string")]
    attribute_name: String,
    #[serde(default, deserialize_with = "null_to_empty_string")]
    attribute_value: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct MouserPriceBreak {
    #[serde(default)]
    quantity: i32,
    #[serde(default, deserialize_with = "null_to_empty_string")]
    price: String,    // "$0.42" — has currency symbol prefix.
    #[serde(default, deserialize_with = "null_to_empty_string")]
    currency: String, // "USD"
}

// ===========================================================================
//  Search endpoint
// ===========================================================================

#[derive(Debug, Deserialize)]
pub struct SearchRequest {
    pub q: String,
    /// "keyword" | "partnumber"
    pub by: String,
}

#[derive(Debug, Serialize)]
pub struct SearchResponse {
    pub items: Vec<LookupResult>,
    pub errors: Vec<String>,
}

pub async fn search(
    State(cfg): State<MouserConfig>,
    Json(req): Json<SearchRequest>,
) -> Result<Json<SearchResponse>, AppError> {
    let key = cfg.search_key.as_ref().ok_or_else(|| {
        AppError::BadRequest("mouser search not configured (set PARTKEEPR_MOUSER_SEARCH_KEY)")
    })?;

    let q = req.q.trim();
    if q.is_empty() {
        return Err(AppError::BadRequest("query is required"));
    }

    // Build endpoint URL + body per the API guide. Both endpoints
    // take the api key as a query parameter; the body shape differs.
    let (url, body) = match req.by.as_str() {
        "partnumber" => (
            format!("{MOUSER_SEARCH_BASE}/partnumber?apiKey={key}"),
            json!({ "SearchByPartRequest": { "mouserPartNumber": q } }),
        ),
        "keyword" | "" => (
            format!("{MOUSER_SEARCH_BASE}/keyword?apiKey={key}"),
            json!({ "SearchByKeywordRequest": { "keyword": q, "records": 50, "startingRecord": 0 } }),
        ),
        other => {
            return Err(AppError::BadRequest(crate::handlers::attachments::leak(format!(
                "unknown search type: {other}"
            ))));
        }
    };

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(HTTP_TIMEOUT_SECS))
        .build()
        .map_err(|e| AppError::Internal(format!("reqwest build: {e}")))?;
    let resp = client.post(&url).json(&body).send().await
        .map_err(|e| AppError::Internal(format!("mouser search: {e}")))?;
    let status = resp.status();
    let raw = resp.text().await
        .map_err(|e| AppError::Internal(format!("mouser body read: {e}")))?;

    // Mouser returns HTTP 200 with an Errors array even on bad keys
    // / malformed requests. Surface those as warnings but don't fail
    // the request — the operator's UI shows them.
    let parsed: MouserSearchResponse = serde_json::from_str(&raw)
        .map_err(|e| AppError::Internal(format!(
            "mouser response parse failed (status={status}): {e}: {}",
            raw.chars().take(400).collect::<String>()
        )))?;

    let mut errors: Vec<String> = parsed.errors.iter()
        .map(|e| format!(
            "{}: {}{}",
            e.code,
            e.message,
            e.property_name.as_deref().map(|p| format!(" ({p})")).unwrap_or_default()
        ))
        .collect();

    let items: Vec<LookupResult> = parsed.search_results
        .map(|r| r.parts)
        .unwrap_or_default()
        .into_iter()
        .map(map_part)
        .collect();

    if items.is_empty() && errors.is_empty() && parsed.errors.is_empty() {
        // Genuine no-hits-but-no-errors response.
        errors.push("No results.".to_string());
    }

    Ok(Json(SearchResponse { items, errors }))
}

fn map_part(p: MouserPart) -> LookupResult {
    let price_breaks = p.price_breaks.into_iter()
        .map(|pb| PriceBreak {
            quantity: pb.quantity,
            // Strip leading currency symbol (e.g. "$0.42" → "0.42").
            // Some symbols are multi-byte ("£", "€"); take from first
            // ASCII digit / dot onward.
            price: pb.price.trim_start_matches(|c: char| {
                !c.is_ascii_digit() && c != '.' && c != '-'
            }).to_string(),
            currency: pb.currency,
        })
        .collect();

    let lead_time_days = parse_lead_time_days(&p.lead_time);

    // Mouser's stock fields:
    //   - AvailabilityInStock = clean integer-as-string ("45298")
    //   - Availability        = free-form string ("45298 In Stock")
    //   - FactoryStock        = something else, often "0" — NOT inventory
    // Prefer the clean field; fall back to the string if absent.
    let availability_str = if !p.availability_in_stock.trim().is_empty() {
        Some(format!("In Stock: {}", p.availability_in_stock))
    } else if !p.availability.trim().is_empty() {
        Some(p.availability)
    } else {
        None
    };

    // Map ProductAttributes → LookupResultParameter list. Also pull
    // "Standard Pack Qty" out as the canonical packaging unit since
    // Mouser doesn't expose it as a top-level field.
    let mut parameters: Vec<LookupResultParameter> = Vec::new();
    let mut standard_pack_qty: Option<i32> = None;
    for a in &p.product_attributes {
        let name = a.attribute_name.trim();
        let value = a.attribute_value.trim();
        if name.is_empty() || value.is_empty() { continue; }
        if name.eq_ignore_ascii_case("Standard Pack Qty") {
            standard_pack_qty = value.parse().ok().or(standard_pack_qty);
        }
        parameters.push(LookupResultParameter {
            name: name.to_string(),
            value: value.to_string(),
        });
    }

    LookupResult {
        source: "mouser".to_string(),
        mpn: p.manufacturer_part_number,
        manufacturer_name: p.manufacturer,
        description: p.description,
        category_name: opt_nonempty(p.category),
        image_url: opt_nonempty(p.image_path),
        datasheet_url: opt_nonempty(p.data_sheet_url),
        detail_url: opt_nonempty(p.product_detail_url),
        distributor_pn: p.mouser_part_number,
        price_breaks,
        availability: availability_str,
        min_order_qty: p.min.parse().ok(),
        order_qty_multiple: p.mult.parse().ok(),
        standard_pack_qty,
        lifecycle_status: opt_nonempty(p.lifecycle_status),
        rohs_status: opt_nonempty(p.rohs_status),
        lead_time_days,
        parameters,
    }
}

fn opt_nonempty(s: String) -> Option<String> {
    let t = s.trim();
    if t.is_empty() { None } else { Some(s) }
}

/// Best-effort: Mouser's `LeadTime` is free-form text like "12 Weeks"
/// or "5 Days" or "". Parse the integer + unit when possible.
fn parse_lead_time_days(s: &str) -> Option<i32> {
    let s = s.trim();
    if s.is_empty() { return None; }
    let mut parts = s.split_whitespace();
    let n: i32 = parts.next()?.parse().ok()?;
    let unit = parts.next()?.to_lowercase();
    let multiplier = match unit.as_str() {
        u if u.starts_with("day") => 1,
        u if u.starts_with("week") => 7,
        u if u.starts_with("month") => 30,
        _ => return None,
    };
    Some(n * multiplier)
}

// ===========================================================================
//  Import endpoint
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
    /// PartAttachment id if the datasheet was successfully fetched.
    pub datasheet_attachment_id: Option<i32>,
    /// Reason the datasheet fetch failed, if it did. Frontend
    /// surfaces this in the toast.
    pub datasheet_error: Option<String>,
    pub logo_attachment_id: Option<i32>,
    pub logo_error: Option<String>,
}

pub async fn import(
    State(pool): State<MySqlPool>,
    State(store): State<StorageConfig>,
    Json(req): Json<ImportRequest>,
) -> Result<Json<ImportResponse>, AppError> {
    let r = &req.result;
    if r.mpn.trim().is_empty() {
        return Err(AppError::BadRequest("result.mpn is required"));
    }
    if r.manufacturer_name.trim().is_empty() {
        return Err(AppError::BadRequest("result.manufacturer_name is required"));
    }

    let mut tx = pool.begin().await?;

    // 1. Manufacturer — find by case-insensitive exact name; create if
    //    missing.
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

    // 2. Mouser distributor — find by case-insensitive name; create
    //    if missing. (Should exist; safety net.)
    let dist_existing: Option<(i32,)> = sqlx::query_as(
        "SELECT id FROM Distributor WHERE LOWER(name) = 'mouser' LIMIT 1",
    )
    .fetch_optional(&mut *tx)
    .await?;
    let distributor_id = match dist_existing {
        Some((id,)) => id,
        None => {
            let res = sqlx::query(
                "INSERT INTO Distributor (name, url, enabledForReports) \
                 VALUES ('Mouser', 'https://www.mouser.com', 1)",
            )
            .execute(&mut *tx)
            .await?;
            res.last_insert_id() as i32
        }
    };

    // 3. Part — name = MPN (matches the convention seen on operator's
    //    existing parts, where short identifier-like strings live in
    //    Part.name and the longer freeform text goes in description).
    //    Fall back to truncated description only when MPN is missing.
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

    // 5. PartDistributor link. Use the qty=1 price break as the
    //    primary price; standard_pack_qty (if set) drives packagingUnit.
    let primary_break = r.price_breaks.iter()
        .min_by_key(|pb| pb.quantity);
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

    // 6. PartParameter rows for each ProductAttribute. v1 imports
    //    everything as string params (Mouser's attributes are mostly
    //    packaging info; richer parametric data is in the Description
    //    free-text and would need a parser to extract).
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
    tracing::info!(part_id, mpn = %r.mpn, "imported part from mouser");

    // 6. Datasheet fetch (best-effort, post-commit). Failures don't
    //    roll back the part — operator can attach manually.
    let (datasheet_attachment_id, datasheet_error) = match r.datasheet_url.as_deref() {
        Some(url) if !url.trim().is_empty() => {
            match fetch_url_core(
                &pool, &store, AttachmentKind::PartAttachment, part_id,
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

    // 7. Manufacturer image fetch — only when we just created the
    //    manufacturer. Avoids piling logos on existing manufacturers.
    let (logo_attachment_id, logo_error) = if manufacturer_created {
        match r.image_url.as_deref() {
            Some(url) if !url.trim().is_empty() => {
                match fetch_url_core(
                    &pool, &store, AttachmentKind::ManufacturerICLogo, manufacturer_id,
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

    Ok(Json(ImportResponse {
        part_id,
        manufacturer_id,
        distributor_id,
        manufacturer_created,
        datasheet_attachment_id,
        datasheet_error,
        logo_attachment_id,
        logo_error,
    }))
}

/// Pull a human-readable message out of an `AppError` debug string.
/// `AppError` doesn't impl Display; this is a best-effort extraction.
fn strip_apperror(dbg: &str) -> String {
    // Common shapes:
    //   `BadRequest("message")` → "message"
    //   `Internal("message")` → "message"
    //   `NotFound("name")` → "name not found"
    if let Some(start) = dbg.find('"') {
        let rest = &dbg[start + 1..];
        if let Some(end) = rest.rfind('"') {
            return rest[..end].to_string();
        }
    }
    dbg.to_string()
}
