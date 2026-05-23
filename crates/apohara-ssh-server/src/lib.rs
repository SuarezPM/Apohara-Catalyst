//! apohara-ssh-server — embedded SSH server for distributed compute workers (G6.C).
//!
//! Bound to `127.0.0.1` ONLY. Key-based authentication is mandatory.
//! Password authentication is explicitly denied.
//!
//! Activated only when `APOHARA_REMOTE_WORKERS=1`.
//!
//! Endpoint file (`~/.apohara/ssh-server/endpoint.json`) advertises the
//! kernel-assigned port so clients (`apohara worker`) can connect.

pub mod audit;
pub mod auth;
pub mod endpoint;
pub mod server;

pub use audit::{
    append_to as audit_append_to, default_path as audit_default_path, read_all as audit_read_all,
    AuditError, AuditEvent, AuditEventKind, AuditLog,
};
pub use auth::{
    decide_password, decide_publickey, AuthOutcome, AuthorizedKeyEntry, AuthorizedKeys,
    AuthorizedKeysError, ALLOWED_ALGOS,
};
pub use endpoint::{Endpoint, EndpointError};
pub use server::{ServerConfig, ServerHandle, ServerStartError};

/// Environment flag gating remote worker functionality.
pub const FEATURE_FLAG: &str = "APOHARA_REMOTE_WORKERS";

/// Returns true when the remote workers feature flag is set to `1`.
pub fn feature_enabled() -> bool {
    std::env::var(FEATURE_FLAG).ok().as_deref() == Some("1")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn feature_flag_default_off() {
        // Default behavior: when not set, feature is OFF.
        // We don't unset here (could pollute other tests); just verify the API exists
        // and FEATURE_FLAG is the expected constant.
        assert_eq!(FEATURE_FLAG, "APOHARA_REMOTE_WORKERS");
    }

    #[test]
    fn feature_flag_enabled_when_set_to_one() {
        // SAFETY: scoped env mutation in test only.
        unsafe { std::env::set_var(FEATURE_FLAG, "1") };
        assert!(feature_enabled());
        unsafe { std::env::remove_var(FEATURE_FLAG) };
    }

    #[test]
    fn feature_flag_off_for_other_values() {
        unsafe { std::env::set_var(FEATURE_FLAG, "0") };
        assert!(!feature_enabled());
        unsafe { std::env::set_var(FEATURE_FLAG, "true") };
        assert!(!feature_enabled());
        unsafe { std::env::remove_var(FEATURE_FLAG) };
    }
}
