use apohara_worktree::naming::{random_slug, parse_slug, SUFFIX_HEX_LEN};

#[test]
fn random_slug_matches_pattern() {
    let s = random_slug();
    let parts: Vec<&str> = s.split('-').collect();
    assert_eq!(parts.len(), 3, "expected 3 parts, got {}", s);
    assert!(parts[2].chars().all(|c| c.is_ascii_hexdigit()));
    assert_eq!(parts[2].len(), SUFFIX_HEX_LEN);
}

#[test]
fn parse_slug_round_trip() {
    let s = random_slug();
    let parsed = parse_slug(&s).expect("valid slug");
    assert_eq!(parsed.suffix.len(), SUFFIX_HEX_LEN);
}

#[test]
fn parse_slug_rejects_invalid() {
    assert!(parse_slug("not-a-valid-slug").is_err());
    assert!(parse_slug("no-hex").is_err());
    assert!(parse_slug("a-b-c-d").is_err());
}
