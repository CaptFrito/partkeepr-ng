// SPDX-License-Identifier: GPL-3.0-or-later

//! Shared serde deserialization helpers for distributor API responses.
//!
//! Distributor APIs (Digi-Key, Mouser, …) routinely send JSON `null` for
//! "no value" instead of omitting the field, and embed integers in
//! string-typed fields. Serde's built-in `#[serde(default)]` only kicks
//! in for *missing* fields, not nulls — these helpers coerce the common
//! shape mismatches uniformly so handler code can assume sensible types.

use serde::Deserialize;

/// Coerce JSON `null` → `""`. Digi-Key v4 OrderStatus fields like
/// CustomerReference / PurchaseOrder are routinely null on orders
/// without a PO; without this they fail deserialization as `String`.
/// Mouser's Search response uses null instead of empty string for any
/// missing text field. Same fix works for both.
pub fn null_to_empty_string<'de, D>(de: D) -> Result<String, D::Error>
where
    D: serde::Deserializer<'de>,
{
    Ok(Option::<String>::deserialize(de)?.unwrap_or_default())
}

/// Coerce JSON `null` → `[]`. Some Mouser response arrays are null
/// when empty rather than `[]`.
pub fn null_to_empty_vec<'de, D, T>(de: D) -> Result<Vec<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: serde::Deserialize<'de>,
{
    Ok(Option::<Vec<T>>::deserialize(de)?.unwrap_or_default())
}

/// Accept either a JSON number or a numeric string for an i32 field.
/// Digi-Key v4 sometimes returns quantity-style fields as strings
/// ("100") and sometimes as numbers (100); this normalizes both into
/// `Option<i32>`. Returns None on null, missing, or unparseable string.
pub fn de_int_or_string<'de, D>(de: D) -> Result<Option<i32>, D::Error>
where
    D: serde::Deserializer<'de>,
{
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

/// As `de_int_or_string`, but for required fields. Defaults to 0 when
/// the value is missing or unparseable. Useful for line counts and the
/// like where "no value" is meaningful as zero.
pub fn de_int_or_string_required<'de, D>(de: D) -> Result<i32, D::Error>
where
    D: serde::Deserializer<'de>,
{
    Ok(de_int_or_string(de)?.unwrap_or(0))
}
