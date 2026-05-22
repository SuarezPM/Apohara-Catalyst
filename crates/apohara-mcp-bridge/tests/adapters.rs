use apohara_mcp_bridge::adapters::{claude, codex, opencode};
use apohara_mcp_bridge::canonical::{McpCanonical, McpServerCanonical, McpServerType};
use std::collections::HashMap;

fn sample() -> McpCanonical {
    let mut env = HashMap::new();
    env.insert("FOO".into(), "bar".into());
    McpCanonical {
        servers: vec![McpServerCanonical {
            name: "apohara.ledger".into(),
            meta: HashMap::new(),
            command: "apohara".into(),
            args: vec!["mcp".into(), "serve".into(), "ledger".into()],
            env,
            ty: McpServerType::Local,
        }],
    }
}

#[test]
fn to_claude_has_mcp_servers_key() {
    let out = claude::to_claude(&sample());
    let s = serde_json::to_string(&out).unwrap();
    assert!(s.contains("mcpServers"));
    assert!(s.contains("apohara.ledger"));
}

#[test]
fn to_codex_emits_toml_section() {
    let out = codex::to_codex_toml(&sample());
    // Server names containing `.` are emitted as quoted TOML keys so
    // they don't accidentally become nested tables (apohara → ledger).
    assert!(out.contains("[mcp_servers.\"apohara.ledger\"]"), "got: {out}");
    assert!(out.contains("command = \"apohara\""));
    assert!(out.contains("args = [\"mcp\", \"serve\", \"ledger\"]"));
}

#[test]
fn to_opencode_uses_local_type() {
    let out = opencode::to_opencode(&sample());
    let s = serde_json::to_string(&out).unwrap();
    assert!(s.contains("\"type\":\"local\""));
    assert!(s.contains("apohara.ledger"));
}

#[test]
fn canonical_roundtrip_via_serde_json() {
    let c = sample();
    let s = serde_json::to_string(&c).unwrap();
    let parsed: McpCanonical = serde_json::from_str(&s).unwrap();
    assert_eq!(c, parsed);
}