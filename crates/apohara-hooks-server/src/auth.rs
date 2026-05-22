//! Bearer token middleware for the hooks loopback server.

use axum::{
    extract::{Request, State},
    http::StatusCode,
    middleware::Next,
    response::Response,
};
use std::sync::Arc;

#[derive(Clone)]
pub struct AuthState {
    pub bearer_token: Arc<String>,
}

pub async fn bearer_auth(
    State(state): State<AuthState>,
    req: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    let header = req.headers().get("authorization").and_then(|v| v.to_str().ok());
    match header {
        Some(value) if value.starts_with("Bearer ") => {
            let token = &value[7..];
            if subtle_eq(token.as_bytes(), state.bearer_token.as_bytes()) {
                Ok(next.run(req).await)
            } else {
                Err(StatusCode::UNAUTHORIZED)
            }
        }
        _ => Err(StatusCode::UNAUTHORIZED),
    }
}

/// Constant-time byte slice equality. Mitigates timing oracles.
fn subtle_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() { return false; }
    let mut diff: u8 = 0;
    for (x, y) in a.iter().zip(b.iter()) { diff |= x ^ y; }
    diff == 0
}
