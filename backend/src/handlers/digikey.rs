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

fn de_int_or_string<'de, D>(de: D) -> Result<Option<i32>, D::Error>
where D: serde::Deserializer<'de> {
    use serde::de::Error;
    match Option::<serde_json::Value>::deserialize(de)? {
        None | Some(serde_json::Value::Null) => Ok(None),
        Some(serde_json::Value::Number(n)) => Ok(n.as_i64().map(|v| v as i32)),
        Some(serde_json::Value::String(s)) => Ok(s.trim().parse().ok()),
        Some(other) => Err(D::Error::custom(format!(
            "expected int or string, got {other:?}"
        ))),
    }
}

fn de_int_or_string_required<'de, D>(de: D) -> Result<i32, D::Error>
where D: serde::Deserializer<'de> {
    Ok(de_int_or_string(de)?.unwrap_or(0))
}

/// Coerce `null` → `""`. Digi-Key v4 OrderStatus fields like
/// CustomerReference / PurchaseOrder are routinely null on orders
/// without a PO; without this they fail deserialization as `String`.
fn null_to_empty_string<'de, D>(de: D) -> Result<String, D::Error>
where D: serde::Deserializer<'de> {
    Ok(Option::<String>::deserialize(de)?.unwrap_or_default())
}

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

#[derive(Debug, Deserialize)]
pub struct OrderStatusRequest {
    pub order_id: i64,
}

#[derive(Debug, Serialize)]
pub struct OrderStatusResponse {
    pub sales_order_id: i64,
    pub currency: String,
    pub lines: Vec<OrderStatusLine>,
}

#[derive(Debug, Serialize)]
pub struct OrderStatusLine {
    pub line_number: String,
    pub digikey_pn: String,
    pub mpn: String,
    pub manufacturer: String,
    pub description: String,
    pub customer_reference: String,
    pub quantity_ordered: i32,
    pub quantity_shipped: i32,
    pub quantity_backorder: i32,
    pub unit_price: f64,
    /// Local-DB match. None if no PartDistributor row matches the
    /// (Digi-Key, digikey_pn) pair. Operator can still receive the
    /// line by manually picking a part — but most flows go: missing
    /// match → operator opens lookup-import dialog → re-fetches.
    pub part_id: Option<i32>,
    pub part_name: Option<String>,
    pub current_stock: Option<i32>,
}

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
    let mut lines: Vec<OrderStatusLine> = Vec::with_capacity(order.line_items.len());
    for li in &order.line_items {
        let dk_pn = li.digi_key_part_number.trim();
        let (part_id, part_name, current_stock) = if dk_pn.is_empty() {
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
            .bind(dk_pn)
            .fetch_optional(&pool)
            .await?;
            match row {
                Some((pid, name, stock)) => (Some(pid), Some(name), Some(stock)),
                None => (None, None, None),
            }
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
        });
    }

    Ok(Json(OrderStatusResponse {
        sales_order_id: order.sales_order_id,
        currency: order.currency,
        lines,
    }))
}

// ----- Receive endpoint -----------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct OrderReceiveRequest {
    pub order_id: i64,
    pub lines: Vec<OrderReceiveLine>,
}

#[derive(Debug, Deserialize)]
pub struct OrderReceiveLine {
    pub part_id: i32,
    pub quantity: i32,
    /// Per-piece price. None → no cost basis recorded for this entry.
    pub price: Option<rust_decimal::Decimal>,
    /// Override the default comment ("Digi-Key SO #{n} line {k}").
    pub comment: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct OrderReceiveResponse {
    pub applied: usize,
    pub results: Vec<OrderReceiveResult>,
}

#[derive(Debug, Serialize)]
pub struct OrderReceiveResult {
    pub part_id: i32,
    pub quantity: i32,
    pub stock_after: i32,
    pub low_stock: bool,
}

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
    let mut results: Vec<OrderReceiveResult> = Vec::with_capacity(req.lines.len());
    for (idx, line) in req.lines.iter().enumerate() {
        let default_comment = format!("Digi-Key SO #{} line {}", req.order_id, idx + 1);
        let comment = line.comment.as_deref().filter(|s| !s.trim().is_empty())
            .unwrap_or(&default_comment);
        let (stock_after, low_stock) = crate::handlers::stock::apply_stock_change_in_tx(
            &mut tx,
            line.part_id,
            line.quantity,
            line.price,
            Some(comment),
            false, // not a correction — real receipt
            user.user_id,
        ).await?;
        results.push(OrderReceiveResult {
            part_id: line.part_id,
            quantity: line.quantity,
            stock_after,
            low_stock,
        });
    }
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
