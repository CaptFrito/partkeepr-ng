// SPDX-License-Identifier: GPL-3.0-or-later

//! Minimal ClamAV/clamd INSTREAM client.
//!
//! Talks the `INSTREAM` wire protocol over TCP — the simplest of clamd's
//! scanning modes. We send file bytes over the wire, clamd scans them in
//! its own process (no path-sharing required), and replies with either
//! `stream: OK` or `stream: <Signature> FOUND`.
//!
//! Configuration: `PARTKEEPR_CLAMD=tcp://host:port`. When the env var is
//! unset or malformed at startup, scanning is disabled and uploads pass
//! through unscanned (with a one-time WARN logged at boot). When set,
//! every upload is scanned before the file lands on disk; an infected
//! upload is rejected with HTTP 422.

use std::env;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

#[derive(Debug, Clone)]
pub struct ClamdConfig {
    /// `host:port` for the clamd TCP socket. None means scanning is
    /// disabled (the bypass-on-no-config mode used by dev).
    pub tcp_addr: Option<String>,
}

impl ClamdConfig {
    /// Read from env. Logs a WARN if not configured. Logs an INFO if
    /// configured (the actual scan happens on every upload — too noisy
    /// to log per-scan).
    pub fn from_env() -> Self {
        let raw = env::var("PARTKEEPR_CLAMD").ok();
        let tcp_addr = raw
            .as_deref()
            .and_then(|v| v.strip_prefix("tcp://"))
            .map(|h| h.to_string());
        match (raw.as_deref(), &tcp_addr) {
            (None, _) => {
                tracing::warn!(
                    "virus scanning disabled — set PARTKEEPR_CLAMD=tcp://host:port to enable"
                );
            }
            (Some(_), Some(addr)) => {
                tracing::info!(clamd = %addr, "virus scanning enabled");
            }
            (Some(other), None) => {
                tracing::warn!(
                    raw = %other,
                    "PARTKEEPR_CLAMD set but format not recognised (expected tcp://host:port); scanning disabled"
                );
            }
        }
        Self { tcp_addr }
    }

    pub fn enabled(&self) -> bool {
        self.tcp_addr.is_some()
    }
}

#[derive(Debug)]
pub enum ScanResult {
    Clean,
    Infected(String),
}

/// Scan a buffer with clamd. Returns:
/// - `Ok(Clean)` if clamd reports `stream: OK`.
/// - `Ok(Infected(name))` if clamd reports a signature match.
/// - `Err(_)` for transport failures, malformed responses, or when
///   scanning isn't configured at all (caller should treat the
///   `disabled` case via `ClamdConfig::enabled` before calling).
pub async fn scan(cfg: &ClamdConfig, bytes: &[u8]) -> anyhow::Result<ScanResult> {
    let addr = cfg.tcp_addr.as_deref()
        .ok_or_else(|| anyhow::anyhow!("clamd not configured"))?;

    let mut stream = TcpStream::connect(addr).await?;

    // INSTREAM command. The "z" prefix (= zINSTREAM) would null-terminate
    // the command; "n" uses newline. Newline form is simpler to read
    // back and is what clamd's docs recommend for line-based clients.
    stream.write_all(b"nINSTREAM\n").await?;

    // Body is one or more chunks: <u32-be length><bytes>, terminated
    // by a zero-length chunk. clamd's StreamMaxLength config limits the
    // total size; we don't enforce a separate cap here — caller can.
    const CHUNK: usize = 65_536;
    for slice in bytes.chunks(CHUNK) {
        let len = slice.len() as u32;
        stream.write_all(&len.to_be_bytes()).await?;
        stream.write_all(slice).await?;
    }
    stream.write_all(&0u32.to_be_bytes()).await?;
    stream.flush().await?;

    let mut buf = Vec::with_capacity(128);
    stream.read_to_end(&mut buf).await?;
    let resp = String::from_utf8_lossy(&buf).trim().to_string();

    // Possible replies:
    //   "stream: OK"
    //   "stream: <Signature> FOUND"
    //   "stream: <error> ERROR"
    if resp.ends_with("OK") {
        return Ok(ScanResult::Clean);
    }
    if let Some(rest) = resp.strip_suffix(" FOUND") {
        let sig = rest.trim_start_matches("stream: ").to_string();
        return Ok(ScanResult::Infected(sig));
    }
    if resp.ends_with("ERROR") {
        anyhow::bail!("clamd error: {resp}");
    }
    anyhow::bail!("unrecognised clamd reply: {resp}");
}
