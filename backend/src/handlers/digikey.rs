// SPDX-License-Identifier: GPL-3.0-or-later

//! Slice 12b — Digi-Key Product Information V4 integration.
//!
//! OAuth2 client_credentials grant (two-legged), shared token cache
//! (Arc<Mutex<>>) so concurrent search requests don't each refresh,
//! lazy + on-401 invalidation. The search wrapper maps Digi-Key's
//! v4 `Products[]` shape into our shared `LookupResult`. Import
//! delegates to `lookup::import_lookup_result` with Digi-Key as the
//! distributor identity — same flow Mouser uses.
//!
//! Crucially, Digi-Key's `Parameters[]` array carries the structured
//! parametric data (Vceo, IcMax, Pd, package, etc.) that Mouser's
//! Search API doesn't expose. This is the slice's reason to exist.

use axum::{extract::State, Json};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::MySqlPool;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::Mutex;

use crate::error::AppError;
use crate::handlers::lookup::{
    DistributorIdentity, ImportRequest, ImportResponse, LookupResult,
    LookupResultParameter, PriceBreak,
};
use crate::handlers::storage::StorageConfig;

const HTTP_TIMEOUT_SECS: u64 = 15;
const TOKEN_REFRESH_MARGIN_SECS: u64 = 30;
const DEFAULT_BASE_URL: &str = "https://api.digikey.com";
/// Default Order Status endpoint — Digi-Key v4 OrderStatus product.
/// The legacy v3 product (`/OrderDetails/v3/Status`) is a separate
/// subscription that most apps don't have; the v4 OrderStatus product
/// is the one approved alongside ProductInformation V4. Override via
/// `PARTKEEPR_DIGIKEY_ORDER_STATUS_PATH` if Digi-Key changes the route.
const DEFAULT_ORDER_STATUS_PATH: &str = "/orderstatus/v4/salesorder";

#[derive(Clone)]
pub struct DigiKeyConfig {
    pub client_id:         Option<String>,
    pub client_secret:     Option<String>,
    pub base_url:          String,
    pub order_status_path: String,
    /// Digi-Key customer number (env: PARTKEEPR_DIGIKEY_CUSTOMER_ID).
    /// Required for OrderStatus calls; v4 returns 400 "Account ID must
    /// not be 0" without it. Independent of OAuth — it's the customer
    /// account whose orders we're querying.
    pub customer_id:       Option<String>,
    pub token_cache:       Arc<Mutex<TokenCache>>,
}

#[derive(Default)]
pub struct TokenCache {
    pub token:      Option<String>,
    pub expires_at: Option<Instant>,
}

impl DigiKeyConfig {
    pub fn from_env() -> Self {
        let client_id = std::env::var("PARTKEEPR_DIGIKEY_CLIENT_ID")
            .ok().filter(|s| !s.trim().is_empty());
        let client_secret = std::env::var("PARTKEEPR_DIGIKEY_CLIENT_SECRET")
            .ok().filter(|s| !s.trim().is_empty());
        let base_url = std::env::var("PARTKEEPR_DIGIKEY_BASE_URL")
            .ok().filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| DEFAULT_BASE_URL.to_string());
        let order_status_path = std::env::var("PARTKEEPR_DIGIKEY_ORDER_STATUS_PATH")
            .ok().filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| DEFAULT_ORDER_STATUS_PATH.to_string());
        let customer_id = std::env::var("PARTKEEPR_DIGIKEY_CUSTOMER_ID")
            .ok().filter(|s| !s.trim().is_empty());
        if client_id.is_some() && client_secret.is_some() {
            tracing::info!(
                base_url = %base_url,
                customer_id_set = customer_id.is_some(),
                "digikey api enabled",
            );
        } else {
            tracing::info!(
                "digikey api disabled (set PARTKEEPR_DIGIKEY_CLIENT_ID and \
                 PARTKEEPR_DIGIKEY_CLIENT_SECRET to enable)"
            );
        }
        Self {
            client_id, client_secret, base_url, order_status_path, customer_id,
            token_cache: Arc::new(Mutex::new(TokenCache::default())),
        }
    }

    pub fn available(&self) -> bool {
        self.client_id.is_some() && self.client_secret.is_some()
    }
}

// ===========================================================================
//  OAuth2 token cache
// ===========================================================================

/// Get a valid access token. Lazy-refreshes if expired or near
/// expiry; safe to call concurrently (mutex serializes refresh,
/// not steady-state usage).
async fn get_token(cfg: &DigiKeyConfig) -> Result<String, AppError> {
    {
        let cache = cfg.token_cache.lock().await;
        if let (Some(tok), Some(exp)) = (cache.token.as_ref(), cache.expires_at) {
            if exp > Instant::now() + Duration::from_secs(TOKEN_REFRESH_MARGIN_SECS) {
                return Ok(tok.clone());
            }
        }
    }
    refresh_token(cfg).await
}

async fn refresh_token(cfg: &DigiKeyConfig) -> Result<String, AppError> {
    let client_id = cfg.client_id.as_ref()
        .ok_or_else(|| AppError::BadRequest("digikey not configured (set PARTKEEPR_DIGIKEY_CLIENT_ID)"))?;
    let client_secret = cfg.client_secret.as_ref()
        .ok_or_else(|| AppError::BadRequest("digikey not configured (set PARTKEEPR_DIGIKEY_CLIENT_SECRET)"))?;

    let url = format!("{}/v1/oauth2/token", cfg.base_url);
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(HTTP_TIMEOUT_SECS))
        .build()
        .map_err(|e| AppError::Internal(format!("reqwest build: {e}")))?;
    let resp = client.post(&url)
        .form(&[
            ("grant_type",    "client_credentials"),
            ("client_id",     client_id.as_str()),
            ("client_secret", client_secret.as_str()),
        ])
        .send().await
        .map_err(|e| AppError::Internal(format!("digikey token: {e}")))?;
    let status = resp.status();
    let body = resp.text().await
        .map_err(|e| AppError::Internal(format!("digikey token body: {e}")))?;
    if !status.is_success() {
        return Err(AppError::Internal(format!(
            "digikey token request failed (HTTP {status}): {}",
            body.chars().take(400).collect::<String>()
        )));
    }
    let parsed: TokenResponse = serde_json::from_str(&body)
        .map_err(|e| AppError::Internal(format!("digikey token parse: {e}: {body}")))?;

    let expires_at = Instant::now() + Duration::from_secs(parsed.expires_in.max(60) as u64);
    let mut cache = cfg.token_cache.lock().await;
    cache.token      = Some(parsed.access_token.clone());
    cache.expires_at = Some(expires_at);
    tracing::info!(expires_in = parsed.expires_in, "digikey token refreshed");
    Ok(parsed.access_token)
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    expires_in:   i64,
    #[allow(dead_code)]
    token_type:   String,
}

// ===========================================================================
//  Search endpoint
// ===========================================================================

#[derive(Debug, Deserialize)]
pub struct SearchRequest {
    pub q: String,
    pub by: String, // "keyword" | "partnumber"
}

#[derive(Debug, Serialize)]
pub struct SearchResponse {
    pub items: Vec<LookupResult>,
    pub errors: Vec<String>,
}

pub async fn search(
    State(cfg): State<DigiKeyConfig>,
    Json(req): Json<SearchRequest>,
) -> Result<Json<SearchResponse>, AppError> {
    if !cfg.available() {
        return Err(AppError::BadRequest(
            "digikey not configured (set PARTKEEPR_DIGIKEY_CLIENT_ID and _CLIENT_SECRET)",
        ));
    }
    let q = req.q.trim();
    if q.is_empty() {
        return Err(AppError::BadRequest("query is required"));
    }

    // Both "MPN" and "keyword" use the same /products/v4/search/keyword
    // endpoint. For MPN searches we set the keyword to the MPN value
    // and add a ManufacturerProductNumber filter to narrow the
    // results. v4's keyword endpoint accepts a free-form text with
    // an optional FilterOptionsRequest.
    let body = match req.by.as_str() {
        "partnumber" => json!({
            "Keywords": q,
            "Limit": 25,
            "Offset": 0,
            "FilterOptionsRequest": {
                "ManufacturerProductNumber": q,
            },
        }),
        _ => json!({ "Keywords": q, "Limit": 25, "Offset": 0 }),
    };

    let mut resp_text = digikey_search_call(&cfg, &body).await?;

    // Try once more on 401 (token might have expired between refresh and use).
    if resp_text.is_empty() {
        // 401 was already detected and the token forcibly cleared
        // inside digikey_search_call's retry loop; but its return
        // is the response body. If empty, try refresh + once more.
        resp_text = digikey_search_call(&cfg, &body).await?;
    }

    let parsed: DkKeywordResponse = serde_json::from_str(&resp_text)
        .map_err(|e| AppError::Internal(format!(
            "digikey search parse: {e}: {}",
            resp_text.chars().take(400).collect::<String>()
        )))?;

    let mut errors: Vec<String> = parsed.errors.iter()
        .map(|e| e.message.clone())
        .filter(|m| !m.trim().is_empty())
        .collect();

    let items: Vec<LookupResult> = parsed.products.into_iter()
        .map(map_product)
        .collect();

    if items.is_empty() && errors.is_empty() {
        errors.push("No results.".to_string());
    }

    Ok(Json(SearchResponse { items, errors }))
}

/// Single Digi-Key search call with token refresh on 401.
async fn digikey_search_call(
    cfg: &DigiKeyConfig,
    body: &serde_json::Value,
) -> Result<String, AppError> {
    let url = format!("{}/products/v4/search/keyword", cfg.base_url);
    digikey_request(cfg, reqwest::Method::POST, &url, Some(body), "search", None).await
}

/// Generic Digi-Key request: handles auth headers + on-401 token
/// refresh + size-bounded error bodies. `op` is a short tag used in
/// error messages and logs. `body` is None for GET / Some(json) for
/// POST. `customer_id` adds an `X-DIGIKEY-Customer-Id` header — only
/// needed for the OrderStatus family.
async fn digikey_request(
    cfg: &DigiKeyConfig,
    method: reqwest::Method,
    url: &str,
    body: Option<&serde_json::Value>,
    op: &str,
    customer_id: Option<&str>,
) -> Result<String, AppError> {
    let client_id = cfg.client_id.as_ref().unwrap(); // available()-checked

    for attempt in 0..2u32 {
        let token = get_token(cfg).await?;
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(HTTP_TIMEOUT_SECS))
            .build()
            .map_err(|e| AppError::Internal(format!("reqwest build: {e}")))?;
        let mut req = client.request(method.clone(), url)
            .header("Authorization", format!("Bearer {token}"))
            .header("X-DIGIKEY-Client-Id", client_id)
            .header("X-DIGIKEY-Locale-Site", "US")
            .header("X-DIGIKEY-Locale-Language", "en")
            .header("X-DIGIKEY-Locale-Currency", "USD")
            .header("Accept", "application/json");
        if let Some(cid) = customer_id {
            req = req.header("X-DIGIKEY-Customer-Id", cid);
        }
        if let Some(b) = body {
            req = req.json(b);
        }
        let resp = req.send().await
            .map_err(|e| AppError::Internal(format!("digikey {op}: {e}")))?;
        let status = resp.status();
        let text = resp.text().await
            .map_err(|e| AppError::Internal(format!("digikey {op} body: {e}")))?;

        if status.as_u16() == 401 && attempt == 0 {
            let mut cache = cfg.token_cache.lock().await;
            cache.token = None;
            cache.expires_at = None;
            tracing::info!(%op, "digikey 401 — invalidating token + retrying");
            continue;
        }
        if status.as_u16() == 404 {
            return Err(AppError::NotFound("digikey order"));
        }
        if !status.is_success() {
            return Err(AppError::Internal(format!(
                "digikey {op} HTTP {status}: {}",
                text.chars().take(400).collect::<String>()
            )));
        }
        return Ok(text);
    }
    Err(AppError::Internal(format!("digikey {op} retries exhausted")))
}

// ===========================================================================
//  Wire format — Digi-Key v4 keyword response
//
//  Digi-Key sometimes serializes integers as strings (`"14"` rather
//  than `14`) — confirmed against ManufacturerLeadWeeks on real
//  products. This helper accepts either form so we don't fail to
//  deserialize the response over a single inconsistent field.
// ===========================================================================

use crate::handlers::serde_helpers::{
    de_int_or_string, de_int_or_string_required, null_to_empty_string,
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct DkKeywordResponse {
    #[serde(default)]
    products: Vec<DkProduct>,
    #[serde(default, rename = "Errors")]
    errors: Vec<DkError>,
}

#[derive(Debug, Deserialize)]
struct DkError {
    #[serde(default, rename = "Message")]
    message: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct DkProduct {
    #[serde(default, rename = "ManufacturerProductNumber")]
    manufacturer_product_number: String,
    #[serde(default)]
    manufacturer: Option<DkManufacturer>,
    #[serde(default)]
    description: Option<DkDescription>,
    #[serde(default)]
    category: Option<DkCategory>,
    #[serde(default)]
    photo_url: Option<String>,
    #[serde(default)]
    datasheet_url: Option<String>,
    #[serde(default)]
    product_url: Option<String>,
    #[serde(default)]
    quantity_available: Option<i64>,
    #[serde(default)]
    product_status: Option<DkProductStatus>,
    #[serde(default)]
    classifications: Option<DkClassifications>,
    #[serde(default, deserialize_with = "de_int_or_string")]
    manufacturer_lead_weeks: Option<i32>,
    #[serde(default)]
    parameters: Vec<DkParameter>,
    #[serde(default)]
    product_variations: Vec<DkProductVariation>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct DkManufacturer { #[serde(default)] name: String }

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct DkDescription {
    #[serde(default)]
    product_description: String,
    #[serde(default)]
    detailed_description: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct DkCategory { #[serde(default)] name: String }

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct DkProductStatus { #[serde(default)] status: String }

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct DkClassifications {
    #[serde(default)]
    rohs_status: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct DkParameter {
    #[serde(default)]
    parameter_text: String,
    #[serde(default)]
    value_text: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct DkProductVariation {
    #[serde(default)]
    digi_key_product_number: String,
    #[serde(default, deserialize_with = "de_int_or_string")]
    minimum_order_quantity: Option<i32>,
    #[serde(default, deserialize_with = "de_int_or_string")]
    standard_package: Option<i32>,
    #[serde(default)]
    standard_pricing: Vec<DkPricing>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct DkPricing {
    #[serde(default, deserialize_with = "de_int_or_string_required")]
    break_quantity: i32,
    #[serde(default)]
    unit_price: f64,
}

fn map_product(p: DkProduct) -> LookupResult {
    let manufacturer_name = p.manufacturer.map(|m| m.name).unwrap_or_default();
    let category_name = p.category.map(|c| c.name).filter(|s| !s.is_empty());

    // Description: prefer DetailedDescription, fall back to ProductDescription.
    let description = p.description
        .map(|d| {
            if !d.detailed_description.trim().is_empty() {
                d.detailed_description
            } else {
                d.product_description
            }
        })
        .unwrap_or_default();

    let lifecycle_status = p.product_status.map(|s| s.status).filter(|s| !s.is_empty());
    let rohs_status = p.classifications.map(|c| c.rohs_status).filter(|s| !s.is_empty());
    let lead_time_days = p.manufacturer_lead_weeks.map(|w| w * 7);

    // Primary product variation: first one in the array. Carries the
    // Digi-Key SKU + the per-quantity price breaks.
    let primary_variation = p.product_variations.first();
    let distributor_pn = primary_variation
        .map(|v| v.digi_key_product_number.clone())
        .unwrap_or_default();
    let min_order_qty = primary_variation.and_then(|v| v.minimum_order_quantity);
    let standard_pack_qty = primary_variation.and_then(|v| v.standard_package);
    let order_qty_multiple = primary_variation.and_then(|v| v.minimum_order_quantity);

    let price_breaks: Vec<PriceBreak> = primary_variation
        .map(|v| {
            v.standard_pricing.iter().map(|pb| PriceBreak {
                quantity: pb.break_quantity,
                price: format!("{:.4}", pb.unit_price),
                currency: "USD".to_string(), // header-driven
            }).collect()
        })
        .unwrap_or_default();

    let parameters: Vec<LookupResultParameter> = p.parameters.into_iter()
        .filter(|p| !p.parameter_text.trim().is_empty() && !p.value_text.trim().is_empty())
        .map(|p| LookupResultParameter {
            name: p.parameter_text,
            value: p.value_text,
        })
        .collect();

    let availability = p.quantity_available.map(|n| format!("In Stock: {n}"));

    LookupResult {
        source: "digikey".to_string(),
        mpn: p.manufacturer_product_number,
        manufacturer_name,
        description,
        category_name,
        image_url: p.photo_url.filter(|s| !s.is_empty()),
        datasheet_url: p.datasheet_url.filter(|s| !s.is_empty()),
        detail_url: p.product_url.filter(|s| !s.is_empty()),
        distributor_pn,
        price_breaks,
        availability,
        min_order_qty,
        order_qty_multiple,
        standard_pack_qty,
        lifecycle_status,
        rohs_status,
        lead_time_days,
        parameters,
    }
}

// ===========================================================================
//  Import endpoint — delegates to shared lookup::import_lookup_result.
// ===========================================================================

pub async fn import(
    State(pool): State<MySqlPool>,
    State(store): State<StorageConfig>,
    Json(req): Json<ImportRequest>,
) -> Result<Json<ImportResponse>, AppError> {
    let resp = crate::handlers::lookup::import_lookup_result(
        &pool, &store, req,
        DistributorIdentity {
            name: "Digi-Key",
            url:  "https://www.digikey.com",
        },
    ).await?;
    Ok(Json(resp))
}

// ===========================================================================
//  Slice 12b.2 — Order Status auto-stock-in
//
//  Default endpoint: GET /OrderDetails/v3/Status/{salesOrderId}
//  Verified wire format from peeter123/digikey-api OSS (BSD-licensed).
//
//  Two endpoints we expose to the frontend:
//
//   1. POST /api/lookup/digikey/order-status { order_id }
//      → fetches the Digi-Key sales order, joins each line item
//      against PartDistributor (where Distributor.name='Digi-Key'),
//      returns a preview list. **No DB writes.** Re-runnable.
//
//   2. POST /api/lookup/digikey/order-receive
//      { order_id, lines: [{part_id, quantity, price?, comment?}] }
//      → applies operator-confirmed stock-ins via
//      stock::apply_stock_change_in_tx in one transaction. Comment
//      defaults to "Digi-Key SO #{order_id} line {n}". Returns
//      counts + per-line stock_after.
//
//  Receiving the same order twice is *not* blocked — operator-permissive
//  per project policy. The SO# in each StockEntry.comment is the
//  audit trail.
// ===========================================================================

#[derive(Debug, Deserialize)]
struct DkOrderStatusResponse {
    /// v3 emitted "SalesorderId" (lowercase s); v4 uses "SalesOrderId".
    /// Accept either, default 0 if neither — we surface the parsed
    /// value but don't depend on it for matching.
    #[serde(default, alias = "SalesorderId", alias = "SalesOrderId")]
    sales_order_id: i64,
    #[serde(default, alias = "Currency", deserialize_with = "null_to_empty_string")]
    currency: String,
    #[serde(default, alias = "LineItems")]
    line_items: Vec<DkLineItem>,
}

#[derive(Debug, Deserialize)]
struct DkLineItem {
    #[serde(default, alias = "PoLineItemNumber", alias = "LineNumber",
            deserialize_with = "null_to_empty_string")]
    po_line_item_number: String,
    /// v3: "DigiKeyPartNumber"; v4: "DigiKeyProductNumber" (matches the
    /// ProductInformation V4 convention).
    #[serde(default, alias = "DigiKeyPartNumber", alias = "DigiKeyProductNumber",
            deserialize_with = "null_to_empty_string")]
    digi_key_part_number: String,
    /// v3: "ManufacturerPartNumber"; v4: "ManufacturerProductNumber".
    #[serde(default, alias = "ManufacturerPartNumber", alias = "ManufacturerProductNumber",
            deserialize_with = "null_to_empty_string")]
    manufacturer_part_number: String,
    #[serde(default, alias = "ProductDescription",
            deserialize_with = "null_to_empty_string")]
    product_description: String,
    #[serde(default, alias = "Manufacturer", deserialize_with = "null_to_empty_string")]
    manufacturer: String,
    #[serde(default, alias = "CustomerReference",
            deserialize_with = "null_to_empty_string")]
    customer_reference: String,
    #[serde(default, alias = "Quantity", alias = "QuantityOrdered",
            deserialize_with = "de_int_or_string")]
    quantity: Option<i32>,
    #[serde(default, alias = "QuantityShipped",
            deserialize_with = "de_int_or_string")]
    quantity_shipped: Option<i32>,
    #[serde(default, alias = "QuantityBackorder", alias = "QuantityBackOrder",
            deserialize_with = "de_int_or_string")]
    quantity_backorder: Option<i32>,
    #[serde(default, alias = "UnitPrice")]
    unit_price: f64,
}

/// Fetch a single Digi-Key sales order via the OrderStatus API.
/// Returns the parsed response; surfaces 404 as `AppError::NotFound`.
async fn fetch_order_status(
    cfg: &DigiKeyConfig,
    order_id: i64,
) -> Result<DkOrderStatusResponse, AppError> {
    let url = format!("{}{}/{}", cfg.base_url, cfg.order_status_path, order_id);
    let body = digikey_request(
        cfg, reqwest::Method::GET, &url, None, "order-status",
        cfg.customer_id.as_deref(),
    ).await?;
    serde_json::from_str(&body).map_err(|e| AppError::Internal(format!(
        "digikey order-status parse: {e}: {}",
        body.chars().take(400).collect::<String>()
    )))
}

// ----- Preview endpoint -----------------------------------------------------
//
// `OrderStatusRequest` / `OrderStatusResponse` / `OrderStatusLine`
// + `OrderReceive*` types live in `lookup.rs` so the Mouser handler
// (`mouser::order_status`) can map onto the same shape and the
// frontend stays source-agnostic.

use crate::handlers::lookup::{
    OrderStatusRequest, OrderStatusResponse, OrderStatusLine,
    OrderReceiveRequest, OrderReceiveResponse,
};

pub async fn order_status(
    State(pool): State<MySqlPool>,
    State(cfg): State<DigiKeyConfig>,
    Json(req): Json<OrderStatusRequest>,
) -> Result<Json<OrderStatusResponse>, AppError> {
    if !cfg.available() {
        return Err(AppError::BadRequest(
            "digikey not configured (set PARTKEEPR_DIGIKEY_CLIENT_ID and _CLIENT_SECRET)",
        ));
    }
    if req.order_id <= 0 {
        return Err(AppError::BadRequest("order_id must be > 0"));
    }

    let order = fetch_order_status(&cfg, req.order_id).await?;

    // Per-line PartDistributor match: look for a Digi-Key distributor
    // row whose orderNumber equals the line's DigiKeyPartNumber. We
    // use a single round-trip per line; orders are typically <30
    // lines, this is fine.
    let so_str = req.order_id.to_string();
    let mut lines: Vec<OrderStatusLine> = Vec::with_capacity(order.line_items.len());
    for li in &order.line_items {
        let dk_pn = li.digi_key_part_number.trim();
        let (part_id, part_name, current_stock, default_storage_location_id) = if dk_pn.is_empty() {
            (None, None, None, None)
        } else {
            let row: Option<(i32, String, i32, Option<i32>)> = sqlx::query_as(
                "SELECT p.id, p.name, p.stockLevel, p.storageLocation_id \
                 FROM PartDistributor pd \
                 JOIN Distributor d ON d.id = pd.distributor_id \
                 JOIN Part p        ON p.id = pd.part_id \
                 WHERE LOWER(d.name) = 'digi-key' \
                   AND pd.orderNumber = ? \
                 ORDER BY p.id LIMIT 1",
            )
            .bind(dk_pn)
            .fetch_optional(&pool)
            .await?;
            match row {
                Some((pid, name, stock, sloc)) => (Some(pid), Some(name), Some(stock), sloc),
                None => (None, None, None, None),
            }
        };

        // Slice 13d: how many of this part are already attributed to
        // this SO# (lets the receive dialog dedupe across shipments).
        // Restricted to positive deltas — corrections/removals shouldn't
        // count toward "received". Computed only when we have a part_id.
        let units_already_received: Option<i32> = if let Some(pid) = part_id {
            let v: Option<i64> = sqlx::query_scalar(
                "SELECT CAST(SUM(stockLevel) AS SIGNED) \
                 FROM StockEntry se \
                 JOIN Distributor d ON d.id = se.distributor_id \
                 WHERE se.part_id = ? \
                   AND LOWER(d.name) = 'digi-key' \
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

        lines.push(OrderStatusLine {
            line_number: li.po_line_item_number.clone(),
            digikey_pn: dk_pn.to_string(),
            mpn: li.manufacturer_part_number.clone(),
            manufacturer: li.manufacturer.clone(),
            description: li.product_description.clone(),
            customer_reference: li.customer_reference.clone(),
            quantity_ordered: li.quantity.unwrap_or(0),
            quantity_shipped: li.quantity_shipped.unwrap_or(0),
            quantity_backorder: li.quantity_backorder.unwrap_or(0),
            unit_price: li.unit_price,
            part_id,
            part_name,
            current_stock,
            default_storage_location_id,
            units_already_received,
        });
    }

    Ok(Json(OrderStatusResponse {
        sales_order_id: order.sales_order_id,
        currency: order.currency,
        lines,
    }))
}

// ----- Receive endpoint -----------------------------------------------------

pub async fn order_receive(
    State(pool): State<MySqlPool>,
    axum::Extension(user): axum::Extension<crate::handlers::auth::CurrentUser>,
    Json(req): Json<OrderReceiveRequest>,
) -> Result<Json<OrderReceiveResponse>, AppError> {
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

    let dk_id = crate::handlers::lookup::find_or_create_distributor(
        &mut tx, "Digi-Key", "https://www.digikey.com",
    ).await?;
    let results = crate::handlers::lookup::apply_order_receive_lines(
        &mut tx, dk_id, "Digi-Key", req.order_id, &req.lines, user.user_id,
    ).await?;
    tx.commit().await?;
    tracing::info!(
        order_id = req.order_id, applied = results.len(),
        "digikey order received",
    );

    Ok(Json(OrderReceiveResponse {
        applied: results.len(),
        results,
    }))
}

// ===========================================================================
//  Slice 13b — Digi-Key Barcode API
//
//  Four endpoints (all GET, base = /Barcoding/v3/...):
//    ProductBarcodes/{barcode}      — 1D code on a per-part label
//    Product2DBarcodes/{barcode}    — 2D code on a per-reel/CutTape label
//    PackListBarcodes/{barcode}     — 1D code on a packing slip
//    PackList2DBarcodes/{barcode}   — 2D code on a packing slip
//
//  We auto-detect kind by content:
//    - Contains 0x1D (GS) or 0x1E (RS) or starts with "[)>" → 2D
//    - Else → 1D
//    - 2D + payload contains "K" data identifier (after GS) → has SO# → PackList2D
//    - 2D otherwise → Product2D (per-reel label, has lot + date but no SO)
//
//  Control characters in the payload get URL-encoded automatically by
//  reqwest::Url::path_segments_mut().push(). Inateck Nano 160D and
//  similar HID scanners typically pass GS through if "function key
//  emulation" is enabled — otherwise the operator may need to scan
//  the scanner's config sheet to enable it.
//
//  Response shape varies by endpoint, but we union it: every field
//  is Optional, populated when the endpoint provides it.
// ===========================================================================

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct DkBarcodeResponse {
    #[serde(default, alias = "DigiKeyPartNumber")]
    digi_key_part_number: Option<String>,
    #[serde(default, alias = "ManufacturerPartNumber")]
    manufacturer_part_number: Option<String>,
    #[serde(default, alias = "ManufacturerName")]
    manufacturer_name: Option<String>,
    #[serde(default, alias = "Description")]
    description: Option<String>,
    #[serde(default, alias = "Quantity",
            deserialize_with = "de_int_or_string")]
    quantity: Option<i32>,
    /// PackList endpoints only.
    #[serde(default, alias = "SalesorderId", alias = "SalesOrderId",
            deserialize_with = "de_int_or_string")]
    sales_order_id: Option<i32>,
    #[serde(default, alias = "InvoiceId",
            deserialize_with = "de_int_or_string")]
    invoice_id: Option<i32>,
    #[serde(default, alias = "PurchaseOrder")]
    purchase_order: Option<String>,
    #[serde(default, alias = "CustomerReference")]
    customer_reference: Option<String>,
    #[serde(default, alias = "CountryOfOrigin")]
    country_of_origin: Option<String>,
    /// Product2D endpoint only — the per-reel label carries
    /// manufacturing batch info that's interesting for traceability.
    #[serde(default, alias = "LotCode")]
    lot_code: Option<String>,
    #[serde(default, alias = "DateCode")]
    date_code: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct BarcodeRequest {
    pub payload: String,
}

#[derive(Debug, Serialize)]
pub struct BarcodeResponse {
    /// Which endpoint we hit. "product_1d" | "product_2d" | "packlist_2d" | "packlist_1d"
    pub kind: String,
    pub digikey_pn: Option<String>,
    pub mpn: Option<String>,
    pub manufacturer: Option<String>,
    pub description: Option<String>,
    pub quantity: Option<i32>,
    pub sales_order_number: Option<String>,
    pub invoice_id: Option<i32>,
    pub purchase_order: Option<String>,
    pub customer_reference: Option<String>,
    pub country_of_origin: Option<String>,
    pub lot_code: Option<String>,
    pub date_code: Option<String>,
    /// Local-DB match result, joined on (Digi-Key, digikey_pn).
    pub part_id: Option<i32>,
    pub part_name: Option<String>,
    pub current_stock: Option<i32>,
}

#[derive(Debug, Clone, Copy)]
#[allow(dead_code)]  // PackList1D supported by the API even if detect_kind doesn't currently emit it
enum BarcodeKind { Product1D, Product2D, PackList1D, PackList2D }

impl BarcodeKind {
    fn endpoint(self) -> &'static str {
        match self {
            BarcodeKind::Product1D  => "ProductBarcodes",
            BarcodeKind::Product2D  => "Product2DBarcodes",
            BarcodeKind::PackList1D => "PackListBarcodes",
            BarcodeKind::PackList2D => "PackList2DBarcodes",
        }
    }
    fn tag(self) -> &'static str {
        match self {
            BarcodeKind::Product1D  => "product_1d",
            BarcodeKind::Product2D  => "product_2d",
            BarcodeKind::PackList1D => "packlist_1d",
            BarcodeKind::PackList2D => "packlist_2d",
        }
    }
}

fn detect_kind(payload: &str) -> BarcodeKind {
    let has_2d_markers = payload.starts_with("[)>")
        || payload.contains('\u{001D}')   // GS
        || payload.contains('\u{001E}');  // RS
    if !has_2d_markers {
        return BarcodeKind::Product1D;
    }
    // Heuristic: PackList2D codes carry K (customer reference) + 11K
    // (invoice) + 13K (sales order) data identifiers. Per-reel
    // Product2D codes carry P (part) + Q (qty) + 1T (lot) + 4L
    // (country) but no K-prefixed fields.
    let has_packlist_field = payload.contains("\u{001D}K")
        || payload.contains("\u{001D}11K")
        || payload.contains("\u{001D}13K")
        || payload.contains("\u{001D}1K");
    if has_packlist_field {
        BarcodeKind::PackList2D
    } else {
        BarcodeKind::Product2D
    }
}

async fn fetch_barcode(
    cfg: &DigiKeyConfig,
    payload: &str,
    kind: BarcodeKind,
) -> Result<DkBarcodeResponse, AppError> {
    // Digi-Key's gateway is strict about what it accepts in the path
    // — even chars the URL spec calls reserved-but-allowed (`[`, `]`,
    // `(`, `)`, `>`) come back as "Invalid path". Match the
    // unreserved-only encoding that working OSS clients
    // (alvarop/dkbc) use: percent-encode every byte that isn't an
    // RFC 3986 unreserved char.
    let url = format!(
        "{}/Barcoding/v3/{}/{}",
        cfg.base_url, kind.endpoint(),
        percent_encode_unreserved(payload),
    );
    // Barcode API: no customer-id header — that's an OrderStatus
    // concept and including it returns 401 here.
    let body = digikey_request(
        cfg, reqwest::Method::GET, &url, None, "barcode", None,
    ).await?;
    serde_json::from_str(&body).map_err(|e| AppError::Internal(format!(
        "digikey barcode parse: {e}: {}",
        body.chars().take(400).collect::<String>()
    )))
}

/// Percent-encode all bytes except RFC 3986 unreserved characters
/// (A-Z, a-z, 0-9, '-', '_', '.', '~'). Matches Python's
/// `urllib.parse.quote(s, safe='')`. Required for Digi-Key's
/// barcode API gateway, which rejects bracket / paren / angle
/// chars even if the URL spec considers them path-safe.
fn percent_encode_unreserved(s: &str) -> String {
    let mut out = String::with_capacity(s.len() * 3);
    for &b in s.as_bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9'
            | b'-' | b'_' | b'.' | b'~' => out.push(b as char),
            _ => {
                use std::fmt::Write;
                let _ = write!(out, "%{:02X}", b);
            }
        }
    }
    out
}

pub async fn process_barcode(
    State(pool): State<MySqlPool>,
    State(cfg): State<DigiKeyConfig>,
    Json(req): Json<BarcodeRequest>,
) -> Result<Json<BarcodeResponse>, AppError> {
    if !cfg.available() {
        return Err(AppError::BadRequest(
            "digikey not configured (set PARTKEEPR_DIGIKEY_CLIENT_ID and _CLIENT_SECRET)",
        ));
    }
    let payload = req.payload.trim();
    if payload.is_empty() {
        return Err(AppError::BadRequest("payload is required"));
    }

    let kind = detect_kind(payload);
    let parsed = fetch_barcode(&cfg, payload, kind).await?;

    // Local match: PartDistributor where (Digi-Key, orderNumber=DK SKU).
    let dk_pn = parsed.digi_key_part_number.clone().unwrap_or_default();
    let (part_id, part_name, current_stock) = if dk_pn.trim().is_empty() {
        (None, None, None)
    } else {
        let row: Option<(i32, String, i32)> = sqlx::query_as(
            "SELECT p.id, p.name, p.stockLevel \
             FROM PartDistributor pd \
             JOIN Distributor d ON d.id = pd.distributor_id \
             JOIN Part p        ON p.id = pd.part_id \
             WHERE LOWER(d.name) = 'digi-key' \
               AND pd.orderNumber = ? \
             ORDER BY p.id LIMIT 1",
        )
        .bind(dk_pn.trim())
        .fetch_optional(&pool)
        .await?;
        match row {
            Some((pid, name, stock)) => (Some(pid), Some(name), Some(stock)),
            None => (None, None, None),
        }
    };

    Ok(Json(BarcodeResponse {
        kind: kind.tag().to_string(),
        digikey_pn: parsed.digi_key_part_number,
        mpn: parsed.manufacturer_part_number,
        manufacturer: parsed.manufacturer_name,
        description: parsed.description,
        quantity: parsed.quantity,
        sales_order_number: parsed.sales_order_id.map(|n| n.to_string()),
        invoice_id: parsed.invoice_id,
        purchase_order: parsed.purchase_order,
        customer_reference: parsed.customer_reference,
        country_of_origin: parsed.country_of_origin,
        lot_code: parsed.lot_code,
        date_code: parsed.date_code,
        part_id, part_name, current_stock,
    }))
}
