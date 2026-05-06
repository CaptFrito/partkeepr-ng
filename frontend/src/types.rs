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
    /// How many parts are filed directly under this category (does NOT
    /// include parts in descendants). Used by the delete dialog to show
    /// the count and gate the Delete button up front.
    #[serde(default)]
    pub part_count: i64,
    #[serde(default)]
    pub children: Vec<CategoryNode>,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct StorageTreeNode {
    pub id: i32,
    pub name: String,
    pub lvl: i32,
    pub category_path: String,
    #[serde(default)]
    pub children: Vec<StorageTreeNode>,
    #[serde(default)]
    pub locations: Vec<StorageLocationLite>,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct StorageLocationLite {
    pub id: i32,
    pub name: String,
    pub category_id: Option<i32>,
    /// Parts that reference this location. Used by the delete dialog to
    /// show the count and gate the Delete button up front.
    #[serde(default)]
    pub part_count: i64,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct FootprintTreeNode {
    pub id: i32,
    pub name: String,
    pub lvl: i32,
    pub category_path: String,
    #[serde(default)]
    pub children: Vec<FootprintTreeNode>,
    #[serde(default)]
    pub footprints: Vec<FootprintLite>,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct FootprintLite {
    pub id: i32,
    pub name: String,
    pub category_id: Option<i32>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub part_count: i64,
}

// --- Slice 5c-4: lookup-table rich shapes ---

#[derive(Debug, Clone, Deserialize, serde::Serialize, PartialEq)]
pub struct ManufacturerRow {
    pub id: i32,
    pub name: String,
    #[serde(default)]
    pub address: Option<String>,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub email: Option<String>,
    #[serde(default)]
    pub phone: Option<String>,
    #[serde(default)]
    pub fax: Option<String>,
    #[serde(default)]
    pub comment: Option<String>,
    #[serde(default)]
    pub part_count: i64,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize, PartialEq)]
pub struct DistributorRow {
    pub id: i32,
    pub name: String,
    #[serde(default)]
    pub address: Option<String>,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub phone: Option<String>,
    #[serde(default)]
    pub fax: Option<String>,
    #[serde(default)]
    pub email: Option<String>,
    #[serde(default)]
    pub comment: Option<String>,
    #[serde(default)]
    pub skuurl: Option<String>,
    #[serde(default)]
    pub enabled_for_reports: bool,
    #[serde(default)]
    pub part_count: i64,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize, PartialEq)]
pub struct PartUnitRow {
    pub id: i32,
    pub name: String,
    pub short_name: String,
    pub is_default: bool,
    #[serde(default)]
    pub part_count: i64,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize, PartialEq)]
pub struct UnitRow {
    pub id: i32,
    pub name: String,
    pub symbol: String,
    #[serde(default)]
    pub parameter_count: i64,
    #[serde(default)]
    pub allowed_prefix_ids: Vec<i32>,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize, PartialEq)]
pub struct SiPrefixRow {
    pub id: i32,
    pub prefix: String,
    pub symbol: String,
    pub base: i32,
    pub exponent: i32,
    #[serde(default)]
    pub parameter_count: i64,
    #[serde(default)]
    pub unit_count: i64,
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
    /// Slice 11 follow-up: surfaced so the grid can mark meta-part rows.
    #[serde(default)]
    pub meta_part: bool,
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

// --- Slice 8a: Projects + BOMs ---

#[derive(Debug, Clone, Deserialize, PartialEq)]
pub struct ProjectListRow {
    pub id: i32,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub parts_count: i64,
    #[serde(default)]
    pub runs_count: i64,
    #[serde(default)]
    pub last_run_at: Option<String>,
}

#[derive(Debug, Clone, Deserialize, PartialEq)]
pub struct ProjectPartView {
    pub id: i32,
    pub part_id: Option<i32>,
    pub part_name: Option<String>,
    pub part_internal_part_number: Option<String>,
    pub part_stock_level: Option<i32>,
    pub quantity: i32,
    #[serde(default)]
    pub remarks: Option<String>,
    pub overage_type: String,
    pub overage: i32,
    pub lot_number: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ProjectDetail {
    pub id: i32,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    pub parts: Vec<ProjectPartView>,
    pub attachments: Vec<PartAttachmentView>,
    pub runs_count: i64,
}

// --- Slice 8b: project runs ---

#[derive(Debug, Clone, Deserialize, PartialEq)]
pub struct RunPreviewLine {
    pub project_part_id: i32,
    pub part_id: Option<i32>,
    pub part_name: Option<String>,
    pub part_internal_part_number: Option<String>,
    pub current_stock: Option<i32>,
    pub bom_quantity: i32,
    pub overage: i32,
    pub overage_type: String,
    pub lot_number: String,
    pub per_build: i32,
    pub effective: i32,
    pub shortfall: bool,
    #[serde(default)]
    pub is_meta: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RunHistoryHeader {
    pub id: i32,
    pub run_date_time: Option<String>, // ISO datetime
    pub quantity: i32,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RunHistoryLine {
    pub id: i32,
    pub run_id: i32,
    pub part_id: Option<i32>,
    pub part_name: Option<String>,
    pub quantity: i32,
    pub lot_number: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RunHistoryEntry {
    pub run: RunHistoryHeader,
    pub lines: Vec<RunHistoryLine>,
}

// --- Slice 8c: cross-cutting run views ---

#[derive(Debug, Clone, Deserialize)]
pub struct PartProjectRef {
    pub project_id: i32,
    pub project_name: String,
    pub line_id: i32,
    pub quantity: i32,
    pub overage: i32,
    pub overage_type: String,
    #[serde(default)]
    pub remarks: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PartRunRef {
    pub run_id: i32,
    pub project_id: i32,
    pub project_name: String,
    pub run_date_time: Option<String>,
    pub run_quantity: i32,
    pub deducted_quantity: i32,
    pub lot_number: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AllRunsRow {
    pub run_id: i32,
    pub project_id: i32,
    pub project_name: String,
    pub run_date_time: Option<String>,
    pub quantity: i32,
    pub line_count: i64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AllRunsResponse {
    pub items: Vec<AllRunsRow>,
    pub total: i64,
    pub limit: u32,
    pub offset: u32,
}

// --- Slice 11: parametric search ---

#[derive(Debug, Clone, Deserialize, PartialEq)]
pub struct ParameterNameRow {
    pub name: String,
    pub value_type: String,
    #[serde(default)]
    pub dom_unit_id: Option<i32>,
    #[serde(default)]
    pub dom_unit_name: Option<String>,
    #[serde(default)]
    pub dom_unit_symbol: Option<String>,
    pub count: i64,
}

/// Type-erased value-list response. The backend returns either a
/// strings array (for string-type parameters) or a numerics array (for
/// numeric-type parameters); the JSON shape disambiguates by content.
#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
pub enum ParameterValuesResponse {
    Numerics(Vec<NumericValueRow>),
    Strings(Vec<StringValueRow>),
}

#[derive(Debug, Clone, Deserialize, PartialEq)]
pub struct StringValueRow {
    pub string_value: String,
}

#[derive(Debug, Clone, Deserialize, PartialEq)]
pub struct NumericValueRow {
    pub value: f64,
    #[serde(default)]
    pub si_prefix_id: Option<i32>,
    #[serde(default)]
    pub si_prefix_symbol: Option<String>,
    #[serde(default)]
    pub normalized_value: Option<f64>,
}

// --- Slice 11c: meta-part criteria ---

#[derive(Debug, Clone, Deserialize, PartialEq)]
pub struct MetaPartCriterionView {
    pub id: i32,
    pub name: String,
    pub op: String,
    pub value_type: String,
    #[serde(default)]
    pub value: Option<f64>,
    pub string_value: String,
    #[serde(default)]
    pub si_prefix_id: Option<i32>,
    #[serde(default)]
    pub si_prefix_symbol: Option<String>,
    #[serde(default)]
    pub unit_id: Option<i32>,
    #[serde(default)]
    pub unit_symbol: Option<String>,
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
    /// Slice 11c: meta-part criteria. Empty for non-meta parts.
    #[serde(default)]
    pub criteria: Vec<MetaPartCriterionView>,
}
