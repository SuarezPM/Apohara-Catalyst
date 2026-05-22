use apohara_worktree::uds::{UdsServer, ServerConfig};
use tempfile::tempdir;

#[tokio::test]
async fn uds_server_starts_and_responds_to_ping() {
    let dir = tempdir().unwrap();
    let socket = dir.path().join("worktree.sock");
    let config = ServerConfig { socket_path: socket.clone() };
    let server = UdsServer::start(config).await.unwrap();

    use tokio::net::UnixStream;
    use tokio::io::{AsyncWriteExt, AsyncReadExt};
    let mut stream = UnixStream::connect(&socket).await.unwrap();
    let req = serde_json::to_vec(&serde_json::json!({"method":"ping","params":{}})).unwrap();
    stream.write_all(&req).await.unwrap();
    stream.write_all(b"\n").await.unwrap();
    stream.flush().await.unwrap();

    let mut buf = vec![0u8; 256];
    let n = stream.read(&mut buf).await.unwrap();
    let resp: serde_json::Value = serde_json::from_slice(&buf[..n]).unwrap();
    assert_eq!(resp["result"]["ok"], true);

    server.shutdown().await;
}