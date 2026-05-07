//! Slice 13 — label printing.
//!
//! Two endpoints:
//! - `GET /api/print/capabilities` — always available; returns the
//!   set of output paths the backend supports. Frontend gates the
//!   "Print to D410" button on `ptouch.available == true`.
//! - `POST /api/print/label` — takes a base64-encoded PNG and shells
//!   out to `ptouch-print`. Only succeeds when the env var
//!   `PARTKEEPR_PTOUCH_BIN` is set.
//!
//! No CUPS dependency — direct USB via the open-source ptouch-print
//! CLI tool. See https://git.familie-radermacher.ch/linux/ptouch-print/
//! Frontend always supports "Download PNG" as a fallback that needs
//! no backend cooperation at all.

use axum::{extract::State, Json};
use base64::Engine as _;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::path::PathBuf;
use std::process::Stdio;
use tokio::io::AsyncWriteExt;
use tokio::process::Command;

use crate::error::AppError;

/// Backend printing config — derived once at startup, then snapshot
/// into AppState. Cheap to clone.
#[derive(Clone, Debug)]
pub struct PrintConfig {
    /// Path to the `ptouch-print` binary if the operator has set
    /// `PARTKEEPR_PTOUCH_BIN`. None disables direct printing
    /// (frontend Print button stays hidden, only Download-PNG works).
    pub ptouch_bin: Option<PathBuf>,
}

impl PrintConfig {
    pub fn from_env() -> Self {
        let ptouch_bin = std::env::var("PARTKEEPR_PTOUCH_BIN")
            .ok()
            .filter(|s| !s.trim().is_empty())
            .map(PathBuf::from);
        if let Some(p) = &ptouch_bin {
            tracing::info!(path = %p.display(), "ptouch-print enabled");
        } else {
            tracing::info!("ptouch-print disabled (set PARTKEEPR_PTOUCH_BIN to enable)");
        }
        Self { ptouch_bin }
    }
}

#[derive(Debug, Serialize)]
pub struct CapabilitiesResponse {
    pub ptouch: PtouchCaps,
}

#[derive(Debug, Serialize)]
pub struct PtouchCaps {
    pub available: bool,
    /// Tape widths the frontend's renderer offers. The actual
    /// loaded cassette may differ — operator verifies at the
    /// printer. (Auto-detect from `ptouch-print --info` is a
    /// future enhancement.)
    pub supported_widths_mm: Vec<f32>,
    pub default_width_mm: f32,
}

pub async fn capabilities(
    State(cfg): State<PrintConfig>,
) -> Json<CapabilitiesResponse> {
    Json(CapabilitiesResponse {
        ptouch: PtouchCaps {
            available: cfg.ptouch_bin.is_some(),
            supported_widths_mm: vec![3.5, 6.0, 9.0, 12.0],
            default_width_mm: 12.0,
        },
    })
}

#[derive(Debug, Deserialize)]
pub struct PrintLabelRequest {
    /// Base64-encoded PNG (no `data:image/png;base64,` prefix).
    pub png_b64: String,
    /// Cosmetic — included in the toast / log line.
    #[serde(default)]
    pub label_kind: Option<String>,
}

pub async fn print_label(
    State(cfg): State<PrintConfig>,
    Json(req): Json<PrintLabelRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let bin = cfg.ptouch_bin.as_ref().ok_or_else(|| {
        AppError::BadRequest("printing not configured (set PARTKEEPR_PTOUCH_BIN)")
    })?;

    // Decode the PNG and write to a temp file. Using a real temp
    // file (not stdin) because ptouch-print expects --image=PATH.
    let png = base64::engine::general_purpose::STANDARD
        .decode(req.png_b64.as_bytes())
        .map_err(|_| AppError::BadRequest("png_b64 is not valid base64"))?;
    if png.len() < 16 || &png[..8] != b"\x89PNG\r\n\x1a\n" {
        return Err(AppError::BadRequest("decoded payload is not a PNG"));
    }

    // Lazy temp file — name in /tmp, cleaned up on success or error.
    let tmp = std::env::temp_dir().join(format!("partkeepr-label-{}.png", uuid::Uuid::new_v4()));
    {
        let mut f = tokio::fs::File::create(&tmp).await.map_err(|e| {
            AppError::Internal(format!("temp file: {e}"))
        })?;
        f.write_all(&png).await.map_err(|e| {
            AppError::Internal(format!("writing temp PNG: {e}"))
        })?;
        f.flush().await.ok();
    }

    let kind = req.label_kind.as_deref().unwrap_or("label");
    tracing::info!(?bin, ?tmp, %kind, "ptouch-print: about to invoke");

    // Run ptouch-print --image <tmp>. We capture stdout+stderr so
    // any error (printer not ready, out of tape, unsupported device)
    // surfaces back to the operator's toast.
    let output = Command::new(bin)
        .arg("--image")
        .arg(&tmp)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|e| AppError::Internal(format!("spawning ptouch-print: {e}")))?;

    // Best-effort cleanup; failure to delete a temp file isn't
    // user-visible.
    let _ = tokio::fs::remove_file(&tmp).await;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if !output.status.success() {
        let code = output.status.code().unwrap_or(-1);
        tracing::warn!(%code, %stderr, "ptouch-print failed");
        return Err(AppError::Conflict(json!({
            "error": "ptouch-print failed",
            "exit_code": code,
            "stdout": stdout,
            "stderr": stderr,
        })));
    }

    Ok(Json(json!({
        "printed": true,
        "stdout": stdout,
        "stderr": stderr,
    })))
}

/// 413 if PNG is bigger than this. ptouch-print at 180 dpi over a
/// 12mm × 200mm tape is ~1.5 MB at the worst; 5 MB headroom is plenty.
#[allow(dead_code)]
const MAX_PNG_BYTES: usize = 5 * 1024 * 1024;
