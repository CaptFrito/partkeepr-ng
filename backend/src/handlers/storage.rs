// SPDX-License-Identifier: GPL-3.0-or-later

//! Slice 7: file-storage abstraction shared by all attachment endpoints.
//!
//! Layout on disk — matches the legacy PartKeepr layout so existing
//! files can be `rsync`'d into the new tree without renaming:
//!
//! ```text
//! $PARTKEEPR_STORAGE_DIR/
//! ├── PartAttachment/{uuid}.{ext}
//! ├── PartAttachment/{uuid}.thumb.jpg        (only for images)
//! ├── FootprintImage/{uuid}.{ext}
//! ├── FootprintAttachment/{uuid}.{ext}
//! ├── ManufacturerICLogo/{uuid}.{ext}
//! └── StorageLocationImage/{uuid}.{ext}
//! ```
//!
//! Subdir name is the Doctrine entity class name. UUID filenames are
//! preserved from the existing DB rows (`filename` column).

use std::env;
use std::io::Cursor;
use std::path::{Path, PathBuf};

use anyhow::Context;
use bytes::Bytes;
use image::ImageReader;
use tokio::fs;
use tokio::io::AsyncWriteExt;

use super::clamd::{self, ClamdConfig, ScanResult};

#[derive(Debug, Clone)]
pub struct StorageConfig {
    pub root: PathBuf,
    pub clamd: ClamdConfig,
}

impl StorageConfig {
    /// Read root from env (`PARTKEEPR_STORAGE_DIR`), falling back to
    /// `~/.local/share/partkeepr-ng/files/`. Creates the directory if
    /// missing.
    pub async fn from_env_and_init() -> anyhow::Result<Self> {
        let root = match env::var("PARTKEEPR_STORAGE_DIR") {
            Ok(v) => PathBuf::from(v),
            Err(_) => {
                let home = env::var("HOME").context("HOME not set")?;
                PathBuf::from(home)
                    .join(".local")
                    .join("share")
                    .join("partkeepr-ng")
                    .join("files")
            }
        };
        fs::create_dir_all(&root)
            .await
            .with_context(|| format!("create storage root {}", root.display()))?;
        tracing::info!(root = %root.display(), "file storage root");
        Ok(Self {
            root,
            clamd: ClamdConfig::from_env(),
        })
    }
}

/// Bytes + metadata extracted from an inbound multipart field. The
/// caller pulls these out of axum's `Multipart`.
pub struct UploadInput {
    pub bytes: Bytes,
    pub original_filename: Option<String>,
    pub content_type: Option<String>,
}

/// Result of a successful save — exactly the columns the per-entity
/// attachment tables need (`filename`, `originalname`, `mimetype`,
/// `size`, `isImage`, `extension`).
pub struct SavedFile {
    pub uuid: String,
    pub original_filename: String,
    pub mimetype: String,
    pub size: i32,
    pub extension: Option<String>,
    pub is_image: bool,
}

#[derive(Debug)]
pub enum SaveError {
    Infected(String),
    Io(std::io::Error),
    Other(anyhow::Error),
}

impl From<std::io::Error> for SaveError {
    fn from(e: std::io::Error) -> Self { SaveError::Io(e) }
}
impl From<anyhow::Error> for SaveError {
    fn from(e: anyhow::Error) -> Self { SaveError::Other(e) }
}

/// Save an uploaded file under `{root}/{table}/{uuid}.{ext}`. If the
/// file is an image (per its content type), also generates a 200x200
/// JPEG thumbnail at `{uuid}.thumb.jpg`. If clamd is configured, the
/// bytes are scanned before anything hits disk.
pub async fn save_upload(
    cfg: &StorageConfig,
    table: &str,
    input: UploadInput,
) -> Result<SavedFile, SaveError> {
    // Virus scan first — bail before touching the disk.
    if cfg.clamd.enabled() {
        match clamd::scan(&cfg.clamd, &input.bytes).await {
            Ok(ScanResult::Clean) => {}
            Ok(ScanResult::Infected(sig)) => return Err(SaveError::Infected(sig)),
            Err(e) => {
                // Treat scanner connectivity errors as fatal — we
                // would rather refuse uploads than silently bypass
                // the scanner when the env var said it should run.
                return Err(SaveError::Other(e));
            }
        }
    }

    let original_filename = input
        .original_filename
        .unwrap_or_else(|| "upload".to_string());
    let extension = extension_from_filename(&original_filename);
    let mimetype = input
        .content_type
        .or_else(|| {
            mime_guess::from_path(&original_filename)
                .first()
                .map(|m| m.essence_str().to_string())
        })
        .unwrap_or_else(|| "application/octet-stream".to_string());
    let is_image = mimetype.starts_with("image/");
    let size = input.bytes.len() as i32;

    let uuid = uuid::Uuid::new_v4().to_string();
    let dir = cfg.root.join(table);
    fs::create_dir_all(&dir).await?;
    let main_path = file_path(&dir, &uuid, extension.as_deref());

    // Write atomically: write to .tmp then rename, so a crash mid-write
    // doesn't leave a half-file referenced by the DB row.
    let tmp = main_path.with_extension("tmp");
    let mut f = fs::File::create(&tmp).await?;
    f.write_all(&input.bytes).await?;
    f.sync_all().await?;
    drop(f);
    fs::rename(&tmp, &main_path).await?;

    if is_image {
        if let Err(e) = generate_thumbnail(&main_path, &thumbnail_path(&dir, &uuid)).await {
            tracing::warn!(error = %e, original = %original_filename, "thumbnail generation failed");
            // Non-fatal: keep the original.
        }
    }

    Ok(SavedFile {
        uuid,
        original_filename,
        mimetype,
        size,
        extension,
        is_image,
    })
}

/// Build the on-disk path for the original of `{uuid}` in `dir`. We
/// preserve the extension when present so the file is recognisable on
/// disk (and so that `Content-Disposition` can fall back to it cleanly).
pub fn file_path(dir: &Path, uuid: &str, ext: Option<&str>) -> PathBuf {
    match ext {
        Some(e) if !e.is_empty() => dir.join(format!("{uuid}.{e}")),
        _ => dir.join(uuid),
    }
}

/// Like `file_path`, but resolves the actual file on disk even when the
/// DB's `extension` column doesn't match what's there. Falls back to a
/// directory glob so legacy rows with `extension = NULL` (e.g. our
/// imported ManufacturerICLogo / FootprintImage data) still serve.
///
/// Probes in order:
/// 1. `{uuid}.{hint_ext}` — fast path, single stat.
/// 2. `{uuid}` — extensionless legacy convention.
/// 3. Walk `dir` for an entry whose name starts with `{uuid}.` and
///    isn't the thumbnail companion. Slow, but only hit for rows where
///    1+2 missed.
pub async fn resolve_file_path(
    dir: &Path,
    uuid: &str,
    hint_ext: Option<&str>,
) -> Option<PathBuf> {
    if let Some(e) = hint_ext {
        if !e.is_empty() {
            let p = dir.join(format!("{uuid}.{e}"));
            if tokio::fs::try_exists(&p).await.unwrap_or(false) {
                return Some(p);
            }
        }
    }
    let plain = dir.join(uuid);
    if tokio::fs::try_exists(&plain).await.unwrap_or(false) {
        return Some(plain);
    }
    let prefix = format!("{uuid}.");
    let thumb_marker = ".thumb.";
    if let Ok(mut entries) = tokio::fs::read_dir(dir).await {
        while let Ok(Some(entry)) = entries.next_entry().await {
            if let Some(name) = entry.file_name().to_str() {
                if name.starts_with(&prefix) && !name.contains(thumb_marker) {
                    return Some(entry.path());
                }
            }
        }
    }
    None
}

pub fn thumbnail_path(dir: &Path, uuid: &str) -> PathBuf {
    dir.join(format!("{uuid}.thumb.jpg"))
}

/// Extract the lowercased extension (sans dot) from a filename. Returns
/// None if no `.` or trailing-dot.
fn extension_from_filename(name: &str) -> Option<String> {
    let dot = name.rfind('.')?;
    let ext = &name[dot + 1..];
    if ext.is_empty() || ext.contains('/') {
        None
    } else {
        Some(ext.to_ascii_lowercase())
    }
}

/// Public alias — lets the attachment handler regenerate a thumbnail
/// lazily when it's missing on disk (typical for legacy-imported
/// images where the original PartKeepr never produced a thumb).
pub async fn regenerate_thumbnail(src: &Path, out: &Path) -> anyhow::Result<()> {
    generate_thumbnail(src, out).await
}

/// Generate a 200x200 JPEG thumbnail at `out`. Reads the source from
/// `src`. CPU-bound; runs on the tokio blocking pool.
async fn generate_thumbnail(src: &Path, out: &Path) -> anyhow::Result<()> {
    let src = src.to_path_buf();
    let out = out.to_path_buf();
    tokio::task::spawn_blocking(move || -> anyhow::Result<()> {
        let img = ImageReader::open(&src)?
            .with_guessed_format()?
            .decode()?;
        let thumb = img.thumbnail(200, 200);
        let mut buf = Cursor::new(Vec::with_capacity(8192));
        thumb.write_to(&mut buf, image::ImageFormat::Jpeg)?;
        std::fs::write(&out, buf.into_inner())?;
        Ok(())
    })
    .await??;
    Ok(())
}
