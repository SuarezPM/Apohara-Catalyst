use apohara_types::capabilities::Capability;

#[test]
fn capability_serializes_snake_case() {
    assert_eq!(serde_json::to_string(&Capability::SessionFork).unwrap(), "\"session_fork\"");
    assert_eq!(serde_json::to_string(&Capability::AgentHooks).unwrap(), "\"agent_hooks\"");
}

#[test]
fn capability_deserializes() {
    let cap: Capability = serde_json::from_str("\"json_stream\"").unwrap();
    assert_eq!(cap, Capability::JsonStream);
}

#[test]
fn capability_count_matches_documented_set() {
    let all = Capability::all();
    assert_eq!(all.len(), 19);
}
