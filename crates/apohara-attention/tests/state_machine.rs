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
