// SPDX-License-Identifier: GPL-3.0-or-later

use std::net::SocketAddr;
use std::path::PathBuf;

use anyhow::Context;
use axum::{extract::FromRef, middleware, routing::get, Router};
use sqlx::mysql::MySqlPoolOptions;
use sqlx::MySqlPool;
use tower_http::services::ServeDir;
use tower_http::trace::TraceLayer;
use tracing_subscriber::EnvFilter;

mod error;
mod handlers;
mod models;
mod startup;

use handlers::auth::SessionSigner;
use handlers::storage::StorageConfig;

/// Combined router state. axum's `FromRef` impls below let individual
/// handlers extract just the part they need (e.g.
/// `State(pool): State<MySqlPool>`) without the rest of the app having
/// to know about `StorageConfig`.
#[derive(Clone)]
pub struct AppState {
    pub pool: MySqlPool,
    pub store: StorageConfig,
    pub signer: SessionSigner,
    pub printing: handlers::printing::PrintConfig,
    pub mouser: handlers::mouser::MouserConfig,
    pub digikey: handlers::digikey::DigiKeyConfig,
    pub trustedparts: handlers::trustedparts::TrustedPartsConfig,
}

impl FromRef<AppState> for MySqlPool {
    fn from_ref(s: &AppState) -> Self { s.pool.clone() }
}
impl FromRef<AppState> for StorageConfig {
    fn from_ref(s: &AppState) -> Self { s.store.clone() }
}
impl FromRef<AppState> for SessionSigner {
    fn from_ref(s: &AppState) -> Self { s.signer.clone() }
}
impl FromRef<AppState> for handlers::printing::PrintConfig {
    fn from_ref(s: &AppState) -> Self { s.printing.clone() }
}
impl FromRef<AppState> for handlers::mouser::MouserConfig {
    fn from_ref(s: &AppState) -> Self { s.mouser.clone() }
}
impl FromRef<AppState> for handlers::digikey::DigiKeyConfig {
    fn from_ref(s: &AppState) -> Self { s.digikey.clone() }
}
impl FromRef<AppState> for handlers::trustedparts::TrustedPartsConfig {
    fn from_ref(s: &AppState) -> Self { s.trustedparts.clone() }
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenvy::dotenv().ok();

    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new("info,partkeepr_api=debug,tower_http=debug")),
        )
        .init();

    let database_url =
        std::env::var("DATABASE_URL").context("DATABASE_URL must be set (see .env.example)")?;
    let bind_addr: SocketAddr = std::env::var("BIND_ADDR")
        .unwrap_or_else(|_| "127.0.0.1:8080".to_string())
        .parse()
        .context("BIND_ADDR must be a valid socket address")?;

    let pool = MySqlPoolOptions::new()
        .max_connections(8)
        .connect(&database_url)
        .await
        .context("connecting to database")?;
    tracing::info!("connected to database");

    // Startup invariants — schema sanity + seed rows that the app
    // assumes exist. See backend/src/startup.rs for the list.
    startup::ensure_invariants(&pool).await?;

    let store = StorageConfig::from_env_and_init().await?;
    let signer = SessionSigner::from_env()?;
    let printing = handlers::printing::PrintConfig::from_env();
    let mouser = handlers::mouser::MouserConfig::from_env();
    let digikey = handlers::digikey::DigiKeyConfig::from_env();
    let trustedparts = handlers::trustedparts::TrustedPartsConfig::from_env();
    let state = AppState { pool, store, signer, printing, mouser, digikey, trustedparts };

    // Frontend is served as static assets out of this directory. Default
    // is "../frontend" relative to the backend cwd (matches the dev
    // checkout layout). Production sets PARTKEEPR_FRONTEND_DIR to the
    // installed location (e.g., /usr/share/partkeepr-ng/frontend).
    let frontend_dir: PathBuf = std::env::var("PARTKEEPR_FRONTEND_DIR")
        .unwrap_or_else(|_| "../frontend".to_string())
        .into();
    if !frontend_dir.exists() {
        anyhow::bail!(
            "frontend directory {:?} does not exist (set PARTKEEPR_FRONTEND_DIR \
             or run from backend/ where ../frontend resolves)",
            frontend_dir
        );
    }
    tracing::info!(?frontend_dir, "serving static frontend");

    let app = Router::new()
        .route("/health", get(health))
        .merge(handlers::routes())
        .merge(models::routes())
        // Auth middleware runs ahead of every handler. Whitelisted
        // public paths (/health, /api/login) and any non-/api/, non-/files/
        // path (i.e., static frontend assets) pass through; everything
        // else returns 401 unless the session cookie is present and valid.
        // See handlers/auth.rs::auth_middleware.
        .layer(middleware::from_fn_with_state(
            state.clone(),
            handlers::auth::auth_middleware,
        ))
        .layer(TraceLayer::new_for_http())
        .fallback_service(ServeDir::new(&frontend_dir))
        .with_state(state);

    let listener = tokio::net::TcpListener::bind(bind_addr).await?;
    tracing::info!(%bind_addr, "listening");
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;
    Ok(())
}

async fn health() -> &'static str {
    "ok"
}

async fn shutdown_signal() {
    tokio::signal::ctrl_c()
        .await
        .expect("install Ctrl+C handler");
    tracing::info!("shutdown signal received");
}
