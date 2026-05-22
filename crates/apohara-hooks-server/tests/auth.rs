use apohara_hooks_server::{HooksServer, ServerConfig};
use std::sync::Arc;

#[tokio::test]
async fn rejects_unauthorized_request() {
    let config = ServerConfig {
        bearer_token: "secret-token-abc".to_string(),
        bind_addr: "127.0.0.1:0".parse().unwrap(),
    };
    let server = HooksServer::start(Arc::new(config)).await.unwrap();
    let url = format!("http://{}/health", server.bound_addr());

    let resp = reqwest::Client::new().get(&url).send().await.unwrap();
    assert_eq!(resp.status(), 401);

    let resp = reqwest::Client::new()
        .get(&url)
        .header("Authorization", "Bearer wrong-token")
        .send().await.unwrap();
    assert_eq!(resp.status(), 401);

    let resp = reqwest::Client::new()
        .get(&url)
        .header("Authorization", "Bearer secret-token-abc")
        .send().await.unwrap();
    assert_eq!(resp.status(), 200);
    let body: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(body["alive"], true);

    server.shutdown().await;
}

#[tokio::test]
async fn binds_to_random_port_when_port_0() {
    let config = ServerConfig {
        bearer_token: "t".to_string(),
        bind_addr: "127.0.0.1:0".parse().unwrap(),
    };
    let server = HooksServer::start(Arc::new(config)).await.unwrap();
    assert_ne!(server.bound_addr().port(), 0);
    server.shutdown().await;
}
