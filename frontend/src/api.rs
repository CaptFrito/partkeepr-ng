//! Thin client over the slice 4a backend endpoints.

use gloo_net::http::Request;
use serde::Serialize;

use crate::types::{
    AllRunsResponse, CategoryNode, DistributorRow, FootprintTreeNode, ManufacturerRow,
    ParameterNameRow, ParameterValuesResponse, PartDetail, PartListResponse, PartProjectRef,
    PartRunRef, PartUnitRow, ProjectDetail, ProjectListRow, RunHistoryEntry, RunPreviewLine,
    SiPrefixRow, StorageTreeNode, UnitRow,
};

/// Backend root URL. Public so other modules (e.g.
/// components::attachments_section) can build their own request URLs
/// when they need to.
pub const API_BASE_PUB: &str = "http://localhost:8080";
const API_BASE: &str = API_BASE_PUB;

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
    storage_folder: Option<i32>,
    storage_location: Option<i32>,
    footprint_folder: Option<i32>,
    footprint: Option<i32>,
    search: String,
    limit: u32,
    offset: u32,
    sort: Option<String>,
    dir: Option<String>,
    meta_only: Option<bool>,
) -> Result<PartListResponse, ApiError> {
    let mut url = format!("{API_BASE}/api/parts?limit={limit}&offset={offset}");
    if let Some(c) = category {
        url.push_str(&format!("&category={c}"));
    }
    if let Some(f) = storage_folder {
        url.push_str(&format!("&storage_folder={f}"));
    }
    if let Some(l) = storage_location {
        url.push_str(&format!("&storage_location={l}"));
    }
    if let Some(f) = footprint_folder {
        url.push_str(&format!("&footprint_folder={f}"));
    }
    if let Some(f) = footprint {
        url.push_str(&format!("&footprint={f}"));
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
    if let Some(m) = meta_only {
        url.push_str(&format!("&meta_only={m}"));
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
    /// Slice 11c: meta-part criteria. Same Option-vec semantics as the
    /// other sub-arrays (None = leave alone, Some = replace).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub criteria: Option<Vec<MetaPartCriterionWrite>>,
}

#[derive(Debug, Serialize)]
pub struct MetaPartCriterionWrite {
    pub name: String,
    pub op: String,
    pub value_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub string_value: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub si_prefix_id: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unit_id: Option<i32>,
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

// --- Slice 5c-1: PartCategory CRUD ---

#[derive(Debug, Serialize)]
pub struct CategoryCreate {
    pub parent_id: i32,
    pub name: String,
    pub description: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct CategoryUpdate {
    pub name: String,
    pub description: Option<String>,
}

#[derive(Debug, Clone, PartialEq, serde::Deserialize)]
pub struct CategoryFlatOption {
    pub id: i32,
    pub parent_id: Option<i32>,
    pub name: String,
    pub lvl: i32,
    pub lft: i32,
    pub rgt: i32,
}

/// Body returned with HTTP 409 when delete is blocked. Used to render a
/// "show affected parts" link.
#[derive(Debug, Clone, serde::Deserialize)]
pub struct DeleteConflict {
    #[allow(dead_code)]
    pub error: String,
    pub child_count: i64,
    pub part_count: i64,
}

/// Distinct error types so the UI can branch on conflict-with-counts.
#[derive(Debug, Clone)]
pub enum CategoryDeleteError {
    Conflict(DeleteConflict),
    Other(String),
}

pub async fn fetch_categories_flat_full() -> Result<Vec<CategoryFlatOption>, ApiError> {
    Ok(Request::get(&format!("{API_BASE}/api/part_categories"))
        .send()
        .await?
        .json()
        .await?)
}

pub async fn post_category(body: CategoryCreate) -> Result<i32, ApiError> {
    let resp = Request::post(&format!("{API_BASE}/api/part_categories"))
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

pub async fn put_category(id: i32, body: CategoryUpdate) -> Result<(), ApiError> {
    let resp = Request::put(&format!("{API_BASE}/api/part_categories/{id}"))
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

pub async fn delete_category(id: i32) -> Result<(), CategoryDeleteError> {
    let resp = Request::delete(&format!("{API_BASE}/api/part_categories/{id}"))
        .send()
        .await
        .map_err(|e| CategoryDeleteError::Other(e.to_string()))?;
    if resp.ok() {
        return Ok(());
    }
    let status = resp.status();
    if status == 409 {
        match resp.json::<DeleteConflict>().await {
            Ok(c) => return Err(CategoryDeleteError::Conflict(c)),
            Err(e) => {
                return Err(CategoryDeleteError::Other(format!(
                    "HTTP 409 (could not parse body): {e}"
                )))
            }
        }
    }
    let body = resp.text().await.unwrap_or_default();
    Err(CategoryDeleteError::Other(format!("HTTP {status}: {body}")))
}

pub async fn move_category(id: i32, new_parent_id: i32) -> Result<(), ApiError> {
    let body = serde_json::json!({"new_parent_id": new_parent_id});
    let resp = Request::patch(&format!("{API_BASE}/api/part_categories/{id}/move"))
        .header("content-type", "application/json")
        .body(body.to_string())
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

// --- Slice 5c-2: StorageLocationCategory + StorageLocation CRUD ---

pub async fn fetch_storage_tree() -> Result<Vec<StorageTreeNode>, ApiError> {
    Ok(Request::get(&format!("{API_BASE}/api/storage_tree"))
        .send().await?.json().await?)
}

pub async fn fetch_storage_cats_flat_full() -> Result<Vec<CategoryFlatOption>, ApiError> {
    Ok(Request::get(&format!("{API_BASE}/api/storage_location_categories"))
        .send().await?.json().await?)
}

#[derive(Debug, Serialize)]
pub struct StorageCatCreate {
    pub parent_id: i32,
    pub name: String,
    pub description: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct StorageCatUpdate {
    pub name: String,
    pub description: Option<String>,
}

/// Conflict body for StorageLocationCategory delete — distinct from
/// PartCategory's because non-empty here means children OR
/// storage-locations within (not Parts directly).
#[derive(Debug, Clone, serde::Deserialize)]
pub struct StorageCatDeleteConflict {
    #[allow(dead_code)]
    pub error: String,
    pub child_count: i64,
    pub location_count: i64,
}

#[derive(Debug, Clone)]
pub enum StorageCatDeleteError {
    Conflict(StorageCatDeleteConflict),
    Other(String),
}

pub async fn post_storage_cat(body: StorageCatCreate) -> Result<i32, ApiError> {
    let resp = Request::post(&format!("{API_BASE}/api/storage_location_categories"))
        .header("content-type", "application/json")
        .body(serde_json::to_string(&body).map_err(ApiError::from)?)
        .map_err(ApiError::from)?
        .send().await?;
    if !resp.ok() {
        let s = resp.status();
        let b = resp.text().await.unwrap_or_default();
        return Err(ApiError(format!("HTTP {s}: {b}")));
    }
    let data: serde_json::Value = resp.json().await?;
    let id = data.get("id").and_then(|v| v.as_i64())
        .ok_or_else(|| ApiError("server response missing id".into()))?;
    Ok(id as i32)
}

pub async fn put_storage_cat(id: i32, body: StorageCatUpdate) -> Result<(), ApiError> {
    let resp = Request::put(&format!("{API_BASE}/api/storage_location_categories/{id}"))
        .header("content-type", "application/json")
        .body(serde_json::to_string(&body).map_err(ApiError::from)?)
        .map_err(ApiError::from)?
        .send().await?;
    if !resp.ok() {
        let s = resp.status();
        let b = resp.text().await.unwrap_or_default();
        return Err(ApiError(format!("HTTP {s}: {b}")));
    }
    Ok(())
}

pub async fn delete_storage_cat(id: i32) -> Result<(), StorageCatDeleteError> {
    let resp = Request::delete(&format!("{API_BASE}/api/storage_location_categories/{id}"))
        .send().await
        .map_err(|e| StorageCatDeleteError::Other(e.to_string()))?;
    if resp.ok() { return Ok(()); }
    let status = resp.status();
    if status == 409 {
        match resp.json::<StorageCatDeleteConflict>().await {
            Ok(c) => return Err(StorageCatDeleteError::Conflict(c)),
            Err(e) => return Err(StorageCatDeleteError::Other(format!(
                "HTTP 409 (could not parse body): {e}"))),
        }
    }
    let body = resp.text().await.unwrap_or_default();
    Err(StorageCatDeleteError::Other(format!("HTTP {status}: {body}")))
}

pub async fn move_storage_cat(id: i32, new_parent_id: i32) -> Result<(), ApiError> {
    let body = serde_json::json!({"new_parent_id": new_parent_id});
    let resp = Request::patch(&format!("{API_BASE}/api/storage_location_categories/{id}/move"))
        .header("content-type", "application/json")
        .body(body.to_string())
        .map_err(ApiError::from)?
        .send().await?;
    if !resp.ok() {
        let s = resp.status();
        let b = resp.text().await.unwrap_or_default();
        return Err(ApiError(format!("HTTP {s}: {b}")));
    }
    Ok(())
}

// --- Storage locations (the leaves) ---

#[derive(Debug, Serialize)]
pub struct StorageLocCreate {
    pub category_id: i32,
    pub name: String,
}

#[derive(Debug, Serialize)]
pub struct StorageLocUpdate {
    pub name: String,
}

#[derive(Debug, Clone, serde::Deserialize)]
pub struct StorageLocDeleteConflict {
    #[allow(dead_code)]
    pub error: String,
    pub part_count: i64,
}

#[derive(Debug, Clone)]
pub enum StorageLocDeleteError {
    Conflict(StorageLocDeleteConflict),
    Other(String),
}

pub async fn post_storage_loc(body: StorageLocCreate) -> Result<i32, ApiError> {
    let resp = Request::post(&format!("{API_BASE}/api/storage_locations"))
        .header("content-type", "application/json")
        .body(serde_json::to_string(&body).map_err(ApiError::from)?)
        .map_err(ApiError::from)?
        .send().await?;
    if !resp.ok() {
        let s = resp.status();
        let b = resp.text().await.unwrap_or_default();
        return Err(ApiError(format!("HTTP {s}: {b}")));
    }
    let data: serde_json::Value = resp.json().await?;
    let id = data.get("id").and_then(|v| v.as_i64())
        .ok_or_else(|| ApiError("server response missing id".into()))?;
    Ok(id as i32)
}

pub async fn put_storage_loc(id: i32, body: StorageLocUpdate) -> Result<(), ApiError> {
    let resp = Request::put(&format!("{API_BASE}/api/storage_locations/{id}"))
        .header("content-type", "application/json")
        .body(serde_json::to_string(&body).map_err(ApiError::from)?)
        .map_err(ApiError::from)?
        .send().await?;
    if !resp.ok() {
        let s = resp.status();
        let b = resp.text().await.unwrap_or_default();
        return Err(ApiError(format!("HTTP {s}: {b}")));
    }
    Ok(())
}

pub async fn delete_storage_loc(id: i32) -> Result<(), StorageLocDeleteError> {
    let resp = Request::delete(&format!("{API_BASE}/api/storage_locations/{id}"))
        .send().await
        .map_err(|e| StorageLocDeleteError::Other(e.to_string()))?;
    if resp.ok() { return Ok(()); }
    let status = resp.status();
    if status == 409 {
        match resp.json::<StorageLocDeleteConflict>().await {
            Ok(c) => return Err(StorageLocDeleteError::Conflict(c)),
            Err(e) => return Err(StorageLocDeleteError::Other(format!(
                "HTTP 409 (could not parse body): {e}"))),
        }
    }
    let body = resp.text().await.unwrap_or_default();
    Err(StorageLocDeleteError::Other(format!("HTTP {status}: {body}")))
}

pub async fn move_storage_loc(id: i32, new_category_id: i32) -> Result<(), ApiError> {
    let body = serde_json::json!({"new_category_id": new_category_id});
    let resp = Request::patch(&format!("{API_BASE}/api/storage_locations/{id}/move"))
        .header("content-type", "application/json")
        .body(body.to_string())
        .map_err(ApiError::from)?
        .send().await?;
    if !resp.ok() {
        let s = resp.status();
        let b = resp.text().await.unwrap_or_default();
        return Err(ApiError(format!("HTTP {s}: {b}")));
    }
    Ok(())
}

// --- Slice 5c-3: FootprintCategory + Footprint CRUD ---

pub async fn fetch_footprint_tree() -> Result<Vec<FootprintTreeNode>, ApiError> {
    Ok(Request::get(&format!("{API_BASE}/api/footprint_tree"))
        .send().await?.json().await?)
}

pub async fn fetch_footprint_cats_flat_full() -> Result<Vec<CategoryFlatOption>, ApiError> {
    Ok(Request::get(&format!("{API_BASE}/api/footprint_categories"))
        .send().await?.json().await?)
}

#[derive(Debug, Serialize)]
pub struct FootprintCatCreate {
    pub parent_id: i32,
    pub name: String,
    pub description: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct FootprintCatUpdate {
    pub name: String,
    pub description: Option<String>,
}

#[derive(Debug, Clone, serde::Deserialize)]
pub struct FootprintCatDeleteConflict {
    #[allow(dead_code)]
    pub error: String,
    pub child_count: i64,
    pub footprint_count: i64,
}

#[derive(Debug, Clone)]
pub enum FootprintCatDeleteError {
    Conflict(FootprintCatDeleteConflict),
    Other(String),
}

pub async fn post_footprint_cat(body: FootprintCatCreate) -> Result<i32, ApiError> {
    let resp = Request::post(&format!("{API_BASE}/api/footprint_categories"))
        .header("content-type", "application/json")
        .body(serde_json::to_string(&body).map_err(ApiError::from)?)
        .map_err(ApiError::from)?
        .send().await?;
    if !resp.ok() {
        let s = resp.status();
        let b = resp.text().await.unwrap_or_default();
        return Err(ApiError(format!("HTTP {s}: {b}")));
    }
    let data: serde_json::Value = resp.json().await?;
    let id = data.get("id").and_then(|v| v.as_i64())
        .ok_or_else(|| ApiError("server response missing id".into()))?;
    Ok(id as i32)
}

pub async fn put_footprint_cat(id: i32, body: FootprintCatUpdate) -> Result<(), ApiError> {
    let resp = Request::put(&format!("{API_BASE}/api/footprint_categories/{id}"))
        .header("content-type", "application/json")
        .body(serde_json::to_string(&body).map_err(ApiError::from)?)
        .map_err(ApiError::from)?
        .send().await?;
    if !resp.ok() {
        let s = resp.status();
        let b = resp.text().await.unwrap_or_default();
        return Err(ApiError(format!("HTTP {s}: {b}")));
    }
    Ok(())
}

pub async fn delete_footprint_cat(id: i32) -> Result<(), FootprintCatDeleteError> {
    let resp = Request::delete(&format!("{API_BASE}/api/footprint_categories/{id}"))
        .send().await
        .map_err(|e| FootprintCatDeleteError::Other(e.to_string()))?;
    if resp.ok() { return Ok(()); }
    let status = resp.status();
    if status == 409 {
        match resp.json::<FootprintCatDeleteConflict>().await {
            Ok(c) => return Err(FootprintCatDeleteError::Conflict(c)),
            Err(e) => return Err(FootprintCatDeleteError::Other(format!(
                "HTTP 409 (could not parse body): {e}"))),
        }
    }
    let body = resp.text().await.unwrap_or_default();
    Err(FootprintCatDeleteError::Other(format!("HTTP {status}: {body}")))
}

pub async fn move_footprint_cat(id: i32, new_parent_id: i32) -> Result<(), ApiError> {
    let body = serde_json::json!({"new_parent_id": new_parent_id});
    let resp = Request::patch(&format!("{API_BASE}/api/footprint_categories/{id}/move"))
        .header("content-type", "application/json")
        .body(body.to_string())
        .map_err(ApiError::from)?
        .send().await?;
    if !resp.ok() {
        let s = resp.status();
        let b = resp.text().await.unwrap_or_default();
        return Err(ApiError(format!("HTTP {s}: {b}")));
    }
    Ok(())
}

// --- Footprints (the leaves) ---

#[derive(Debug, Serialize)]
pub struct FootprintCreate {
    pub category_id: i32,
    pub name: String,
    pub description: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct FootprintUpdate {
    pub name: String,
    pub description: Option<String>,
}

#[derive(Debug, Clone, serde::Deserialize)]
pub struct FootprintDeleteConflict {
    #[allow(dead_code)]
    pub error: String,
    pub part_count: i64,
}

#[derive(Debug, Clone)]
pub enum FootprintDeleteError {
    Conflict(FootprintDeleteConflict),
    Other(String),
}

pub async fn post_footprint(body: FootprintCreate) -> Result<i32, ApiError> {
    let resp = Request::post(&format!("{API_BASE}/api/footprints"))
        .header("content-type", "application/json")
        .body(serde_json::to_string(&body).map_err(ApiError::from)?)
        .map_err(ApiError::from)?
        .send().await?;
    if !resp.ok() {
        let s = resp.status();
        let b = resp.text().await.unwrap_or_default();
        return Err(ApiError(format!("HTTP {s}: {b}")));
    }
    let data: serde_json::Value = resp.json().await?;
    let id = data.get("id").and_then(|v| v.as_i64())
        .ok_or_else(|| ApiError("server response missing id".into()))?;
    Ok(id as i32)
}

pub async fn put_footprint(id: i32, body: FootprintUpdate) -> Result<(), ApiError> {
    let resp = Request::put(&format!("{API_BASE}/api/footprints/{id}"))
        .header("content-type", "application/json")
        .body(serde_json::to_string(&body).map_err(ApiError::from)?)
        .map_err(ApiError::from)?
        .send().await?;
    if !resp.ok() {
        let s = resp.status();
        let b = resp.text().await.unwrap_or_default();
        return Err(ApiError(format!("HTTP {s}: {b}")));
    }
    Ok(())
}

pub async fn delete_footprint(id: i32) -> Result<(), FootprintDeleteError> {
    let resp = Request::delete(&format!("{API_BASE}/api/footprints/{id}"))
        .send().await
        .map_err(|e| FootprintDeleteError::Other(e.to_string()))?;
    if resp.ok() { return Ok(()); }
    let status = resp.status();
    if status == 409 {
        match resp.json::<FootprintDeleteConflict>().await {
            Ok(c) => return Err(FootprintDeleteError::Conflict(c)),
            Err(e) => return Err(FootprintDeleteError::Other(format!(
                "HTTP 409 (could not parse body): {e}"))),
        }
    }
    let body = resp.text().await.unwrap_or_default();
    Err(FootprintDeleteError::Other(format!("HTTP {status}: {body}")))
}

pub async fn move_footprint(id: i32, new_category_id: i32) -> Result<(), ApiError> {
    let body = serde_json::json!({"new_category_id": new_category_id});
    let resp = Request::patch(&format!("{API_BASE}/api/footprints/{id}/move"))
        .header("content-type", "application/json")
        .body(body.to_string())
        .map_err(ApiError::from)?
        .send().await?;
    if !resp.ok() {
        let s = resp.status();
        let b = resp.text().await.unwrap_or_default();
        return Err(ApiError(format!("HTTP {s}: {b}")));
    }
    Ok(())
}

// --- Slice 5c-4: rich lookup fetches + per-entity CRUD ---

pub async fn fetch_manufacturers_full() -> Result<Vec<ManufacturerRow>, ApiError> {
    Ok(Request::get(&format!("{API_BASE}/api/manufacturers"))
        .send().await?.json().await?)
}
pub async fn fetch_distributors_full() -> Result<Vec<DistributorRow>, ApiError> {
    Ok(Request::get(&format!("{API_BASE}/api/distributors"))
        .send().await?.json().await?)
}
pub async fn fetch_part_units_full() -> Result<Vec<PartUnitRow>, ApiError> {
    Ok(Request::get(&format!("{API_BASE}/api/part_measurement_units"))
        .send().await?.json().await?)
}
pub async fn fetch_units_rich() -> Result<Vec<UnitRow>, ApiError> {
    Ok(Request::get(&format!("{API_BASE}/api/units"))
        .send().await?.json().await?)
}
pub async fn fetch_si_prefixes_rich() -> Result<Vec<SiPrefixRow>, ApiError> {
    Ok(Request::get(&format!("{API_BASE}/api/si_prefixes"))
        .send().await?.json().await?)
}

/// Generic write — body is JSON the backend's per-entity write DTO
/// shapes (the dialogs build the right shape per kind). Returns the
/// new id on POST or just () on PUT/DELETE.
pub async fn lookup_post(path: &str, body: &serde_json::Value) -> Result<i32, ApiError> {
    let resp = Request::post(&format!("{API_BASE}{path}"))
        .header("content-type", "application/json")
        .body(body.to_string()).map_err(ApiError::from)?
        .send().await?;
    if !resp.ok() {
        let s = resp.status();
        let b = resp.text().await.unwrap_or_default();
        return Err(ApiError(format!("HTTP {s}: {b}")));
    }
    let data: serde_json::Value = resp.json().await?;
    Ok(data.get("id").and_then(|v| v.as_i64()).unwrap_or(0) as i32)
}

pub async fn lookup_put(path: &str, body: &serde_json::Value) -> Result<(), ApiError> {
    let resp = Request::put(&format!("{API_BASE}{path}"))
        .header("content-type", "application/json")
        .body(body.to_string()).map_err(ApiError::from)?
        .send().await?;
    if !resp.ok() {
        let s = resp.status();
        let b = resp.text().await.unwrap_or_default();
        return Err(ApiError(format!("HTTP {s}: {b}")));
    }
    Ok(())
}

/// Lookup delete — returns the raw JSON of any 409 conflict body so the
/// caller (a single shared dialog) can extract counts without per-entity
/// wrapper types.
#[derive(Debug, Clone)]
pub enum LookupDeleteError {
    Conflict(serde_json::Value),
    Other(String),
}

pub async fn lookup_delete(path: &str) -> Result<(), LookupDeleteError> {
    let resp = Request::delete(&format!("{API_BASE}{path}"))
        .send().await
        .map_err(|e| LookupDeleteError::Other(e.to_string()))?;
    if resp.ok() { return Ok(()); }
    let status = resp.status();
    if status == 409 {
        match resp.json::<serde_json::Value>().await {
            Ok(c) => return Err(LookupDeleteError::Conflict(c)),
            Err(e) => return Err(LookupDeleteError::Other(format!(
                "HTTP 409 (could not parse body): {e}"))),
        }
    }
    let body = resp.text().await.unwrap_or_default();
    Err(LookupDeleteError::Other(format!("HTTP {status}: {body}")))
}

// --- Slice 7: attachment upload / delete / edit ---

#[derive(Debug, Clone, serde::Deserialize, PartialEq)]
pub struct AttachmentRow {
    pub id: i32,
    pub filename: String,
    #[serde(default)]
    pub originalname: Option<String>,
    pub mimetype: String,
    pub size: i32,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub extension: Option<String>,
    #[serde(default)]
    pub is_image: bool,
}

/// Returns the absolute file URL the browser can use directly (e.g.,
/// in `<img src=...>` or `<a href=...>`). Always points to the original
/// (full-size) file.
pub fn file_url(kind: &str, id: i32) -> String {
    format!("{API_BASE}/files/{kind}/{id}")
}

/// Thumbnail URL for image attachments.
pub fn thumb_url(kind: &str, id: i32) -> String {
    format!("{API_BASE}/files/{kind}/{id}/thumb")
}

/// Upload one or more files to the named parent entity. `upload_path`
/// is the relative API path with a placeholder for the parent id, e.g.
/// `"/api/parts/{id}/attachments"` — the caller substitutes the id.
///
/// Uses `web_sys::FormData` to build a multipart body that the browser
/// serialises with the right Content-Type boundary header.
pub async fn upload_files(
    upload_path: &str,
    files: &web_sys::FileList,
) -> Result<Vec<AttachmentRow>, ApiError> {
    use wasm_bindgen::JsCast;
    let form = web_sys::FormData::new()
        .map_err(|_| ApiError("FormData::new failed".into()))?;
    for i in 0..files.length() {
        let file = files.get(i)
            .ok_or_else(|| ApiError("file at index missing".into()))?;
        let name = file.name();
        form.append_with_blob_and_filename("file", &file, &name)
            .map_err(|_| ApiError("FormData.append failed".into()))?;
    }
    let body: wasm_bindgen::JsValue = form.into();
    let resp = Request::post(&format!("{API_BASE}{upload_path}"))
        .body(body).map_err(ApiError::from)?
        .send().await?;
    if !resp.ok() {
        let s = resp.status();
        let b = resp.text().await.unwrap_or_default();
        return Err(ApiError(format!("HTTP {s}: {b}")));
    }
    Ok(resp.json().await?)
}

/// Upload by URL — server fetches the URL and stores the result. The
/// `upload_path` is the same shape as `upload_files` (e.g.
/// `/api/parts/123/attachments`); this helper appends `/by-url` to it.
pub async fn upload_by_url(
    upload_path: &str,
    url: &str,
    filename_override: Option<&str>,
) -> Result<Vec<AttachmentRow>, ApiError> {
    let body = serde_json::json!({
        "url": url,
        "filename": filename_override,
    });
    let resp = Request::post(&format!("{API_BASE}{upload_path}/by-url"))
        .header("content-type", "application/json")
        .body(body.to_string()).map_err(ApiError::from)?
        .send().await?;
    if !resp.ok() {
        let s = resp.status();
        let b = resp.text().await.unwrap_or_default();
        return Err(ApiError(format!("HTTP {s}: {b}")));
    }
    Ok(resp.json().await?)
}

pub async fn delete_attachment(kind: &str, id: i32) -> Result<(), ApiError> {
    let resp = Request::delete(&format!("{API_BASE}/api/attachments/{kind}/{id}"))
        .send().await?;
    if !resp.ok() {
        let s = resp.status();
        let b = resp.text().await.unwrap_or_default();
        return Err(ApiError(format!("HTTP {s}: {b}")));
    }
    Ok(())
}

pub async fn update_attachment_description(
    kind: &str,
    id: i32,
    description: Option<String>,
) -> Result<(), ApiError> {
    let body = serde_json::json!({"description": description});
    let resp = Request::put(&format!("{API_BASE}/api/attachments/{kind}/{id}"))
        .header("content-type", "application/json")
        .body(body.to_string()).map_err(ApiError::from)?
        .send().await?;
    if !resp.ok() {
        let s = resp.status();
        let b = resp.text().await.unwrap_or_default();
        return Err(ApiError(format!("HTTP {s}: {b}")));
    }
    Ok(())
}

// ---------------------------------------------------------------------------
//  Slice 8a: Projects + BOM lines
// ---------------------------------------------------------------------------

pub async fn fetch_projects() -> Result<Vec<ProjectListRow>, ApiError> {
    Ok(Request::get(&format!("{API_BASE}/api/projects"))
        .send().await?.json().await?)
}

pub async fn fetch_project_detail(id: i32) -> Result<ProjectDetail, ApiError> {
    Ok(Request::get(&format!("{API_BASE}/api/projects/{id}"))
        .send().await?.json().await?)
}

#[derive(Debug, Serialize)]
pub struct ProjectWrite {
    pub name: String,
    pub description: Option<String>,
}

pub async fn post_project(body: ProjectWrite) -> Result<i32, ApiError> {
    let resp = Request::post(&format!("{API_BASE}/api/projects"))
        .header("content-type", "application/json")
        .body(serde_json::to_string(&body)?).map_err(ApiError::from)?
        .send().await?;
    if !resp.ok() {
        let s = resp.status();
        let b = resp.text().await.unwrap_or_default();
        return Err(ApiError(format!("HTTP {s}: {b}")));
    }
    let v: serde_json::Value = resp.json().await?;
    v.get("id").and_then(|x| x.as_i64()).map(|x| x as i32)
        .ok_or_else(|| ApiError("project create: missing id in response".into()))
}

pub async fn put_project(id: i32, body: ProjectWrite) -> Result<(), ApiError> {
    let resp = Request::put(&format!("{API_BASE}/api/projects/{id}"))
        .header("content-type", "application/json")
        .body(serde_json::to_string(&body)?).map_err(ApiError::from)?
        .send().await?;
    if !resp.ok() {
        let s = resp.status();
        let b = resp.text().await.unwrap_or_default();
        return Err(ApiError(format!("HTTP {s}: {b}")));
    }
    Ok(())
}

#[derive(Debug, Clone)]
pub enum ProjectDeleteError {
    /// 409 — runs exist; pass through the count for a clearer message.
    HasRuns(i64),
    Other(ApiError),
}

pub async fn delete_project(id: i32) -> Result<(), ProjectDeleteError> {
    let resp = Request::delete(&format!("{API_BASE}/api/projects/{id}"))
        .send().await
        .map_err(|e| ProjectDeleteError::Other(e.into()))?;
    if resp.ok() {
        return Ok(());
    }
    if resp.status() == 409 {
        let body: serde_json::Value = resp.json().await
            .map_err(|e| ProjectDeleteError::Other(e.into()))?;
        let runs = body.get("runs").and_then(|x| x.as_i64()).unwrap_or(0);
        return Err(ProjectDeleteError::HasRuns(runs));
    }
    let s = resp.status();
    let b = resp.text().await.unwrap_or_default();
    Err(ProjectDeleteError::Other(ApiError(format!("HTTP {s}: {b}"))))
}

#[derive(Debug, Serialize)]
pub struct BomLineWrite {
    pub part_id: i32,
    pub quantity: i32,
    pub remarks: Option<String>,
    pub overage_type: Option<String>,
    pub overage: Option<i32>,
    pub lot_number: Option<String>,
}

pub async fn post_bom_line(project_id: i32, body: BomLineWrite) -> Result<i32, ApiError> {
    let resp = Request::post(&format!("{API_BASE}/api/projects/{project_id}/parts"))
        .header("content-type", "application/json")
        .body(serde_json::to_string(&body)?).map_err(ApiError::from)?
        .send().await?;
    if !resp.ok() {
        let s = resp.status();
        let b = resp.text().await.unwrap_or_default();
        return Err(ApiError(format!("HTTP {s}: {b}")));
    }
    let v: serde_json::Value = resp.json().await?;
    v.get("id").and_then(|x| x.as_i64()).map(|x| x as i32)
        .ok_or_else(|| ApiError("bom line create: missing id".into()))
}

pub async fn put_bom_line(
    project_id: i32, line_id: i32, body: BomLineWrite,
) -> Result<(), ApiError> {
    let resp = Request::put(&format!("{API_BASE}/api/projects/{project_id}/parts/{line_id}"))
        .header("content-type", "application/json")
        .body(serde_json::to_string(&body)?).map_err(ApiError::from)?
        .send().await?;
    if !resp.ok() {
        let s = resp.status();
        let b = resp.text().await.unwrap_or_default();
        return Err(ApiError(format!("HTTP {s}: {b}")));
    }
    Ok(())
}

pub async fn delete_bom_line(project_id: i32, line_id: i32) -> Result<(), ApiError> {
    let resp = Request::delete(
        &format!("{API_BASE}/api/projects/{project_id}/parts/{line_id}"),
    ).send().await?;
    if !resp.ok() {
        let s = resp.status();
        let b = resp.text().await.unwrap_or_default();
        return Err(ApiError(format!("HTTP {s}: {b}")));
    }
    Ok(())
}

pub async fn fetch_run_preview(
    project_id: i32, quantity: i32,
) -> Result<Vec<RunPreviewLine>, ApiError> {
    Ok(Request::get(&format!(
        "{API_BASE}/api/projects/{project_id}/runs/preview?quantity={quantity}"
    )).send().await?.json().await?)
}

pub async fn fetch_run_history(project_id: i32) -> Result<Vec<RunHistoryEntry>, ApiError> {
    Ok(Request::get(&format!("{API_BASE}/api/projects/{project_id}/runs"))
        .send().await?.json().await?)
}

#[derive(Debug, Serialize)]
pub struct RunRequest {
    pub quantity: i32,
    pub comment: Option<String>,
    /// Map project_part_id (as a string key, since serde_json objects
    /// require string keys) → lot-number override.
    pub lot_overrides: std::collections::HashMap<String, String>,
    /// Slice 11 follow-up: per-BOM-line allocation override. When
    /// present for a line, each allocation produces one ProjectRunPart
    /// + one negative StockEntry against the chosen real_part_id.
    /// When absent, the backend falls back to the BOM-specified
    /// part_id at full effective qty (back-compat with the pre-meta
    /// flow).
    pub allocations: std::collections::HashMap<String, Vec<RunAllocation>>,
}

#[derive(Debug, Clone, Serialize)]
pub struct RunAllocation {
    pub real_part_id: i32,
    pub quantity: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lot_number: Option<String>,
}

pub async fn fetch_part_projects(part_id: i32) -> Result<Vec<PartProjectRef>, ApiError> {
    Ok(Request::get(&format!("{API_BASE}/api/parts/{part_id}/projects"))
        .send().await?.json().await?)
}

pub async fn fetch_part_runs(part_id: i32) -> Result<Vec<PartRunRef>, ApiError> {
    Ok(Request::get(&format!("{API_BASE}/api/parts/{part_id}/runs"))
        .send().await?.json().await?)
}

pub async fn fetch_all_runs(limit: u32, offset: u32) -> Result<AllRunsResponse, ApiError> {
    Ok(Request::get(&format!(
        "{API_BASE}/api/project_runs?limit={limit}&offset={offset}"
    )).send().await?.json().await?)
}

pub async fn delete_run(
    project_id: i32, run_id: i32, restore_stock: bool,
) -> Result<(), ApiError> {
    let resp = Request::delete(&format!(
        "{API_BASE}/api/projects/{project_id}/runs/{run_id}?restore_stock={restore_stock}"
    )).send().await?;
    if !resp.ok() {
        let s = resp.status();
        let b = resp.text().await.unwrap_or_default();
        return Err(ApiError(format!("HTTP {s}: {b}")));
    }
    Ok(())
}

pub async fn post_run(project_id: i32, body: RunRequest) -> Result<serde_json::Value, ApiError> {
    let resp = Request::post(&format!("{API_BASE}/api/projects/{project_id}/runs"))
        .header("content-type", "application/json")
        .body(serde_json::to_string(&body)?).map_err(ApiError::from)?
        .send().await?;
    if !resp.ok() {
        let s = resp.status();
        let b = resp.text().await.unwrap_or_default();
        return Err(ApiError(format!("HTTP {s}: {b}")));
    }
    Ok(resp.json().await?)
}

// ---------------------------------------------------------------------------
//  Slice 11: parametric search
// ---------------------------------------------------------------------------

pub async fn fetch_parameter_names() -> Result<Vec<ParameterNameRow>, ApiError> {
    Ok(Request::get(&format!("{API_BASE}/api/part_parameters/names"))
        .send().await?.json().await?)
}

pub async fn fetch_parameter_values(
    name: &str,
    value_type: &str,
) -> Result<ParameterValuesResponse, ApiError> {
    let url = format!(
        "{API_BASE}/api/part_parameters/values?name={}&value_type={}",
        urlencode(name),
        value_type,
    );
    Ok(Request::get(&url).send().await?.json().await?)
}

/// Wire shape of one predicate. Mirrors the backend's `Predicate`. Either
/// `string_value` or `value` (with optional `si_prefix_id`) carries the
/// scalar; `string_values`/`values` carries the list for `in`.
#[derive(Debug, Clone, Serialize, serde::Deserialize, Default, PartialEq)]
pub struct Predicate {
    pub name: String,
    /// One of: `=`, `!=`, `<`, `<=`, `>`, `>=`, `like`, `in`.
    pub op: String,
    /// "string" | "numeric".
    pub value_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub string_value: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub string_values: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub values: Option<Vec<f64>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub si_prefix_id: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct ParametricBody {
    pub predicates: Vec<Predicate>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub category: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub storage_folder: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub storage_location: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub footprint_folder: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub footprint: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub search: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub meta_only: Option<bool>,
    pub limit: u32,
    pub offset: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sort: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dir: Option<String>,
}

pub async fn fetch_part_matches(
    part_id: i32, limit: u32, offset: u32,
) -> Result<PartListResponse, ApiError> {
    Ok(Request::get(&format!(
        "{API_BASE}/api/parts/{part_id}/matches?limit={limit}&offset={offset}"
    )).send().await?.json().await?)
}

pub async fn post_parametric(body: ParametricBody) -> Result<PartListResponse, ApiError> {
    let resp = Request::post(&format!("{API_BASE}/api/parts/parametric"))
        .header("content-type", "application/json")
        .body(serde_json::to_string(&body)?).map_err(ApiError::from)?
        .send().await?;
    if !resp.ok() {
        let s = resp.status();
        let b = resp.text().await.unwrap_or_default();
        return Err(ApiError(format!("HTTP {s}: {b}")));
    }
    Ok(resp.json().await?)
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
