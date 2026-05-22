//! OpenCode dialect: .opencode/settings.json with { mcp: { name: {...} } }
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