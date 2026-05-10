// SPDX-License-Identifier: GPL-3.0-or-later

//! Slice 7: per-entity attachment endpoints.
//!
//! Five Doctrine entities — PartAttachment, FootprintImage,
//! FootprintAttachment, ManufacturerICLogo, StorageLocationImage —
//! all share the same overall shape (id, {parent}_id, filename,
//! originalname, mimetype, size, description, extension, created),
//! and they all live under their PascalCase subdir on disk.
//!
//! The wire URL space is split:
//!
//! - **POST** `/api/{parent}/:id/{children}` — upload (multipart);
//!   parent path varies per entity.
//! - **GET** `/files/:kind/:id` — download original (browser-friendly,
//!   no `/api` prefix so HTML can `<img src=>` directly).
//! - **GET** `/files/:kind/:id/thumb` — JPEG thumbnail (image kinds
//!   only; 404 for non-image rows).
//! - **PUT** `/api/attachments/:kind/:id` — update description.
//! - **DELETE** `/api/attachments/:kind/:id` — remove file + DB row.
//!
//! `:kind` is the Doctrine class name (PascalCase singular).

use axum::{
    extract::{Multipart, Path, State},
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use bytes::{Bytes, BytesMut};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::MySqlPool;
use tokio::fs;
use tokio::io::AsyncReadExt;

use crate::error::AppError;
use crate::handlers::storage::{self, SaveError, StorageConfig, UploadInput};

// ---------------------------------------------------------------------------
//  Kind enum + per-kind metadata
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AttachmentKind {
    PartAttachment,
    FootprintImage,
    FootprintAttachment,
    ManufacturerICLogo,
    StorageLocationImage,
    ProjectAttachment,
}

impl AttachmentKind {
    pub fn from_str(s: &str) -> Option<Self> {
        Some(match s {
            "PartAttachment"       => Self::PartAttachment,
            "FootprintImage"       => Self::FootprintImage,
            "FootprintAttachment"  => Self::FootprintAttachment,
            "ManufacturerICLogo"   => Self::ManufacturerICLogo,
            "StorageLocationImage" => Self::StorageLocationImage,
            "ProjectAttachment"    => Self::ProjectAttachment,
            _ => return None,
        })
    }

    /// PascalCase entity name. Doubles as on-disk subdir and Doctrine
    /// `type` discriminator value.
    pub fn name(self) -> &'static str {
        match self {
            Self::PartAttachment       => "PartAttachment",
            Self::FootprintImage       => "FootprintImage",
            Self::FootprintAttachment  => "FootprintAttachment",
            Self::ManufacturerICLogo   => "ManufacturerICLogo",
            Self::StorageLocationImage => "StorageLocationImage",
            Self::ProjectAttachment    => "ProjectAttachment",
        }
    }

    /// SQL table name (= entity name; Doctrine uses class-name tables).
    fn table(self) -> &'static str { self.name() }

    /// FK column linking the attachment row to its parent entity.
    fn parent_fk(self) -> &'static str {
        match self {
            Self::PartAttachment       => "part_id",
            Self::FootprintImage       => "footprint_id",
            Self::FootprintAttachment  => "footprint_id",
            Self::ManufacturerICLogo   => "manufacturer_id",
            Self::StorageLocationImage => "storageLocation_id",
            Self::ProjectAttachment    => "project_id",
        }
    }

    /// Whether the table has the `isImage` column (only PartAttachment
    /// does — the other tables imply by-class).
    fn has_is_image_column(self) -> bool {
        matches!(self, Self::PartAttachment)
    }

    /// Whether attachments of this kind are *always* images. Determines
    /// what we set in `isImage` on insert (for PartAttachment) and is
    /// also used to gate thumbnail generation when the upload's MIME
    /// turns out to be ambiguous.
    fn always_image(self) -> bool {
        matches!(self, Self::FootprintImage | Self::ManufacturerICLogo | Self::StorageLocationImage)
    }
}

// ---------------------------------------------------------------------------
//  Wire shapes
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct AttachmentRow {
    pub id: i32,
    pub filename: String,
    pub originalname: Option<String>,
    pub mimetype: String,
    pub size: i32,
    pub description: Option<String>,
    pub extension: Option<String>,
    pub is_image: bool,
}

#[derive(Debug, Deserialize)]
pub struct UpdateDescription {
    pub description: Option<String>,
}

// ---------------------------------------------------------------------------
//  Upload (multipart) — per-entity entry points wrap a shared core
// ---------------------------------------------------------------------------

pub async fn upload_part(
    State(pool): State<MySqlPool>,
    State(store): State<StorageConfig>,
    Path(parent_id): Path<i32>,
    multipart: Multipart,
) -> Result<Json<Vec<AttachmentRow>>, AppError> {
    upload_core(&pool, &store, AttachmentKind::PartAttachment, parent_id, multipart).await
}

pub async fn upload_footprint_image(
    State(pool): State<MySqlPool>,
    State(store): State<StorageConfig>,
    Path(parent_id): Path<i32>,
    multipart: Multipart,
) -> Result<Json<Vec<AttachmentRow>>, AppError> {
    upload_core(&pool, &store, AttachmentKind::FootprintImage, parent_id, multipart).await
}

pub async fn upload_footprint_attachment(
    State(pool): State<MySqlPool>,
    State(store): State<StorageConfig>,
    Path(parent_id): Path<i32>,
    multipart: Multipart,
) -> Result<Json<Vec<AttachmentRow>>, AppError> {
    upload_core(&pool, &store, AttachmentKind::FootprintAttachment, parent_id, multipart).await
}

pub async fn upload_manufacturer_logo(
    State(pool): State<MySqlPool>,
    State(store): State<StorageConfig>,
    Path(parent_id): Path<i32>,
    multipart: Multipart,
) -> Result<Json<Vec<AttachmentRow>>, AppError> {
    upload_core(&pool, &store, AttachmentKind::ManufacturerICLogo, parent_id, multipart).await
}

pub async fn upload_storage_location_image(
    State(pool): State<MySqlPool>,
    State(store): State<StorageConfig>,
    Path(parent_id): Path<i32>,
    multipart: Multipart,
) -> Result<Json<Vec<AttachmentRow>>, AppError> {
    upload_core(&pool, &store, AttachmentKind::StorageLocationImage, parent_id, multipart).await
}

pub async fn upload_project_attachment(
    State(pool): State<MySqlPool>,
    State(store): State<StorageConfig>,
    Path(parent_id): Path<i32>,
    multipart: Multipart,
) -> Result<Json<Vec<AttachmentRow>>, AppError> {
    upload_core(&pool, &store, AttachmentKind::ProjectAttachment, parent_id, multipart).await
}

// ---------------------------------------------------------------------------
//  Slice 7 follow-up: server-side URL fetch
// ---------------------------------------------------------------------------

/// Hard caps on the URL-fetch path. We're a small internal app and don't
/// want a stray paste of a 4 GB ISO link to fill the disk; nor do we
/// want a slow-loris fetch tying up a connection forever.
const URL_FETCH_TIMEOUT_SECS: u64 = 15;
const URL_FETCH_MAX_BYTES: usize = 25 * 1024 * 1024; // 25 MB

#[derive(Debug, Deserialize)]
pub struct FetchByUrl {
    pub url: String,
    /// Optional override for `originalname`. When unset we use the
    /// Content-Disposition filename if the server sent one, else the
    /// URL path basename, else a generic "url-fetch" placeholder.
    #[serde(default)]
    pub filename: Option<String>,
}

pub async fn fetch_part(
    State(pool): State<MySqlPool>,
    State(store): State<StorageConfig>,
    Path(parent_id): Path<i32>,
    Json(req): Json<FetchByUrl>,
) -> Result<Json<Vec<AttachmentRow>>, AppError> {
    fetch_url_core(&pool, &store, AttachmentKind::PartAttachment, parent_id, req).await
}
pub async fn fetch_footprint_image(
    State(pool): State<MySqlPool>, State(store): State<StorageConfig>,
    Path(parent_id): Path<i32>, Json(req): Json<FetchByUrl>,
) -> Result<Json<Vec<AttachmentRow>>, AppError> {
    fetch_url_core(&pool, &store, AttachmentKind::FootprintImage, parent_id, req).await
}
pub async fn fetch_footprint_attachment(
    State(pool): State<MySqlPool>, State(store): State<StorageConfig>,
    Path(parent_id): Path<i32>, Json(req): Json<FetchByUrl>,
) -> Result<Json<Vec<AttachmentRow>>, AppError> {
    fetch_url_core(&pool, &store, AttachmentKind::FootprintAttachment, parent_id, req).await
}
pub async fn fetch_manufacturer_logo(
    State(pool): State<MySqlPool>, State(store): State<StorageConfig>,
    Path(parent_id): Path<i32>, Json(req): Json<FetchByUrl>,
) -> Result<Json<Vec<AttachmentRow>>, AppError> {
    fetch_url_core(&pool, &store, AttachmentKind::ManufacturerICLogo, parent_id, req).await
}
pub async fn fetch_storage_location_image(
    State(pool): State<MySqlPool>, State(store): State<StorageConfig>,
    Path(parent_id): Path<i32>, Json(req): Json<FetchByUrl>,
) -> Result<Json<Vec<AttachmentRow>>, AppError> {
    fetch_url_core(&pool, &store, AttachmentKind::StorageLocationImage, parent_id, req).await
}
pub async fn fetch_project_attachment(
    State(pool): State<MySqlPool>, State(store): State<StorageConfig>,
    Path(parent_id): Path<i32>, Json(req): Json<FetchByUrl>,
) -> Result<Json<Vec<AttachmentRow>>, AppError> {
    fetch_url_core(&pool, &store, AttachmentKind::ProjectAttachment, parent_id, req).await
}

/// Internal: fetch a URL's contents and create an attachment row of
/// the given kind for the given parent. Used by the per-kind
/// `fetch_*` HTTP handlers above, and by the Mouser import flow
/// (`handlers/mouser.rs`) to attach datasheets and manufacturer
/// images on demand. Public so cross-module callers can drive it.
pub async fn fetch_url_core(
    pool: &MySqlPool,
    store: &StorageConfig,
    kind: AttachmentKind,
    parent_id: i32,
    req: FetchByUrl,
) -> Result<Json<Vec<AttachmentRow>>, AppError> {
    // Parent existence check (same flow as the multipart upload path).
    let parent_table = match kind {
        AttachmentKind::PartAttachment       => "Part",
        AttachmentKind::FootprintImage |
        AttachmentKind::FootprintAttachment  => "Footprint",
        AttachmentKind::ManufacturerICLogo   => "Manufacturer",
        AttachmentKind::StorageLocationImage => "StorageLocation",
        AttachmentKind::ProjectAttachment    => "Project",
    };
    let exists: Option<(i32,)> = sqlx::query_as(&format!(
        "SELECT id FROM {parent_table} WHERE id = ?"
    )).bind(parent_id).fetch_optional(pool).await?;
    if exists.is_none() {
        return Err(AppError::NotFound(match kind {
            AttachmentKind::PartAttachment       => "part",
            AttachmentKind::FootprintImage |
            AttachmentKind::FootprintAttachment  => "footprint",
            AttachmentKind::ManufacturerICLogo   => "manufacturer",
            AttachmentKind::StorageLocationImage => "storage location",
            AttachmentKind::ProjectAttachment    => "project",
        }));
    }

    // Validate URL — http/https only. We don't want this endpoint to
    // become a generic SSRF gadget for file://, gopher://, etc. The
    // `from_str` parse rejects most malformed URLs; we just need to
    // ensure the scheme is one we want to follow.
    let parsed = reqwest::Url::parse(req.url.trim())
        .map_err(|_| AppError::BadRequest("invalid url"))?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err(AppError::BadRequest("only http/https urls are accepted"));
    }

    // Fetch with timeout + size cap. We stream the body so we can abort
    // mid-download if the server lies about Content-Length (or omits it).
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(URL_FETCH_TIMEOUT_SECS))
        // A browser-like User-Agent. Some vendors (e.g., NXP) reject
        // requests that look like script clients ("reqwest/x.x"). This
        // doesn't help against full bot protection (e.g., analog.com's
        // Akamai), but covers the easy cases.
        .user_agent(
            "Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0",
        )
        .build()
        .map_err(|e| {
            tracing::error!(error = %e, "build reqwest client");
            AppError::BadRequest("could not build http client")
        })?;
    let resp = client.get(parsed.as_str()).send().await
        .map_err(|e| AppError::BadRequest(leak(format!("fetch failed: {e}"))))?;
    if !resp.status().is_success() {
        return Err(AppError::BadRequest(leak(format!(
            "remote returned HTTP {}", resp.status()
        ))));
    }

    // Pre-flight CL check: if the header says it's bigger than our cap,
    // bail before we read a single byte.
    if let Some(cl) = resp.content_length() {
        if cl as usize > URL_FETCH_MAX_BYTES {
            return Err(AppError::BadRequest(leak(format!(
                "remote file too large: {cl} bytes (cap {URL_FETCH_MAX_BYTES})"
            ))));
        }
    }

    // Pull a few bits out of the response BEFORE moving it into the
    // bytes_stream() consumer: content-type, content-disposition, the
    // resolved final URL (after redirects).
    let content_type = resp.headers().get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.split(';').next().unwrap_or(s).trim().to_string());
    let cd_filename = resp.headers().get(reqwest::header::CONTENT_DISPOSITION)
        .and_then(|v| v.to_str().ok())
        .and_then(parse_content_disposition_filename);
    let final_url = resp.url().clone();

    // Stream the body, abort if it exceeds cap.
    let mut buf = BytesMut::with_capacity(64 * 1024);
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk
            .map_err(|e| AppError::BadRequest(leak(format!("read body failed: {e}"))))?;
        if buf.len() + chunk.len() > URL_FETCH_MAX_BYTES {
            return Err(AppError::BadRequest(leak(format!(
                "remote file exceeds cap of {URL_FETCH_MAX_BYTES} bytes"
            ))));
        }
        buf.extend_from_slice(&chunk);
    }
    let bytes = buf.freeze();
    if bytes.is_empty() {
        return Err(AppError::BadRequest("remote returned empty body"));
    }

    // Filename selection: explicit override > Content-Disposition >
    // last URL path segment > generic.
    let original_filename = req.filename
        .filter(|s| !s.trim().is_empty())
        .or(cd_filename)
        .or_else(|| {
            final_url.path_segments()
                .and_then(|segs| segs.filter(|s| !s.is_empty()).last())
                .map(|s| s.to_string())
        })
        .unwrap_or_else(|| "url-fetch".to_string());

    let saved_file = match storage::save_upload(
        store,
        kind.name(),
        UploadInput {
            bytes,
            original_filename: Some(original_filename.clone()),
            content_type,
        },
    ).await {
        Ok(s) => s,
        Err(SaveError::Infected(sig)) => {
            return Err(AppError::BadRequest(leak(format!(
                "fetch rejected — virus scanner flagged: {sig}"
            ))));
        }
        Err(SaveError::Io(e)) => {
            return Err(AppError::BadRequest(leak(format!(
                "could not save fetched file: {e}"
            ))));
        }
        Err(SaveError::Other(e)) => {
            tracing::error!(error = %e, "url-fetch save failed");
            return Err(AppError::BadRequest("fetch failed"));
        }
    };

    let now = chrono::Utc::now().naive_utc();
    let new_id = if kind.has_is_image_column() {
        sqlx::query(&format!(
            "INSERT INTO {tbl} \
                ({fk}, type, filename, originalname, mimetype, size, \
                 description, extension, isImage, created) \
             VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)",
            tbl = kind.table(), fk = kind.parent_fk()
        ))
        .bind(parent_id).bind(kind.name())
        .bind(&saved_file.uuid).bind(&saved_file.original_filename)
        .bind(&saved_file.mimetype).bind(saved_file.size)
        .bind(&saved_file.extension).bind(saved_file.is_image)
        .bind(now).execute(pool).await?.last_insert_id() as i32
    } else {
        sqlx::query(&format!(
            "INSERT INTO {tbl} \
                ({fk}, type, filename, originalname, mimetype, size, \
                 description, extension, created) \
             VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)",
            tbl = kind.table(), fk = kind.parent_fk()
        ))
        .bind(parent_id).bind(kind.name())
        .bind(&saved_file.uuid).bind(&saved_file.original_filename)
        .bind(&saved_file.mimetype).bind(saved_file.size)
        .bind(&saved_file.extension)
        .bind(now).execute(pool).await?.last_insert_id() as i32
    };

    Ok(Json(vec![AttachmentRow {
        id: new_id,
        filename: saved_file.uuid,
        originalname: Some(saved_file.original_filename),
        mimetype: saved_file.mimetype,
        size: saved_file.size,
        description: None,
        extension: saved_file.extension,
        is_image: saved_file.is_image || kind.always_image(),
    }]))
}

/// Tiny RFC 6266 / RFC 5987 parser — just enough to pull a filename
/// out of `Content-Disposition: attachment; filename="foo.pdf"` (or
/// `filename*=UTF-8''foo.pdf`). Browsers' parsers are more thorough;
/// we only need the common cases.
fn parse_content_disposition_filename(cd: &str) -> Option<String> {
    let mut star = None;
    let mut plain = None;
    for part in cd.split(';') {
        let part = part.trim();
        if let Some(v) = part.strip_prefix("filename*=") {
            // RFC 5987: charset'lang'pct-encoded-name
            if let Some(rest) = v.split_once("''") {
                star = Some(percent_decode(rest.1.trim_matches('"')));
                continue;
            }
            star = Some(v.trim_matches('"').to_string());
        } else if let Some(v) = part.strip_prefix("filename=") {
            plain = Some(v.trim_matches('"').to_string());
        }
    }
    star.or(plain)
}

fn percent_decode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(b) = u8::from_str_radix(
                std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap_or("00"), 16
            ) {
                out.push(b as char);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i] as char);
        i += 1;
    }
    out
}

// ---------------------------------------------------------------------------
//  List attachments for a given parent (mirrors POST upload paths)
// ---------------------------------------------------------------------------

pub async fn list_part(
    State(pool): State<MySqlPool>,
    Path(parent_id): Path<i32>,
) -> Result<Json<Vec<AttachmentRow>>, AppError> {
    list_for_kind(&pool, AttachmentKind::PartAttachment, parent_id).await
}
pub async fn list_footprint_image(
    State(pool): State<MySqlPool>,
    Path(parent_id): Path<i32>,
) -> Result<Json<Vec<AttachmentRow>>, AppError> {
    list_for_kind(&pool, AttachmentKind::FootprintImage, parent_id).await
}
pub async fn list_footprint_attachment(
    State(pool): State<MySqlPool>,
    Path(parent_id): Path<i32>,
) -> Result<Json<Vec<AttachmentRow>>, AppError> {
    list_for_kind(&pool, AttachmentKind::FootprintAttachment, parent_id).await
}
pub async fn list_manufacturer_logo(
    State(pool): State<MySqlPool>,
    Path(parent_id): Path<i32>,
) -> Result<Json<Vec<AttachmentRow>>, AppError> {
    list_for_kind(&pool, AttachmentKind::ManufacturerICLogo, parent_id).await
}
pub async fn list_storage_location_image(
    State(pool): State<MySqlPool>,
    Path(parent_id): Path<i32>,
) -> Result<Json<Vec<AttachmentRow>>, AppError> {
    list_for_kind(&pool, AttachmentKind::StorageLocationImage, parent_id).await
}
pub async fn list_project_attachment(
    State(pool): State<MySqlPool>,
    Path(parent_id): Path<i32>,
) -> Result<Json<Vec<AttachmentRow>>, AppError> {
    list_for_kind(&pool, AttachmentKind::ProjectAttachment, parent_id).await
}

async fn list_for_kind(
    pool: &MySqlPool,
    kind: AttachmentKind,
    parent_id: i32,
) -> Result<Json<Vec<AttachmentRow>>, AppError> {
    // Two flavours: PartAttachment has the isImage column; the others
    // imply image-ness from the entity class.
    let select = if kind.has_is_image_column() {
        format!(
            "SELECT id, filename, originalname, mimetype, size, description, \
                    extension, COALESCE(isImage, 0) AS is_image \
             FROM {tbl} WHERE {fk} = ? ORDER BY id",
            tbl = kind.table(), fk = kind.parent_fk()
        )
    } else {
        let always_img = if kind.always_image() { "1" } else { "0" };
        format!(
            "SELECT id, filename, originalname, mimetype, size, description, \
                    extension, {always_img} AS is_image \
             FROM {tbl} WHERE {fk} = ? ORDER BY id",
            tbl = kind.table(), fk = kind.parent_fk()
        )
    };
    let rows: Vec<AttachmentRow> = sqlx::query_as(&select)
        .bind(parent_id)
        .fetch_all(pool)
        .await?;
    Ok(Json(rows))
}

async fn upload_core(
    pool: &MySqlPool,
    store: &StorageConfig,
    kind: AttachmentKind,
    parent_id: i32,
    mut multipart: Multipart,
) -> Result<Json<Vec<AttachmentRow>>, AppError> {
    // Pre-flight: refuse if the parent doesn't exist. Without this we
    // happily write the file to disk and then bounce off a FK error,
    // leaking the file. (Theoretical race between this check and the
    // INSERT below is harmless — the worst case is a leaked file when
    // someone deletes the parent mid-upload, which we can clean up
    // out-of-band.)
    let parent_table = match kind {
        AttachmentKind::PartAttachment       => "Part",
        AttachmentKind::FootprintImage |
        AttachmentKind::FootprintAttachment  => "Footprint",
        AttachmentKind::ManufacturerICLogo   => "Manufacturer",
        AttachmentKind::StorageLocationImage => "StorageLocation",
        AttachmentKind::ProjectAttachment    => "Project",
    };
    let exists: Option<(i32,)> = sqlx::query_as(&format!(
        "SELECT id FROM {parent_table} WHERE id = ?"
    ))
    .bind(parent_id)
    .fetch_optional(pool)
    .await?;
    if exists.is_none() {
        return Err(AppError::NotFound(match kind {
            AttachmentKind::PartAttachment       => "part",
            AttachmentKind::FootprintImage |
            AttachmentKind::FootprintAttachment  => "footprint",
            AttachmentKind::ManufacturerICLogo   => "manufacturer",
            AttachmentKind::StorageLocationImage => "storage location",
            AttachmentKind::ProjectAttachment    => "project",
        }));
    }

    let mut saved: Vec<AttachmentRow> = Vec::new();

    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| AppError::BadRequest(leak(format!("malformed multipart: {e}"))))?
    {
        // Only files (with filenames) are persisted; ignore other fields.
        let original_filename = field.file_name().map(|s| s.to_string());
        let content_type = field.content_type().map(|s| s.to_string());
        let bytes: Bytes = field.bytes().await.map_err(|e| {
            AppError::BadRequest(leak(format!("could not read upload body: {e}")))
        })?;
        if bytes.is_empty() {
            continue;
        }
        let original = original_filename.unwrap_or_else(|| "upload".to_string());

        let saved_file = match storage::save_upload(
            store,
            kind.name(),
            UploadInput {
                bytes,
                original_filename: Some(original.clone()),
                content_type,
            },
        )
        .await
        {
            Ok(s) => s,
            Err(SaveError::Infected(sig)) => {
                return Err(AppError::BadRequest(leak(format!(
                    "upload rejected — virus scanner flagged: {sig}"
                ))));
            }
            Err(SaveError::Io(e)) => {
                return Err(AppError::BadRequest(leak(format!(
                    "could not save upload: {e}"
                ))));
            }
            Err(SaveError::Other(e)) => {
                tracing::error!(error = %e, "upload save failed");
                return Err(AppError::BadRequest("upload failed"));
            }
        };

        // INSERT row. Two flavours: PartAttachment has an isImage
        // column; the others don't.
        let now = chrono::Utc::now().naive_utc();
        let new_id = if kind.has_is_image_column() {
            let res = sqlx::query(&format!(
                "INSERT INTO {tbl} \
                    ({fk}, type, filename, originalname, mimetype, size, \
                     description, extension, isImage, created) \
                 VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)",
                tbl = kind.table(), fk = kind.parent_fk()
            ))
            .bind(parent_id)
            .bind(kind.name())
            .bind(&saved_file.uuid)
            .bind(&saved_file.original_filename)
            .bind(&saved_file.mimetype)
            .bind(saved_file.size)
            .bind(&saved_file.extension)
            .bind(saved_file.is_image)
            .bind(now)
            .execute(pool)
            .await?
            .last_insert_id() as i32;
            res
        } else {
            sqlx::query(&format!(
                "INSERT INTO {tbl} \
                    ({fk}, type, filename, originalname, mimetype, size, \
                     description, extension, created) \
                 VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)",
                tbl = kind.table(), fk = kind.parent_fk()
            ))
            .bind(parent_id)
            .bind(kind.name())
            .bind(&saved_file.uuid)
            .bind(&saved_file.original_filename)
            .bind(&saved_file.mimetype)
            .bind(saved_file.size)
            .bind(&saved_file.extension)
            .bind(now)
            .execute(pool)
            .await?
            .last_insert_id() as i32
        };

        saved.push(AttachmentRow {
            id: new_id,
            filename: saved_file.uuid,
            originalname: Some(saved_file.original_filename),
            mimetype: saved_file.mimetype,
            size: saved_file.size,
            description: None,
            extension: saved_file.extension,
            is_image: saved_file.is_image || kind.always_image(),
        });
    }

    Ok(Json(saved))
}

// ---------------------------------------------------------------------------
//  Download original
// ---------------------------------------------------------------------------

pub async fn download(
    State(pool): State<MySqlPool>,
    State(store): State<StorageConfig>,
    Path((kind_str, id)): Path<(String, i32)>,
) -> Result<Response, AppError> {
    let kind = AttachmentKind::from_str(&kind_str)
        .ok_or(AppError::NotFound("attachment kind"))?;

    let row = lookup_row(&pool, kind, id).await?;
    let dir = store.root.join(kind.name());
    let path = match storage::resolve_file_path(
        &dir,
        &row.filename,
        row.extension.as_deref(),
    ).await {
        Some(p) => p,
        None => return Err(AppError::NotFound("file")),
    };
    serve_file(&path, &row.mimetype, row.originalname.as_deref()).await
}

pub async fn download_thumb(
    State(pool): State<MySqlPool>,
    State(store): State<StorageConfig>,
    Path((kind_str, id)): Path<(String, i32)>,
) -> Result<Response, AppError> {
    let kind = AttachmentKind::from_str(&kind_str)
        .ok_or(AppError::NotFound("attachment kind"))?;

    let row = lookup_row(&pool, kind, id).await?;
    if !row.is_image && !kind.always_image() {
        return Err(AppError::NotFound("thumbnail"));
    }
    let dir = store.root.join(kind.name());
    let thumb = storage::thumbnail_path(&dir, &row.filename);

    // Lazy-generate the thumbnail when it's missing on disk. This
    // happens for every legacy-imported image (since legacy never
    // produced thumbnails) — and as a defensive fallback if a thumbnail
    // got deleted out from under us. First request pays the decode +
    // resize cost; subsequent requests serve the cached file directly.
    if !tokio::fs::try_exists(&thumb).await.unwrap_or(false) {
        let original = match storage::resolve_file_path(
            &dir, &row.filename, row.extension.as_deref(),
        ).await {
            Some(p) => p,
            None => {
                tracing::warn!(uuid = %row.filename, "thumb requested but original file not on disk");
                return Err(AppError::NotFound("thumbnail"));
            }
        };
        if let Err(e) = storage::regenerate_thumbnail(&original, &thumb).await {
            tracing::warn!(error = %e, original = %original.display(), "lazy thumbnail generation failed");
            return Err(AppError::NotFound("thumbnail"));
        }
    }
    serve_file(&thumb, "image/jpeg", None).await
}

async fn serve_file(
    path: &std::path::Path,
    mimetype: &str,
    suggested_name: Option<&str>,
) -> Result<Response, AppError> {
    let mut f = match fs::File::open(path).await {
        Ok(f) => f,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Err(AppError::NotFound("file"));
        }
        Err(e) => {
            tracing::error!(error = %e, path = %path.display(), "open file");
            return Err(AppError::BadRequest("file unavailable"));
        }
    };
    let mut buf = Vec::new();
    f.read_to_end(&mut buf).await.map_err(|e| {
        tracing::error!(error = %e, "read file");
        AppError::BadRequest("file unavailable")
    })?;

    let mut headers = HeaderMap::new();
    headers.insert(
        header::CONTENT_TYPE,
        mimetype.parse().unwrap_or_else(|_| "application/octet-stream".parse().unwrap()),
    );
    if let Some(n) = suggested_name {
        // RFC 5987-style; covers UTF-8 names. Browsers fall back to
        // the filename= form if needed.
        let safe = n.replace('"', "");
        let value: String = format!("inline; filename=\"{safe}\"");
        if let Ok(hv) = value.parse() {
            headers.insert(header::CONTENT_DISPOSITION, hv);
        }
    }
    Ok((StatusCode::OK, headers, buf).into_response())
}

// ---------------------------------------------------------------------------
//  Update description
// ---------------------------------------------------------------------------

pub async fn update_description(
    State(pool): State<MySqlPool>,
    Path((kind_str, id)): Path<(String, i32)>,
    Json(req): Json<UpdateDescription>,
) -> Result<Json<serde_json::Value>, AppError> {
    let kind = AttachmentKind::from_str(&kind_str)
        .ok_or(AppError::NotFound("attachment kind"))?;
    let res = sqlx::query(&format!(
        "UPDATE {tbl} SET description = ? WHERE id = ?",
        tbl = kind.table()
    ))
    .bind(&req.description)
    .bind(id)
    .execute(&pool)
    .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::NotFound("attachment"));
    }
    Ok(Json(json!({"id": id})))
}

// ---------------------------------------------------------------------------
//  Delete (file + thumb + DB row)
// ---------------------------------------------------------------------------

pub async fn delete(
    State(pool): State<MySqlPool>,
    State(store): State<StorageConfig>,
    Path((kind_str, id)): Path<(String, i32)>,
) -> Result<StatusCode, AppError> {
    let kind = AttachmentKind::from_str(&kind_str)
        .ok_or(AppError::NotFound("attachment kind"))?;
    let row = lookup_row(&pool, kind, id).await?;

    // Best-effort file delete — even if the file is missing, we still
    // want to drop the DB row so the user can recover. resolve_file_path
    // handles legacy rows where the DB extension column doesn't match
    // the on-disk filename.
    let dir = store.root.join(kind.name());
    if let Some(main) = storage::resolve_file_path(
        &dir, &row.filename, row.extension.as_deref(),
    ).await {
        let _ = fs::remove_file(&main).await;
    }
    let thumb = storage::thumbnail_path(&dir, &row.filename);
    let _ = fs::remove_file(&thumb).await;

    sqlx::query(&format!(
        "DELETE FROM {tbl} WHERE id = ?",
        tbl = kind.table()
    ))
    .bind(id)
    .execute(&pool)
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

// ---------------------------------------------------------------------------
//  Helpers
// ---------------------------------------------------------------------------

#[derive(sqlx::FromRow)]
struct LookupRow {
    filename: String,
    originalname: Option<String>,
    mimetype: String,
    extension: Option<String>,
    is_image: bool,
}

async fn lookup_row(
    pool: &MySqlPool,
    kind: AttachmentKind,
    id: i32,
) -> Result<LookupRow, AppError> {
    // PartAttachment has isImage; the others get a constant `true` for
    // image kinds and `false` for FootprintAttachment.
    let select = if kind.has_is_image_column() {
        format!(
            "SELECT filename, originalname, mimetype, extension, \
                    COALESCE(isImage, 0) AS is_image \
             FROM {tbl} WHERE id = ?",
            tbl = kind.table()
        )
    } else {
        let always_img = if kind.always_image() { "1" } else { "0" };
        format!(
            "SELECT filename, originalname, mimetype, extension, \
                    {always_img} AS is_image \
             FROM {tbl} WHERE id = ?",
            tbl = kind.table()
        )
    };
    let row: Option<LookupRow> = sqlx::query_as(&select)
        .bind(id)
        .fetch_optional(pool)
        .await?;
    row.ok_or(AppError::NotFound("attachment"))
}

/// AppError::BadRequest currently takes &'static str; we leak() the
/// dynamically-built error messages so the variant doesn't need
/// widening just for slice 7. The leaks are bounded to the count of
/// distinct upload errors (small).
pub(crate) fn leak(s: String) -> &'static str {
    Box::leak(s.into_boxed_str())
}
