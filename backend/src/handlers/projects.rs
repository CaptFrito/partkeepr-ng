//! Slice 8a: Project + ProjectPart (BOM) CRUD.
//!
//! - `GET    /api/projects`               — flat list with parts/runs counts
//! - `GET    /api/projects/:id`           — detail with BOM lines + attachments
//! - `POST   /api/projects`               — create (name + description)
//! - `PUT    /api/projects/:id`           — update name/description
//! - `DELETE /api/projects/:id`           — delete (refuses if any ProjectRun
//!                                          rows exist; runs are append-only
//!                                          history per the slice-8 design)
//! - `POST   /api/projects/:pid/parts`    — add a BOM line
//! - `PUT    /api/projects/:pid/parts/:ppid` — update a BOM line
//! - `DELETE /api/projects/:pid/parts/:ppid` — remove a BOM line
//!
//! ProjectAttachments live behind `handlers::attachments::*` (slice 7) and
//! are surfaced inside the project detail payload here.

use std::collections::HashMap;

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use chrono::{NaiveDateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::{FromRow, MySqlPool};

use crate::error::AppError;
use crate::handlers::auth::CurrentUser;
use crate::handlers::parts::PartAttachmentView;
use crate::handlers::stock;

/// Leak a String into a `&'static str` for `AppError::BadRequest` —
/// the variant takes &'static currently, and widening it is more churn
/// than it's worth for the small handful of dynamic messages we have.
fn leak(s: String) -> &'static str {
    Box::leak(s.into_boxed_str())
}

// ---------------------------------------------------------------------------
//  Wire shapes
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, FromRow)]
pub struct ProjectListRow {
    pub id: i32,
    pub name: String,
    pub description: Option<String>,
    pub parts_count: i64,
    pub runs_count: i64,
    pub last_run_at: Option<NaiveDateTime>,
}

#[derive(Debug, Serialize, FromRow)]
pub struct ProjectPartView {
    pub id: i32,
    pub part_id: Option<i32>,
    pub part_name: Option<String>,
    pub part_internal_part_number: Option<String>,
    pub part_stock_level: Option<i32>,
    pub quantity: i32,
    pub remarks: Option<String>,
    pub overage_type: String,
    pub overage: i32,
    pub lot_number: String,
}

#[derive(Debug, Serialize)]
pub struct ProjectDetail {
    pub id: i32,
    pub name: String,
    pub description: Option<String>,
    pub parts: Vec<ProjectPartView>,
    pub attachments: Vec<PartAttachmentView>,
    pub runs_count: i64,
}

#[derive(Debug, Deserialize)]
pub struct ProjectWrite {
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ProjectPartWrite {
    pub part_id: i32,
    pub quantity: i32,
    #[serde(default)]
    pub remarks: Option<String>,
    /// One of "" (none), "absolute", or "percent". Defaults to "".
    /// Upstream uses these exact strings — see ProjectPart entity
    /// `OVERAGE_TYPES` constants.
    #[serde(default)]
    pub overage_type: Option<String>,
    #[serde(default)]
    pub overage: Option<i32>,
    /// Free-form lot identifier for the BOM line. Stored as `longtext NOT
    /// NULL` upstream; we default to empty when omitted.
    #[serde(default)]
    pub lot_number: Option<String>,
}

// ---------------------------------------------------------------------------
//  Validation
// ---------------------------------------------------------------------------

fn validate_project(p: &ProjectWrite) -> Result<(), AppError> {
    if p.name.trim().is_empty() {
        return Err(AppError::BadRequest("name is required"));
    }
    if p.name.chars().count() > 255 {
        return Err(AppError::BadRequest("name must be 255 characters or fewer"));
    }
    if let Some(d) = &p.description {
        if d.chars().count() > 255 {
            return Err(AppError::BadRequest(
                "description must be 255 characters or fewer",
            ));
        }
    }
    Ok(())
}

fn validate_bom_line(p: &ProjectPartWrite) -> Result<(), AppError> {
    if p.part_id <= 0 {
        return Err(AppError::BadRequest("part_id is required"));
    }
    if p.quantity < 1 {
        return Err(AppError::BadRequest("quantity must be >= 1"));
    }
    let overage = p.overage.unwrap_or(0);
    if overage < 0 {
        return Err(AppError::BadRequest("overage must be >= 0"));
    }
    let ot = p.overage_type.as_deref().unwrap_or("");
    if !matches!(ot, "" | "absolute" | "percent") {
        return Err(AppError::BadRequest(
            "overage_type must be \"\", \"absolute\", or \"percent\"",
        ));
    }
    // "percent" with > 100 is legal in upstream and may even be intentional
    // (e.g., 200% safety margin for pick-and-place fiducials), so we don't
    // cap it here.
    Ok(())
}

// ---------------------------------------------------------------------------
//  GET /api/projects
// ---------------------------------------------------------------------------

pub async fn list(
    State(pool): State<MySqlPool>,
) -> Result<Json<Vec<ProjectListRow>>, AppError> {
    let rows: Vec<ProjectListRow> = sqlx::query_as(
        "SELECT p.id, p.name, p.description, \
                COALESCE(pp.cnt, 0) AS parts_count, \
                COALESCE(pr.cnt, 0) AS runs_count, \
                pr.last_at         AS last_run_at \
         FROM Project p \
         LEFT JOIN (SELECT project_id, COUNT(*) AS cnt \
                    FROM ProjectPart GROUP BY project_id) pp \
                ON pp.project_id = p.id \
         LEFT JOIN (SELECT project_id, COUNT(*) AS cnt, \
                           MAX(runDateTime) AS last_at \
                    FROM ProjectRun GROUP BY project_id) pr \
                ON pr.project_id = p.id \
         ORDER BY p.name",
    )
    .fetch_all(&pool)
    .await?;
    Ok(Json(rows))
}

// ---------------------------------------------------------------------------
//  GET /api/projects/:id
// ---------------------------------------------------------------------------

pub async fn detail(
    State(pool): State<MySqlPool>,
    Path(id): Path<i32>,
) -> Result<Json<ProjectDetail>, AppError> {
    let head: Option<(i32, String, Option<String>)> = sqlx::query_as(
        "SELECT id, name, description FROM Project WHERE id = ?",
    )
    .bind(id)
    .fetch_optional(&pool)
    .await?;
    let (pid, name, description) = head.ok_or(AppError::NotFound("project"))?;

    let parts: Vec<ProjectPartView> = sqlx::query_as(
        "SELECT pp.id, \
                pp.part_id, \
                p.name              AS part_name, \
                p.internalPartNumber AS part_internal_part_number, \
                p.stockLevel        AS part_stock_level, \
                pp.quantity, \
                pp.remarks, \
                pp.overageType      AS overage_type, \
                pp.overage, \
                pp.lotNumber        AS lot_number \
         FROM ProjectPart pp \
         LEFT JOIN Part p ON p.id = pp.part_id \
         WHERE pp.project_id = ? \
         ORDER BY p.name, pp.id",
    )
    .bind(pid)
    .fetch_all(&pool)
    .await?;

    let attachments: Vec<PartAttachmentView> = sqlx::query_as(
        // ProjectAttachment has no `isImage` column — slot in NULL so the
        // shared PartAttachmentView shape (which carries Option<bool>) keeps
        // working without a dedicated DTO.
        "SELECT id, filename, originalname, mimetype, size, description, \
                NULL AS isImage, extension, created \
         FROM ProjectAttachment WHERE project_id = ? ORDER BY created DESC, id DESC",
    )
    .bind(pid)
    .fetch_all(&pool)
    .await?;

    let (runs_count,): (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM ProjectRun WHERE project_id = ?",
    )
    .bind(pid)
    .fetch_one(&pool)
    .await?;

    Ok(Json(ProjectDetail {
        id: pid,
        name,
        description,
        parts,
        attachments,
        runs_count,
    }))
}

// ---------------------------------------------------------------------------
//  POST /api/projects
// ---------------------------------------------------------------------------

pub async fn create(
    State(pool): State<MySqlPool>,
    axum::Extension(user): axum::Extension<CurrentUser>,
    Json(req): Json<ProjectWrite>,
) -> Result<impl IntoResponse, AppError> {
    validate_project(&req)?;
    let res = sqlx::query(
        "INSERT INTO Project (name, description, user_id) VALUES (?, ?, ?)",
    )
        .bind(req.name.trim())
        .bind(req.description.as_deref())
        .bind(user.user_id)
        .execute(&pool)
        .await?;
    Ok((
        StatusCode::CREATED,
        Json(json!({"id": res.last_insert_id() as i32})),
    ))
}

// ---------------------------------------------------------------------------
//  PUT /api/projects/:id
// ---------------------------------------------------------------------------

pub async fn update(
    State(pool): State<MySqlPool>,
    Path(id): Path<i32>,
    Json(req): Json<ProjectWrite>,
) -> Result<Json<serde_json::Value>, AppError> {
    validate_project(&req)?;
    let res = sqlx::query("UPDATE Project SET name = ?, description = ? WHERE id = ?")
        .bind(req.name.trim())
        .bind(req.description.as_deref())
        .bind(id)
        .execute(&pool)
        .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::NotFound("project"));
    }
    Ok(Json(json!({"id": id})))
}

// ---------------------------------------------------------------------------
//  DELETE /api/projects/:id
// ---------------------------------------------------------------------------

pub async fn delete(
    State(pool): State<MySqlPool>,
    Path(id): Path<i32>,
) -> Result<impl IntoResponse, AppError> {
    let mut tx = pool.begin().await?;

    let exists: Option<(i32,)> = sqlx::query_as("SELECT id FROM Project WHERE id = ?")
        .bind(id)
        .fetch_optional(&mut *tx)
        .await?;
    if exists.is_none() {
        return Err(AppError::NotFound("project"));
    }

    // Runs are append-only history — refuse to delete a project that has
    // any. The user can delete the runs separately if they really mean it
    // (no UI for that today, intentionally).
    let (runs,): (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM ProjectRun WHERE project_id = ?",
    )
    .bind(id)
    .fetch_one(&mut *tx)
    .await?;
    if runs > 0 {
        return Err(AppError::Conflict(json!({
            "error": "project has run history",
            "runs": runs,
        })));
    }

    // ProjectAttachment rows: drop file rows here, but the on-disk files
    // are NOT cleaned up (we don't have storage state in this handler;
    // the slice-7 attachments delete endpoint is the one that wipes
    // files). Accepting the leak: if the user deletes a project with N
    // attachments, those N files become orphans on disk. Acceptable in
    // practice since project deletion is rare. Future cleanup pass can
    // sweep orphans.
    sqlx::query("DELETE FROM ProjectAttachment WHERE project_id = ?")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM ProjectPart WHERE project_id = ?")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM Project WHERE id = ?")
        .bind(id)
        .execute(&mut *tx)
        .await?;

    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

// ---------------------------------------------------------------------------
//  POST /api/projects/:pid/parts  (add BOM line)
// ---------------------------------------------------------------------------

pub async fn add_part(
    State(pool): State<MySqlPool>,
    Path(pid): Path<i32>,
    Json(req): Json<ProjectPartWrite>,
) -> Result<impl IntoResponse, AppError> {
    validate_bom_line(&req)?;
    let project_exists: Option<(i32,)> = sqlx::query_as("SELECT id FROM Project WHERE id = ?")
        .bind(pid)
        .fetch_optional(&pool)
        .await?;
    if project_exists.is_none() {
        return Err(AppError::NotFound("project"));
    }
    let part_exists: Option<(i32,)> = sqlx::query_as("SELECT id FROM Part WHERE id = ?")
        .bind(req.part_id)
        .fetch_optional(&pool)
        .await?;
    if part_exists.is_none() {
        return Err(AppError::BadRequest("part_id does not refer to a known part"));
    }

    let res = sqlx::query(
        "INSERT INTO ProjectPart \
            (project_id, part_id, quantity, remarks, overageType, overage, lotNumber) \
         VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(pid)
    .bind(req.part_id)
    .bind(req.quantity)
    .bind(req.remarks.as_deref())
    .bind(req.overage_type.as_deref().unwrap_or(""))
    .bind(req.overage.unwrap_or(0))
    .bind(req.lot_number.as_deref().unwrap_or(""))
    .execute(&pool)
    .await?;
    Ok((
        StatusCode::CREATED,
        Json(json!({"id": res.last_insert_id() as i32})),
    ))
}

// ---------------------------------------------------------------------------
//  PUT /api/projects/:pid/parts/:ppid  (update BOM line)
// ---------------------------------------------------------------------------

pub async fn update_part(
    State(pool): State<MySqlPool>,
    Path((pid, ppid)): Path<(i32, i32)>,
    Json(req): Json<ProjectPartWrite>,
) -> Result<Json<serde_json::Value>, AppError> {
    validate_bom_line(&req)?;
    let part_exists: Option<(i32,)> = sqlx::query_as("SELECT id FROM Part WHERE id = ?")
        .bind(req.part_id)
        .fetch_optional(&pool)
        .await?;
    if part_exists.is_none() {
        return Err(AppError::BadRequest("part_id does not refer to a known part"));
    }
    let res = sqlx::query(
        "UPDATE ProjectPart SET \
            part_id = ?, quantity = ?, remarks = ?, \
            overageType = ?, overage = ?, lotNumber = ? \
         WHERE id = ? AND project_id = ?",
    )
    .bind(req.part_id)
    .bind(req.quantity)
    .bind(req.remarks.as_deref())
    .bind(req.overage_type.as_deref().unwrap_or(""))
    .bind(req.overage.unwrap_or(0))
    .bind(req.lot_number.as_deref().unwrap_or(""))
    .bind(ppid)
    .bind(pid)
    .execute(&pool)
    .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::NotFound("project part"));
    }
    Ok(Json(json!({"id": ppid})))
}

// ---------------------------------------------------------------------------
//  DELETE /api/projects/:pid/parts/:ppid  (remove BOM line)
// ---------------------------------------------------------------------------

pub async fn remove_part(
    State(pool): State<MySqlPool>,
    Path((pid, ppid)): Path<(i32, i32)>,
) -> Result<StatusCode, AppError> {
    let res = sqlx::query(
        "DELETE FROM ProjectPart WHERE id = ? AND project_id = ?",
    )
    .bind(ppid)
    .bind(pid)
    .execute(&pool)
    .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::NotFound("project part"));
    }
    Ok(StatusCode::NO_CONTENT)
}

// ---------------------------------------------------------------------------
//  Slice 8b: Run a project (BOM ↦ stock removal)
// ---------------------------------------------------------------------------

/// Compute how many of `bom_quantity` per build, including overage. Per-
/// line math runs once; we then multiply by the run quantity at the end.
///
/// `overage_type` = "" or "absolute" → `overage` is added straight to the
/// per-build qty. "percent" → `overage` is scaled against `bom_quantity`
/// and rounded up. We `ceil` percent overage on the conservative-build
/// principle: if you ask for 10% spare you don't want the rounding to
/// give you fewer pieces than your fingers expect.
fn per_build_qty(bom_quantity: i32, overage: i32, overage_type: &str) -> i32 {
    if overage <= 0 {
        return bom_quantity;
    }
    match overage_type {
        "percent" => {
            // ceil(bom_quantity * overage / 100) without floats.
            let num = (bom_quantity as i64) * (overage as i64);
            let extra = (num + 99) / 100;
            bom_quantity + extra as i32
        }
        // "absolute" or "" — both mean per-piece additive.
        _ => bom_quantity + overage,
    }
}

#[derive(Debug, Deserialize)]
pub struct RunPreviewQuery {
    pub quantity: Option<i32>,
}

#[derive(Debug, Serialize, FromRow)]
pub struct RunPreviewLine {
    pub project_part_id: i32,
    pub part_id: Option<i32>,
    pub part_name: Option<String>,
    pub part_internal_part_number: Option<String>,
    pub current_stock: Option<i32>,
    pub bom_quantity: i32,
    pub overage: i32,
    pub overage_type: String,
    pub lot_number: String,
    /// Per-build qty including overage.
    pub per_build: i32,
    /// Total qty for the run (per_build × run_quantity).
    pub effective: i32,
    /// True if `effective > current_stock`. We warn-and-allow.
    pub shortfall: bool,
    /// Slice 11 follow-up: true if the BOM line's part is a meta-part.
    /// The run dialog uses this to switch to the per-allocation editor
    /// (a meta-line can't be deducted directly — it has no stock; the
    /// operator must allocate to specific real parts).
    pub is_meta: bool,
}

/// `GET /api/projects/{pid}/runs/preview?quantity=N`. Computes what the
/// run *would* deduct and where it'd come up short. Pure-read; doesn't
/// mutate anything.
pub async fn run_preview(
    State(pool): State<MySqlPool>,
    Path(pid): Path<i32>,
    Query(q): Query<RunPreviewQuery>,
) -> Result<Json<Vec<RunPreviewLine>>, AppError> {
    let qty = q.quantity.unwrap_or(1);
    if qty < 1 {
        return Err(AppError::BadRequest("quantity must be >= 1"));
    }
    let project_exists: Option<(i32,)> = sqlx::query_as("SELECT id FROM Project WHERE id = ?")
        .bind(pid)
        .fetch_optional(&pool)
        .await?;
    if project_exists.is_none() {
        return Err(AppError::NotFound("project"));
    }
    #[derive(FromRow)]
    struct Row {
        id: i32,
        part_id: Option<i32>,
        part_name: Option<String>,
        part_internal_part_number: Option<String>,
        current_stock: Option<i32>,
        bom_quantity: i32,
        overage: i32,
        overage_type: String,
        lot_number: String,
        is_meta: bool,
    }
    let rows: Vec<Row> = sqlx::query_as(
        "SELECT pp.id, pp.part_id, \
                p.name              AS part_name, \
                p.internalPartNumber AS part_internal_part_number, \
                p.stockLevel        AS current_stock, \
                pp.quantity         AS bom_quantity, \
                pp.overage, \
                pp.overageType      AS overage_type, \
                pp.lotNumber        AS lot_number, \
                COALESCE(p.metaPart, 0) AS is_meta \
         FROM ProjectPart pp \
         LEFT JOIN Part p ON p.id = pp.part_id \
         WHERE pp.project_id = ? \
         ORDER BY p.name, pp.id",
    )
    .bind(pid)
    .fetch_all(&pool)
    .await?;
    let lines: Vec<RunPreviewLine> = rows
        .into_iter()
        .map(|r| {
            let per_build = per_build_qty(r.bom_quantity, r.overage, &r.overage_type);
            let effective = per_build.saturating_mul(qty);
            let shortfall = match r.current_stock {
                Some(cs) => effective > cs,
                None => true,
            };
            RunPreviewLine {
                project_part_id: r.id,
                part_id: r.part_id,
                part_name: r.part_name,
                part_internal_part_number: r.part_internal_part_number,
                current_stock: r.current_stock,
                bom_quantity: r.bom_quantity,
                overage: r.overage,
                overage_type: r.overage_type,
                lot_number: r.lot_number,
                per_build,
                effective,
                shortfall,
                is_meta: r.is_meta,
            }
        })
        .collect();
    Ok(Json(lines))
}

#[derive(Debug, Deserialize)]
pub struct RunRequest {
    pub quantity: i32,
    #[serde(default)]
    pub comment: Option<String>,
    /// Optional per-line lot-number overrides (project_part_id → lot).
    /// When unset for a given line, we carry the BOM line's stored
    /// `lotNumber`. Saved on the resulting `ProjectRunPart` rows.
    /// Only applies to lines that don't have an explicit allocation
    /// list — when allocations are provided, each allocation carries
    /// its own lot.
    #[serde(default)]
    pub lot_overrides: HashMap<i32, String>,
    /// Slice 11 follow-up: per-line allocation maps (project_part_id →
    /// list of `RunAllocation`). When provided for a line, the run
    /// produces one `ProjectRunPart` + one negative `StockEntry` per
    /// allocation entry, against the allocation's `real_part_id`.
    /// When absent for a line, the existing 1:1 fallback applies (use
    /// the BOM's part_id at full effective qty). Meta-part BOM lines
    /// **must** carry an allocation; runs reject if any meta-line is
    /// unresolved.
    #[serde(default)]
    pub allocations: HashMap<i32, Vec<RunAllocation>>,
}

#[derive(Debug, Deserialize)]
pub struct RunAllocation {
    pub real_part_id: i32,
    pub quantity: i32,
    #[serde(default)]
    pub lot_number: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct RunResultLine {
    pub project_part_id: i32,
    pub part_id: i32,
    pub part_name: Option<String>,
    pub deducted: i32,
    pub current_stock_after: i32,
    pub low_stock_after: bool,
    pub lot_number: String,
}

#[derive(Debug, Serialize)]
pub struct RunResult {
    pub run_id: i32,
    pub run_date_time: NaiveDateTime,
    pub quantity: i32,
    pub lines: Vec<RunResultLine>,
}

/// `POST /api/projects/{pid}/runs`. Inserts a `ProjectRun`, then for each
/// BOM line: insert `ProjectRunPart` and apply a negative `StockEntry`
/// via the shared `stock::apply_stock_change_in_tx` helper. All in one
/// transaction; if any line errors (FK, validation), the whole run rolls
/// back.
pub async fn run_project(
    State(pool): State<MySqlPool>,
    axum::Extension(user): axum::Extension<CurrentUser>,
    Path(pid): Path<i32>,
    Json(req): Json<RunRequest>,
) -> Result<impl IntoResponse, AppError> {
    if req.quantity < 1 {
        return Err(AppError::BadRequest("quantity must be >= 1"));
    }

    let mut tx = pool.begin().await?;

    let project_exists: Option<(i32, String)> = sqlx::query_as(
        "SELECT id, name FROM Project WHERE id = ?",
    )
    .bind(pid)
    .fetch_optional(&mut *tx)
    .await?;
    let (_, project_name) = project_exists.ok_or(AppError::NotFound("project"))?;

    #[derive(FromRow)]
    struct Bom {
        id: i32,
        part_id: Option<i32>,
        part_name: Option<String>,
        bom_quantity: i32,
        overage: i32,
        overage_type: String,
        lot_number: String,
        is_meta: bool,
    }
    let bom: Vec<Bom> = sqlx::query_as(
        "SELECT pp.id, pp.part_id, p.name AS part_name, \
                pp.quantity AS bom_quantity, pp.overage, \
                pp.overageType AS overage_type, pp.lotNumber AS lot_number, \
                COALESCE(p.metaPart, 0) AS is_meta \
         FROM ProjectPart pp \
         LEFT JOIN Part p ON p.id = pp.part_id \
         WHERE pp.project_id = ?",
    )
    .bind(pid)
    .fetch_all(&mut *tx)
    .await?;
    if bom.is_empty() {
        return Err(AppError::BadRequest(
            "project has no BOM lines — add parts before running",
        ));
    }
    // Hard-fail: any orphaned BOM line (part_id=NULL on the row, e.g.
    // because the referenced Part was deleted out from under us) makes
    // the run undefined. Refuse rather than invent stock movements.
    if bom.iter().any(|b| b.part_id.is_none()) {
        return Err(AppError::BadRequest(
            "project BOM contains orphaned lines (referenced part missing) — fix the BOM first",
        ));
    }
    // Pre-flight: every meta-part BOM line must carry an `allocations`
    // entry — meta-parts have no stock of their own, so the run can't
    // proceed unresolved. Real-part lines may omit the allocation and
    // fall back to the BOM's part_id at full effective qty (back-compat
    // with the simple flow from slice 8b).
    for line in &bom {
        if line.is_meta {
            let resolved = req.allocations.get(&line.id)
                .map(|v| !v.is_empty())
                .unwrap_or(false);
            if !resolved {
                return Err(AppError::BadRequest(leak(format!(
                    "BOM line {} references a meta-part; provide \
                     `allocations[{}]` with one or more real parts to run.",
                    line.part_name.clone().unwrap_or_else(|| format!("#{}", line.id)),
                    line.id,
                ))));
            }
        }
    }

    let now = Utc::now().naive_utc();
    let run_id = sqlx::query(
        "INSERT INTO ProjectRun (project_id, runDateTime, quantity) VALUES (?, ?, ?)",
    )
    .bind(pid)
    .bind(now)
    .bind(req.quantity)
    .execute(&mut *tx)
    .await?
    .last_insert_id() as i32;

    let comment_base = match req.comment.as_deref() {
        Some(c) if !c.trim().is_empty() => format!(
            "Project run #{run_id} — {project_name} (×{}): {c}",
            req.quantity,
        ),
        _ => format!("Project run #{run_id} — {project_name} (×{})", req.quantity),
    };

    let mut result_lines = Vec::with_capacity(bom.len());

    for line in &bom {
        let per_build = per_build_qty(line.bom_quantity, line.overage, &line.overage_type);
        let effective = per_build.saturating_mul(req.quantity);
        let bom_part_id = line.part_id.unwrap(); // existence checked above

        // Determine the consumption plan. Two paths:
        //  1. Explicit allocations: caller specified one or more real
        //     parts to draw from for this line. Use them as-is.
        //  2. Implicit (no allocations): real-part line draws from its
        //     own part_id at full effective qty. (Meta-part lines with
        //     no allocations were already rejected above.)
        let consumptions: Vec<(i32, i32, String)> = match req.allocations.get(&line.id) {
            Some(allocs) if !allocs.is_empty() => allocs
                .iter()
                .map(|a| {
                    let lot = a.lot_number.clone().unwrap_or_else(|| line.lot_number.clone());
                    (a.real_part_id, a.quantity, lot)
                })
                .collect(),
            _ => {
                let lot = req
                    .lot_overrides
                    .get(&line.id)
                    .cloned()
                    .unwrap_or_else(|| line.lot_number.clone());
                vec![(bom_part_id, effective, lot)]
            }
        };

        for (part_id, qty, lot) in consumptions {
            if qty <= 0 {
                continue; // skip zero-qty allocations rather than producing a no-op row
            }
            // ProjectRunPart row first — small enough that ordering
            // doesn't matter, but keeping the run-history insert before
            // the stock mutation makes the audit trail order match the
            // operator's mental model.
            sqlx::query(
                "INSERT INTO ProjectRunPart \
                    (projectRun_id, part_id, quantity, lotNumber) \
                 VALUES (?, ?, ?, ?)",
            )
            .bind(run_id)
            .bind(part_id)
            .bind(qty)
            .bind(&lot)
            .execute(&mut *tx)
            .await?;

            let (current_stock_after, low_stock_after) = stock::apply_stock_change_in_tx(
                &mut tx,
                part_id,
                -qty,
                None,
                Some(&comment_base),
                false,
                user.user_id,
                stock::OrderAttribution::default(),
                None, // BOM consume doesn't yet pick a PSL row (slice-13c follow-on)
            )
            .await
            .map_err(|e| match e {
                // Friendlier error when an allocation references a
                // non-existent real_part_id — caller passed a bad id.
                AppError::NotFound("part") => AppError::BadRequest(leak(format!(
                    "BOM line {}: allocation references non-existent part id {}",
                    line.part_name.clone().unwrap_or_else(|| format!("#{}", line.id)),
                    part_id,
                ))),
                other => other,
            })?;

            // Look up the real part's name for the result row when it
            // differs from the BOM line's name (meta-resolution case).
            let part_name = if part_id == bom_part_id {
                line.part_name.clone()
            } else {
                let row: Option<(String,)> = sqlx::query_as(
                    "SELECT name FROM Part WHERE id = ?",
                )
                .bind(part_id)
                .fetch_optional(&mut *tx)
                .await?;
                row.map(|(n,)| n)
            };

            result_lines.push(RunResultLine {
                project_part_id: line.id,
                part_id,
                part_name,
                deducted: qty,
                current_stock_after,
                low_stock_after,
                lot_number: lot,
            });
        }
    }

    tx.commit().await?;
    Ok((
        StatusCode::CREATED,
        Json(RunResult {
            run_id,
            run_date_time: now,
            quantity: req.quantity,
            lines: result_lines,
        }),
    ))
}

// ---------------------------------------------------------------------------
//  Slice 8b: Run history listing
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, FromRow)]
pub struct RunHistoryHeader {
    pub id: i32,
    pub run_date_time: Option<NaiveDateTime>,
    pub quantity: i32,
}

#[derive(Debug, Serialize, FromRow)]
pub struct RunHistoryLine {
    pub id: i32,
    pub run_id: i32,
    pub part_id: Option<i32>,
    pub part_name: Option<String>,
    pub quantity: i32,
    pub lot_number: String,
}

#[derive(Debug, Serialize)]
pub struct RunHistory {
    pub run: RunHistoryHeader,
    pub lines: Vec<RunHistoryLine>,
}

#[derive(Debug, Deserialize)]
pub struct DeleteRunQuery {
    /// When true, insert compensating positive `StockEntry` rows for
    /// every line of the run and re-run the per-part recompute. Off by
    /// default so the audit trail stays honest unless the operator
    /// explicitly asks to undo the stock effect.
    #[serde(default)]
    pub restore_stock: bool,
}

/// `DELETE /api/projects/{pid}/runs/{rid}` — admin escape hatch to remove
/// a single run record (and optionally undo its stock impact). Runs are
/// normally append-only; this exists for fixing mistakes and cleaning
/// up test/staging projects.
pub async fn delete_run(
    State(pool): State<MySqlPool>,
    axum::Extension(user): axum::Extension<CurrentUser>,
    Path((pid, rid)): Path<(i32, i32)>,
    Query(q): Query<DeleteRunQuery>,
) -> Result<StatusCode, AppError> {
    let mut tx = pool.begin().await?;

    let exists: Option<(i32,)> = sqlx::query_as(
        "SELECT id FROM ProjectRun WHERE id = ? AND project_id = ?",
    )
    .bind(rid)
    .bind(pid)
    .fetch_optional(&mut *tx)
    .await?;
    if exists.is_none() {
        return Err(AppError::NotFound("project run"));
    }

    if q.restore_stock {
        let lines: Vec<(Option<i32>, i32)> = sqlx::query_as(
            "SELECT part_id, quantity FROM ProjectRunPart WHERE projectRun_id = ?",
        )
        .bind(rid)
        .fetch_all(&mut *tx)
        .await?;
        let comment = format!("Reversed: project run #{rid}");
        for (part_id, qty) in lines {
            // ProjectRunPart.part_id can technically be NULL if the
            // referenced part was deleted; if so, there's nothing to
            // restore on the stock side. Skip and continue.
            if let Some(pid_v) = part_id {
                if qty != 0 {
                    stock::apply_stock_change_in_tx(
                        &mut tx,
                        pid_v,
                        qty,
                        None,
                        Some(&comment),
                        false,
                        user.user_id,
                        stock::OrderAttribution::default(),
                        None, // run-deletion restore doesn't re-target a specific PSL row
                    )
                    .await?;
                }
            }
        }
    }

    sqlx::query("DELETE FROM ProjectRunPart WHERE projectRun_id = ?")
        .bind(rid)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM ProjectRun WHERE id = ?")
        .bind(rid)
        .execute(&mut *tx)
        .await?;

    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

// ---------------------------------------------------------------------------
//  Slice 8c: cross-cutting run views
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, FromRow)]
pub struct PartProjectRef {
    pub project_id: i32,
    pub project_name: String,
    pub line_id: i32,
    pub quantity: i32,
    pub overage: i32,
    pub overage_type: String,
    pub remarks: Option<String>,
}

/// `GET /api/parts/{id}/projects` — every BOM line that references this
/// part, with its parent project. Lets the part-detail panel surface
/// "this part is used in N projects" without a join through every
/// project's expanded detail.
pub async fn part_projects(
    State(pool): State<MySqlPool>,
    Path(part_id): Path<i32>,
) -> Result<Json<Vec<PartProjectRef>>, AppError> {
    let rows: Vec<PartProjectRef> = sqlx::query_as(
        "SELECT pr.id            AS project_id, \
                pr.name          AS project_name, \
                pp.id            AS line_id, \
                pp.quantity, \
                pp.overage, \
                pp.overageType   AS overage_type, \
                pp.remarks \
         FROM ProjectPart pp \
         JOIN Project pr ON pr.id = pp.project_id \
         WHERE pp.part_id = ? \
         ORDER BY pr.name, pp.id",
    )
    .bind(part_id)
    .fetch_all(&pool)
    .await?;
    Ok(Json(rows))
}

#[derive(Debug, Serialize, FromRow)]
pub struct PartRunRef {
    pub run_id: i32,
    pub project_id: i32,
    pub project_name: String,
    pub run_date_time: Option<NaiveDateTime>,
    pub run_quantity: i32,
    pub deducted_quantity: i32,
    pub lot_number: String,
}

#[derive(Debug, Deserialize)]
pub struct PartRunsQuery {
    #[serde(default)]
    pub limit: Option<u32>,
    #[serde(default)]
    pub offset: Option<u32>,
}

/// `GET /api/parts/{id}/runs?limit=&offset=` — project runs that have
/// deducted this part, newest first. Used by part detail to show "where
/// did this stock go".
pub async fn part_runs(
    State(pool): State<MySqlPool>,
    Path(part_id): Path<i32>,
    Query(q): Query<PartRunsQuery>,
) -> Result<Json<Vec<PartRunRef>>, AppError> {
    let limit = q.limit.unwrap_or(20).clamp(1, 200) as i64;
    let offset = q.offset.unwrap_or(0) as i64;
    let rows: Vec<PartRunRef> = sqlx::query_as(
        "SELECT prp.projectRun_id AS run_id, \
                prj.id            AS project_id, \
                prj.name          AS project_name, \
                pr.runDateTime    AS run_date_time, \
                pr.quantity       AS run_quantity, \
                prp.quantity      AS deducted_quantity, \
                prp.lotNumber     AS lot_number \
         FROM ProjectRunPart prp \
         JOIN ProjectRun pr ON pr.id = prp.projectRun_id \
         JOIN Project prj   ON prj.id = pr.project_id \
         WHERE prp.part_id = ? \
         ORDER BY pr.runDateTime DESC, prp.id DESC \
         LIMIT ? OFFSET ?",
    )
    .bind(part_id)
    .bind(limit)
    .bind(offset)
    .fetch_all(&pool)
    .await?;
    Ok(Json(rows))
}

#[derive(Debug, Serialize, FromRow)]
pub struct AllRunsRow {
    pub run_id: i32,
    pub project_id: i32,
    pub project_name: String,
    pub run_date_time: Option<NaiveDateTime>,
    pub quantity: i32,
    pub line_count: i64,
}

#[derive(Debug, Serialize)]
pub struct AllRunsResponse {
    pub items: Vec<AllRunsRow>,
    pub total: i64,
    pub limit: u32,
    pub offset: u32,
}

#[derive(Debug, Deserialize)]
pub struct AllRunsQuery {
    #[serde(default)]
    pub limit: Option<u32>,
    #[serde(default)]
    pub offset: Option<u32>,
}

/// `GET /api/project_runs?limit=&offset=` — every run across every
/// project, newest-first. Powers the "all runs" empty-state view in
/// Projects mode.
pub async fn all_runs(
    State(pool): State<MySqlPool>,
    Query(q): Query<AllRunsQuery>,
) -> Result<Json<AllRunsResponse>, AppError> {
    let limit = q.limit.unwrap_or(50).clamp(1, 500);
    let offset = q.offset.unwrap_or(0);
    let (total,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM ProjectRun")
        .fetch_one(&pool)
        .await?;
    let items: Vec<AllRunsRow> = sqlx::query_as(
        "SELECT pr.id           AS run_id, \
                prj.id          AS project_id, \
                prj.name        AS project_name, \
                pr.runDateTime  AS run_date_time, \
                pr.quantity, \
                COALESCE(lc.cnt, 0) AS line_count \
         FROM ProjectRun pr \
         JOIN Project prj ON prj.id = pr.project_id \
         LEFT JOIN (SELECT projectRun_id, COUNT(*) AS cnt \
                    FROM ProjectRunPart GROUP BY projectRun_id) lc \
                ON lc.projectRun_id = pr.id \
         ORDER BY pr.runDateTime DESC, pr.id DESC \
         LIMIT ? OFFSET ?",
    )
    .bind(limit as i64)
    .bind(offset as i64)
    .fetch_all(&pool)
    .await?;
    Ok(Json(AllRunsResponse {
        items,
        total,
        limit,
        offset,
    }))
}

/// `GET /api/projects/{pid}/runs` — full per-run history with lines
/// embedded. Project runs are append-only and the per-project volume is
/// expected to stay in the dozens; no pagination yet.
pub async fn list_runs(
    State(pool): State<MySqlPool>,
    Path(pid): Path<i32>,
) -> Result<Json<Vec<RunHistory>>, AppError> {
    let project_exists: Option<(i32,)> = sqlx::query_as("SELECT id FROM Project WHERE id = ?")
        .bind(pid)
        .fetch_optional(&pool)
        .await?;
    if project_exists.is_none() {
        return Err(AppError::NotFound("project"));
    }
    let runs: Vec<RunHistoryHeader> = sqlx::query_as(
        "SELECT id, runDateTime AS run_date_time, quantity \
         FROM ProjectRun WHERE project_id = ? ORDER BY runDateTime DESC, id DESC",
    )
    .bind(pid)
    .fetch_all(&pool)
    .await?;
    if runs.is_empty() {
        return Ok(Json(Vec::new()));
    }
    let run_ids: Vec<i32> = runs.iter().map(|r| r.id).collect();
    // Build the IN(?,?,?...) clause: sqlx-mysql doesn't bind arrays.
    let placeholders = vec!["?"; run_ids.len()].join(",");
    let sql = format!(
        "SELECT prp.id, prp.projectRun_id AS run_id, prp.part_id, \
                p.name AS part_name, prp.quantity, prp.lotNumber AS lot_number \
         FROM ProjectRunPart prp \
         LEFT JOIN Part p ON p.id = prp.part_id \
         WHERE prp.projectRun_id IN ({placeholders}) \
         ORDER BY p.name, prp.id"
    );
    let mut q = sqlx::query_as::<_, RunHistoryLine>(&sql);
    for id in &run_ids {
        q = q.bind(*id);
    }
    let all_lines: Vec<RunHistoryLine> = q.fetch_all(&pool).await?;

    // Group lines by run_id (preserving ORDER BY p.name within each).
    let mut by_run: HashMap<i32, Vec<RunHistoryLine>> = HashMap::new();
    for ln in all_lines {
        by_run.entry(ln.run_id).or_default().push(ln);
    }
    let history = runs
        .into_iter()
        .map(|r| {
            let lines = by_run.remove(&r.id).unwrap_or_default();
            RunHistory { run: r, lines }
        })
        .collect();
    Ok(Json(history))
}
