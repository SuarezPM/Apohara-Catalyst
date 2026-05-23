use super::envelope::Envelope;
use super::local_socket::{read_frame, write_frame, LocalSocketError, MAX_FRAME_BYTES};
use serde_json::json;
use tokio::io::duplex;

#[tokio::test]
async fn roundtrip_single_frame() {
    let (mut a, mut b) = duplex(64 * 1024);
    let env = Envelope::new("ping", json!({"ok": true}));
    write_frame(&mut a, &env).await.unwrap();
    let got = read_frame(&mut b).await.unwrap().unwrap();
    assert_eq!(got, env);
}

#[tokio::test]
async fn multiple_frames_in_order() {
    let (mut a, mut b) = duplex(64 * 1024);
    let e1 = Envelope::new("a", json!(1));
    let e2 = Envelope::new("b", json!(2));
    let e3 = Envelope::new("c", json!(3));
    write_frame(&mut a, &e1).await.unwrap();
    write_frame(&mut a, &e2).await.unwrap();
    write_frame(&mut a, &e3).await.unwrap();
    let g1 = read_frame(&mut b).await.unwrap().unwrap();
    let g2 = read_frame(&mut b).await.unwrap().unwrap();
    let g3 = read_frame(&mut b).await.unwrap().unwrap();
    assert_eq!(g1.kind, "a");
    assert_eq!(g2.kind, "b");
    assert_eq!(g3.kind, "c");
}

#[tokio::test]
async fn clean_eof_returns_none() {
    let (a, mut b) = duplex(64);
    drop(a);
    let got = read_frame(&mut b).await.unwrap();
    assert!(got.is_none());
}

#[tokio::test]
async fn unexpected_eof_mid_frame_errors() {
    let (mut a, mut b) = duplex(64);
    // Write a length header claiming 1024 bytes but only send 4.
    use tokio::io::AsyncWriteExt;
    let len: u32 = 1024;
    a.write_all(&len.to_be_bytes()).await.unwrap();
    a.write_all(&[0u8; 4]).await.unwrap();
    drop(a);
    let err = read_frame(&mut b).await.unwrap_err();
    assert!(matches!(err, LocalSocketError::UnexpectedEof(_)));
}

#[tokio::test]
async fn oversized_length_rejected_without_buffering() {
    let (mut a, mut b) = duplex(64);
    use tokio::io::AsyncWriteExt;
    let bogus = MAX_FRAME_BYTES + 1;
    a.write_all(&bogus.to_be_bytes()).await.unwrap();
    drop(a);
    let err = read_frame(&mut b).await.unwrap_err();
    assert!(matches!(err, LocalSocketError::FrameTooLarge(_)));
}

#[tokio::test]
async fn invalid_envelope_version_rejected_on_read() {
    let (mut a, mut b) = duplex(1024);
    use tokio::io::AsyncWriteExt;
    let body = br#"{"version":999,"kind":"x","payload":null}"#;
    let len = (body.len() as u32).to_be_bytes();
    a.write_all(&len).await.unwrap();
    a.write_all(body).await.unwrap();
    drop(a);
    let err = read_frame(&mut b).await.unwrap_err();
    assert!(matches!(err, LocalSocketError::Envelope(_)));
}
