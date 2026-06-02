//! OpenCode dialect: { mcp: { name: {...} } } written to `opencode.jsonc` at
//! the WORKSPACE ROOT — NOT `.opencode/settings.json` (opencode 1.15+ discovers
//! config from `opencode.jsonc` at the root; the `.opencode/settings.json` path
//! is a documented past-incident, see CLAUDE.md). The injection writer in
//! `apohara-mcp::injection::inject_opencode` owns the path and already targets
//! `<ws>/opencode.jsonc`; this adapter only shapes the value.
use crate::canonical::{McpCanonical, McpServerCanonical, McpServerType};
use serde_json::{json, Value};

pub fn to_opencode(c: &McpCanonical) -> Value {
    let mut mcp = serde_json::Map::new();
    for s in &c.servers {
        mcp.insert(s.name.clone(), server_to_opencode(s));
    }
    json!({ "mcp": mcp })
}

fn server_to_opencode(s: &McpServerCanonical) -> Value {
    let ty = match s.ty {
        McpServerType::Local => "local",
        McpServerType::Remote => "remote",
    };
    json!({
        "type": ty,
        "command": s.command,
        "args": s.args,
        "env": s.env,
    })
}