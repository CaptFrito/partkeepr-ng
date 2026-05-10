// SPDX-License-Identifier: GPL-3.0-or-later

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
    /// Order History / Cart / Order key (env: PARTKEEPR_MOUSER_ORDER_KEY).
    /// Distinct from the Search key — Mouser issues two on the same
    /// account; this one unlocks the four `/orderhistory/*` endpoints.
    pub order_key: Option<String>,
}

impl MouserConfig {
    pub fn from_env() -> Self {
        let search_key = std::env::var("PARTKEEPR_MOUSER_SEARCH_KEY")
            .ok()
            .filter(|s| !s.trim().is_empty());
        let order_key = std::env::var("PARTKEEPR_MOUSER_ORDER_KEY")
            .ok()
            .filter(|s| !s.trim().is_empty());
        if search_key.is_some() {
            tracing::info!("mouser search api enabled");
        } else {
            tracing::info!("mouser search api disabled (set PARTKEEPR_MOUSER_SEARCH_KEY to enable)");
        }
        if order_key.is_some() {
            tracing::info!("mouser order history api enabled");
        }
        Self { search_key, order_key }
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

// ===========================================================================
//  Slice 12a.2 — Mouser Order History receive flow
//
//  Endpoints (path: /api/v1/orderhistory/...):
//   - salesOrderNumber?apiKey&salesOrderNumber  → per-order line items
//   - webOrderNumber?apiKey&webOrderNumber      → same shape, web-order #
//   - ByDateRange?apiKey&startDate&endDate      → list of order summaries
//   - ByDateFilter?apiKey&dateFilter            → preset windows
//
//  Wire format taken from Mouser's live swagger doc — fields are
//  PascalCase (consistent with their Search API). Per-line shape:
//    OrderLines[].{ Quantity, UnitPrice, ExtPrice, FormattedUnitPrice,
//                   FormattedExtendedPrice,
//                   ProductInfo.{ MouserPartNumber, CustomerPartNumber,
//                                 ManufacturerName, ManufacturerPartNumber,
//                                 PartDescription },
//                   AdditionalFees[], Activities[] }
//
//  We map onto the same `OrderStatusResponse`/`OrderStatusLine` /
//  `OrderReceive*` shapes the Digi-Key flow uses, so the frontend
//  dialog can be source-agnostic.
// ===========================================================================

const MOUSER_ORDER_BASE: &str = "https://api.mouser.com/api/v1/orderhistory";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct MouserOrderDetailResponse {
    #[serde(default)]
    order_lines: Vec<MouserOrderLine>,
    #[serde(default, deserialize_with = "null_to_empty_vec")]
    errors: Vec<MouserOrderError>,
}

#[derive(Debug, Deserialize)]
struct MouserOrderError {
    #[serde(default, rename = "Message", deserialize_with = "null_to_empty_string")]
    message: String,
    #[allow(dead_code)]
    #[serde(default, rename = "Code", deserialize_with = "null_to_empty_string")]
    code: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct MouserOrderLine {
    #[serde(default)]
    quantity: i32,
    #[serde(default)]
    unit_price: f64,
    #[allow(dead_code)]
    #[serde(default)]
    ext_price: f64,
    #[allow(dead_code)]
    #[serde(default, deserialize_with = "null_to_empty_string")]
    formatted_unit_price: String,
    #[serde(default)]
    product_info: MouserProductInfo,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct MouserProductInfo {
    #[serde(default, deserialize_with = "null_to_empty_string")]
    mouser_part_number: String,
    #[allow(dead_code)]
    #[serde(default, deserialize_with = "null_to_empty_string")]
    customer_part_number: String,
    #[serde(default, deserialize_with = "null_to_empty_string")]
    manufacturer_name: String,
    #[serde(default, deserialize_with = "null_to_empty_string")]
    manufacturer_part_number: String,
    #[serde(default, deserialize_with = "null_to_empty_string")]
    part_description: String,
}

async fn fetch_order_detail(
    cfg: &MouserConfig,
    sales_order_number: &str,
) -> Result<MouserOrderDetailResponse, AppError> {
    let key = cfg.order_key.as_ref().ok_or_else(|| AppError::BadRequest(
        "mouser order history not configured (set PARTKEEPR_MOUSER_ORDER_KEY)",
    ))?;
    let base = format!("{}/salesOrderNumber", MOUSER_ORDER_BASE);
    let url = reqwest::Url::parse_with_params(&base, &[
        ("salesOrderNumber", sales_order_number),
        ("apiKey", key.as_str()),
    ]).map_err(|e| AppError::Internal(format!("mouser order url: {e}")))?;
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(HTTP_TIMEOUT_SECS))
        .build()
        .map_err(|e| AppError::Internal(format!("reqwest build: {e}")))?;
    let resp = client.get(url)
        .header("Accept", "application/json")
        .send().await
        .map_err(|e| AppError::Internal(format!("mouser order: {e}")))?;
    let status = resp.status();
    let text = resp.text().await
        .map_err(|e| AppError::Internal(format!("mouser order body: {e}")))?;
    if !status.is_success() {
        return Err(AppError::Internal(format!(
            "mouser order HTTP {status}: {}",
            text.chars().take(400).collect::<String>()
        )));
    }
    serde_json::from_str(&text).map_err(|e| AppError::Internal(format!(
        "mouser order parse: {e}: {}",
        text.chars().take(400).collect::<String>()
    )))
}

// ----- Preview endpoint (mirrors Digi-Key's order_status shape) -----

use crate::handlers::lookup::{
    OrderStatusRequest as MouserOrderStatusRequest,
    OrderStatusResponse as MouserOrderStatusResponse,
    OrderStatusLine as MouserOrderStatusLine,
    OrderReceiveRequest as MouserOrderReceiveRequest,
    OrderReceiveResponse as MouserOrderReceiveResponse,
    OrderReceiveResult as MouserOrderReceiveResult,
};

pub async fn order_status(
    State(pool): State<MySqlPool>,
    State(cfg): State<MouserConfig>,
    Json(req): Json<MouserOrderStatusRequest>,
) -> Result<Json<MouserOrderStatusResponse>, AppError> {
    if cfg.order_key.is_none() {
        return Err(AppError::BadRequest(
            "mouser order history not configured (set PARTKEEPR_MOUSER_ORDER_KEY)",
        ));
    }
    // The shared OrderStatusRequest carries `order_id: i64`; Mouser SO#s
    // are also numeric in practice. Pass through as a string to the API.
    if req.order_id <= 0 {
        return Err(AppError::BadRequest("order_id must be > 0"));
    }
    let so_str = req.order_id.to_string();

    let detail = fetch_order_detail(&cfg, &so_str).await?;

    // Bubble any non-empty error messages — Mouser returns 200 with
    // an Errors[] body for soft failures (key wrong scope, SO# not
    // owned by account, etc.).
    if let Some(err) = detail.errors.iter().find(|e| !e.message.trim().is_empty()) {
        return Err(AppError::Internal(format!("mouser: {}", err.message)));
    }

    let mut lines: Vec<MouserOrderStatusLine> = Vec::with_capacity(detail.order_lines.len());
    for (idx, ol) in detail.order_lines.iter().enumerate() {
        let mouser_pn = ol.product_info.mouser_part_number.trim();
        let (part_id, part_name, current_stock, default_storage_location_id) = if mouser_pn.is_empty() {
            (None, None, None, None)
        } else {
            let row: Option<(i32, String, i32, Option<i32>)> = sqlx::query_as(
                "SELECT p.id, p.name, p.stockLevel, p.storageLocation_id \
                 FROM PartDistributor pd \
                 JOIN Distributor d ON d.id = pd.distributor_id \
                 JOIN Part p        ON p.id = pd.part_id \
                 WHERE LOWER(d.name) = 'mouser' \
                   AND pd.orderNumber = ? \
                 ORDER BY p.id LIMIT 1",
            )
            .bind(mouser_pn)
            .fetch_optional(&pool)
            .await?;
            match row {
                Some((pid, name, stock, sloc)) => (Some(pid), Some(name), Some(stock), sloc),
                None => (None, None, None, None),
            }
        };

        // Slice 13d: already-received units against this Mouser SO#.
        let units_already_received: Option<i32> = if let Some(pid) = part_id {
            let v: Option<i64> = sqlx::query_scalar(
                "SELECT CAST(SUM(stockLevel) AS SIGNED) \
                 FROM StockEntry se \
                 JOIN Distributor d ON d.id = se.distributor_id \
                 WHERE se.part_id = ? \
                   AND LOWER(d.name) = 'mouser' \
                   AND se.salesOrderNumber = ? \
                   AND se.stockLevel > 0",
            )
            .bind(pid)
            .bind(&so_str)
            .fetch_one(&pool)
            .await?;
            Some(v.unwrap_or(0) as i32)
        } else {
            None
        };

        // Mouser's per-order endpoint returns `Quantity` (ordered),
        // not a separate shipped count. The receive flow defaults
        // `qty_shipped = quantity_ordered` since order-history rows
        // typically reflect already-fulfilled orders, but the operator
        // can edit per-line before applying.
        lines.push(MouserOrderStatusLine {
            line_number: format!("{}", idx + 1),
            digikey_pn: mouser_pn.to_string(),  // shared field name; "Distributor SKU"
            mpn: ol.product_info.manufacturer_part_number.clone(),
            manufacturer: ol.product_info.manufacturer_name.clone(),
            description: ol.product_info.part_description.clone(),
            customer_reference: ol.product_info.customer_part_number.clone(),
            quantity_ordered: ol.quantity,
            quantity_shipped: ol.quantity, // assume fulfilled
            quantity_backorder: 0,
            unit_price: ol.unit_price,
            part_id,
            part_name,
            current_stock,
            default_storage_location_id,
            units_already_received,
        });
    }

    Ok(Json(MouserOrderStatusResponse {
        sales_order_id: req.order_id,
        currency: "USD".to_string(), // Mouser order endpoint doesn't echo currency
        lines,
    }))
}

pub async fn order_receive(
    State(pool): State<MySqlPool>,
    axum::Extension(user): axum::Extension<crate::handlers::auth::CurrentUser>,
    Json(req): Json<MouserOrderReceiveRequest>,
) -> Result<Json<MouserOrderReceiveResponse>, AppError> {
    if req.order_id <= 0 {
        return Err(AppError::BadRequest("order_id must be > 0"));
    }
    if req.lines.is_empty() {
        return Err(AppError::BadRequest("no lines to apply"));
    }
    for l in &req.lines {
        if l.quantity <= 0 {
            return Err(AppError::BadRequest("line quantity must be > 0"));
        }
    }

    let mut tx = pool.begin().await?;
    let mouser_id = match sqlx::query_as::<_, (i32,)>(
        "SELECT id FROM Distributor WHERE LOWER(name) = 'mouser' LIMIT 1",
    ).fetch_optional(&mut *tx).await? {
        Some((id,)) => id,
        None => {
            let res = sqlx::query(
                "INSERT INTO Distributor (name, url, enabledForReports) \
                 VALUES ('Mouser', 'https://www.mouser.com', 1)",
            ).execute(&mut *tx).await?;
            res.last_insert_id() as i32
        }
    };
    let so_str = req.order_id.to_string();

    let mut results: Vec<MouserOrderReceiveResult> = Vec::with_capacity(req.lines.len());
    for (idx, line) in req.lines.iter().enumerate() {
        let default_comment = format!("Mouser SO #{} line {}", req.order_id, idx + 1);
        let comment = line.comment.as_deref().filter(|s| !s.trim().is_empty())
            .unwrap_or(&default_comment);

        // Slice 13d: parallel to digikey::order_receive — mint a PSL
        // row per line unless the operator opted out (already scanned
        // this reel earlier).
        let psl_id: Option<i32> = if line.skip_psl_row {
            None
        } else {
            let form = line.form.as_deref().unwrap_or("Loose");
            Some(crate::handlers::stock::insert_psl_row_in_tx(
                &mut tx,
                line.part_id,
                form,
                line.storage_location_id,
                line.quantity,
                None, None,
                Some(comment),
                user.user_id,
            ).await?)
        };

        let (stock_after, low_stock) = crate::handlers::stock::apply_stock_change_in_tx(
            &mut tx,
            line.part_id,
            line.quantity,
            line.price,
            Some(comment),
            false,
            user.user_id,
            crate::handlers::stock::OrderAttribution {
                distributor_id: Some(mouser_id),
                sales_order_number: Some(&so_str),
            },
            psl_id,
        ).await?;
        results.push(MouserOrderReceiveResult {
            part_id: line.part_id,
            quantity: line.quantity,
            stock_after,
            low_stock,
        });
    }
    tx.commit().await?;
    tracing::info!(
        order_id = req.order_id, applied = results.len(),
        "mouser order received",
    );

    Ok(Json(MouserOrderReceiveResponse {
        applied: results.len(),
        results,
    }))
}
