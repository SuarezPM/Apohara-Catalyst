//! Apohara MCP — internal MCP servers (bootstrap, canonical schema,
//! injection, base + servers/{ledger,runs,indexer,settings,commit}).
//!
//! Replaces `src/core/mcp/*.ts` (TS legacy). Feature flag:
//! APOHARA_RUST_MCP=1 (default OFF until Phase 1 cierre).
//!
//! Built on `axum` (HTTP + bearer auth) plus `apohara-mcp-bridge` for
//! the canonical MCP config types (single source of truth, shared with
//! the existing dialect adapters). G1.C.1 port — modules ported
//! task-by-task following TDD.

pub mod audit_logger;
pub mod bootstrap;
pub mod injection;
pub mod input_validation;
pub mod permission_guard;
pub mod rate_limit;
pub mod server;
pub mod servers;
pub mod tauri_bridge;

pub use audit_logger::{AuditEntry, AuditError, AuditLogger, AuditStatus};
pub use bootstrap::{
    bootstrap_mcp_servers, build_canonical_from_handle, default_audit_log_path,
    default_endpoint_file_path, default_settings_storage_path, BootstrapHandle, BootstrapOpts,
    EndpointDescriptor, EndpointPort, EndpointServers,
};
pub use injection::{
    build_canonical_from_endpoint, inject_mcp_config, EndpointPorts, InjectionError,
    InjectionResult, ProviderId,
};
pub use input_validation::{
    optional_integer, optional_string, optional_string_array, require_record, require_string,
    McpValidationError, ValidationResult,
};
pub use permission_guard::{GuardrailFlagMetadata, PermissionGuard, PermissionedToolSpec};
pub use rate_limit::{RateLimitConfig, TokenBucket, DEFAULT_RATE_LIMITS};
pub use server::{
    tool_handler, McpError, McpServer, McpServerConfig, RunningServer, ToolHandler,
    ToolRegistration,
};

// Re-export canonical types from the bridge crate (single source of truth).
pub use apohara_mcp_bridge::{McpCanonical, McpServerCanonical, McpServerType};
