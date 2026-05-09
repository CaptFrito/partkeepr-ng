//! Startup invariant checks. Runs once after the DB pool is built,
//! before the server starts accepting requests. The single rule:
//! everything in here must be idempotent — repeated runs on a
//! healthy DB are a no-op.
//!
//! Today this only ensures the operator's "(NOWHERE)" catch-all
//! StorageLocation exists (slice 13b follow-on). New invariants
//! (schema checks, missing seed rows, etc.) belong here too.

use anyhow::Context;
use sqlx::MySqlPool;

/// The convention bin name for "not-yet-placed" parts. Created if
/// missing on startup; can't be deleted via the API. The literal
/// string is also matched by the frontend's defaultStorageLocationId
/// helper (case-insensitive regex against `NOWHERE`), so renaming
/// this here would break that lookup.
pub const NOWHERE_LOCATION_NAME: &str = "(NOWHERE)";

/// Run all startup invariant checks. Bails if any check fails so
/// the operator sees the problem at boot rather than at first
/// request.
pub async fn ensure_invariants(pool: &MySqlPool) -> anyhow::Result<()> {
    ensure_nowhere_storage_location(pool).await?;
    Ok(())
}

/// Ensure a StorageLocation named `(NOWHERE)` exists. Used as the
/// system-wide default for parts whose physical bin hasn't been
/// chosen yet. Idempotent.
async fn ensure_nowhere_storage_location(pool: &MySqlPool) -> anyhow::Result<()> {
    let existing: Option<(i32,)> = sqlx::query_as(
        "SELECT id FROM StorageLocation WHERE name = ? LIMIT 1",
    )
    .bind(NOWHERE_LOCATION_NAME)
    .fetch_optional(pool)
    .await
    .context("checking for (NOWHERE) StorageLocation")?;

    if existing.is_some() {
        tracing::debug!(name = %NOWHERE_LOCATION_NAME, "convention bin exists");
        return Ok(());
    }

    // Pick a category to attach the new bin to. StorageLocationCategory
    // is a nested-set tree; the root is the only guaranteed category.
    // Find its id; bail if even that's missing (would mean an
    // uninitialized DB).
    let cat_id: i32 = sqlx::query_scalar(
        "SELECT id FROM StorageLocationCategory \
         WHERE parent_id IS NULL OR parent_id = 0 \
         ORDER BY id LIMIT 1",
    )
    .fetch_one(pool)
    .await
    .context("looking up root StorageLocationCategory")?;

    sqlx::query(
        "INSERT INTO StorageLocation (name, category_id) VALUES (?, ?)",
    )
    .bind(NOWHERE_LOCATION_NAME)
    .bind(cat_id)
    .execute(pool)
    .await
    .context("creating (NOWHERE) StorageLocation")?;

    tracing::info!(name = %NOWHERE_LOCATION_NAME, "created convention bin");
    Ok(())
}
