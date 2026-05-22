//! Catches regressions where keyring platform features get stripped from Cargo.toml,
//! which would silently re-enable the in-process mock backend (spec §0.10 violation).
//!
//! keyring 3.6 exposes no stable `id()` on `CredentialBuilderApi`, but the
//! `persistence()` lifetime is sufficient: the mock backend reports
//! `CredentialPersistence::EntryOnly` (password lives in the entry struct,
//! evaporates when dropped), while every real OS backend reports `UntilDelete`
//! (secret-service / macOS Keychain / Windows Credential Manager) or
//! `UntilReboot` (linux keyutils). Any non-`EntryOnly` value proves a real
//! backend is wired at compile time.

use keyring::credential::CredentialPersistence;

#[cfg(any(target_os = "linux", target_os = "macos", target_os = "windows"))]
#[test]
fn real_backend_compiled_in_not_mock() {
    let builder = keyring::default::default_credential_builder();
    // CredentialPersistence has no PartialEq/Debug, so match on it.
    let is_mock = matches!(builder.persistence(), CredentialPersistence::EntryOnly);
    assert!(
        !is_mock,
        "keyring platform features missing; default builder reports EntryOnly persistence \
         (mock backend); secrets would not survive a process restart and spec §0.10 is violated"
    );
}
