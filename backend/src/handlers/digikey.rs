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

#[derive(Clone)]
pub struct DigiKeyConfig {
    pub client_id:     Option<String>,
    pub client_secret: Option<String>,
    pub base_url:      String,
    pub token_cache:   Arc<Mutex<TokenCache>>,
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
        if client_id.is_some() && client_secret.is_some() {
            tracing::info!(base_url = %base_url, "digikey api enabled");
        } else {
            tracing::info!(
                "digikey api disabled (set PARTKEEPR_DIGIKEY_CLIENT_ID and \
                 PARTKEEPR_DIGIKEY_CLIENT_SECRET to enable)"
            );
        }
        Self {
            client_id, client_secret, base_url,
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
    let client_id = cfg.client_id.as_ref().unwrap(); // available()-checked
    let url = format!("{}/products/v4/search/keyword", cfg.base_url);

    for attempt in 0..2u32 {
        let token = get_token(cfg).await?;
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(HTTP_TIMEOUT_SECS))
            .build()
            .map_err(|e| AppError::Internal(format!("reqwest build: {e}")))?;
        let resp = client.post(&url)
            .header("Authorization", format!("Bearer {token}"))
            .header("X-DIGIKEY-Client-Id", client_id)
            .header("X-DIGIKEY-Locale-Site", "US")
            .header("X-DIGIKEY-Locale-Language", "en")
            .header("X-DIGIKEY-Locale-Currency", "USD")
            .header("Accept", "application/json")
            .json(body)
            .send().await
            .map_err(|e| AppError::Internal(format!("digikey search: {e}")))?;
        let status = resp.status();
        let text = resp.text().await
            .map_err(|e| AppError::Internal(format!("digikey body: {e}")))?;

        if status.as_u16() == 401 && attempt == 0 {
            // Force token refresh on next iteration.
            let mut cache = cfg.token_cache.lock().await;
            cache.token = None;
            cache.expires_at = None;
            tracing::info!("digikey 401 — invalidating token + retrying");
            continue;
        }
        if !status.is_success() {
            return Err(AppError::Internal(format!(
                "digikey search HTTP {status}: {}",
                text.chars().take(400).collect::<String>()
            )));
        }
        return Ok(text);
    }
    Err(AppError::Internal("digikey search retries exhausted".into()))
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
