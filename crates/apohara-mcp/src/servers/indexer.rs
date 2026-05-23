//! apohara.indexer MCP server.
//!
//! Mirrors `src/core/mcp/servers/apohara-indexer.ts`. Tools: blast_radius
//! / search_symbols / file_symbols / reverse_dependencies. Backed by a
//! trait so this crate doesn't pull apohara-indexer at this layer — the
//! cli/desktop binary wires a concrete adapter (over UDS or in-process).
//! A `StubIndexerClient` ships for tests and pre-wire bootstrapping.

use std::sync::Arc;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::input_validation::{optional_string, require_string};
use crate::server::{tool_handler, ToolRegistration};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SymbolMatch {
    pub file: String,
    pub symbol: String,
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub line: Option<u32>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Confidence {
    High,
    Low,
    None,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlastRadiusResult {
    pub symbols: Vec<SymbolMatch>,
    pub confidence: Confidence,
}

#[async_trait]
pub trait IndexerClient: Send + Sync {
    async fn blast_radius(&self, symbol: &str) -> Result<BlastRadiusResult, String>;
    async fn search_symbols(
        &self,
        query: &str,
        kind: Option<&str>,
    ) -> Result<Vec<SymbolMatch>, String>;
    async fn file_symbols(&self, file: &str) -> Result<Vec<SymbolMatch>, String>;
    async fn reverse_dependencies(&self, symbol: &str) -> Result<Vec<SymbolMatch>, String>;
}

pub struct StubIndexerClient;

#[async_trait]
impl IndexerClient for StubIndexerClient {
    async fn blast_radius(&self, _symbol: &str) -> Result<BlastRadiusResult, String> {
        Ok(BlastRadiusResult {
            symbols: vec![],
            confidence: Confidence::None,
        })
    }
    async fn search_symbols(
        &self,
        _query: &str,
        _kind: Option<&str>,
    ) -> Result<Vec<SymbolMatch>, String> {
        Ok(vec![])
    }
    async fn file_symbols(&self, _file: &str) -> Result<Vec<SymbolMatch>, String> {
        Ok(vec![])
    }
    async fn reverse_dependencies(&self, _symbol: &str) -> Result<Vec<SymbolMatch>, String> {
        Ok(vec![])
    }
}

pub fn build_indexer_tools(client: Arc<dyn IndexerClient>) -> Vec<ToolRegistration> {
    let c1 = Arc::clone(&client);
    let c2 = Arc::clone(&client);
    let c3 = Arc::clone(&client);
    let c4 = Arc::clone(&client);
    vec![
        ToolRegistration {
            name: "blast_radius".to_string(),
            handler: tool_handler(move |input| {
                let client = Arc::clone(&c1);
                async move {
                    let symbol = require_string(&input, "symbol")?;
                    let result = client
                        .blast_radius(&symbol)
                        .await
                        .map_err(crate::server::McpError::other)?;
                    Ok(json!({
                        "symbols": result.symbols,
                        "confidence": result.confidence,
                    }))
                }
            }),
        },
        ToolRegistration {
            name: "search_symbols".to_string(),
            handler: tool_handler(move |input| {
                let client = Arc::clone(&c2);
                async move {
                    let query = require_string(&input, "query")?;
                    let kind = optional_string(&input, "kind")?;
                    let matches = client
                        .search_symbols(&query, kind.as_deref())
                        .await
                        .map_err(crate::server::McpError::other)?;
                    Ok(json!({ "matches": matches }))
                }
            }),
        },
        ToolRegistration {
            name: "file_symbols".to_string(),
            handler: tool_handler(move |input| {
                let client = Arc::clone(&c3);
                async move {
                    let file = require_string(&input, "file")?;
                    let symbols = client
                        .file_symbols(&file)
                        .await
                        .map_err(crate::server::McpError::other)?;
                    Ok(json!({ "symbols": symbols }))
                }
            }),
        },
        ToolRegistration {
            name: "reverse_dependencies".to_string(),
            handler: tool_handler(move |input| {
                let client = Arc::clone(&c4);
                async move {
                    let symbol = require_string(&input, "symbol")?;
                    let dependents = client
                        .reverse_dependencies(&symbol)
                        .await
                        .map_err(crate::server::McpError::other)?;
                    Ok(json!({ "dependents": dependents }))
                }
            }),
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Map, Value};

    #[tokio::test]
    async fn stub_blast_radius_returns_none_confidence() {
        let client = Arc::new(StubIndexerClient);
        let tools = build_indexer_tools(client);
        let t = tools.iter().find(|t| t.name == "blast_radius").unwrap();
        let mut input = Map::new();
        input.insert("symbol".into(), Value::String("foo".into()));
        let out = (t.handler)(input).await.unwrap();
        assert_eq!(out["confidence"], "none");
        assert_eq!(out["symbols"].as_array().unwrap().len(), 0);
    }

    #[tokio::test]
    async fn search_symbols_requires_query() {
        let client = Arc::new(StubIndexerClient);
        let tools = build_indexer_tools(client);
        let t = tools.iter().find(|t| t.name == "search_symbols").unwrap();
        let err = (t.handler)(Map::new()).await.unwrap_err();
        assert!(matches!(err, crate::server::McpError::Validation(_)));
    }

    struct CountingClient;
    #[async_trait]
    impl IndexerClient for CountingClient {
        async fn blast_radius(&self, symbol: &str) -> Result<BlastRadiusResult, String> {
            Ok(BlastRadiusResult {
                symbols: vec![SymbolMatch {
                    file: "f".into(),
                    symbol: symbol.to_string(),
                    kind: "fn".into(),
                    line: Some(10),
                }],
                confidence: Confidence::High,
            })
        }
        async fn search_symbols(
            &self,
            query: &str,
            _kind: Option<&str>,
        ) -> Result<Vec<SymbolMatch>, String> {
            Ok(vec![SymbolMatch {
                file: format!("{query}.rs"),
                symbol: query.to_string(),
                kind: "fn".into(),
                line: None,
            }])
        }
        async fn file_symbols(&self, file: &str) -> Result<Vec<SymbolMatch>, String> {
            Ok(vec![SymbolMatch {
                file: file.to_string(),
                symbol: "x".into(),
                kind: "fn".into(),
                line: Some(1),
            }])
        }
        async fn reverse_dependencies(&self, _symbol: &str) -> Result<Vec<SymbolMatch>, String> {
            Ok(vec![])
        }
    }

    #[tokio::test]
    async fn search_symbols_forwards_query_to_backend() {
        let client = Arc::new(CountingClient);
        let tools = build_indexer_tools(client);
        let t = tools.iter().find(|t| t.name == "search_symbols").unwrap();
        let mut input = Map::new();
        input.insert("query".into(), Value::String("foo".into()));
        let out = (t.handler)(input).await.unwrap();
        let arr = out["matches"].as_array().unwrap();
        assert_eq!(arr.len(), 1);
        assert_eq!(arr[0]["symbol"], "foo");
        assert_eq!(arr[0]["file"], "foo.rs");
    }
}
