use apohara_attention::{AttentionState, Band, Stimulus};
use std::time::{Duration, Instant};

#[test]
fn direct_stimulus_promotes_to_hot() {
    let mut state = AttentionState::new("target-1", Instant::now());
    state.apply(Stimulus::Direct, Instant::now());
    assert_eq!(state.band(), Band::Hot);
}

#[test]
fn ambient_promotes_one_step_capped_at_warm() {
    let mut state = AttentionState::new("target-1", Instant::now());
    state.apply(Stimulus::Ambient, Instant::now());
    assert_eq!(state.band(), Band::Warm);
    state.apply(Stimulus::Ambient, Instant::now());
    // Already at Warm cap; no further promotion from ambient
    assert_eq!(state.band(), Band::Warm);
}

#[test]
fn decay_walks_hot_to_idle_over_full_window() {
    let t0 = Instant::now();
    let mut state = AttentionState::new("target-1", t0);
    state.apply(Stimulus::Direct, t0);
    assert_eq!(state.band(), Band::Hot);
    // Hot hold 60s + Warm hold 240s + Cool hold 720s = 1020s
    state.tick(t0 + Duration::from_secs(61));
    assert_eq!(state.band(), Band::Warm);
    state.tick(t0 + Duration::from_secs(61 + 241));
    assert_eq!(state.band(), Band::Cool);
    state.tick(t0 + Duration::from_secs(61 + 241 + 721));
    assert_eq!(state.band(), Band::Idle);
}

#[test]
fn tick_on_idle_is_noop_and_idempotent() {
    let t0 = std::time::Instant::now();
    let mut s = apohara_attention::AttentionState::new("t1".to_string(), t0);
    // s starts at Idle. tick a long way should remain Idle.
    s.tick(t0 + std::time::Duration::from_secs(10_000));
    assert_eq!(s.band(), apohara_attention::Band::Idle);
    // Idempotent: another tick same time, still Idle.
    s.tick(t0 + std::time::Duration::from_secs(10_000));
    assert_eq!(s.band(), apohara_attention::Band::Idle);
}

#[test]
fn decay_walks_hot_to_idle_in_single_tick() {
    let t0 = std::time::Instant::now();
    let mut s = apohara_attention::AttentionState::new("t1".to_string(), t0);
    s.apply(apohara_attention::Stimulus::Direct, t0);
    assert_eq!(s.band(), apohara_attention::Band::Hot);
    // A single tick after 60+240+720 = 1020s should walk Hot → Warm → Cool → Idle.
    s.tick(t0 + std::time::Duration::from_secs(1100));
    assert_eq!(s.band(), apohara_attention::Band::Idle);
}

#[test]
fn zero_elapsed_tick_is_noop() {
    let t0 = std::time::Instant::now();
    let mut s = apohara_attention::AttentionState::new("t1".to_string(), t0);
    s.apply(apohara_attention::Stimulus::Direct, t0);
    s.tick(t0); // zero elapsed
    assert_eq!(s.band(), apohara_attention::Band::Hot);
}

#[test]
fn ambient_does_not_demote_hot() {
    let t0 = std::time::Instant::now();
    let mut s = apohara_attention::AttentionState::new("t1".to_string(), t0);
    s.apply(apohara_attention::Stimulus::Direct, t0);
    assert_eq!(s.band(), apohara_attention::Band::Hot);
    s.apply(apohara_attention::Stimulus::Ambient, t0);
    assert_eq!(s.band(), apohara_attention::Band::Hot, "ambient must not demote hot");
}
