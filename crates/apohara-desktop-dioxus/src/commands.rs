//! IPC commands surface — G2.A.2 fleshes this out.

/// Placeholder ping command. Returns a synthetic id so the UI can prove the
/// Rust ↔ Dioxus bridge is reachable end-to-end before the real
/// `apohara-dispatch` wiring lands (G3 / G4 phases).
pub fn dispatch_ping() -> String {
    "ok".to_string()
}
