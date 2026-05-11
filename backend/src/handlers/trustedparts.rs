// SPDX-License-Identifier: GPL-3.0-or-later

//! TrustedParts.com Inventory API V2 — live cross-distributor price/
//! stock aggregator. ECIA-backed: every participating distributor proves
//! authorization with the manufacturer before its line card appears, so
//! results are counterfeit-resistant.
//!
//! Unlike Mouser/Digi-Key, results from this API are **NOT persisted
//! beyond a short in-memory cache**. The TrustedParts.com API Terms of
//! Use cap storage at 7 days and forbid redistribution, so the
//! response is rendered live in the "💲 Compare distributors" modal
//! and discarded when the modal closes. No row goes into Part /
//! PartDistributor / PartParameter from this source — those tables
//! stay sourced from DK + Mouser imports only.
//!
//! Required attribution per trustedparts.com docs is rendered in the
//! Compare modal footer.
//!
//! Endpoint: `POST https://api.trustedparts.com/v2/search`
//! Auth:     `X-Api-Key` header (single static key, no OAuth refresh).
//! Request:  up to 50 part numbers per call; we send one per query.

use axum::{extract::State, Json};
use serde::{Deserialize, Serialize};
use std::time::Duration;

use crate::error::AppError;
use crate::handlers::serde_helpers::{null_to_empty_string, null_to_zero_f64};

const TRUSTEDPARTS_BASE: &str = "https://api.trustedparts.com";
const HTTP_TIMEOUT_SECS: u64 = 20;
const USER_AGENT: &str = "partkeepr-ng/0.1 (workshop inventory tool)";

// ---------------------------------------------------------------------------
//  Config
// ---------------------------------------------------------------------------

#[derive(Clone, Debug, Default)]
pub struct TrustedPartsConfig {
    /// API key (env: PARTKEEPR_TRUSTEDPARTS_API_KEY).
    pub api_key: Option<String>,
    /// Override the API base URL (optional). Defaults to production.
    pub base_url: String,
}

impl TrustedPartsConfig {
    pub fn from_env() -> Self {
        let api_key = std::env::var("PARTKEEPR_TRUSTEDPARTS_API_KEY")
            .ok()
            .filter(|s| !s.trim().is_empty());
        let base_url = std::env::var("PARTKEEPR_TRUSTEDPARTS_BASE_URL")
            .ok()
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| TRUSTEDPARTS_BASE.to_string());
        if api_key.is_some() {
            tracing::info!(base_url = %base_url, "trustedparts api enabled");
        } else {
            tracing::info!(
                "trustedparts api disabled (set PARTKEEPR_TRUSTEDPARTS_API_KEY to enable)"
            );
        }
        Self { api_key, base_url }
    }

    pub fn available(&self) -> bool {
        self.api_key.is_some()
    }
}

// ---------------------------------------------------------------------------
//  Frontend-facing types (what /api/lookup/trustedparts/compare returns)
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct CompareRequest {
    pub mpn: String,
    /// Optional manufacturer filter. When set, trustedparts narrows to
    /// just that manufacturer (avoids false positives on common MPNs).
    #[serde(default)]
    pub manufacturer: Option<String>,
    /// Operator's source IP (forwarded for trustedparts' compliance
    /// logging). When None we leave the field unset.
    #[serde(default)]
    pub source_ip: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct CompareResponse {
    pub mpn: String,
    pub manufacturer: String,
    pub product_url: String,
    pub is_affected_by_tariff: bool,
    /// One row per distributor offer, flattened across the API's
    /// nested Distributors[].DistributorResults[] structure. Each entry
    /// represents one distributor's stock+pricing for this MPN.
    pub offers: Vec<DistributorOffer>,
    /// Number of distinct distributors carrying this MPN.
    pub distributor_count: usize,
    /// Wire-clock timestamp from the API (informational).
    pub response_time: String,
    pub current_date: String,
    /// Attribution string the frontend renders in the modal footer.
    /// Required by TrustedParts.com TOS.
    pub attribution_html: String,
}

#[derive(Debug, Serialize)]
pub struct DistributorOffer {
    pub distributor_name: String,
    pub distributor_id: i32,
    pub sku: String,
    pub description: String,
    pub stock_qty: Option<f64>,
    pub stock_availability: String,
    pub currency: String,
    pub min_qty: Option<f64>,
    pub quantity_multiple: Option<f64>,
    pub price_breaks: Vec<PriceBreakOut>,
    pub datasheet_url: Option<String>,
    pub product_url: Option<String>,
    pub packaging: Vec<PackagingOut>,
}

#[derive(Debug, Serialize)]
pub struct PriceBreakOut {
    pub quantity: f64,
    pub amount: f64,
    pub formatted: String,
}

#[derive(Debug, Serialize)]
pub struct PackagingOut {
    pub package_type: String,
    pub min_order_qty: Option<i32>,
}

// ---------------------------------------------------------------------------
//  Wire-format types — what TrustedParts.com /v2/search actually returns
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
#[serde(rename_all = "PascalCase")]
struct TrustedPartsRequest<'a> {
    queries: Vec<TpSearchQuery<'a>>,
    country_code: &'a str,
    currency_code: &'a str,
    in_stock_only: bool,
    exact_match: bool,
    use_cached_data: bool,
    user_agent: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    source_ip: Option<&'a str>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "PascalCase")]
struct TpSearchQuery<'a> {
    search_token: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    manufacturers: Option<Vec<&'a str>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct TpResponse {
    #[serde(default)]
    part_results: Vec<TpPartResult>,
    #[serde(default)]
    current_date: String,
    #[serde(default)]
    response_time: String,
    #[serde(default, deserialize_with = "null_to_empty_string")]
    error_message: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct TpPartResult {
    #[serde(default, deserialize_with = "null_to_empty_string")]
    part_number: String,
    #[serde(default, deserialize_with = "null_to_empty_string")]
    manufacturer: String,
    #[serde(default, deserialize_with = "null_to_empty_string")]
    product_url: String,
    #[serde(default)]
    is_affected_by_tariff: bool,
    #[serde(default)]
    distributors: Vec<TpDistributor>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct TpDistributor {
    #[serde(default)]
    id: i32,
    #[serde(default, deserialize_with = "null_to_empty_string")]
    name: String,
    #[serde(default)]
    distributor_results: Vec<TpDistributorResult>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct TpDistributorResult {
    #[serde(default, deserialize_with = "null_to_empty_string")]
    description: String,
    #[serde(default, deserialize_with = "null_to_empty_string")]
    distributor_part_number: String,
    stock: Option<TpStock>,
    pricing: Option<TpPricing>,
    #[serde(default)]
    links: Vec<TpLink>,
    #[serde(default)]
    packaging: Vec<TpPackage>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct TpStock {
    #[serde(default)]
    quantity_on_hand: Option<f64>,
    #[serde(default, deserialize_with = "null_to_empty_string")]
    availability: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct TpPricing {
    #[serde(default, deserialize_with = "null_to_empty_string")]
    currency_code: String,
    #[serde(default)]
    minimum_quantity: Option<f64>,
    #[serde(default)]
    quantity_multiple: Option<f64>,
    #[serde(default)]
    prices: Vec<TpPrice>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct TpPrice {
    #[serde(default, deserialize_with = "null_to_zero_f64")]
    quantity: f64,
    #[serde(default, deserialize_with = "null_to_zero_f64")]
    amount: f64,
    #[serde(default, deserialize_with = "null_to_empty_string")]
    formatted_amount: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct TpLink {
    #[serde(default, rename = "Type", deserialize_with = "null_to_empty_string")]
    link_type: String,
    #[serde(default, deserialize_with = "null_to_empty_string")]
    url: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct TpPackage {
    #[serde(default, deserialize_with = "null_to_empty_string")]
    package_type: String,
    #[serde(default)]
    minimum_order_quantity: Option<i32>,
}

// ---------------------------------------------------------------------------
//  Handler
// ---------------------------------------------------------------------------

/// POST /api/lookup/trustedparts/compare
///
/// Live cross-distributor price + stock lookup for one MPN. Response is
/// rendered in the "💲 Compare distributors" modal and not persisted.
pub async fn compare(
    State(cfg): State<TrustedPartsConfig>,
    Json(req): Json<CompareRequest>,
) -> Result<Json<CompareResponse>, AppError> {
    let api_key = cfg.api_key.as_ref().ok_or(AppError::BadRequest(
        "trustedparts not configured (set PARTKEEPR_TRUSTEDPARTS_API_KEY)",
    ))?;

    let mpn = req.mpn.trim();
    if mpn.is_empty() {
        return Err(AppError::BadRequest("mpn is required"));
    }
    if mpn.len() > 100 {
        return Err(AppError::BadRequest("mpn too long (max 100 chars)"));
    }

    let manufacturer = req.manufacturer.as_deref().map(str::trim).filter(|s| !s.is_empty());
    let body = TrustedPartsRequest {
        queries: vec![TpSearchQuery {
            search_token: mpn,
            manufacturers: manufacturer.map(|m| vec![m]),
        }],
        country_code: "US",
        currency_code: "USD",
        in_stock_only: false,
        exact_match: false,
        use_cached_data: false,
        user_agent: USER_AGENT,
        source_ip: req.source_ip.as_deref().filter(|s| !s.is_empty()),
    };

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(HTTP_TIMEOUT_SECS))
        .build()
        .map_err(|e| AppError::Internal(format!("http client: {e}")))?;

    let res = client
        .post(format!("{}/v2/search", cfg.base_url))
        .header("X-Api-Key", api_key)
        .header("Accept", "application/json")
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("trustedparts request: {e}")))?;

    let status = res.status();
    let raw = res.text().await
        .map_err(|e| AppError::Internal(format!("trustedparts read body: {e}")))?;
    if !status.is_success() {
        tracing::warn!(status = %status, body = %raw, "trustedparts non-2xx");
        return Err(AppError::Internal(format!(
            "trustedparts HTTP {}: {}",
            status.as_u16(),
            raw.chars().take(200).collect::<String>(),
        )));
    }

    let resp: TpResponse = serde_json::from_str(&raw)
        .map_err(|e| AppError::Internal(format!("trustedparts JSON parse: {e}")))?;

    if !resp.error_message.is_empty() {
        return Err(AppError::Internal(format!("trustedparts: {}", resp.error_message)));
    }

    let pr = resp.part_results.into_iter().next()
        .ok_or(AppError::NotFound("no matches"))?;

    let mut offers: Vec<DistributorOffer> = Vec::new();
    for d in pr.distributors {
        for dr in d.distributor_results {
            offers.push(DistributorOffer {
                distributor_name: d.name.clone(),
                distributor_id: d.id,
                sku: dr.distributor_part_number,
                description: dr.description,
                stock_qty: dr.stock.as_ref().and_then(|s| s.quantity_on_hand),
                stock_availability: dr.stock.as_ref().map(|s| s.availability.clone()).unwrap_or_default(),
                currency: dr.pricing.as_ref().map(|p| p.currency_code.clone()).unwrap_or_default(),
                min_qty: dr.pricing.as_ref().and_then(|p| p.minimum_quantity),
                quantity_multiple: dr.pricing.as_ref().and_then(|p| p.quantity_multiple),
                price_breaks: dr.pricing.as_ref()
                    .map(|p| p.prices.iter().map(|pb| PriceBreakOut {
                        quantity: pb.quantity,
                        amount: pb.amount,
                        formatted: pb.formatted_amount.clone(),
                    }).collect())
                    .unwrap_or_default(),
                datasheet_url: dr.links.iter()
                    .find(|l| l.link_type.eq_ignore_ascii_case("datasheet"))
                    .map(|l| l.url.clone())
                    .filter(|u| !u.is_empty()),
                product_url: dr.links.iter()
                    .find(|l| l.link_type.eq_ignore_ascii_case("distributor"))
                    .map(|l| l.url.clone())
                    .filter(|u| !u.is_empty()),
                packaging: dr.packaging.into_iter().map(|p| PackagingOut {
                    package_type: p.package_type,
                    min_order_qty: p.minimum_order_quantity,
                }).collect(),
            });
        }
    }

    // Sort offers: in-stock first (desc by stock_qty), then by 1pc price ascending.
    offers.sort_by(|a, b| {
        let a_stock = a.stock_qty.unwrap_or(0.0);
        let b_stock = b.stock_qty.unwrap_or(0.0);
        let stock_cmp = b_stock.partial_cmp(&a_stock).unwrap_or(std::cmp::Ordering::Equal);
        if stock_cmp != std::cmp::Ordering::Equal { return stock_cmp; }
        let a_p = a.price_breaks.first().map(|p| p.amount).unwrap_or(f64::INFINITY);
        let b_p = b.price_breaks.first().map(|p| p.amount).unwrap_or(f64::INFINITY);
        a_p.partial_cmp(&b_p).unwrap_or(std::cmp::Ordering::Equal)
    });

    let distributor_count = offers.iter()
        .map(|o| o.distributor_id)
        .collect::<std::collections::HashSet<_>>()
        .len();

    Ok(Json(CompareResponse {
        mpn: pr.part_number,
        manufacturer: pr.manufacturer,
        product_url: pr.product_url,
        is_affected_by_tariff: pr.is_affected_by_tariff,
        offers,
        distributor_count,
        response_time: resp.response_time,
        current_date: resp.current_date,
        // Required attribution per TrustedParts.com docs page
        // /en/docs/trustedparts-logos — text "Powered by" + the
        // TrustedParts.com logo, linking back to the site. The logo
        // asset lives at frontend/assets/trustedparts-logo.png, sourced
        // from https://cms.trustedparts.com/production/images/trustedparts-logo-large.png
        attribution_html:
            "<a href=\"https://www.trustedparts.com/\" target=\"_blank\" rel=\"noopener\" \
                style=\"display:inline-flex;align-items:center;gap:6px;text-decoration:none;color:inherit\">\
               <span>Powered by</span>\
               <img src=\"assets/trustedparts-logo.png\" alt=\"TrustedParts.com\" style=\"height:14px;vertical-align:middle\"/>\
             </a>".to_string(),
    }))
}
