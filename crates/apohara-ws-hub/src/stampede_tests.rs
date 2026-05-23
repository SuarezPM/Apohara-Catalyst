use super::stampede::StampedePolicy;

#[test]
fn default_policy_caps_at_32() {
    let p = StampedePolicy::default();
    assert_eq!(p.max_subscribers_per_event, 32);
}

#[test]
fn with_max_floors_at_one() {
    let p = StampedePolicy::with_max(0);
    assert_eq!(p.max_subscribers_per_event, 1);
    let p2 = StampedePolicy::with_max(8);
    assert_eq!(p2.max_subscribers_per_event, 8);
}
