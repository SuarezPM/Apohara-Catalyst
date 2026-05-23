use super::health::HealthState;

#[test]
fn snapshot_carries_profile_and_version() {
    let h = HealthState::new("prod", "1.0.0-dev");
    let s = h.snapshot();
    assert!(s.alive);
    assert_eq!(s.profile, "prod");
    assert_eq!(s.version, "1.0.0-dev");
    assert_eq!(s.connections, 0);
}

#[test]
fn connection_counter_inc_dec_floors_at_zero() {
    let h = HealthState::new("dev", "x");
    h.inc_connection();
    h.inc_connection();
    h.inc_connection();
    assert_eq!(h.snapshot().connections, 3);
    h.dec_connection();
    h.dec_connection();
    assert_eq!(h.snapshot().connections, 1);
    h.dec_connection();
    h.dec_connection(); // should saturate
    assert_eq!(h.snapshot().connections, 0);
}

#[test]
fn uptime_monotonic() {
    let h = HealthState::new("dev", "x");
    let s1 = h.snapshot();
    std::thread::sleep(std::time::Duration::from_millis(2));
    let s2 = h.snapshot();
    assert!(s2.uptime_ms >= s1.uptime_ms);
}

#[test]
fn snapshot_serializes_to_json() {
    let h = HealthState::new("dev", "v");
    let s = h.snapshot();
    let j = serde_json::to_string(&s).unwrap();
    assert!(j.contains("\"alive\":true"));
    assert!(j.contains("\"profile\":\"dev\""));
}
