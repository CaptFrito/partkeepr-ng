//! Slice 5c-1: PartCategory CRUD.
//!
//! - `POST   /api/part_categories`            — create child category
//! - `PUT    /api/part_categories/:id`        — rename / change description
//! - `DELETE /api/part_categories/:id`        — delete (hard-block if non-empty)
//! - `PATCH  /api/part_categories/:id/move`   — reparent
//!
//! Tree maintenance: after any structural change we rebuild the entire
//! nested-set encoding (lft, rgt, lvl, categoryPath) by walking the
//! parent_id adjacency list. This is O(N) per write but the tree is
//! tiny (141 rows in prod). Trade-off: dramatically simpler than
//! Celko-style nested-set surgery, no risk of leaving the tree in a
//! corrupt half-renumbered state.

use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::MySqlPool;

use crate::error::AppError;
use crate::handlers::nested_set;

/// Table name used by the shared rebuild helper. All other SQL in this
/// file hard-codes `PartCategory` since the queries are table-specific
/// (and changing them would just be churn).
const TABLE: &str = "PartCategory";

// ---------------------------------------------------------------------------
//  POST /api/part_categories
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct CategoryCreate {
    /// Required — we don't permit creating a second root.
    pub parent_id: i32,
    pub name: String,
    pub description: Option<String>,
}

pub async fn create(
    State(pool): State<MySqlPool>,
    Json(req): Json<CategoryCreate>,
) -> Result<Json<serde_json::Value>, AppError> {
    let name = req.name.trim();
    if name.is_empty() {
        return Err(AppError::BadRequest("name is required"));
    }

    let mut tx = pool.begin().await?;

    let parent_exists: Option<(i32,)> =
        sqlx::query_as("SELECT id FROM PartCategory WHERE id = ?")
            .bind(req.parent_id)
            .fetch_optional(&mut *tx)
            .await?;
    if parent_exists.is_none() {
        return Err(AppError::BadRequest("parent category does not exist"));
    }

    // Insert with placeholder lft/rgt/lvl/categoryPath; rebuild_tree will
    // assign the real values in a moment.
    let res = sqlx::query(
        "INSERT INTO PartCategory \
            (parent_id, name, description, lft, rgt, lvl, root, categoryPath) \
         VALUES (?, ?, ?, 0, 0, 0, 1, '')",
    )
    .bind(req.parent_id)
    .bind(name)
    .bind(&req.description)
    .execute(&mut *tx)
    .await?;
    let new_id = res.last_insert_id() as i32;

    rebuild_tree(&mut tx).await?;
    tx.commit().await?;
    Ok(Json(json!({"id": new_id})))
}

// ---------------------------------------------------------------------------
//  PUT /api/part_categories/:id
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct CategoryUpdate {
    pub name: String,
    pub description: Option<String>,
}

pub async fn update(
    State(pool): State<MySqlPool>,
    Path(id): Path<i32>,
    Json(req): Json<CategoryUpdate>,
) -> Result<Json<serde_json::Value>, AppError> {
    let name = req.name.trim();
    if name.is_empty() {
        return Err(AppError::BadRequest("name is required"));
    }

    let mut tx = pool.begin().await?;

    let exists: Option<(i32,)> = sqlx::query_as("SELECT id FROM PartCategory WHERE id = ?")
        .bind(id)
        .fetch_optional(&mut *tx)
        .await?;
    if exists.is_none() {
        return Err(AppError::NotFound("category"));
    }

    sqlx::query("UPDATE PartCategory SET name = ?, description = ? WHERE id = ?")
        .bind(name)
        .bind(&req.description)
        .bind(id)
        .execute(&mut *tx)
        .await?;

    // Name change cascades into categoryPath of self + descendants.
    // rebuild_tree handles both cases (no-op rename also fine).
    rebuild_tree(&mut tx).await?;
    tx.commit().await?;
    Ok(Json(json!({"id": id})))
}

// ---------------------------------------------------------------------------
//  PATCH /api/part_categories/:id/move
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct CategoryMove {
    pub new_parent_id: i32,
}

pub async fn move_node(
    State(pool): State<MySqlPool>,
    Path(id): Path<i32>,
    Json(req): Json<CategoryMove>,
) -> Result<Json<serde_json::Value>, AppError> {
    let mut tx = pool.begin().await?;

    let self_row: Option<(i32, Option<i32>, i32, i32)> = sqlx::query_as(
        "SELECT id, parent_id, lft, rgt FROM PartCategory WHERE id = ?",
    )
    .bind(id)
    .fetch_optional(&mut *tx)
    .await?;
    let (_, self_parent, self_lft, self_rgt) =
        self_row.ok_or(AppError::NotFound("category"))?;

    if self_parent.is_none() {
        return Err(AppError::BadRequest("cannot move the root category"));
    }
    if req.new_parent_id == id {
        return Err(AppError::BadRequest("cannot move a category into itself"));
    }

    let target: Option<(i32, i32)> =
        sqlx::query_as("SELECT lft, rgt FROM PartCategory WHERE id = ?")
            .bind(req.new_parent_id)
            .fetch_optional(&mut *tx)
            .await?;
    let (t_lft, _t_rgt) = target.ok_or(AppError::BadRequest("target parent does not exist"))?;
    if t_lft >= self_lft && t_lft <= self_rgt {
        return Err(AppError::BadRequest(
            "cannot move a category into its own descendant",
        ));
    }

    sqlx::query("UPDATE PartCategory SET parent_id = ? WHERE id = ?")
        .bind(req.new_parent_id)
        .bind(id)
        .execute(&mut *tx)
        .await?;

    rebuild_tree(&mut tx).await?;
    tx.commit().await?;
    Ok(Json(json!({"id": id})))
}

// ---------------------------------------------------------------------------
//  DELETE /api/part_categories/:id
// ---------------------------------------------------------------------------

pub async fn delete(
    State(pool): State<MySqlPool>,
    Path(id): Path<i32>,
) -> Result<StatusCode, AppError> {
    let mut tx = pool.begin().await?;

    let row: Option<(i32, Option<i32>)> =
        sqlx::query_as("SELECT id, parent_id FROM PartCategory WHERE id = ?")
            .bind(id)
            .fetch_optional(&mut *tx)
            .await?;
    let (_, parent_id) = row.ok_or(AppError::NotFound("category"))?;
    if parent_id.is_none() {
        return Err(AppError::BadRequest("cannot delete the root category"));
    }

    let child_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM PartCategory WHERE parent_id = ?")
            .bind(id)
            .fetch_one(&mut *tx)
            .await?;
    let part_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM Part WHERE category_id = ?")
            .bind(id)
            .fetch_one(&mut *tx)
            .await?;
    if child_count > 0 || part_count > 0 {
        return Err(AppError::Conflict(json!({
            "error": "category not empty",
            "child_count": child_count,
            "part_count": part_count,
        })));
    }

    sqlx::query("DELETE FROM PartCategory WHERE id = ?")
        .bind(id)
        .execute(&mut *tx)
        .await?;

    rebuild_tree(&mut tx).await?;
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

// ---------------------------------------------------------------------------
//  Helpers
// ---------------------------------------------------------------------------

/// Local alias for the shared rebuild helper, parameterised to this
/// table. Kept as a thin wrapper so the call sites remain readable.
async fn rebuild_tree(
    tx: &mut sqlx::Transaction<'_, sqlx::MySql>,
) -> Result<(), AppError> {
    nested_set::rebuild_tree(tx, TABLE).await
}

// ---------------------------------------------------------------------------
//  Response shape used by the move-target picker (a flat list with parent
//  links — the frontend rebuilds the picker tree client-side and prunes
//  the moved node's subtree).
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct CategoryFlatRow {
    pub id: i32,
    pub parent_id: Option<i32>,
    pub name: String,
    pub lvl: i32,
    pub lft: i32,
    pub rgt: i32,
}

pub async fn list_flat(
    State(pool): State<MySqlPool>,
) -> Result<Json<Vec<CategoryFlatRow>>, AppError> {
    let rows = sqlx::query_as::<_, CategoryFlatRow>(
        "SELECT id, parent_id, name, lvl, lft, rgt FROM PartCategory ORDER BY lft",
    )
    .fetch_all(&pool)
    .await?;
    Ok(Json(rows))
}
