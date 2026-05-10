// SPDX-License-Identifier: GPL-3.0-or-later

//! `cargo run --bin reset-password -- <username> <new-password>`
//!
//! Resets a single FOSUser row's password hash to a new value, using
//! the same FOSUserBundle scheme the login handler verifies against
//! (sha512 over `password{salt}` iterated 5000×, base64). Looks up
//! by either `username` or `username_canonical` so casing doesn't
//! matter.
//!
//! The DATABASE_URL is read from the environment (or `.env` via
//! dotenvy) — same as the API server. Connect to the same database
//! the running app uses; otherwise the reset won't take effect for
//! the live login flow.
//!
//! Notes:
//!   - Existing salt is preserved. FOSUserBundle doesn't require salt
//!     rotation, and keeping it stable means failed-attempt timing
//!     stays comparable to other accounts.
//!   - Won't unlock or enable a user — only changes the password
//!     hash. If `locked=1` or `enabled=0` the user still can't log
//!     in; that's a separate admin task.
//!   - Won't create a missing `PartKeeprUser` row. If a FOSUser has
//!     no PartKeeprUser counterpart, the login handler refuses
//!     login (per the existing code path); password reset alone
//!     won't fix that.

use base64::Engine as _;
use sha2::{Digest, Sha512};
use sqlx::mysql::MySqlPoolOptions;
use std::env;
use std::process::ExitCode;

#[tokio::main]
async fn main() -> ExitCode {
    dotenvy::dotenv().ok();

    let args: Vec<String> = env::args().collect();
    if args.len() != 3 {
        eprintln!("usage: reset-password <username> <new-password>");
        eprintln!();
        eprintln!("Example:");
        eprintln!("  cargo run --bin reset-password -- admin 'hunter2'");
        return ExitCode::from(2);
    }
    let username = &args[1];
    let new_password = &args[2];

    let database_url = match env::var("DATABASE_URL") {
        Ok(v) => v,
        Err(_) => {
            eprintln!("error: DATABASE_URL must be set (see backend/.env)");
            return ExitCode::from(1);
        }
    };

    let pool = match MySqlPoolOptions::new()
        .max_connections(2)
        .connect(&database_url)
        .await
    {
        Ok(p) => p,
        Err(e) => {
            eprintln!("error: connecting to DB failed: {e}");
            return ExitCode::from(1);
        }
    };

    // Look up the user's salt + status. We accept either casing of
    // the username argument.
    let row: Option<(i64, String, bool, bool)> = match sqlx::query_as(
        "SELECT id, salt, enabled, locked \
         FROM FOSUser \
         WHERE username_canonical = LOWER(?) OR username = ? \
         LIMIT 1",
    )
    .bind(username)
    .bind(username)
    .fetch_optional(&pool)
    .await
    {
        Ok(r) => r,
        Err(e) => {
            eprintln!("error: lookup query failed: {e}");
            return ExitCode::from(1);
        }
    };

    let (user_id, salt, enabled, locked) = match row {
        Some(r) => r,
        None => {
            eprintln!("error: user '{username}' not found in FOSUser");
            return ExitCode::from(1);
        }
    };

    let hashed = hash_fos_password(new_password, &salt);

    let res = match sqlx::query("UPDATE FOSUser SET password = ? WHERE id = ?")
        .bind(&hashed)
        .bind(user_id)
        .execute(&pool)
        .await
    {
        Ok(r) => r,
        Err(e) => {
            eprintln!("error: UPDATE failed: {e}");
            return ExitCode::from(1);
        }
    };

    if res.rows_affected() != 1 {
        eprintln!(
            "error: UPDATE affected {} rows (expected 1)",
            res.rows_affected()
        );
        return ExitCode::from(1);
    }

    println!("password reset for '{username}' (FOSUser.id={user_id})");
    if !enabled {
        println!("note: user is currently disabled (enabled=0) — they still can't log in.");
    }
    if locked {
        println!("note: user is currently locked (locked=1) — they still can't log in.");
    }
    ExitCode::SUCCESS
}

/// FOSUserBundle's MessageDigestPasswordEncoder: salted = "{pw}{salt}",
/// digest = sha512(salted), then 4999 more iterations of
/// sha512(prev_digest || salted), final result base64-encoded.
///
/// Mirrors `verify_fos_password` in `handlers/auth.rs`. Keep them in
/// sync; if either is changed, both must change.
fn hash_fos_password(password: &str, salt: &str) -> String {
    let salted = format!("{password}{{{salt}}}");
    let salted_bytes = salted.as_bytes();
    let mut digest = Sha512::digest(salted_bytes).to_vec();
    for _ in 1..5000 {
        let mut h = Sha512::new();
        h.update(&digest);
        h.update(salted_bytes);
        digest = h.finalize().to_vec();
    }
    base64::engine::general_purpose::STANDARD.encode(&digest)
}
