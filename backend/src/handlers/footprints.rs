// SPDX-License-Identifier: GPL-3.0-or-later

//! Slice 5c-3: FootprintCategory + Footprint CRUD.
//!
//! Same shape as handlers/storage_locations.rs — a nested-set tree of
//! folders, with leaf entities (Footprints) hanging off each folder.
//! The leaf has an extra `description` field compared to StorageLocation,
//! but everything else is parallel.

use std::collections::HashMap;

use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::MySqlPool;

use crate::error::AppError;

// ===========================================================================
//  Combined tree GET — folders with their leaf footprints
// ===========================================================================

#[derive(Debug, Serialize)]
pub struct FootprintTreeNode {
    pub id: i32,
    pub name: String,
    pub lvl: i32,
    pub category_path: String,
    pub children: Vec<FootprintTreeNode>,
    pub footprints: Vec<FootprintLite>,
}

#[derive(Debug, Serialize, sqlx::FromRow, Clone)]
pub struct FootprintLite {
    pub id: i32,
    pub name: String,
    pub category_id: Option<i32>,
    pub description: Option<String>,
    /// How many parts reference this footprint. Surfaced so the delete
    /// dialog can show the count and gate Delete without a roundtrip.
    pub part_count: i64,
}

pub async fn tree(
    State(pool): State<MySqlPool>,
) -> Result<Json<Vec<FootprintTreeNode>>, AppError> {
    #[derive(sqlx::FromRow)]
    struct CatRow {
        id: i32,
        parent_id: Option<i32>,
        name: String,
        lvl: i32,
        category_path: Option<String>,
    }

    let cats: Vec<CatRow> = sqlx::query_as(
        "SELECT id, parent_id, name, lvl, categoryPath AS category_path \
         FROM FootprintCategory ORDER BY lft",
    )
    .fetch_all(&pool)
    .await?;

    let feet: Vec<FootprintLite> = sqlx::query_as(
        "SELECT f.id, f.name, f.category_id, f.description, \
                COALESCE(f_counts.cnt, 0) AS part_count \
         FROM Footprint f \
         LEFT JOIN (SELECT footprint_id, COUNT(*) AS cnt \
                    FROM Part GROUP BY footprint_id) f_counts \
           ON f_counts.footprint_id = f.id \
         ORDER BY f.name",
    )
    .fetch_all(&pool)
    .await?;

    let mut children_idx: HashMap<Option<i32>, Vec<usize>> = HashMap::new();
    for (i, r) in cats.iter().enumerate() {
        children_idx.entry(r.parent_id).or_default().push(i);
    }
    let mut feet_by_cat: HashMap<i32, Vec<FootprintLite>> = HashMap::new();
    for f in feet {
        if let Some(cid) = f.category_id {
            feet_by_cat.entry(cid).or_default().push(f);
        }
    }

    fn build(
        idx: usize,
        cats: &[CatRow],
        children_idx: &HashMap<Option<i32>, Vec<usize>>,
        feet_by_cat: &HashMap<i32, Vec<FootprintLite>>,
    ) -> FootprintTreeNode {
        let r = &cats[idx];
        let children = children_idx
            .get(&Some(r.id))
            .map(|cs| cs.iter().map(|&ci| build(ci, cats, children_idx, feet_by_cat)).collect())
            .unwrap_or_default();
        let footprints = feet_by_cat.get(&r.id).cloned().unwrap_or_default();
        FootprintTreeNode {
            id: r.id,
            name: r.name.clone(),
            lvl: r.lvl,
            category_path: r.category_path.clone().unwrap_or_default(),
            children,
            footprints,
        }
    }

    let roots: Vec<FootprintTreeNode> = children_idx
        .get(&None)
        .map(|cs| cs.iter().map(|&ci| build(ci, &cats, &children_idx, &feet_by_cat)).collect())
        .unwrap_or_default();

    Ok(Json(roots))
}

// ===========================================================================
//  FootprintCategory — POST / PUT / DELETE / move
// ===========================================================================

#[derive(Debug, Deserialize)]
pub struct CategoryCreate {
    pub parent_id: i32,
    pub name: String,
    pub description: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct CategoryUpdate {
    pub name: String,
    pub description: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct CategoryMove {
    pub new_parent_id: i32,
}

pub async fn cat_create(
    State(pool): State<MySqlPool>,
    Json(req): Json<CategoryCreate>,
) -> Result<Json<serde_json::Value>, AppError> {
    let name = req.name.trim();
    if name.is_empty() {
        return Err(AppError::BadRequest("name is required"));
    }
    let mut tx = pool.begin().await?;

    let parent_exists: Option<(i32,)> =
        sqlx::query_as("SELECT id FROM FootprintCategory WHERE id = ?")
            .bind(req.parent_id)
            .fetch_optional(&mut *tx)
            .await?;
    if parent_exists.is_none() {
        return Err(AppError::BadRequest("parent category does not exist"));
    }

    let res = sqlx::query(
        "INSERT INTO FootprintCategory \
            (parent_id, name, description, lft, rgt, lvl, root, categoryPath) \
         VALUES (?, ?, ?, 0, 0, 0, 1, '')",
    )
    .bind(req.parent_id)
    .bind(name)
    .bind(&req.description)
    .execute(&mut *tx)
    .await?;
    let new_id = res.last_insert_id() as i32;

    crate::handlers::nested_set::rebuild_tree(&mut tx, "FootprintCategory").await?;
    tx.commit().await?;
    Ok(Json(json!({"id": new_id})))
}

pub async fn cat_update(
    State(pool): State<MySqlPool>,
    Path(id): Path<i32>,
    Json(req): Json<CategoryUpdate>,
) -> Result<Json<serde_json::Value>, AppError> {
    let name = req.name.trim();
    if name.is_empty() {
        return Err(AppError::BadRequest("name is required"));
    }
    let mut tx = pool.begin().await?;

    let exists: Option<(i32,)> =
        sqlx::query_as("SELECT id FROM FootprintCategory WHERE id = ?")
            .bind(id)
            .fetch_optional(&mut *tx)
            .await?;
    if exists.is_none() {
        return Err(AppError::NotFound("footprint category"));
    }

    sqlx::query("UPDATE FootprintCategory SET name = ?, description = ? WHERE id = ?")
        .bind(name)
        .bind(&req.description)
        .bind(id)
        .execute(&mut *tx)
        .await?;

    crate::handlers::nested_set::rebuild_tree(&mut tx, "FootprintCategory").await?;
    tx.commit().await?;
    Ok(Json(json!({"id": id})))
}

pub async fn cat_move(
    State(pool): State<MySqlPool>,
    Path(id): Path<i32>,
    Json(req): Json<CategoryMove>,
) -> Result<Json<serde_json::Value>, AppError> {
    let mut tx = pool.begin().await?;

    let self_row: Option<(i32, Option<i32>, i32, i32)> = sqlx::query_as(
        "SELECT id, parent_id, lft, rgt FROM FootprintCategory WHERE id = ?",
    )
    .bind(id)
    .fetch_optional(&mut *tx)
    .await?;
    let (_, self_parent, self_lft, self_rgt) =
        self_row.ok_or(AppError::NotFound("footprint category"))?;

    if self_parent.is_none() {
        return Err(AppError::BadRequest("cannot move the root category"));
    }
    if req.new_parent_id == id {
        return Err(AppError::BadRequest("cannot move a category into itself"));
    }

    let target: Option<(i32, i32)> =
        sqlx::query_as("SELECT lft, rgt FROM FootprintCategory WHERE id = ?")
            .bind(req.new_parent_id)
            .fetch_optional(&mut *tx)
            .await?;
    let (t_lft, _t_rgt) = target.ok_or(AppError::BadRequest("target parent does not exist"))?;
    if t_lft >= self_lft && t_lft <= self_rgt {
        return Err(AppError::BadRequest(
            "cannot move a category into its own descendant",
        ));
    }

    sqlx::query("UPDATE FootprintCategory SET parent_id = ? WHERE id = ?")
        .bind(req.new_parent_id)
        .bind(id)
        .execute(&mut *tx)
        .await?;

    crate::handlers::nested_set::rebuild_tree(&mut tx, "FootprintCategory").await?;
    tx.commit().await?;
    Ok(Json(json!({"id": id})))
}

pub async fn cat_delete(
    State(pool): State<MySqlPool>,
    Path(id): Path<i32>,
) -> Result<StatusCode, AppError> {
    let mut tx = pool.begin().await?;

    let row: Option<(i32, Option<i32>)> =
        sqlx::query_as("SELECT id, parent_id FROM FootprintCategory WHERE id = ?")
            .bind(id)
            .fetch_optional(&mut *tx)
            .await?;
    let (_, parent_id) = row.ok_or(AppError::NotFound("footprint category"))?;
    if parent_id.is_none() {
        return Err(AppError::BadRequest("cannot delete the root category"));
    }

    let child_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM FootprintCategory WHERE parent_id = ?")
            .bind(id)
            .fetch_one(&mut *tx)
            .await?;
    let footprint_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM Footprint WHERE category_id = ?")
            .bind(id)
            .fetch_one(&mut *tx)
            .await?;
    if child_count > 0 || footprint_count > 0 {
        return Err(AppError::Conflict(json!({
            "error": "category not empty",
            "child_count": child_count,
            "footprint_count": footprint_count,
        })));
    }

    sqlx::query("DELETE FROM FootprintCategory WHERE id = ?")
        .bind(id)
        .execute(&mut *tx)
        .await?;

    crate::handlers::nested_set::rebuild_tree(&mut tx, "FootprintCategory").await?;
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

// ===========================================================================
//  Footprint (leaf entity) — POST / PUT / DELETE / move
// ===========================================================================

#[derive(Debug, Deserialize)]
pub struct FootprintCreate {
    pub category_id: i32,
    pub name: String,
    pub description: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct FootprintUpdate {
    pub name: String,
    pub description: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct FootprintMove {
    pub new_category_id: i32,
}

pub async fn fp_create(
    State(pool): State<MySqlPool>,
    Json(req): Json<FootprintCreate>,
) -> Result<Json<serde_json::Value>, AppError> {
    let name = req.name.trim();
    if name.is_empty() {
        return Err(AppError::BadRequest("name is required"));
    }

    let parent_exists: Option<(i32,)> =
        sqlx::query_as("SELECT id FROM FootprintCategory WHERE id = ?")
            .bind(req.category_id)
            .fetch_optional(&pool)
            .await?;
    if parent_exists.is_none() {
        return Err(AppError::BadRequest("parent category does not exist"));
    }

    let res = sqlx::query(
        "INSERT INTO Footprint (category_id, name, description) VALUES (?, ?, ?)",
    )
    .bind(req.category_id)
    .bind(name)
    .bind(&req.description)
    .execute(&pool)
    .await?;
    Ok(Json(json!({"id": res.last_insert_id() as i32})))
}

pub async fn fp_update(
    State(pool): State<MySqlPool>,
    Path(id): Path<i32>,
    Json(req): Json<FootprintUpdate>,
) -> Result<Json<serde_json::Value>, AppError> {
    let name = req.name.trim();
    if name.is_empty() {
        return Err(AppError::BadRequest("name is required"));
    }
    let res = sqlx::query("UPDATE Footprint SET name = ?, description = ? WHERE id = ?")
        .bind(name)
        .bind(&req.description)
        .bind(id)
        .execute(&pool)
        .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::NotFound("footprint"));
    }
    Ok(Json(json!({"id": id})))
}

pub async fn fp_move(
    State(pool): State<MySqlPool>,
    Path(id): Path<i32>,
    Json(req): Json<FootprintMove>,
) -> Result<Json<serde_json::Value>, AppError> {
    let parent_exists: Option<(i32,)> =
        sqlx::query_as("SELECT id FROM FootprintCategory WHERE id = ?")
            .bind(req.new_category_id)
            .fetch_optional(&pool)
            .await?;
    if parent_exists.is_none() {
        return Err(AppError::BadRequest("target category does not exist"));
    }
    let res = sqlx::query("UPDATE Footprint SET category_id = ? WHERE id = ?")
        .bind(req.new_category_id)
        .bind(id)
        .execute(&pool)
        .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::NotFound("footprint"));
    }
    Ok(Json(json!({"id": id})))
}

pub async fn fp_delete(
    State(pool): State<MySqlPool>,
    Path(id): Path<i32>,
) -> Result<StatusCode, AppError> {
    let part_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM Part WHERE footprint_id = ?")
            .bind(id)
            .fetch_one(&pool)
            .await?;
    if part_count > 0 {
        return Err(AppError::Conflict(json!({
            "error": "footprint is referenced by parts",
            "part_count": part_count,
        })));
    }
    let res = sqlx::query("DELETE FROM Footprint WHERE id = ?")
        .bind(id)
        .execute(&pool)
        .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::NotFound("footprint"));
    }
    Ok(StatusCode::NO_CONTENT)
}

// ===========================================================================
//  Flat list endpoints (used by the move-to picker and the part editor)
// ===========================================================================

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct CategoryFlatRow {
    pub id: i32,
    pub parent_id: Option<i32>,
    pub name: String,
    pub lvl: i32,
    pub lft: i32,
    pub rgt: i32,
}

pub async fn cat_list_flat(
    State(pool): State<MySqlPool>,
) -> Result<Json<Vec<CategoryFlatRow>>, AppError> {
    let rows = sqlx::query_as::<_, CategoryFlatRow>(
        "SELECT id, parent_id, name, lvl, lft, rgt FROM FootprintCategory ORDER BY lft",
    )
    .fetch_all(&pool)
    .await?;
    Ok(Json(rows))
}

pub async fn fp_list(
    State(pool): State<MySqlPool>,
) -> Result<Json<Vec<FootprintLite>>, AppError> {
    let rows = sqlx::query_as::<_, FootprintLite>(
        "SELECT f.id, f.name, f.category_id, f.description, \
                COALESCE(f_counts.cnt, 0) AS part_count \
         FROM Footprint f \
         LEFT JOIN (SELECT footprint_id, COUNT(*) AS cnt \
                    FROM Part GROUP BY footprint_id) f_counts \
           ON f_counts.footprint_id = f.id \
         ORDER BY f.name",
    )
    .fetch_all(&pool)
    .await?;
    Ok(Json(rows))
}
