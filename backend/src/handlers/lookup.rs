// SPDX-License-Identifier: GPL-3.0-or-later

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
use chrono::Utc;
use serde::{Deserialize, Serialize};
use sqlx::MySqlPool;

use crate::error::AppError;
use crate::handlers::attachments::{fetch_url_core, AttachmentKind, FetchByUrl};
use crate::handlers::digikey::DigiKeyConfig;
use crate::handlers::mouser::MouserConfig;
use crate::handlers::storage::StorageConfig;

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
    /// One entry per source. `null` when unconfigured.
    pub mouser: Option<SourceCaps>,
    pub digikey: Option<SourceCaps>,
}

#[derive(Debug, Serialize)]
pub struct SourceCaps {
    pub available: bool,
    /// Order Status / receive flow available — independent of search.
    /// Digi-Key: bound to the same OAuth credentials. Mouser: separate
    /// API key (PARTKEEPR_MOUSER_ORDER_KEY).
    pub order_status_available: bool,
    pub calls_per_minute: u32,
    pub calls_per_day: u32,
}

pub async fn capabilities(
    State(mouser): State<MouserConfig>,
    State(digikey): State<DigiKeyConfig>,
) -> Json<CapabilitiesResponse> {
    Json(CapabilitiesResponse {
        mouser: Some(SourceCaps {
            available: mouser.search_key.is_some(),
            order_status_available: mouser.order_key.is_some(),
            calls_per_minute: 30,
            calls_per_day: 1000,
        }),
        digikey: Some(SourceCaps {
            available: digikey.available(),
            // Digi-Key uses the same OAuth token for search + order
            // status; if the app is configured at all, both are live.
            order_status_available: digikey.available(),
            calls_per_minute: 60, // Digi-Key historical: ~1/sec.
            calls_per_day: 1000,
        }),
    })
}

// ===========================================================================
//  Order receive — shared shapes
//
//  Both Digi-Key (slice 12b.2) and Mouser (slice 12a.2) implement the
//  same operator workflow: enter SO# → preview line items joined
//  against PartDistributor → apply matched lines as StockEntry
//  inserts. The wire shapes differ between sources; the *frontend-
//  facing* shapes are unified here so one dialog handles both.
// ===========================================================================

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
    /// Distributor SKU. For Digi-Key this is the DK part #;
    /// for Mouser it's the Mouser part #. Frontend treats it
    /// as a generic distributor-SKU string.
    pub distributor_pn: String,
    pub mpn: String,
    pub manufacturer: String,
    pub description: String,
    pub customer_reference: String,
    pub quantity_ordered: i32,
    pub quantity_shipped: i32,
    pub quantity_backorder: i32,
    pub unit_price: f64,
    /// Local-DB match. None if no PartDistributor row matches the
    /// (distributor, sku) pair.
    pub part_id: Option<i32>,
    pub part_name: Option<String>,
    pub current_stock: Option<i32>,
    /// The matched part's primary storage location, used to pre-fill
    /// the per-line storage picker on the receive dialog. `None` when
    /// `part_id` is None or the part has no primary set.
    pub default_storage_location_id: Option<i32>,
    /// Slice 13d: how many units of *this* part have already been
    /// received against *this* SO# (sum of positive-delta StockEntry
    /// rows with matching `(distributor_id, salesOrderNumber)`). Lets
    /// the receive dialog auto-disable fully-received lines and
    /// pre-fill the residual on partial ones, so a two-shipment order
    /// can be received in two passes without double-counting.
    /// `None` when `part_id` is None (no local match → can't compute).
    pub units_already_received: Option<i32>,
}

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
    /// Override the default comment ("<Distributor> SO #{n} line {k}").
    pub comment: Option<String>,
    /// Slice 13d: per-line container metadata. When `skip_psl_row` is
    /// false (default), the receive handler mints a PartStorageLocation
    /// row capturing the physical container that arrived and FK-links
    /// it to the new StockEntry. When true, just a StockEntry is
    /// inserted (operator already created the PSL row some other way,
    /// e.g. via scan-receive of the same physical reel earlier).
    #[serde(default)]
    pub form: Option<String>,
    #[serde(default)]
    pub storage_location_id: Option<i32>,
    #[serde(default)]
    pub skip_psl_row: bool,
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

// ===========================================================================
//  Import — shared across all lookup sources
// ===========================================================================

#[derive(Debug, Deserialize)]
pub struct ImportRequest {
    pub result: LookupResult,
    pub category_id: i32,
    pub part_unit_id: i32,
}

#[derive(Debug, Serialize)]
pub struct ImportResponse {
    pub part_id: i32,
    pub manufacturer_id: i32,
    pub distributor_id: i32,
    /// Was the manufacturer just created (vs. matched to an existing
    /// row)? Frontend uses this to decide whether to bother with the
    /// image fetch.
    pub manufacturer_created: bool,
    pub datasheet_attachment_id: Option<i32>,
    pub datasheet_error: Option<String>,
    pub logo_attachment_id: Option<i32>,
    pub logo_error: Option<String>,
}

/// Identity of the distributor we're importing through. Determines
/// the Distributor row name + URL used in the auto-create / lookup
/// step.
pub struct DistributorIdentity {
    pub name: &'static str,    // "Mouser", "Digi-Key"
    pub url:  &'static str,    // "https://www.mouser.com" etc.
}

/// Apply an operator-confirmed list of order-receive lines as
/// (StockEntry + optional PartStorageLocation) inserts inside the
/// caller's transaction. Used by both `digikey::order_receive` and
/// `mouser::order_receive` — they differ only in distributor name,
/// distributor URL, and the upstream API call that produces the
/// preview; the per-line application logic is identical and lives
/// here.
///
/// `distributor_label` is used for the default StockEntry comment
/// ("Digi-Key SO #N line K"); the operator's explicit `comment`
/// override on each line takes precedence when non-empty.
///
/// Per-line behavior:
/// - If `skip_psl_row` is false (default), mint a `PartStorageLocation`
///   row capturing the physical container that arrived (form / storage
///   from the request, lot/date NULL since OrderStatus doesn't expose
///   them). The new row's id is recorded on the StockEntry FK.
/// - If `skip_psl_row` is true, just insert a StockEntry — used when
///   the operator already scanned the reel separately via the
///   scan-receive flow and doesn't want a duplicate row.
/// - The StockEntry is always attributed to `(distributor_id,
///   sales_order_number)` so the part-detail Receipts panel
///   aggregates correctly and partial shipments tracked across
///   sessions don't double-count.
pub async fn apply_order_receive_lines(
    tx: &mut sqlx::Transaction<'_, sqlx::MySql>,
    distributor_id: i32,
    distributor_label: &str,
    sales_order_id: i64,
    lines: &[OrderReceiveLine],
    user_id: i32,
) -> Result<Vec<OrderReceiveResult>, AppError> {
    use crate::handlers::stock::{apply_stock_change_in_tx, insert_psl_row_in_tx, OrderAttribution};

    let so_str = sales_order_id.to_string();
    let mut results: Vec<OrderReceiveResult> = Vec::with_capacity(lines.len());

    for (idx, line) in lines.iter().enumerate() {
        let default_comment = format!(
            "{} SO #{} line {}", distributor_label, sales_order_id, idx + 1,
        );
        let comment = line.comment.as_deref()
            .filter(|s| !s.trim().is_empty())
            .unwrap_or(&default_comment);

        let psl_id: Option<i32> = if line.skip_psl_row {
            None
        } else {
            let form = line.form.as_deref().unwrap_or("Loose");
            Some(insert_psl_row_in_tx(
                tx,
                line.part_id,
                form,
                line.storage_location_id,
                line.quantity,
                None, // lot — not exposed in DK/Mouser OrderStatus
                None, // date code — same
                Some(comment),
                user_id,
            ).await?)
        };

        let (stock_after, low_stock) = apply_stock_change_in_tx(
            tx,
            line.part_id,
            line.quantity,
            line.price,
            Some(comment),
            false, // not a correction — real receipt
            user_id,
            OrderAttribution {
                distributor_id: Some(distributor_id),
                sales_order_number: Some(&so_str),
            },
            psl_id,
        ).await?;

        results.push(OrderReceiveResult {
            part_id: line.part_id,
            quantity: line.quantity,
            stock_after,
            low_stock,
        });
    }

    Ok(results)
}

/// Find a Distributor row by case-insensitive name; create it if
/// missing using the supplied URL. Returns the row id. Used by every
/// import / order-receive handler so the operator never has to
/// pre-seed the Distributor table — the first Mouser/Digi-Key import
/// or order-receive auto-creates the row.
pub async fn find_or_create_distributor(
    tx: &mut sqlx::Transaction<'_, sqlx::MySql>,
    name: &str,
    url: &str,
) -> Result<i32, AppError> {
    let existing: Option<(i32,)> = sqlx::query_as(
        "SELECT id FROM Distributor WHERE LOWER(name) = LOWER(?) LIMIT 1",
    )
    .bind(name)
    .fetch_optional(&mut **tx)
    .await?;
    if let Some((id,)) = existing {
        return Ok(id);
    }
    let res = sqlx::query(
        "INSERT INTO Distributor (name, url, enabledForReports) \
         VALUES (?, ?, 1)",
    )
    .bind(name)
    .bind(url)
    .execute(&mut **tx)
    .await?;
    Ok(res.last_insert_id() as i32)
}

/// Shared import path used by both `handlers::mouser::import` and
/// `handlers::digikey::import`. Atomically creates a Part + its
/// PartManufacturer / PartDistributor / PartParameter children;
/// post-commit, fetches the datasheet (PartAttachment) and the
/// manufacturer logo (ManufacturerICLogo, only on freshly-created
/// manufacturers) via the slice-7 by-URL pipeline.
///
/// Attachment-fetch failures don't roll back the part — operator
/// can attach manually if a remote site rejects our fetch
/// (bot-protection sites do this routinely).
pub async fn import_lookup_result(
    pool: &MySqlPool,
    store: &StorageConfig,
    req: ImportRequest,
    distributor: DistributorIdentity,
) -> Result<ImportResponse, AppError> {
    let r = &req.result;
    if r.mpn.trim().is_empty() {
        return Err(AppError::BadRequest("result.mpn is required"));
    }
    if r.manufacturer_name.trim().is_empty() {
        return Err(AppError::BadRequest("result.manufacturer_name is required"));
    }

    let mut tx = pool.begin().await?;

    // 1. Manufacturer — find by case-insensitive exact name; create
    //    if missing.
    let mfg_name = r.manufacturer_name.trim();
    let existing_mfg: Option<(i32,)> = sqlx::query_as(
        "SELECT id FROM Manufacturer WHERE LOWER(name) = LOWER(?) LIMIT 1",
    )
    .bind(mfg_name)
    .fetch_optional(&mut *tx)
    .await?;
    let (manufacturer_id, manufacturer_created) = match existing_mfg {
        Some((id,)) => (id, false),
        None => {
            let res = sqlx::query("INSERT INTO Manufacturer (name) VALUES (?)")
                .bind(mfg_name)
                .execute(&mut *tx)
                .await?;
            (res.last_insert_id() as i32, true)
        }
    };

    // 2. Distributor — find by case-insensitive name; auto-create if
    //    missing. Source-specific (Mouser / Digi-Key / etc.).
    let distributor_id = find_or_create_distributor(
        &mut tx, distributor.name, distributor.url,
    ).await?;

    // 3. Part — Name = MPN (matches existing convention; longer text
    //    lives in description).
    let desc_full = r.description.trim();
    let part_name = if !r.mpn.trim().is_empty() {
        r.mpn.trim().to_string()
    } else {
        let mut buf = String::new();
        for ch in desc_full.chars() {
            if buf.chars().count() >= 80 { break; }
            buf.push(ch);
        }
        buf
    };

    let now = Utc::now().naive_utc();
    let part_res = sqlx::query(
        "INSERT INTO Part \
            (category_id, name, description, comment, stockLevel, \
             minStockLevel, averagePrice, status, needsReview, \
             partCondition, createDate, partUnit_id, \
             removals, lowStock, productionRemarks, \
             internalPartNumber, metaPart) \
         VALUES (?, ?, ?, '', 0, 0, 0, NULL, 0, NULL, ?, ?, 0, 1, NULL, NULL, 0)",
    )
    .bind(req.category_id)
    .bind(&part_name)
    .bind(desc_full)
    .bind(now)
    .bind(req.part_unit_id)
    .execute(&mut *tx)
    .await?;
    let part_id = part_res.last_insert_id() as i32;

    // 4. PartManufacturer link.
    sqlx::query(
        "INSERT INTO PartManufacturer (part_id, manufacturer_id, partNumber) \
         VALUES (?, ?, ?)",
    )
    .bind(part_id)
    .bind(manufacturer_id)
    .bind(&r.mpn)
    .execute(&mut *tx)
    .await?;

    // 5. PartDistributor link. Use the cheapest / lowest-quantity
    //    price break as the primary; standard_pack_qty (if set)
    //    drives packagingUnit.
    let primary_break = r.price_breaks.iter().min_by_key(|pb| pb.quantity);
    let unit_price: Option<rust_decimal::Decimal> = primary_break
        .and_then(|pb| pb.price.parse().ok());
    let currency: Option<&str> = primary_break.map(|pb| pb.currency.as_str());
    let packaging_unit = r.standard_pack_qty
        .or(r.order_qty_multiple)
        .filter(|n| *n > 0)
        .unwrap_or(1);

    sqlx::query(
        "INSERT INTO PartDistributor \
            (part_id, distributor_id, orderNumber, price, currency, \
             sku, packagingUnit, ignoreForReports) \
         VALUES (?, ?, ?, ?, ?, ?, ?, 0)",
    )
    .bind(part_id)
    .bind(distributor_id)
    .bind(&r.distributor_pn)
    .bind(unit_price)
    .bind(currency)
    .bind(&r.mpn)
    .bind(packaging_unit)
    .execute(&mut *tx)
    .await?;

    // 6. PartParameter rows for each source-supplied parameter.
    //    Try parsing each value as `<number>[<si-prefix><unit>]` so
    //    "1.1 MHz" → numeric/Hz/M, "200 mA" → numeric/A/m, etc.
    //    Anything that doesn't parse cleanly (composite units like
    //    "0.6V/µs", ranges like "0°C ~ 70°C", strings like
    //    "Surface Mount") falls through as a string parameter.
    let unit_lookup: Vec<(i32, String)> = if r.parameters.is_empty() {
        Vec::new()
    } else {
        sqlx::query_as("SELECT id, symbol FROM Unit ORDER BY id")
            .fetch_all(&mut *tx).await?
    };
    let prefix_lookup: Vec<(i32, String, i32, i32)> = if r.parameters.is_empty() {
        Vec::new()
    } else {
        sqlx::query_as("SELECT id, symbol, base, exponent FROM SiPrefix ORDER BY id")
            .fetch_all(&mut *tx).await?
    };

    for param in &r.parameters {
        let name = param.name.trim();
        let value = param.value.trim();
        if name.is_empty() || value.is_empty() { continue; }

        if let Some(p) = parse_numeric_param(value, &unit_lookup, &prefix_lookup) {
            sqlx::query(
                "INSERT INTO PartParameter \
                    (part_id, unit_id, name, description, value, siPrefix_id, \
                     normalizedValue, maximumValue, normalizedMaxValue, \
                     minimumValue, normalizedMinValue, stringValue, valueType, \
                     minSiPrefix_id, maxSiPrefix_id) \
                 VALUES (?, ?, ?, '', ?, ?, ?, NULL, NULL, NULL, NULL, '', 'numeric', NULL, NULL)",
            )
            .bind(part_id)
            .bind(p.unit_id)
            .bind(name)
            .bind(p.value)
            .bind(p.si_prefix_id)
            .bind(p.normalized_value)
            .execute(&mut *tx)
            .await?;
        } else {
            sqlx::query(
                "INSERT INTO PartParameter \
                    (part_id, unit_id, name, description, value, siPrefix_id, \
                     normalizedValue, maximumValue, normalizedMaxValue, \
                     minimumValue, normalizedMinValue, stringValue, valueType, \
                     minSiPrefix_id, maxSiPrefix_id) \
                 VALUES (?, NULL, ?, '', NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?, 'string', NULL, NULL)",
            )
            .bind(part_id)
            .bind(name)
            .bind(value)
            .execute(&mut *tx)
            .await?;
        }
    }

    tx.commit().await?;
    tracing::info!(part_id, mpn = %r.mpn, source = %r.source, "imported part");

    // 7. Datasheet fetch (best-effort, post-commit).
    let (datasheet_attachment_id, datasheet_error) = match r.datasheet_url.as_deref() {
        Some(url) if !url.trim().is_empty() => {
            match fetch_url_core(
                pool, store, AttachmentKind::PartAttachment, part_id,
                FetchByUrl { url: url.to_string(), filename: None },
            ).await {
                Ok(rows) => (rows.0.first().map(|r| r.id), None),
                Err(e) => {
                    let msg = format!("{e:?}");
                    tracing::warn!(part_id, %msg, "datasheet fetch failed");
                    (None, Some(strip_apperror(&msg)))
                }
            }
        }
        _ => (None, None),
    };

    // 8. Manufacturer image fetch — only on newly-created mfgs.
    let (logo_attachment_id, logo_error) = if manufacturer_created {
        match r.image_url.as_deref() {
            Some(url) if !url.trim().is_empty() => {
                match fetch_url_core(
                    pool, store, AttachmentKind::ManufacturerICLogo, manufacturer_id,
                    FetchByUrl { url: url.to_string(), filename: None },
                ).await {
                    Ok(rows) => (rows.0.first().map(|r| r.id), None),
                    Err(e) => {
                        let msg = format!("{e:?}");
                        tracing::warn!(manufacturer_id, %msg, "logo fetch failed");
                        (None, Some(strip_apperror(&msg)))
                    }
                }
            }
            _ => (None, None),
        }
    } else {
        (None, None)
    };

    Ok(ImportResponse {
        part_id,
        manufacturer_id,
        distributor_id,
        manufacturer_created,
        datasheet_attachment_id,
        datasheet_error,
        logo_attachment_id,
        logo_error,
    })
}

fn strip_apperror(dbg: &str) -> String {
    if let Some(start) = dbg.find('"') {
        let rest = &dbg[start + 1..];
        if let Some(end) = rest.rfind('"') {
            return rest[..end].to_string();
        }
    }
    dbg.to_string()
}

// ===========================================================================
//  Numeric parameter parsing
//
//  Source APIs (Digi-Key especially) return parameters as strings:
//  "1.1 MHz", "200 mA", "30 V", "0°C ~ 70°C", "8-SOIC (0.154", 3.90mm Width)".
//  Try to parse the simple cases (`<number><whitespace?><si-prefix?><unit?>`)
//  into structured numeric/unit/prefix triples so parametric search
//  works across them. Reject anything composite (slashes, parens,
//  ranges, multiple words) — those stay as string parameters.
// ===========================================================================

pub(crate) struct ParsedNumeric {
    pub value: f64,
    pub si_prefix_id: Option<i32>,
    pub unit_id: Option<i32>,
    pub normalized_value: f64,
}

/// Match `<number>[<si-prefix?><unit?>]` against the install's live
/// SiPrefix + Unit tables. Returns Some on a clean parse; None when
/// the string is too complex to interpret as a single numeric value
/// (e.g., "0°C ~ 70°C", "0.6V/µs", "Surface Mount").
pub(crate) fn parse_numeric_param(
    raw: &str,
    units: &[(i32, String)],
    prefixes: &[(i32, String, i32, i32)],
) -> Option<ParsedNumeric> {
    let s = raw.trim();
    let (value, rest) = parse_leading_number(s)?;
    let suffix = rest.trim();

    // No suffix at all → numeric without unit (e.g., "Number of
    // Circuits = 2"). Allow.
    if suffix.is_empty() {
        return Some(ParsedNumeric {
            value, si_prefix_id: None, unit_id: None, normalized_value: value,
        });
    }
    // Reject compound or qualified units. Also reject suffixes with
    // any internal whitespace (multi-word descriptors aren't units).
    if suffix.chars().any(|c| matches!(c, '/' | '(' | ')' | ',' | '~' | ';' | '@' | '*'))
        || suffix.split_whitespace().count() > 1
    {
        return None;
    }
    let suffix = suffix.split_whitespace().next().unwrap_or(suffix);

    // 1. Try matching the whole suffix as a unit symbol (no prefix).
    if let Some((uid, _)) = units.iter().find(|(_, sym)| sym == suffix) {
        return Some(ParsedNumeric {
            value,
            si_prefix_id: None,
            unit_id: Some(*uid),
            normalized_value: value,
        });
    }

    // 2. Try (prefix + unit) splits. Iterate prefixes longest-first
    //    so multi-char prefixes (Ki, da, etc.) match before single-
    //    char ones with the same lead character.
    let mut sorted: Vec<&(i32, String, i32, i32)> = prefixes.iter().collect();
    sorted.sort_by_key(|(_, sym, _, _)| std::cmp::Reverse(sym.chars().count()));

    for (pid, psym, pbase, pexp) in sorted {
        if psym.is_empty() { continue; }  // already covered by case 1
        // Mu-symbol variants — Digi-Key sometimes uses U+00B5 (µ),
        // sometimes Greek mu U+03BC (μ), sometimes ASCII "u".
        let candidates: Vec<&str> = if psym == "μ" || psym == "µ" {
            vec!["μ", "µ", "u"]
        } else {
            vec![psym.as_str()]
        };
        for cand in candidates {
            if let Some(unit_part) = suffix.strip_prefix(cand) {
                if let Some((uid, _)) = units.iter().find(|(_, sym)| sym == unit_part) {
                    let base_f = *pbase as f64;
                    let normalized_value = value * base_f.powi(*pexp);
                    return Some(ParsedNumeric {
                        value,
                        si_prefix_id: Some(*pid),
                        unit_id: Some(*uid),
                        normalized_value,
                    });
                }
            }
        }
    }

    None
}

/// Pull a leading f64 off the start of `s`. Returns the parsed value
/// and the unconsumed remainder. Accepts an optional sign, a decimal
/// point, and (no scientific notation; we haven't seen Digi-Key emit
/// any).
fn parse_leading_number(s: &str) -> Option<(f64, &str)> {
    let bytes = s.as_bytes();
    let mut i = 0;
    let mut seen_digit = false;
    let mut seen_dot = false;
    if i < bytes.len() && (bytes[i] == b'-' || bytes[i] == b'+') { i += 1; }
    while i < bytes.len() {
        match bytes[i] {
            b'0'..=b'9' => { seen_digit = true; i += 1; }
            b'.' if !seen_dot => { seen_dot = true; i += 1; }
            _ => break,
        }
    }
    if !seen_digit { return None; }
    let value: f64 = s[..i].parse().ok()?;
    Some((value, &s[i..]))
}
