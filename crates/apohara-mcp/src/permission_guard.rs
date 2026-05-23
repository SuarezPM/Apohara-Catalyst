//! Deny-by-non-registration permission guard for MCP tools.
//!
//! Mirrors `src/core/mcp/permissionGuard.ts` (chorus H11 / T3.12). Tools
//! are visible to an agent only when BOTH conditions hold:
//!   1. The tool was registered via `register_permissioned_tool`, AND
//!   2. The required permission has been granted via `grant_permission`.
//!
//! Unregistered = invisible. This closes the common MCP gap where a
//! tool accidentally exposed by an upstream server (or sneaked in via
//! dynamic registration) is callable just by being in the tool list.
//!
//! When the tool's `required_perm` matches a guardrail-flag code, the
//! guard can surface that flag's metadata so UI / audit / telemetry all
//! consume the SAME instance and labels never drift across surfaces.

use std::collections::{BTreeMap, HashSet};

use apohara_safety::{flag_from_str, GuardrailSeverity};

#[derive(Debug, Clone)]
pub struct PermissionedToolSpec {
    pub tool: String,
    pub required_perm: String,
}

/// Flat view of a guardrail flag for UI / audit consumers.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GuardrailFlagMetadata {
    pub code: String,
    pub severity: GuardrailSeverity,
    pub description: String,
    pub suggested_action: String,
}

#[derive(Debug, Default)]
pub struct PermissionGuard {
    // BTreeMap so `visible_tools()` returns a stable order — handy for
    // snapshot tests + deterministic UI rendering.
    registered: BTreeMap<String, String>,
    granted: HashSet<String>,
}

impl PermissionGuard {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn register_permissioned_tool(&mut self, spec: PermissionedToolSpec) {
        self.registered.insert(spec.tool, spec.required_perm);
    }

    pub fn grant_permission(&mut self, perm: impl Into<String>) {
        self.granted.insert(perm.into());
    }

    pub fn revoke_permission(&mut self, perm: &str) {
        self.granted.remove(perm);
    }

    pub fn is_tool_visible(&self, tool: &str) -> bool {
        match self.registered.get(tool) {
            None => false, // deny by non-registration
            Some(req) => self.granted.contains(req),
        }
    }

    pub fn visible_tools(&self) -> Vec<String> {
        self.registered
            .keys()
            .filter(|t| self.is_tool_visible(t))
            .cloned()
            .collect()
    }

    /// If `tool`'s `required_perm` matches a known guardrail flag code,
    /// return its self-describing metadata; otherwise `None`.
    pub fn describe_required_flag(&self, tool: &str) -> Option<GuardrailFlagMetadata> {
        let req = self.registered.get(tool)?;
        let flag = flag_from_str(req)?;
        Some(GuardrailFlagMetadata {
            code: flag.code.as_str().to_string(),
            severity: flag.severity,
            description: flag.description.to_string(),
            suggested_action: flag.suggested_action.to_string(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn spec(tool: &str, perm: &str) -> PermissionedToolSpec {
        PermissionedToolSpec {
            tool: tool.into(),
            required_perm: perm.into(),
        }
    }

    #[test]
    fn unregistered_tool_invisible() {
        let g = PermissionGuard::new();
        assert!(!g.is_tool_visible("ghost"));
    }

    #[test]
    fn registered_but_ungranted_is_invisible() {
        let mut g = PermissionGuard::new();
        g.register_permissioned_tool(spec("blast_radius", "indexer.read"));
        assert!(!g.is_tool_visible("blast_radius"));
    }

    #[test]
    fn registered_and_granted_is_visible() {
        let mut g = PermissionGuard::new();
        g.register_permissioned_tool(spec("blast_radius", "indexer.read"));
        g.grant_permission("indexer.read");
        assert!(g.is_tool_visible("blast_radius"));
    }

    #[test]
    fn revoke_hides_tool() {
        let mut g = PermissionGuard::new();
        g.register_permissioned_tool(spec("t", "p"));
        g.grant_permission("p");
        assert!(g.is_tool_visible("t"));
        g.revoke_permission("p");
        assert!(!g.is_tool_visible("t"));
    }

    #[test]
    fn visible_tools_returns_stable_order() {
        let mut g = PermissionGuard::new();
        g.register_permissioned_tool(spec("zebra", "p"));
        g.register_permissioned_tool(spec("apple", "p"));
        g.register_permissioned_tool(spec("mango", "q"));
        g.grant_permission("p");
        let v = g.visible_tools();
        // BTreeMap ordering — alphabetical and excluding mango (no grant).
        assert_eq!(v, vec!["apple".to_string(), "zebra".to_string()]);
    }

    #[test]
    fn describe_required_flag_resolves_known_codes() {
        let mut g = PermissionGuard::new();
        g.register_permissioned_tool(spec("flake", "PROMPT_INJECTION_DETECTED"));
        let meta = g
            .describe_required_flag("flake")
            .expect("known flag must resolve");
        assert_eq!(meta.code, "PROMPT_INJECTION_DETECTED");
        assert_eq!(meta.severity, GuardrailSeverity::Critical);
        assert!(!meta.description.is_empty());
        assert!(!meta.suggested_action.is_empty());
    }

    #[test]
    fn describe_required_flag_none_for_unknown_perm() {
        let mut g = PermissionGuard::new();
        g.register_permissioned_tool(spec("t", "indexer.read"));
        assert!(g.describe_required_flag("t").is_none());
    }

    #[test]
    fn describe_required_flag_none_for_unregistered() {
        let g = PermissionGuard::new();
        assert!(g.describe_required_flag("ghost").is_none());
    }
}
