// SPDX-License-Identifier: GPL-3.0-or-later

//! `GET /api/version` — returns the daemon's compiled-in version
//! string. The frontend renders it as a small chip next to the
//! header title so operators can tell at a glance which release is
//! live on a given host.

use axum::Json;
use serde::Serialize;

#[derive(Serialize)]
pub struct VersionResponse {
    pub version: &'static str,
}

pub async fn version() -> Json<VersionResponse> {
    Json(VersionResponse {
        version: env!("CARGO_PKG_VERSION"),
    })
}
