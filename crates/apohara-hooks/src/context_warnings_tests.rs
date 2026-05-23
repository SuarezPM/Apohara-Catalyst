//! Mirrors `src/core/hooks/context-warnings.test.ts`.

use super::context_warnings::{
    classify_context_usage, ContextLevel, ContextWarningMonitor, ObserveInput,
};

fn observe(monitor: &ContextWarningMonitor, session: &str, used: u64, limit: u64) -> Option<ContextLevel> {
    monitor
        .observe(ObserveInput {
            session_id: session.into(),
            tokens_used: used,
            tokens_limit: limit,
        })
        .map(|e| e.level)
}

#[test]
fn classify_returns_ok_below_caution() {
    assert_eq!(classify_context_usage(1000, 10_000).level, ContextLevel::Ok);
    assert_eq!(classify_context_usage(7400, 10_000).level, ContextLevel::Ok);
}

#[test]
fn classify_caution_band() {
    assert_eq!(
        classify_context_usage(7500, 10_000).level,
        ContextLevel::Caution
    );
    assert_eq!(
        classify_context_usage(8000, 10_000).level,
        ContextLevel::Caution
    );
    assert_eq!(
        classify_context_usage(8499, 10_000).level,
        ContextLevel::Caution
    );
}

#[test]
fn classify_warning_band() {
    assert_eq!(
        classify_context_usage(8500, 10_000).level,
        ContextLevel::Warning
    );
    assert_eq!(
        classify_context_usage(9000, 10_000).level,
        ContextLevel::Warning
    );
    assert_eq!(
        classify_context_usage(9499, 10_000).level,
        ContextLevel::Warning
    );
}

#[test]
fn classify_critical_band() {
    assert_eq!(
        classify_context_usage(9500, 10_000).level,
        ContextLevel::Critical
    );
    assert_eq!(
        classify_context_usage(10_000, 10_000).level,
        ContextLevel::Critical
    );
    assert_eq!(
        classify_context_usage(12_000, 10_000).level,
        ContextLevel::Critical
    );
}

#[test]
fn classify_percent_one_decimal() {
    let p = classify_context_usage(7531, 10_000).percent;
    assert!((p - 75.3).abs() < 0.01, "got {p}");
}

#[test]
fn classify_zero_or_negative_limit_is_ok() {
    assert_eq!(classify_context_usage(100, 0).level, ContextLevel::Ok);
    assert_eq!(classify_context_usage(100, -1).level, ContextLevel::Ok);
}

#[test]
fn monitor_silent_when_below_caution() {
    let m = ContextWarningMonitor::new();
    assert!(observe(&m, "s", 100, 10_000).is_none());
}

#[test]
fn monitor_emits_on_first_caution() {
    let m = ContextWarningMonitor::new();
    let ev = observe(&m, "s", 7600, 10_000);
    assert_eq!(ev, Some(ContextLevel::Caution));
}

#[test]
fn monitor_does_not_re_emit_same_band() {
    let m = ContextWarningMonitor::new();
    observe(&m, "s", 7600, 10_000);
    assert!(observe(&m, "s", 7900, 10_000).is_none());
    assert!(observe(&m, "s", 8200, 10_000).is_none());
}

#[test]
fn monitor_re_emits_on_escalation() {
    let m = ContextWarningMonitor::new();
    let a = observe(&m, "s", 7600, 10_000);
    let b = observe(&m, "s", 8700, 10_000);
    let c = observe(&m, "s", 9700, 10_000);
    assert_eq!(a, Some(ContextLevel::Caution));
    assert_eq!(b, Some(ContextLevel::Warning));
    assert_eq!(c, Some(ContextLevel::Critical));
}

#[test]
fn monitor_silent_on_drop_back() {
    let m = ContextWarningMonitor::new();
    let a = observe(&m, "s", 9700, 10_000);
    let b = observe(&m, "s", 5000, 10_000);
    assert_eq!(a, Some(ContextLevel::Critical));
    assert!(b.is_none());
    // High-water mark preserved
    assert_eq!(m.current_band("s"), ContextLevel::Critical);
}

#[test]
fn monitor_tracks_sessions_independently() {
    let m = ContextWarningMonitor::new();
    let a = observe(&m, "a", 7600, 10_000);
    let b = observe(&m, "b", 9700, 10_000);
    assert_eq!(a, Some(ContextLevel::Caution));
    assert_eq!(b, Some(ContextLevel::Critical));
}

#[test]
fn monitor_forget_resets_band() {
    let m = ContextWarningMonitor::new();
    observe(&m, "s", 7600, 10_000);
    m.forget("s");
    let again = observe(&m, "s", 7600, 10_000);
    assert_eq!(again, Some(ContextLevel::Caution));
}
