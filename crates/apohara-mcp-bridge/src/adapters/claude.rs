//! Claude dialect: .claude/mcp.json with shape { mcpServers: { name: {...} } }
use crate::canonical::{McpCanonical, McpServerCanonical};
use serde_json::{json, Value};

pub fn to_claude(c: &McpCanonical) -> Value {
    let mut servers = serde_json::Map::new();
    for s in &c.servers {
        servers.insert(s.name.clone(), server_to_claude(s));
    }
    json!({ "mcpServers": servers })
}

fn server_to_claude(s: &McpServerCanonical) -> Value {
    json!({
        "command": s.command,
        "args": s.args,
        "env": s.env,
    })
}