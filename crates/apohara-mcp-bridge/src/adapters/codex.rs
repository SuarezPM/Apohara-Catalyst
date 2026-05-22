//! Codex dialect: .codex/config.toml with [mcp_servers.NAME] sections.
//! We emit TOML as a string (no full toml-edit roundtrip in this pass; preserved
//! by JSONC adapter per §0.27 in a future pass).
use crate::canonical::McpCanonical;

pub fn to_codex_toml(c: &McpCanonical) -> String {
    let mut out = String::new();
    for s in &c.servers {
        out.push_str(&format!("[mcp_servers.{}]\n", s.name));
        out.push_str(&format!("command = {:?}\n", s.command));
        out.push_str("args = [");
        for (i, a) in s.args.iter().enumerate() {
            if i > 0 { out.push_str(", "); }
            out.push_str(&format!("{:?}", a));
        }
        out.push_str("]\n");
        if !s.env.is_empty() {
            out.push_str("env = {");
            let pairs: Vec<String> = s.env.iter().map(|(k,v)| format!("{} = {:?}", k, v)).collect();
            out.push_str(&pairs.join(", "));
            out.push_str("}\n");
        }
        out.push('\n');
    }
    out
}