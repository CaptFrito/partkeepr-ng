// SPDX-License-Identifier: GPL-3.0-or-later

//! LCSC / JLCPCB cross-reference, sourced from the jlcparts SQLite.
//!
//! Read-only queries against a local mirror of yaqwsx/jlcparts'
//! cache.sqlite3 (MIT-licensed pipeline, refreshed by our own weekly
//! cron — see `scripts/jlcparts-sync.sh` and Phase-2 build at
//! `scripts/jlcparts-build/`).
//!
//! No live API call. Sub-millisecond MPN lookups against ~7.1M rows
//! with an `idx_components_mfr` index that the cron-sync adds on each
//! refresh.
//!
//! Three pieces of information the operator cares about per row:
//!
//!   1. **LCSC part number** (the `C5423`-style code) — needed to
//!      paste into the JLCPCB BOM tool when ordering a PCBA.
//!   2. **Library tier** (`basic` / `preferred` / `extended`) — drives
//!      JLC's per-part placement fee. Basic library parts are free to
//!      place; Extended adds a one-time $3 fee per design.
//!   3. **Stock + price tier** — same as any other distributor offer.

use axum::{extract::State, Json};
use serde::{Deserialize, Serialize};
use sqlx::{sqlite::{SqlitePool, SqlitePoolOptions, SqliteConnectOptions}, Row};
use std::str::FromStr;
use std::time::Duration;

use crate::error::AppError;

const CONNECT_TIMEOUT_SECS: u64 = 5;

// ---------------------------------------------------------------------------
//  Config
// ---------------------------------------------------------------------------

#[derive(Clone, Debug)]
pub struct JlcPartsConfig {
    /// Connection pool to the mirrored jlcparts SQLite. None when the
    /// file doesn't exist or sqlx can't open it — the cross-reference
    /// endpoint then returns a friendly "not configured" error.
    pub pool: Option<SqlitePool>,
}

impl JlcPartsConfig {
    pub async fn from_env() -> Self {
        let path = std::env::var("PARTKEEPR_JLCPARTS_DB_PATH")
            .ok()
            .filter(|s| !s.trim().is_empty());

        let path = match path {
            Some(p) => p,
            None => {
                tracing::info!(
                    "jlcparts cross-reference disabled (set PARTKEEPR_JLCPARTS_DB_PATH \
                     to the mirrored cache.sqlite3 to enable)",
                );
                return Self { pool: None };
            }
        };

        if !std::path::Path::new(&path).exists() {
            tracing::warn!(
                path = %path,
                "PARTKEEPR_JLCPARTS_DB_PATH points at a missing file; cross-reference disabled",
            );
            return Self { pool: None };
        }

        // Read-only, no journal, no locking — the file is owned by the
        // cron-sync script which uses atomic rename so we never see a
        // half-written file. Even so, open immutably to be safe.
        let opts = match SqliteConnectOptions::from_str(&path) {
            Ok(o) => o.read_only(true).immutable(true),
            Err(e) => {
                tracing::warn!(path = %path, error = %e, "invalid jlcparts DB path; disabled");
                return Self { pool: None };
            }
        };

        match SqlitePoolOptions::new()
            .max_connections(4)
            .acquire_timeout(Duration::from_secs(CONNECT_TIMEOUT_SECS))
            .connect_with(opts)
            .await
        {
            Ok(pool) => {
                tracing::info!(path = %path, "jlcparts cross-reference enabled");
                Self { pool: Some(pool) }
            }
            Err(e) => {
                tracing::warn!(path = %path, error = %e, "failed to open jlcparts DB; disabled");
                Self { pool: None }
            }
        }
    }

    pub fn available(&self) -> bool {
        self.pool.is_some()
    }
}

// ---------------------------------------------------------------------------
//  Wire shapes
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct CrossRefRequest {
    pub mpn: String,
    /// Optional manufacturer filter (e.g. "Texas Instruments"). When
    /// set, restricts to matches whose `manufacturers.name` matches
    /// case-insensitively. Useful for ambiguous MPNs.
    #[serde(default)]
    pub manufacturer: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct CrossRefResponse {
    pub mpn: String,
    /// Echo of the manufacturer filter we used (empty when unfiltered).
    pub manufacturer: String,
    pub matches: Vec<LcscMatch>,
    /// Attribution required by jlcparts' MIT license + community
    /// etiquette — frontend renders in the modal footer.
    pub attribution_html: String,
}

#[derive(Debug, Serialize)]
pub struct LcscMatch {
    /// LCSC part number — the bare integer. UI prefixes with "C"
    /// (e.g. 5423 → "C5423"). That's the canonical form for the
    /// JLCPCB BOM tool.
    pub lcsc: i64,
    /// Manufacturer Part Number as LCSC has it (e.g. "LM358DR").
    pub mfr: String,
    pub manufacturer: String,
    pub package: String,
    pub category: String,
    pub subcategory: String,
    pub stock: i64,
    /// JLC library tier: "Basic" (free placement), "Preferred" (newer
    /// tier with reduced fees), or "Extended" (one-time fee).
    pub tier: String,
    pub description: String,
    pub datasheet: String,
    /// Parsed price breaks. JSON in the DB is `[{qFrom, qTo, price}]`;
    /// we re-emit as a sorted ascending-qty list.
    pub price_breaks: Vec<PriceBreak>,
    /// Direct link to the LCSC product page.
    pub lcsc_url: String,
}

#[derive(Debug, Serialize)]
pub struct PriceBreak {
    pub qty_from: i64,
    pub qty_to: Option<i64>,
    pub price: f64,
}

// ---------------------------------------------------------------------------
//  Handler
// ---------------------------------------------------------------------------

/// POST /api/lookup/jlcparts/cross_ref
///
/// Look up matches for an MPN in the local jlcparts mirror. Returns
/// every row whose `mfr` matches exactly or has the MPN as a prefix
/// (catches DR / DRG4 / PWR / N suffixes), ordered with Basic-library
/// parts first, then Preferred, then by stock descending.
pub async fn cross_ref(
    State(cfg): State<JlcPartsConfig>,
    Json(req): Json<CrossRefRequest>,
) -> Result<Json<CrossRefResponse>, AppError> {
    let pool = cfg.pool.as_ref().ok_or(AppError::BadRequest(
        "jlcparts cross-reference not configured \
         (set PARTKEEPR_JLCPARTS_DB_PATH and run scripts/jlcparts-sync.sh)",
    ))?;

    let mpn = req.mpn.trim();
    if mpn.is_empty() {
        return Err(AppError::BadRequest("mpn is required"));
    }
    if mpn.len() > 200 {
        return Err(AppError::BadRequest("mpn too long"));
    }
    let mfr_filter = req.manufacturer.as_deref().map(str::trim).filter(|s| !s.is_empty());

    // Build the GLOB pattern in Rust. We have to pass a single
    // precomputed string (not `UPPER(?) || '*'`); SQLite's expression-
    // index optimization only kicks in for a literal-shape RHS.
    //
    // The cache.sqlite3 has an `idx_components_mfr_upper` expression
    // index on `UPPER(mfr)` added by scripts/jlcparts-sync.sh.
    // Case-insensitive match via UPPER on both sides + GLOB (which is
    // case-sensitive but always indexable).
    let upper_pattern = format!("{}*", mpn.to_uppercase());

    // Cap at 25 — disambiguating an MPN that returns more than a
    // couple-dozen variants is the operator's problem, and pulling
    // all of them slows the modal needlessly.
    let rows = sqlx::query(
        "SELECT \
            c.lcsc, \
            c.mfr, \
            m.name        AS manufacturer, \
            c.package, \
            cat.category, \
            cat.subcategory, \
            c.stock, \
            c.basic, \
            c.preferred, \
            c.description, \
            c.datasheet, \
            c.price \
         FROM components c \
         LEFT JOIN manufacturers m ON m.id = c.manufacturer_id \
         LEFT JOIN categories cat ON cat.id = c.category_id \
         WHERE UPPER(c.mfr) GLOB ?1 \
           AND (?2 IS NULL OR LOWER(m.name) = LOWER(?2)) \
         ORDER BY c.basic DESC, c.preferred DESC, c.stock DESC \
         LIMIT 25",
    )
    .bind(&upper_pattern)
    .bind(mfr_filter)
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Internal(format!("jlcparts query: {e}")))?;

    let mut matches: Vec<LcscMatch> = Vec::with_capacity(rows.len());
    for row in rows {
        let lcsc: i64 = row.try_get("lcsc").unwrap_or(0);
        let basic: i64 = row.try_get("basic").unwrap_or(0);
        let preferred: i64 = row.try_get("preferred").unwrap_or(0);
        let tier = if basic != 0 {
            "Basic"
        } else if preferred != 0 {
            "Preferred"
        } else {
            "Extended"
        }.to_string();

        let price_json: String = row.try_get("price").unwrap_or_default();
        let price_breaks = parse_price_json(&price_json);

        matches.push(LcscMatch {
            lcsc,
            mfr: row.try_get("mfr").unwrap_or_default(),
            manufacturer: row.try_get("manufacturer").unwrap_or_default(),
            package: row.try_get("package").unwrap_or_default(),
            category: row.try_get("category").unwrap_or_default(),
            subcategory: row.try_get("subcategory").unwrap_or_default(),
            stock: row.try_get("stock").unwrap_or(0),
            tier,
            description: row.try_get("description").unwrap_or_default(),
            datasheet: row.try_get("datasheet").unwrap_or_default(),
            price_breaks,
            lcsc_url: format!("https://lcsc.com/product-detail/C{}.html", lcsc),
        });
    }

    Ok(Json(CrossRefResponse {
        mpn: mpn.to_string(),
        manufacturer: mfr_filter.unwrap_or("").to_string(),
        matches,
        // Attribution per jlcparts' MIT license + courtesy. jlcparts
        // has no logo asset (just a favicon); link the project name.
        attribution_html:
            "Data via <a href=\"https://github.com/yaqwsx/jlcparts\" target=\"_blank\" \
              rel=\"noopener\">yaqwsx/jlcparts</a> (MIT) — JLCPCB / LCSC catalog parser \
             by Honza Mr&#225;zek. JLC library/stock/price data is © LCSC / JLCPCB.".to_string(),
    }))
}

/// jlcparts stores the price column as JSON like
/// `[{"qFrom":1,"qTo":49,"price":0.0753}, ...]` — parse it into our
/// PriceBreak shape. Returns an empty Vec on parse failure (some rows
/// have null or malformed prices for never-stocked SKUs).
fn parse_price_json(s: &str) -> Vec<PriceBreak> {
    #[derive(Deserialize)]
    struct Row {
        #[serde(rename = "qFrom")]
        q_from: Option<i64>,
        #[serde(rename = "qTo")]
        q_to: Option<i64>,
        price: Option<f64>,
    }
    let parsed: Vec<Row> = serde_json::from_str(s).unwrap_or_default();
    let mut out: Vec<PriceBreak> = parsed
        .into_iter()
        .filter_map(|r| Some(PriceBreak {
            qty_from: r.q_from?,
            qty_to: r.q_to,
            price: r.price?,
        }))
        .collect();
    out.sort_by_key(|p| p.qty_from);
    out
}
