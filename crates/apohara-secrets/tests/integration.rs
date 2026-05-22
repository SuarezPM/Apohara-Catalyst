use apohara_secrets::{delete, lookup, store, SecretScope};

#[test]
#[ignore = "requires OS keyring, skip in headless CI"]
fn roundtrip_apohara_mcp_token() {
    let scope = SecretScope::new("apohara-test", "mcp-bearer-token-test");
    let token = "test-bearer-token-abc123";

    store(&scope, token).expect("store failed");
    let retrieved = lookup(&scope).expect("lookup failed");
    assert_eq!(retrieved.as_deref(), Some(token));

    delete(&scope).expect("delete failed");
    let after = lookup(&scope).expect("lookup after delete failed");
    assert_eq!(after, None);
}

#[test]
fn scope_constructs_predictable_key() {
    let scope = SecretScope::new("apohara", "github-app-key");
    assert_eq!(scope.service(), "apohara");
    assert_eq!(scope.username(), "github-app-key");
}
