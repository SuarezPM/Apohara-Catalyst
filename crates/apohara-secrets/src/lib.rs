//! OS-native credential storage per spec §0.10.
//!
//! Wraps `keyring-rs` (which abstracts macOS Keychain, Windows Credential
//! Manager, Linux libsecret) with Apohara-specific conventions: service =
//! "apohara", username = `<purpose>-<id>` (e.g., "mcp-bearer-token-runs",
//! "github-app-private-key-path").
//!
//! All bearer tokens, GitHub App keys, ContextForge sidecar tokens MUST
//! go through this crate — never to plaintext config files or persistent
//! env vars.

use thiserror::Error;

#[derive(Debug, Error)]
pub enum SecretError {
    #[error("keyring backend error: {0}")]
    Backend(#[from] keyring::Error),
    #[error("invalid scope: {0}")]
    InvalidScope(String),
}

#[derive(Debug, Clone)]
pub struct SecretScope {
    service: String,
    username: String,
}

impl SecretScope {
    pub fn new(service: impl Into<String>, username: impl Into<String>) -> Self {
        Self {
            service: service.into(),
            username: username.into(),
        }
    }
    pub fn apohara(purpose: &str) -> Self {
        Self::new("apohara", purpose)
    }
    pub fn service(&self) -> &str {
        &self.service
    }
    pub fn username(&self) -> &str {
        &self.username
    }
}

pub fn store(scope: &SecretScope, secret: &str) -> Result<(), SecretError> {
    let entry = keyring::Entry::new(&scope.service, &scope.username)?;
    entry.set_password(secret)?;
    tracing::info!(scope = ?scope, "secret stored");
    Ok(())
}

pub fn lookup(scope: &SecretScope) -> Result<Option<String>, SecretError> {
    let entry = keyring::Entry::new(&scope.service, &scope.username)?;
    match entry.get_password() {
        Ok(s) => Ok(Some(s)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(SecretError::Backend(e)),
    }
}

pub fn delete(scope: &SecretScope) -> Result<(), SecretError> {
    let entry = keyring::Entry::new(&scope.service, &scope.username)?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()), // idempotent delete
        Err(e) => Err(SecretError::Backend(e)),
    }
}
