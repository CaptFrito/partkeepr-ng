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
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::MySqlPool;

use crate::error::AppError;
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
//  Import endpoint — delegates to shared `lookup::import_lookup_result`
//  with Mouser as the distributor identity.
// ===========================================================================

pub async fn import(
    State(pool): State<MySqlPool>,
    State(store): State<StorageConfig>,
    Json(req): Json<crate::handlers::lookup::ImportRequest>,
) -> Result<Json<crate::handlers::lookup::ImportResponse>, AppError> {
    let resp = crate::handlers::lookup::import_lookup_result(
        &pool, &store, req,
        crate::handlers::lookup::DistributorIdentity {
            name: "Mouser",
            url:  "https://www.mouser.com",
        },
    ).await?;
    Ok(Json(resp))
}
