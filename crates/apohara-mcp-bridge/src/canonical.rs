//! Canonical MCP server config per spec §8.7.
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum McpServerType { Local, Remote }

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct McpServerCanonical {
    pub name: String,
    #[serde(default)]
    pub meta: HashMap<String, String>,
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: HashMap<String, String>,
    #[serde(rename = "type")]
    pub ty: McpServerType,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct McpCanonical {
    pub servers: Vec<McpServerCanonical>,
}