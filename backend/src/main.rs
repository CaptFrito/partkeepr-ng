use std::net::SocketAddr;

use anyhow::Context;
use axum::{extract::FromRef, http::Method, routing::get, Router};
use sqlx::mysql::MySqlPoolOptions;
use sqlx::MySqlPool;
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;
use tracing_subscriber::EnvFilter;

mod error;
mod handlers;
mod models;

use handlers::storage::StorageConfig;

/// Combined router state. axum's `FromRef` impls below let individual
/// handlers extract just the part they need (e.g.
/// `State(pool): State<MySqlPool>`) without the rest of the app having
/// to know about `StorageConfig`.
#[derive(Clone)]
pub struct AppState {
    pub pool: MySqlPool,
    pub store: StorageConfig,
}

impl FromRef<AppState> for MySqlPool {
    fn from_ref(s: &AppState) -> Self { s.pool.clone() }
}
impl FromRef<AppState> for StorageConfig {
    fn from_ref(s: &AppState) -> Self { s.store.clone() }
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

    let store = StorageConfig::from_env_and_init().await?;
    let state = AppState { pool, store };

    // Permissive CORS for local dev — frontend runs on :8081 (Trunk) while
    // the API is on :8080. Tighten / restrict to specific origins when we
    // leave localhost.
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods([Method::GET, Method::POST, Method::PUT, Method::DELETE, Method::PATCH])
        .allow_headers(Any);

    let app = Router::new()
        .route("/health", get(health))
        .merge(handlers::routes())
        .merge(models::routes())
        .layer(TraceLayer::new_for_http())
        .layer(cors)
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
