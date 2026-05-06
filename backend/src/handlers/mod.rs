use axum::{
    routing::{get, post},
    Router,
};
use sqlx::MySqlPool;

pub mod parts;
pub mod stock;

/// Hand-written endpoints. Merged into the main router alongside the
/// codegen routes from `models::routes()`. Routes here take precedence by
/// not being in codegen output (see SKIP_HANDLER_CLASSES in the codegen).
pub fn routes() -> Router<MySqlPool> {
    Router::new()
        .route("/api/part_categories/tree", get(parts::category_tree))
        .route("/api/parts", get(parts::list).post(parts::create))
        .route(
            "/api/parts/:id",
            get(parts::detail).put(parts::update).delete(parts::delete),
        )
        .route("/api/parts/:id/stock-entries", post(stock::create_stock_entry))
}
