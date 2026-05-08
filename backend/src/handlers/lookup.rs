//! Slice 12a — Distributor / catalog lookups (Mouser today, Digi-Key
//! and Nexar later). This module defines the unified result shape
//! every source maps into, plus the `/api/lookup/capabilities`
//! endpoint frontends hit at boot to decide which "+ Add via …"
//! buttons to render.
//!
//! Per-source code lives in sibling modules: `mouser.rs`, eventually
//! `digikey.rs`, `nexar.rs`. They all produce `LookupResult` rows
//! mapped from their native API.

use axum::{extract::State, Json};
use serde::{Deserialize, Serialize};

use crate::handlers::mouser::MouserConfig;

/// Unified search-result shape across all lookup sources. Designed
/// to fit Mouser today, Digi-Key + Nexar without changes later.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LookupResult {
    /// Which source produced this result. "mouser", "digikey", "nexar".
    pub source: String,
    pub mpn: String,
    pub manufacturer_name: String,
    pub description: String,
    /// Free-form category string from the source. Frontend uses it
    /// for a best-effort match against `lookupsCache.categories_tree`.
    pub category_name: Option<String>,
    pub image_url: Option<String>,
    pub datasheet_url: Option<String>,
    /// "View on Mouser/Digi-Key" link for the operator.
    pub detail_url: Option<String>,
    /// The source's own SKU. For Mouser this is the Mouser P/N
    /// (goes into PartDistributor.orderNumber).
    pub distributor_pn: String,
    pub price_breaks: Vec<PriceBreak>,
    pub availability: Option<String>,
    pub min_order_qty: Option<i32>,
    pub order_qty_multiple: Option<i32>,
    pub standard_pack_qty: Option<i32>,
    pub lifecycle_status: Option<String>,
    pub rohs_status: Option<String>,
    pub lead_time_days: Option<i32>,
    /// Source-provided parameters / product attributes. v1 imports
    /// every entry as a string PartParameter (no unit/prefix
    /// inference). Mouser's are typically packaging-only; future
    /// sources (Digi-Key, Nexar) carry richer parametric data.
    #[serde(default)]
    pub parameters: Vec<LookupResultParameter>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LookupResultParameter {
    pub name: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PriceBreak {
    pub quantity: i32,
    /// Decimal as string to avoid serialization edge cases.
    pub price: String,
    pub currency: String,
}

#[derive(Debug, Serialize)]
pub struct CapabilitiesResponse {
    /// One entry per source. `null` when unconfigured (other sources
    /// will appear here later: digikey, nexar).
    pub mouser: Option<SourceCaps>,
}

#[derive(Debug, Serialize)]
pub struct SourceCaps {
    pub available: bool,
    pub calls_per_minute: u32,
    pub calls_per_day: u32,
}

pub async fn capabilities(
    State(mouser): State<MouserConfig>,
) -> Json<CapabilitiesResponse> {
    Json(CapabilitiesResponse {
        mouser: Some(SourceCaps {
            available: mouser.search_key.is_some(),
            calls_per_minute: 30,
            calls_per_day: 1000,
        }),
    })
}
