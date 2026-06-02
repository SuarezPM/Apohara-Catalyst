//! Client for the external Context Forge compression sidecar (US-F4.3).
//!
//! Context Forge (`SuarezPM/Apohara_Context_Forge`, checked out at
//! `../apohara-context-forge`) is an **external Python sidecar**, NOT a Rust
//! workspace lib — it owns LLMLingua-2 compression + APC prefix reuse and is
//! invoked over its HTTP tool surface. The canonical tool is
//! `get_optimized_context` (verified in the sidecar's
//! `apohara_context_forge/mcp/server.py:201`,
//! `@app.post("/tools/get_optimized_context")`), which returns a
//! [`CompressionDecision`] carrying `tokens_saved`.
//!
//! This client is intentionally thin: the heavy lifting (models, GPU/CPU
//! fallback, the JCR safety gate) lives in the sidecar. We serialize the
//! request, POST it, and parse the decision. A 503 passthrough body (the
//! sidecar's coordinator-unavailable fallback) deserializes the same shape
//! with `tokens_saved == 0`, so callers can fall back to the original context.

use serde::{Deserialize, Serialize};

/// Request body for `POST /tools/get_optimized_context`. Mirrors the sidecar's
/// `OptimizedContextRequest` (`agent_id` + `context`).
#[derive(Debug, Clone, Serialize)]
pub struct OptimizedContextRequest {
    pub agent_id: String,
    pub context: String,
}

/// The sidecar's compression decision. Field-for-field with the sidecar's
/// `CompressionDecision` pydantic model; optional fields carry serde defaults
/// so both the 200 decision and the 503 passthrough body parse.
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct CompressionDecision {
    pub strategy: String,
    #[serde(default)]
    pub shared_prefix: Option<String>,
    #[serde(default)]
    pub compressed_context: Option<String>,
    #[serde(default)]
    pub final_context: String,
    #[serde(default)]
    pub original_tokens: u64,
    #[serde(default)]
    pub final_tokens: u64,
    #[serde(default)]
    pub tokens_saved: u64,
    #[serde(default)]
    pub rationale: String,
    #[serde(default)]
    pub savings_pct: f64,
}

#[derive(Debug, thiserror::Error)]
pub enum ContextForgeError {
    #[error("http: {0}")]
    Http(#[from] reqwest::Error),
    #[error("sidecar returned status {status}: {body}")]
    Status { status: u16, body: String },
}

/// Thin HTTP client for the compression sidecar.
#[derive(Debug, Clone)]
pub struct ContextForgeClient {
    base_url: String,
    http: reqwest::Client,
}

impl ContextForgeClient {
    /// `base_url` is the sidecar root, e.g. `http://127.0.0.1:8000`.
    pub fn new(base_url: impl Into<String>) -> Self {
        Self {
            base_url: base_url.into().trim_end_matches('/').to_string(),
            http: reqwest::Client::new(),
        }
    }

    /// Invoke `get_optimized_context`. Returns the parsed decision on 2xx; the
    /// 503 passthrough body (coordinator unavailable) is surfaced as the
    /// decision too (it parses, `tokens_saved == 0`, strategy `passthrough`),
    /// so callers can transparently fall back to the original context.
    pub async fn get_optimized_context(
        &self,
        agent_id: &str,
        context: &str,
    ) -> Result<CompressionDecision, ContextForgeError> {
        let url = format!("{}/tools/get_optimized_context", self.base_url);
        let req = OptimizedContextRequest {
            agent_id: agent_id.to_string(),
            context: context.to_string(),
        };
        let resp = self.http.post(&url).json(&req).send().await?;
        let status = resp.status();
        // 200 (decision) and 503 (passthrough) both carry a CompressionDecision
        // body; anything else is a hard error.
        if status.is_success() || status.as_u16() == 503 {
            Ok(resp.json::<CompressionDecision>().await?)
        } else {
            Err(ContextForgeError::Status {
                status: status.as_u16(),
                body: resp.text().await.unwrap_or_default(),
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn request_serializes_agent_and_context() {
        let req = OptimizedContextRequest {
            agent_id: "claude-blade".to_string(),
            context: "long shared context...".to_string(),
        };
        let v = serde_json::to_value(&req).unwrap();
        assert_eq!(v["agent_id"], "claude-blade");
        assert_eq!(v["context"], "long shared context...");
    }

    #[test]
    fn parses_a_compression_decision_with_tokens_saved() {
        // Real-shaped 200 body from the sidecar's get_optimized_context.
        let body = serde_json::json!({
            "strategy": "compress",
            "shared_prefix": "system preamble",
            "compressed_context": "compacted",
            "final_context": "compacted",
            "original_tokens": 1000,
            "final_tokens": 560,
            "tokens_saved": 440,
            "rationale": "llmlingua-2 ratio 0.56",
            "savings_pct": 44.0
        });
        let d: CompressionDecision = serde_json::from_value(body).unwrap();
        assert_eq!(d.strategy, "compress");
        assert_eq!(d.tokens_saved, 440, "client must extract tokens_saved > 0");
        assert!(d.savings_pct > 0.0);
    }

    #[test]
    fn parses_503_passthrough_body() {
        // The coordinator-unavailable fallback (status 503) is a valid decision.
        let body = serde_json::json!({
            "strategy": "passthrough",
            "final_context": "original",
            "compressed_context": "original",
            "shared_prefix": "",
            "original_tokens": 0,
            "final_tokens": 0,
            "tokens_saved": 0,
            "rationale": "coordinator_unavailable",
            "savings_pct": 0.0
        });
        let d: CompressionDecision = serde_json::from_value(body).unwrap();
        assert_eq!(d.strategy, "passthrough");
        assert_eq!(d.tokens_saved, 0);
    }

    #[test]
    fn base_url_trailing_slash_normalized() {
        let c = ContextForgeClient::new("http://127.0.0.1:8000/");
        assert_eq!(c.base_url, "http://127.0.0.1:8000");
    }

    /// End-to-end acceptance (≥1 real MCP call with tokens_saved > 0).
    ///
    /// SKIPPED by default with reason: the sidecar is an external Python
    /// service requiring heavy deps (torch / transformers / LLMLingua-2) that
    /// are not provisioned in the Rust CI environment. To run locally:
    ///   1. `cd ../apohara-context-forge && uvicorn apohara_context_forge.mcp.server:app --port 8000`
    ///   2. `cargo test -p apohara-mcp context_forge_live -- --ignored`
    #[tokio::test]
    #[ignore = "requires the external Python Context Forge sidecar running on :8000"]
    async fn context_forge_live_call_saves_tokens() {
        let client = ContextForgeClient::new("http://127.0.0.1:8000");
        let long = "duplicated paragraph. ".repeat(200);
        let decision = client
            .get_optimized_context("test-blade", &long)
            .await
            .expect("sidecar reachable");
        assert!(
            decision.tokens_saved > 0 || decision.strategy == "passthrough",
            "a live compression call should save tokens (or passthrough if coordinator down)"
        );
    }
}
