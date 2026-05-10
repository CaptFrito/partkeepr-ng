// SPDX-License-Identifier: GPL-3.0-or-later

//! W8c.X: GridPreset CRUD.
//!
//! GridPreset stores named, *shared* (no per-user) layouts for any
//! Webix datatable. Today only the parts grid drives writes; future
//! grids opt in by sending their own `grid` slug.
//!
//! - Unique `(grid, name)` — duplicate POST/PUT returns 400.
//! - At most one row per `grid` carries `gridDefault=true`. POSTing
//!   or PUTting `grid_default=true` clears every other default for
//!   the same grid in one transaction.
//! - `configuration` is opaque text from the client's perspective and
//!   from ours; the frontend stores a JSON-stringified Webix
//!   `getState()` blob there.
//!
//! Auth: the standard middleware gates `/api/*`; any logged-in user
//! can write. Tighten to `is_admin` later if needed.
use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::MySqlPool;

use crate::error::AppError;

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct GridPresetRow {
    pub id: i32,
    pub grid: String,
    pub name: String,
    pub configuration: String,
    #[sqlx(rename = "gridDefault")]
    pub grid_default: bool,
}

#[derive(Debug, Deserialize)]
pub struct GridPresetWrite {
    pub grid: String,
    pub name: String,
    pub configuration: String,
    #[serde(default)]
    pub grid_default: bool,
}

#[derive(Debug, Deserialize)]
pub struct ListQuery {
    pub grid: Option<String>,
}

pub async fn list(
    State(pool): State<MySqlPool>,
    Query(q): Query<ListQuery>,
) -> Result<Json<Vec<GridPresetRow>>, AppError> {
    let rows = if let Some(grid) = q.grid.as_deref() {
        sqlx::query_as::<_, GridPresetRow>(
            "SELECT id, grid, name, configuration, gridDefault \
             FROM GridPreset WHERE grid = ? \
             ORDER BY gridDefault DESC, name ASC",
        )
        .bind(grid)
        .fetch_all(&pool)
        .await?
    } else {
        sqlx::query_as::<_, GridPresetRow>(
            "SELECT id, grid, name, configuration, gridDefault \
             FROM GridPreset ORDER BY grid ASC, gridDefault DESC, name ASC",
        )
        .fetch_all(&pool)
        .await?
    };
    Ok(Json(rows))
}

pub async fn create(
    State(pool): State<MySqlPool>,
    Json(req): Json<GridPresetWrite>,
) -> Result<Json<serde_json::Value>, AppError> {
    let grid = req.grid.trim();
    let name = req.name.trim();
    if grid.is_empty() || name.is_empty() {
        return Err(AppError::BadRequest("grid and name are required"));
    }
    let mut tx = pool.begin().await?;
    if req.grid_default {
        sqlx::query("UPDATE GridPreset SET gridDefault = 0 WHERE grid = ?")
            .bind(grid)
            .execute(&mut *tx)
            .await?;
    }
    let res = sqlx::query(
        "INSERT INTO GridPreset (grid, name, configuration, gridDefault) \
         VALUES (?, ?, ?, ?)",
    )
    .bind(grid)
    .bind(name)
    .bind(&req.configuration)
    .bind(req.grid_default)
    .execute(&mut *tx)
    .await
    .map_err(map_unique_err)?;
    tx.commit().await?;
    Ok(Json(json!({"id": res.last_insert_id() as i32})))
}

pub async fn update(
    State(pool): State<MySqlPool>,
    Path(id): Path<i32>,
    Json(req): Json<GridPresetWrite>,
) -> Result<Json<serde_json::Value>, AppError> {
    let grid = req.grid.trim();
    let name = req.name.trim();
    if grid.is_empty() || name.is_empty() {
        return Err(AppError::BadRequest("grid and name are required"));
    }
    let mut tx = pool.begin().await?;
    if req.grid_default {
        sqlx::query("UPDATE GridPreset SET gridDefault = 0 WHERE grid = ? AND id <> ?")
            .bind(grid)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    let res = sqlx::query(
        "UPDATE GridPreset \
            SET grid = ?, name = ?, configuration = ?, gridDefault = ? \
            WHERE id = ?",
    )
    .bind(grid)
    .bind(name)
    .bind(&req.configuration)
    .bind(req.grid_default)
    .bind(id)
    .execute(&mut *tx)
    .await
    .map_err(map_unique_err)?;
    if res.rows_affected() == 0 {
        return Err(AppError::NotFound("grid preset"));
    }
    tx.commit().await?;
    Ok(Json(json!({"id": id})))
}

pub async fn delete(
    State(pool): State<MySqlPool>,
    Path(id): Path<i32>,
) -> Result<StatusCode, AppError> {
    let res = sqlx::query("DELETE FROM GridPreset WHERE id = ?")
        .bind(id)
        .execute(&pool)
        .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::NotFound("grid preset"));
    }
    Ok(StatusCode::NO_CONTENT)
}

/// Map MariaDB error 1062 (duplicate-key on `name_grid_unique`) →
/// 400 with a user-friendly message. Same shape as
/// `lookups::map_unique_err`.
fn map_unique_err(e: sqlx::Error) -> AppError {
    if let sqlx::Error::Database(db) = &e {
        if db.code().as_deref() == Some("23000")
            && db.message().to_lowercase().contains("duplicate")
        {
            return AppError::BadRequest(
                "a preset with that name already exists for this grid",
            );
        }
    }
    AppError::Db(e)
}
