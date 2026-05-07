//! Slice 6c: parts-grid column layout — order + per-column width.
//!
//! Persists to localStorage under a fixed key so layouts survive
//! reload. When auth lands (slice 10), this becomes a thin client of
//! the `GridPreset` table; the localStorage path is the stopgap that
//! lets us ship column ergonomics today without waiting on auth.

use serde::{Deserialize, Serialize};

const STORAGE_KEY: &str = "partkeepr-ng:grid-preset:parts:v1";

/// One column in the parts grid. `id` is the stable identifier the
/// renderers dispatch on. `width` is in CSS pixels; `0` means "auto"
/// (let the browser size it).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ColumnState {
    pub id: String,
    pub width: i32,
    /// `true` iff the column is currently shown. Reserved for a
    /// future "show/hide columns" affordance; today everything is
    /// always shown.
    #[serde(default = "default_visible")]
    pub visible: bool,
}

fn default_visible() -> bool { true }

/// Static metadata per column id — label, sort key, alignment, etc.
/// Doesn't live in `ColumnState` because it's hardcoded compile-time
/// (no need to round-trip to localStorage).
pub struct ColumnMeta {
    pub id: &'static str,
    pub label: &'static str,
    pub sort_key: &'static str,
    pub align_right: bool,
    pub default_width: i32,
}

pub const COLUMN_META: &[ColumnMeta] = &[
    ColumnMeta { id: "id",              label: "#",          sort_key: "id",                   align_right: true,  default_width: 60 },
    ColumnMeta { id: "name",            label: "Name",       sort_key: "name",                 align_right: false, default_width: 0  },
    ColumnMeta { id: "description",     label: "Description",sort_key: "description",          align_right: false, default_width: 0  },
    ColumnMeta { id: "stock_level",     label: "Stock",      sort_key: "stock_level",          align_right: true,  default_width: 60 },
    ColumnMeta { id: "min_stock_level", label: "Min",        sort_key: "min_stock_level",      align_right: true,  default_width: 50 },
    ColumnMeta { id: "status",          label: "Status",     sort_key: "status",               align_right: false, default_width: 80 },
    ColumnMeta { id: "part_condition",  label: "Condition",  sort_key: "part_condition",       align_right: false, default_width: 80 },
    ColumnMeta { id: "average_price",   label: "Avg Price",  sort_key: "average_price",        align_right: true,  default_width: 80 },
];

pub fn meta_for(id: &str) -> Option<&'static ColumnMeta> {
    COLUMN_META.iter().find(|m| m.id == id)
}

pub fn default_layout() -> Vec<ColumnState> {
    COLUMN_META.iter().map(|m| ColumnState {
        id: m.id.to_string(),
        width: m.default_width,
        visible: true,
    }).collect()
}

/// Read the persisted layout from localStorage, falling back to
/// defaults on miss / parse error / new column added since last save.
/// When the saved set doesn't cover every meta id, we *append*
/// missing columns at the end at their default widths so a schema
/// addition doesn't silently disappear.
pub fn load_layout() -> Vec<ColumnState> {
    let storage = match local_storage() {
        Some(s) => s,
        None => return default_layout(),
    };
    let raw = match storage.get_item(STORAGE_KEY) {
        Ok(Some(s)) => s,
        _ => return default_layout(),
    };
    let saved: Vec<ColumnState> = match serde_json::from_str(&raw) {
        Ok(v) => v,
        Err(_) => return default_layout(),
    };
    // Merge: keep the saved order/widths, append any columns the user
    // hasn't seen yet (i.e. that we added in code since they last
    // visited).
    let mut out = Vec::with_capacity(COLUMN_META.len());
    for s in &saved {
        if meta_for(&s.id).is_some() {
            out.push(s.clone());
        }
    }
    for m in COLUMN_META {
        if !out.iter().any(|s| s.id == m.id) {
            out.push(ColumnState {
                id: m.id.to_string(),
                width: m.default_width,
                visible: true,
            });
        }
    }
    out
}

pub fn save_layout(layout: &[ColumnState]) {
    let storage = match local_storage() {
        Some(s) => s,
        None => return,
    };
    let json = match serde_json::to_string(layout) {
        Ok(s) => s,
        Err(_) => return,
    };
    let _ = storage.set_item(STORAGE_KEY, &json);
}

fn local_storage() -> Option<web_sys::Storage> {
    web_sys::window()?.local_storage().ok().flatten()
}
