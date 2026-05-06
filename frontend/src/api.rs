//! Thin client over the slice 4a backend endpoints.

use gloo_net::http::Request;
use serde::Serialize;

use crate::types::{CategoryNode, PartDetail, PartListResponse};

const API_BASE: &str = "http://localhost:8080";

#[derive(Debug, Clone)]
pub struct ApiError(pub String);

impl<E: std::fmt::Display> From<E> for ApiError {
    fn from(e: E) -> Self {
        ApiError(e.to_string())
    }
}

pub async fn fetch_category_tree() -> Result<Vec<CategoryNode>, ApiError> {
    Ok(Request::get(&format!("{API_BASE}/api/part_categories/tree"))
        .send()
        .await?
        .json()
        .await?)
}

pub async fn fetch_parts(
    category: Option<i32>,
    search: String,
    limit: u32,
    offset: u32,
    sort: Option<String>,
    dir: Option<String>,
) -> Result<PartListResponse, ApiError> {
    let mut url = format!("{API_BASE}/api/parts?limit={limit}&offset={offset}");
    if let Some(c) = category {
        url.push_str(&format!("&category={c}"));
    }
    if !search.is_empty() {
        // gloo doesn't auto-encode query strings; do it ourselves.
        url.push_str(&format!("&search={}", urlencode(&search)));
    }
    if let Some(s) = sort {
        url.push_str(&format!("&sort={}", urlencode(&s)));
    }
    if let Some(d) = dir {
        url.push_str(&format!("&dir={d}"));
    }
    Ok(Request::get(&url).send().await?.json().await?)
}

pub async fn fetch_part_detail(id: i32) -> Result<PartDetail, ApiError> {
    Ok(Request::get(&format!("{API_BASE}/api/parts/{id}"))
        .send()
        .await?
        .json()
        .await?)
}

#[derive(Debug, Serialize)]
pub struct StockChange {
    pub stock_level: i32,           // delta — positive = add, negative = remove
    pub price: Option<String>,      // serialized Decimal (server parses)
    pub comment: Option<String>,
    pub correction: bool,
}

pub async fn post_stock_entry(part_id: i32, body: StockChange) -> Result<(), ApiError> {
    let resp = Request::post(&format!("{API_BASE}/api/parts/{part_id}/stock-entries"))
        .header("content-type", "application/json")
        .body(serde_json::to_string(&body).map_err(ApiError::from)?)
        .map_err(ApiError::from)?
        .send()
        .await?;
    if !resp.ok() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(ApiError(format!("HTTP {status}: {body}")));
    }
    Ok(())
}

/// PartWrite mirrors the backend's PartWrite DTO. Sub-arrays use
/// `Option<Vec<...>>` so the frontend can omit them on save (backend
/// preserves existing children when omitted) or send an empty Vec
/// (backend deletes all children).
#[derive(Debug, Serialize, Default)]
pub struct PartWrite {
    pub name: String,
    pub description: Option<String>,
    pub comment: String,
    pub category_id: Option<i32>,
    pub footprint_id: Option<i32>,
    pub storage_location_id: Option<i32>,
    pub part_unit_id: Option<i32>,
    pub internal_part_number: Option<String>,
    pub status: Option<String>,
    pub part_condition: Option<String>,
    pub production_remarks: Option<String>,
    pub needs_review: bool,
    pub min_stock_level: i32,
    pub meta_part: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub manufacturers: Option<Vec<PartManufacturerWrite>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub distributors: Option<Vec<PartDistributorWrite>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parameters: Option<Vec<PartParameterWrite>>,
}

#[derive(Debug, Serialize)]
pub struct PartManufacturerWrite {
    pub manufacturer_id: i32,
    pub part_number: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct PartDistributorWrite {
    pub distributor_id: i32,
    pub order_number: Option<String>,
    pub price: Option<String>,
    pub currency: Option<String>,
    pub sku: Option<String>,
    pub packaging_unit: i32,
    pub ignore_for_reports: bool,
}

#[derive(Debug, Serialize)]
pub struct PartParameterWrite {
    pub name: String,
    pub description: String,
    pub value_type: String,
    pub value: Option<f64>,
    pub string_value: String,
    pub minimum_value: Option<f64>,
    pub maximum_value: Option<f64>,
    pub unit_id: Option<i32>,
    pub si_prefix_id: Option<i32>,
    pub min_si_prefix_id: Option<i32>,
    pub max_si_prefix_id: Option<i32>,
}

pub async fn post_part(body: PartWrite) -> Result<i32, ApiError> {
    let resp = Request::post(&format!("{API_BASE}/api/parts"))
        .header("content-type", "application/json")
        .body(serde_json::to_string(&body).map_err(ApiError::from)?)
        .map_err(ApiError::from)?
        .send()
        .await?;
    if !resp.ok() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(ApiError(format!("HTTP {status}: {body}")));
    }
    let data: serde_json::Value = resp.json().await?;
    let id = data.get("id").and_then(|v| v.as_i64())
        .ok_or_else(|| ApiError("server response missing id".into()))?;
    Ok(id as i32)
}

pub async fn put_part(part_id: i32, body: PartWrite) -> Result<(), ApiError> {
    let resp = Request::put(&format!("{API_BASE}/api/parts/{part_id}"))
        .header("content-type", "application/json")
        .body(serde_json::to_string(&body).map_err(ApiError::from)?)
        .map_err(ApiError::from)?
        .send()
        .await?;
    if !resp.ok() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(ApiError(format!("HTTP {status}: {body}")));
    }
    Ok(())
}

pub async fn delete_part(part_id: i32) -> Result<(), ApiError> {
    let resp = Request::delete(&format!("{API_BASE}/api/parts/{part_id}"))
        .send()
        .await?;
    if !resp.ok() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(ApiError(format!("HTTP {status}: {body}")));
    }
    Ok(())
}

/// Lightweight dropdown options. Each lookup uses an existing list
/// endpoint and pulls just id+name.
#[derive(Debug, Clone, PartialEq, serde::Deserialize)]
pub struct LookupOption {
    pub id: i32,
    pub name: String,
}

async fn fetch_lookup(path: &str) -> Result<Vec<LookupOption>, ApiError> {
    Ok(Request::get(&format!("{API_BASE}{path}"))
        .send()
        .await?
        .json()
        .await?)
}

pub async fn fetch_storage_locations() -> Result<Vec<LookupOption>, ApiError> {
    fetch_lookup("/api/storage_locations").await
}
pub async fn fetch_footprints() -> Result<Vec<LookupOption>, ApiError> {
    fetch_lookup("/api/footprints").await
}
pub async fn fetch_part_units() -> Result<Vec<LookupOption>, ApiError> {
    fetch_lookup("/api/part_measurement_units").await
}
pub async fn fetch_categories_flat() -> Result<Vec<LookupOption>, ApiError> {
    // codegen list returns the full PartCategory; deserialize to LookupOption
    // works because LookupOption ignores extra JSON fields by default.
    fetch_lookup("/api/part_categories").await
}
pub async fn fetch_manufacturers() -> Result<Vec<LookupOption>, ApiError> {
    fetch_lookup("/api/manufacturers").await
}
pub async fn fetch_distributors() -> Result<Vec<LookupOption>, ApiError> {
    fetch_lookup("/api/distributors").await
}

/// Unit needs a symbol (Ω, F, V, ...) for the parameter editor's
/// "value + unit" display. The codegen `/api/units` endpoint returns
/// the full Unit row; we extract id, name, symbol.
#[derive(Debug, Clone, PartialEq, serde::Deserialize)]
pub struct UnitOption {
    pub id: i32,
    pub name: String,
    pub symbol: String,
}
pub async fn fetch_units_full() -> Result<Vec<UnitOption>, ApiError> {
    Ok(Request::get(&format!("{API_BASE}/api/units"))
        .send().await?.json().await?)
}

/// SiPrefix needs prefix (kilo), symbol (k), exponent and base for
/// display "k (×10³)" in the dropdown. exponent + base aren't strictly
/// needed client-side (backend computes normalizedValue at write time)
/// but they're nice to show in the picker.
#[derive(Debug, Clone, PartialEq, serde::Deserialize)]
pub struct SiPrefixOption {
    pub id: i32,
    pub prefix: String,
    pub symbol: String,
    pub exponent: i32,
    pub base: i32,
}
pub async fn fetch_si_prefixes() -> Result<Vec<SiPrefixOption>, ApiError> {
    Ok(Request::get(&format!("{API_BASE}/api/si_prefixes"))
        .send().await?.json().await?)
}

/// Minimal percent-encoder for query strings. Avoids pulling a dependency.
fn urlencode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char);
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}
