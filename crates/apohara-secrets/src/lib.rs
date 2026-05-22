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
//!
//! Secrets are returned as a `SecretString` newtype that zeroizes its
//! backing buffer on drop. Without this, a `String` returned by `lookup`
//! lands on the regular heap, gets dropped without overwrite, and the
//! freed page can be re-read by the next allocator user — or surface in
//! core dumps / swap files / process snapshots. The newtype's `Debug`
//! intentionally hides the value so accidental `info!(?secret, ...)`
//! calls log a redacted marker instead.

use std::fmt;
use thiserror::Error;
use zeroize::Zeroize;

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

/// Wrapper around a secret string that:
///   - zeroes its memory on drop (defeats heap re-read attacks),
///   - hides its value in `Debug` so `tracing::info!(?secret, ...)` cannot
///     accidentally log the cleartext token.
///
/// Use `expose()` only at the moment you have to hand the bytes to a
/// transport (HTTP header, env var, file write) and never `.clone()`
/// the inner String — that would extend the lifetime of plaintext into
/// callers that may forget the zeroize discipline.
pub struct SecretString(String);

impl SecretString {
	pub fn new(value: String) -> Self {
		Self(value)
	}
	/// Borrow the cleartext. Caller is responsible for not copying the
	/// returned slice into long-lived plaintext storage.
	pub fn expose(&self) -> &str {
		&self.0
	}
	pub fn into_inner(self) -> String {
		// Bypasses the Drop scrubber — only use when the caller has its
		// own zeroize discipline (rare).
		let mut s = self;
		std::mem::take(&mut s.0)
	}
}

impl Drop for SecretString {
	fn drop(&mut self) {
		self.0.zeroize();
	}
}

impl fmt::Debug for SecretString {
	fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
		f.write_str("SecretString(***)")
	}
}

pub fn store(scope: &SecretScope, secret: &str) -> Result<(), SecretError> {
	let entry = keyring::Entry::new(&scope.service, &scope.username)?;
	entry.set_password(secret)?;
	// Log scope only, never the secret value itself. SecretString's
	// Debug also redacts so accidental `?secret` formatting is safe.
	tracing::debug!(scope = ?scope, "secret stored");
	Ok(())
}

pub fn lookup(scope: &SecretScope) -> Result<Option<SecretString>, SecretError> {
	let entry = keyring::Entry::new(&scope.service, &scope.username)?;
	match entry.get_password() {
		Ok(s) => Ok(Some(SecretString::new(s))),
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

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn debug_redacts_value() {
		let s = SecretString::new("hunter2".into());
		assert_eq!(format!("{s:?}"), "SecretString(***)");
		assert_eq!(s.expose(), "hunter2");
	}
}
