//! Slice 5c-2: StorageLocationCategory + StorageLocation CRUD.
//!
//! Mirrors handlers/categories.rs for the category half (nested-set tree
//! with rebuild-on-change), plus flat CRUD for the leaf StorageLocation
//! entity. A combined tree endpoint returns folders with their leaf
//! locations attached so the UI can render one unified tree.
//!
//! TODO: when slice 5c-3 (Footprint tree) lands, factor the
//! nested-set helpers into a shared module — at that point we'll have
//! three instances and the right shape for the abstraction will be
//! obvious.

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
//  Combined tree GET — folders with their leaf storage locations
// ===========================================================================

#[derive(Debug, Serialize)]
pub struct StorageTreeNode {
    pub id: i32,
    pub name: String,
    pub lvl: i32,
    pub category_path: String,
    pub children: Vec<StorageTreeNode>,
    pub locations: Vec<StorageLocationLite>,
}

#[derive(Debug, Serialize, sqlx::FromRow, Clone)]
pub struct StorageLocationLite {
    pub id: i32,
    pub name: String,
    pub category_id: Option<i32>,
    /// How many parts reference this location. Surfaced so the delete
    /// dialog can show the count and gate the Delete button without a
    /// follow-up roundtrip.
    pub part_count: i64,
}

pub async fn tree(
    State(pool): State<MySqlPool>,
) -> Result<Json<Vec<StorageTreeNode>>, AppError> {
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
         FROM StorageLocationCategory ORDER BY lft",
    )
    .fetch_all(&pool)
    .await?;

    let locs: Vec<StorageLocationLite> = sqlx::query_as(
        "SELECT sl.id, sl.name, sl.category_id, \
                COALESCE(sl_counts.cnt, 0) AS part_count \
         FROM StorageLocation sl \
         LEFT JOIN (SELECT storageLocation_id, COUNT(*) AS cnt \
                    FROM Part GROUP BY storageLocation_id) sl_counts \
           ON sl_counts.storageLocation_id = sl.id \
         ORDER BY sl.name",
    )
    .fetch_all(&pool)
    .await?;

    let mut children_idx: HashMap<Option<i32>, Vec<usize>> = HashMap::new();
    for (i, r) in cats.iter().enumerate() {
        children_idx.entry(r.parent_id).or_default().push(i);
    }
    let mut locs_by_cat: HashMap<i32, Vec<StorageLocationLite>> = HashMap::new();
    for l in locs {
        if let Some(cid) = l.category_id {
            locs_by_cat.entry(cid).or_default().push(l);
        }
    }

    fn build(
        idx: usize,
        cats: &[CatRow],
        children_idx: &HashMap<Option<i32>, Vec<usize>>,
        locs_by_cat: &HashMap<i32, Vec<StorageLocationLite>>,
    ) -> StorageTreeNode {
        let r = &cats[idx];
        let children = children_idx
            .get(&Some(r.id))
            .map(|cs| cs.iter().map(|&ci| build(ci, cats, children_idx, locs_by_cat)).collect())
            .unwrap_or_default();
        let locations = locs_by_cat.get(&r.id).cloned().unwrap_or_default();
        StorageTreeNode {
            id: r.id,
            name: r.name.clone(),
            lvl: r.lvl,
            category_path: r.category_path.clone().unwrap_or_default(),
            children,
            locations,
        }
    }

    let roots: Vec<StorageTreeNode> = children_idx
        .get(&None)
        .map(|cs| cs.iter().map(|&ci| build(ci, &cats, &children_idx, &locs_by_cat)).collect())
        .unwrap_or_default();

    Ok(Json(roots))
}

// ===========================================================================
//  StorageLocationCategory — POST / PUT / DELETE / move
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
        sqlx::query_as("SELECT id FROM StorageLocationCategory WHERE id = ?")
            .bind(req.parent_id)
            .fetch_optional(&mut *tx)
            .await?;
    if parent_exists.is_none() {
        return Err(AppError::BadRequest("parent category does not exist"));
    }

    let res = sqlx::query(
        "INSERT INTO StorageLocationCategory \
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
        sqlx::query_as("SELECT id FROM StorageLocationCategory WHERE id = ?")
            .bind(id)
            .fetch_optional(&mut *tx)
            .await?;
    if exists.is_none() {
        return Err(AppError::NotFound("storage category"));
    }

    sqlx::query("UPDATE StorageLocationCategory SET name = ?, description = ? WHERE id = ?")
        .bind(name)
        .bind(&req.description)
        .bind(id)
        .execute(&mut *tx)
        .await?;

    rebuild_tree(&mut tx).await?;
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
        "SELECT id, parent_id, lft, rgt FROM StorageLocationCategory WHERE id = ?",
    )
    .bind(id)
    .fetch_optional(&mut *tx)
    .await?;
    let (_, self_parent, self_lft, self_rgt) =
        self_row.ok_or(AppError::NotFound("storage category"))?;

    if self_parent.is_none() {
        return Err(AppError::BadRequest("cannot move the root category"));
    }
    if req.new_parent_id == id {
        return Err(AppError::BadRequest("cannot move a category into itself"));
    }

    let target: Option<(i32, i32)> =
        sqlx::query_as("SELECT lft, rgt FROM StorageLocationCategory WHERE id = ?")
            .bind(req.new_parent_id)
            .fetch_optional(&mut *tx)
            .await?;
    let (t_lft, _t_rgt) = target.ok_or(AppError::BadRequest("target parent does not exist"))?;
    if t_lft >= self_lft && t_lft <= self_rgt {
        return Err(AppError::BadRequest(
            "cannot move a category into its own descendant",
        ));
    }

    sqlx::query("UPDATE StorageLocationCategory SET parent_id = ? WHERE id = ?")
        .bind(req.new_parent_id)
        .bind(id)
        .execute(&mut *tx)
        .await?;

    rebuild_tree(&mut tx).await?;
    tx.commit().await?;
    Ok(Json(json!({"id": id})))
}

pub async fn cat_delete(
    State(pool): State<MySqlPool>,
    Path(id): Path<i32>,
) -> Result<StatusCode, AppError> {
    let mut tx = pool.begin().await?;

    let row: Option<(i32, Option<i32>)> =
        sqlx::query_as("SELECT id, parent_id FROM StorageLocationCategory WHERE id = ?")
            .bind(id)
            .fetch_optional(&mut *tx)
            .await?;
    let (_, parent_id) = row.ok_or(AppError::NotFound("storage category"))?;
    if parent_id.is_none() {
        return Err(AppError::BadRequest("cannot delete the root category"));
    }

    let child_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM StorageLocationCategory WHERE parent_id = ?")
            .bind(id)
            .fetch_one(&mut *tx)
            .await?;
    let location_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM StorageLocation WHERE category_id = ?")
            .bind(id)
            .fetch_one(&mut *tx)
            .await?;
    if child_count > 0 || location_count > 0 {
        return Err(AppError::Conflict(json!({
            "error": "category not empty",
            "child_count": child_count,
            "location_count": location_count,
        })));
    }

    sqlx::query("DELETE FROM StorageLocationCategory WHERE id = ?")
        .bind(id)
        .execute(&mut *tx)
        .await?;

    rebuild_tree(&mut tx).await?;
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

// ===========================================================================
//  StorageLocation (leaf entity) — POST / PUT / DELETE / move
// ===========================================================================

#[derive(Debug, Deserialize)]
pub struct LocationCreate {
    pub category_id: i32,
    pub name: String,
}

#[derive(Debug, Deserialize)]
pub struct LocationUpdate {
    pub name: String,
}

#[derive(Debug, Deserialize)]
pub struct LocationMove {
    pub new_category_id: i32,
}

pub async fn loc_create(
    State(pool): State<MySqlPool>,
    Json(req): Json<LocationCreate>,
) -> Result<Json<serde_json::Value>, AppError> {
    let name = req.name.trim();
    if name.is_empty() {
        return Err(AppError::BadRequest("name is required"));
    }

    let parent_exists: Option<(i32,)> =
        sqlx::query_as("SELECT id FROM StorageLocationCategory WHERE id = ?")
            .bind(req.category_id)
            .fetch_optional(&pool)
            .await?;
    if parent_exists.is_none() {
        return Err(AppError::BadRequest("parent category does not exist"));
    }

    let res = sqlx::query("INSERT INTO StorageLocation (category_id, name) VALUES (?, ?)")
        .bind(req.category_id)
        .bind(name)
        .execute(&pool)
        .await?;
    Ok(Json(json!({"id": res.last_insert_id() as i32})))
}

pub async fn loc_update(
    State(pool): State<MySqlPool>,
    Path(id): Path<i32>,
    Json(req): Json<LocationUpdate>,
) -> Result<Json<serde_json::Value>, AppError> {
    let name = req.name.trim();
    if name.is_empty() {
        return Err(AppError::BadRequest("name is required"));
    }
    let res = sqlx::query("UPDATE StorageLocation SET name = ? WHERE id = ?")
        .bind(name)
        .bind(id)
        .execute(&pool)
        .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::NotFound("storage location"));
    }
    Ok(Json(json!({"id": id})))
}

pub async fn loc_move(
    State(pool): State<MySqlPool>,
    Path(id): Path<i32>,
    Json(req): Json<LocationMove>,
) -> Result<Json<serde_json::Value>, AppError> {
    let parent_exists: Option<(i32,)> =
        sqlx::query_as("SELECT id FROM StorageLocationCategory WHERE id = ?")
            .bind(req.new_category_id)
            .fetch_optional(&pool)
            .await?;
    if parent_exists.is_none() {
        return Err(AppError::BadRequest("target category does not exist"));
    }
    let res = sqlx::query("UPDATE StorageLocation SET category_id = ? WHERE id = ?")
        .bind(req.new_category_id)
        .bind(id)
        .execute(&pool)
        .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::NotFound("storage location"));
    }
    Ok(Json(json!({"id": id})))
}

pub async fn loc_delete(
    State(pool): State<MySqlPool>,
    Path(id): Path<i32>,
) -> Result<StatusCode, AppError> {
    // Hard-block if any Part references this storage location. The FK
    // would block too (with a 1451 error), but checking up front gives
    // the UI a clean count and an unambiguous error shape.
    let part_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM Part WHERE storageLocation_id = ?")
            .bind(id)
            .fetch_one(&pool)
            .await?;
    if part_count > 0 {
        return Err(AppError::Conflict(json!({
            "error": "storage location is referenced by parts",
            "part_count": part_count,
        })));
    }

    let res = sqlx::query("DELETE FROM StorageLocation WHERE id = ?")
        .bind(id)
        .execute(&pool)
        .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::NotFound("storage location"));
    }
    Ok(StatusCode::NO_CONTENT)
}

// ===========================================================================
//  Flat list (used by the move-to picker)
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
        "SELECT id, parent_id, name, lvl, lft, rgt FROM StorageLocationCategory ORDER BY lft",
    )
    .fetch_all(&pool)
    .await?;
    Ok(Json(rows))
}

pub async fn loc_list(
    State(pool): State<MySqlPool>,
) -> Result<Json<Vec<StorageLocationLite>>, AppError> {
    let rows = sqlx::query_as::<_, StorageLocationLite>(
        "SELECT sl.id, sl.name, sl.category_id, \
                COALESCE(sl_counts.cnt, 0) AS part_count \
         FROM StorageLocation sl \
         LEFT JOIN (SELECT storageLocation_id, COUNT(*) AS cnt \
                    FROM Part GROUP BY storageLocation_id) sl_counts \
           ON sl_counts.storageLocation_id = sl.id \
         ORDER BY sl.name",
    )
    .fetch_all(&pool)
    .await?;
    Ok(Json(rows))
}

// ===========================================================================
//  Helpers
// ===========================================================================

async fn rebuild_tree(
    tx: &mut sqlx::Transaction<'_, sqlx::MySql>,
) -> Result<(), AppError> {
    crate::handlers::nested_set::rebuild_tree(tx, "StorageLocationCategory").await
}
