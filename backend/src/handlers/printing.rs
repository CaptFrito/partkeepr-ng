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

/// Live info pulled from `ptouch-print --info`. Called just-in-time
/// when the label dialog opens so the tape-width selector can
/// default to whatever cassette is currently loaded. Best-effort:
/// returns `{available: false}` if ptouch isn't configured or the
/// printer is unreachable; never errors out the request.
#[derive(Debug, Serialize)]
pub struct PrinterInfoResponse {
    pub available: bool,
    /// Width of the currently loaded tape, in mm. None when not
    /// known (printer off, ptouch error, etc.).
    pub current_tape_width_mm: Option<f32>,
    /// Max printable height for the loaded tape, in pixels. Same
    /// availability rules as current_tape_width_mm.
    pub current_max_print_height_px: Option<i32>,
    /// Human-readable status message (the tape's media type +
    /// color summary, etc.). Surfaced as a hint in the dialog.
    pub status: Option<String>,
}

pub async fn printer_info(
    State(cfg): State<PrintConfig>,
) -> Json<PrinterInfoResponse> {
    let bin = match cfg.ptouch_bin.as_ref() {
        Some(b) => b,
        None => {
            return Json(PrinterInfoResponse {
                available: false,
                current_tape_width_mm: None,
                current_max_print_height_px: None,
                status: None,
            });
        }
    };

    let result = tokio::time::timeout(
        std::time::Duration::from_secs(3),
        Command::new(bin)
            .arg("--info")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output(),
    )
    .await;

    let output = match result {
        Ok(Ok(o)) if o.status.success() => o,
        Ok(Ok(o)) => {
            let stderr = String::from_utf8_lossy(&o.stderr).to_string();
            return Json(PrinterInfoResponse {
                available: false,
                current_tape_width_mm: None,
                current_max_print_height_px: None,
                status: Some(format!("ptouch-print --info failed: {stderr}").trim().to_string()),
            });
        }
        Ok(Err(e)) => {
            return Json(PrinterInfoResponse {
                available: false,
                current_tape_width_mm: None,
                current_max_print_height_px: None,
                status: Some(format!("ptouch-print spawn error: {e}")),
            });
        }
        Err(_) => {
            return Json(PrinterInfoResponse {
                available: false,
                current_tape_width_mm: None,
                current_max_print_height_px: None,
                status: Some("ptouch-print --info timed out (3s)".into()),
            });
        }
    };

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let parsed = parse_ptouch_info(&stdout);
    Json(PrinterInfoResponse {
        available: parsed.is_some(),
        current_tape_width_mm: parsed.as_ref().map(|p| p.tape_width_mm),
        current_max_print_height_px: parsed.as_ref().map(|p| p.max_print_height_px),
        status: parsed.map(|p| p.status_summary).or(Some(stdout)),
    })
}

struct PtouchInfo {
    tape_width_mm: f32,
    max_print_height_px: i32,
    status_summary: String,
}

/// Parse the few lines we care about out of `ptouch-print --info` output:
///
/// ```text
/// PT-D410 found on USB bus 1, device 40
/// printer has 180 dpi, maximum printing width is 128 px
/// maximum printing width for this tape is 76px
/// media type = 0x01 (Laminated tape)
/// media width = 12 mm
/// tape color = 0x01 (White)
/// text color = 0x08 (Black)
/// error = 0x0000
/// ```
fn parse_ptouch_info(output: &str) -> Option<PtouchInfo> {
    let mut tape_mm: Option<f32> = None;
    let mut max_px: Option<i32> = None;
    let mut media_type: Option<String> = None;
    let mut tape_color: Option<String> = None;
    for line in output.lines() {
        let line = line.trim();
        if let Some(rest) = line.strip_prefix("media width = ") {
            tape_mm = rest.split_whitespace().next().and_then(|s| s.parse().ok());
        } else if let Some(rest) = line.strip_prefix("maximum printing width for this tape is ") {
            // Format: "76px" — trailing literal "px"
            let n = rest.trim_end_matches("px").trim();
            max_px = n.parse().ok();
        } else if let Some(rest) = line.strip_prefix("media type = ") {
            // "0x01 (Laminated tape)" — extract the parenthesized label
            if let (Some(s), Some(e)) = (rest.find('('), rest.rfind(')')) {
                media_type = Some(rest[s + 1..e].to_string());
            }
        } else if let Some(rest) = line.strip_prefix("tape color = ") {
            if let (Some(s), Some(e)) = (rest.find('('), rest.rfind(')')) {
                tape_color = Some(rest[s + 1..e].to_string());
            }
        }
    }
    let tape_width_mm = tape_mm?;
    let max_print_height_px = max_px?;
    let media = media_type.as_deref().unwrap_or("?");
    let color = tape_color.as_deref().unwrap_or("?");
    Some(PtouchInfo {
        tape_width_mm,
        max_print_height_px,
        status_summary: format!(
            "{tape_width_mm} mm {media}, {color}"
        ),
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
