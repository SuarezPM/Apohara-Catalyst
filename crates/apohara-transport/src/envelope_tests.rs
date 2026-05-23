use super::envelope::{Envelope, EnvelopeError, ENVELOPE_VERSION};
use serde_json::json;

#[test]
fn new_envelope_has_current_version() {
    let e = Envelope::new("test", json!({"a": 1}));
    assert_eq!(e.version, ENVELOPE_VERSION);
    assert_eq!(e.kind, "test");
}

#[test]
fn validate_rejects_bad_version() {
    let e = Envelope {
        version: ENVELOPE_VERSION + 99,
        kind: "test".into(),
        payload: json!(null),
    };
    let err = e.validate().unwrap_err();
    assert!(matches!(err, EnvelopeError::BadVersion { .. }));
}

#[test]
fn validate_rejects_empty_kind() {
    let e = Envelope {
        version: ENVELOPE_VERSION,
        kind: "  ".into(),
        payload: json!(null),
    };
    assert!(matches!(e.validate(), Err(EnvelopeError::EmptyKind)));
}

#[test]
fn roundtrip_to_from_bytes() {
    let e = Envelope::new("event.tick", json!({"n": 7}));
    let bytes = e.to_bytes().unwrap();
    let back = Envelope::from_slice(&bytes).unwrap();
    assert_eq!(e, back);
}

#[test]
fn from_slice_rejects_unsupported_version() {
    let raw = br#"{"version":999,"kind":"x","payload":null}"#;
    let err = Envelope::from_slice(raw).unwrap_err();
    assert!(matches!(err, EnvelopeError::BadVersion { .. }));
}
