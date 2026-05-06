//! JSON types matching what the backend's slice 4a endpoints return.
//!
//! Hand-mirrored from `backend/src/handlers/parts.rs`. We accept the
//! duplication for now; a shared crate is a future refactor when this
//! starts hurting.

use serde::Deserialize;

#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct CategoryNode {
    pub id: i32,
    pub name: String,
    pub lvl: i32,
    pub category_path: String,
    #[serde(default)]
    pub children: Vec<CategoryNode>,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct PartListResponse {
    pub items: Vec<PartRow>,
    pub total: i64,
    pub limit: u32,
    pub offset: u32,
}

/// One row in the parts list. Includes the resolved `category_path` so
/// the frontend can group rows by their leaf category breadcrumb without
/// a separate lookup.
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct PartRow {
    pub id: i32,
    pub name: String,
    pub description: Option<String>,
    pub stock_level: i32,
    pub min_stock_level: i32,
    pub low_stock: bool,
    pub status: Option<String>,
    pub part_condition: Option<String>,
    pub average_price: String,
    pub internal_part_number: Option<String>,
    pub category_id: Option<i32>,
    pub storage_location_id: Option<i32>,
    pub category_path: Option<String>,
}

// --- detail types ---

#[derive(Debug, Clone, Deserialize)]
pub struct CategorySummary {
    pub id: i32,
    pub name: String,
    pub category_path: Option<String>,
    pub lvl: i32,
}

#[derive(Debug, Clone, Deserialize)]
pub struct StorageLocationSummary {
    pub id: i32,
    pub name: String,
    pub category_id: Option<i32>,
    pub category_path: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct FootprintSummary {
    pub id: i32,
    pub name: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PartUnitSummary {
    pub id: i32,
    pub name: String,
    pub short_name: String,
    pub is_default: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PartManufacturerView {
    pub id: i32,
    pub manufacturer_id: i32,
    pub manufacturer_name: String,
    pub part_number: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PartDistributorView {
    pub id: i32,
    pub distributor_id: i32,
    pub distributor_name: String,
    pub order_number: Option<String>,
    pub price: Option<String>,
    pub currency: Option<String>,
    pub sku: Option<String>,
    pub packaging_unit: i32,
    pub ignore_for_reports: Option<bool>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PartParameterView {
    pub id: i32,
    pub name: String,
    pub description: String,
    pub value_type: String,
    pub value: Option<f64>,
    pub string_value: String,
    pub minimum_value: Option<f64>,
    pub maximum_value: Option<f64>,
    pub unit_id: Option<i32>,
    pub unit_name: Option<String>,
    pub unit_symbol: Option<String>,
    pub si_prefix_id: Option<i32>,
    pub si_prefix_name: Option<String>,
    pub si_prefix_symbol: Option<String>,
    pub min_si_prefix_id: Option<i32>,
    pub max_si_prefix_id: Option<i32>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PartAttachmentView {
    pub id: i32,
    pub filename: String,
    pub original_filename: Option<String>,
    pub mimetype: String,
    pub size: i32,
    pub description: Option<String>,
    pub is_image: Option<bool>,
    pub extension: Option<String>,
    pub created: Option<String>, // ISO datetime
}

#[derive(Debug, Clone, Deserialize)]
pub struct StockEntryView {
    pub id: i32,
    pub stock_level: i32,
    pub price: Option<String>,
    pub date_time: Option<String>,
    pub correction: bool,
    pub comment: Option<String>,
    pub user_id: Option<i32>,
    pub username: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PartDetail {
    // Flattened Part fields. Match backend's `#[serde(flatten)] pub part: Part`.
    pub id: i32,
    pub name: String,
    pub description: Option<String>,
    pub comment: String,
    pub stock_level: i32,
    pub min_stock_level: i32,
    pub low_stock: bool,
    pub average_price: String,
    pub status: Option<String>,
    pub part_condition: Option<String>,
    pub create_date: Option<String>,
    pub internal_part_number: Option<String>,
    pub removals: bool,
    pub needs_review: bool,
    pub meta_part: bool,
    pub production_remarks: Option<String>,

    // Expanded relations.
    pub category: Option<CategorySummary>,
    pub storage_location: Option<StorageLocationSummary>,
    pub footprint: Option<FootprintSummary>,
    pub part_unit: Option<PartUnitSummary>,
    pub manufacturers: Vec<PartManufacturerView>,
    pub distributors: Vec<PartDistributorView>,
    pub parameters: Vec<PartParameterView>,
    pub attachments: Vec<PartAttachmentView>,
    pub stock_entries: Vec<StockEntryView>,
}
