// SPDX-License-Identifier: GPL-3.0-or-later

use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;

/// Common error type for hand-written handlers. Codegen handlers in
/// `models/` use a different (older) `(StatusCode, String)` shape; that's
/// fine — they're list-only stubs and will be retired as features replace
/// them.
#[derive(Debug)]
pub enum AppError {
    NotFound(&'static str),
    BadRequest(&'static str),
    /// 409 with a structured JSON body — used by delete handlers that
    /// hard-block on outstanding references and need to report counts so
    /// the UI can render an actionable message.
    Conflict(serde_json::Value),
    /// 401. Returned by the auth login handler on bad credentials;
    /// the auth middleware uses a direct response, not this variant,
    /// but it's available for any future handler that needs to
    /// refuse based on the session.
    Unauthorized(&'static str),
    /// 500 with a dynamic message. Used for handler-internal failures
    /// (temp files, subprocess spawn, etc.) where there's no friendlier
    /// shape than "something went wrong, here's the detail".
    Internal(String),
    Db(sqlx::Error),
}

impl From<sqlx::Error> for AppError {
    fn from(e: sqlx::Error) -> Self {
        AppError::Db(e)
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        match self {
            AppError::NotFound(what) => (
                StatusCode::NOT_FOUND,
                Json(json!({"error": format!("{what} not found")})),
            )
                .into_response(),
            AppError::BadRequest(msg) => (
                StatusCode::BAD_REQUEST,
                Json(json!({"error": msg})),
            )
                .into_response(),
            AppError::Conflict(body) => (StatusCode::CONFLICT, Json(body)).into_response(),
            AppError::Unauthorized(msg) => (
                StatusCode::UNAUTHORIZED,
                Json(json!({"error": msg})),
            )
                .into_response(),
            AppError::Db(e) => {
                tracing::error!(error = %e, "database error");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({"error": "internal error"})),
                )
                    .into_response()
            }
            AppError::Internal(msg) => {
                tracing::error!(%msg, "internal error");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({"error": msg})),
                )
                    .into_response()
            }
        }
    }
}
