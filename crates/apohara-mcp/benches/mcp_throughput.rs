//! Microbenches for the apohara-mcp hot paths.
//!
//! - `injection_claude_roundtrip` measures one canonical → Claude JSON
//!   injection through the atomic-write path. Each iteration writes to a
//!   tempdir we share across iterations so we benchmark the rename + the
//!   payload generation, not tempdir creation.
//! - `canonical_validate_roundtrip` measures schema validation through
//!   a serde round trip (parse → serialize → parse) since the canonical
//!   types are the cross-process wire format.
//!
//! These two bound the two interesting hot paths: injection (per-spawn,
//! ~once per task dispatch) and validation (every IPC payload).

use std::collections::HashMap;
use std::sync::OnceLock;

use apohara_mcp::injection::{inject_mcp_config, ProviderId};
use apohara_mcp::{McpCanonical, McpServerCanonical, McpServerType};
use criterion::{criterion_group, criterion_main, Criterion};
use tempfile::TempDir;

fn runtime() -> &'static tokio::runtime::Runtime {
    static RUNTIME: OnceLock<tokio::runtime::Runtime> = OnceLock::new();
    RUNTIME.get_or_init(|| {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
    })
}

fn sample_canonical() -> McpCanonical {
    let mut env = HashMap::new();
    env.insert("APOHARA_MCP_TOKEN".to_string(), "tok".to_string());
    McpCanonical {
        servers: vec![
            McpServerCanonical {
                name: "apohara.ledger".to_string(),
                meta: HashMap::new(),
                command: "apohara".to_string(),
                args: vec!["mcp".into(), "serve".into(), "ledger".into()],
                env: env.clone(),
                ty: McpServerType::Local,
            },
            McpServerCanonical {
                name: "apohara.runs".to_string(),
                meta: HashMap::new(),
                command: "apohara".to_string(),
                args: vec!["mcp".into(), "serve".into(), "runs".into()],
                env: env.clone(),
                ty: McpServerType::Local,
            },
            McpServerCanonical {
                name: "apohara.indexer".to_string(),
                meta: HashMap::new(),
                command: "apohara".to_string(),
                args: vec!["mcp".into(), "serve".into(), "indexer".into()],
                env,
                ty: McpServerType::Local,
            },
        ],
    }
}

fn bench_injection_claude_roundtrip(c: &mut Criterion) {
    let tmp = TempDir::new().expect("tempdir");
    let canonical = sample_canonical();
    let rt = runtime();
    let workspace = tmp.path().to_path_buf();

    c.bench_function("injection_claude_roundtrip", |b| {
        b.iter(|| {
            rt.block_on(async {
                inject_mcp_config(ProviderId::ClaudeCodeCli, &canonical, &workspace)
                    .await
                    .expect("inject");
            });
        });
    });
}

fn bench_canonical_validate_roundtrip(c: &mut Criterion) {
    let canonical = sample_canonical();
    let json = serde_json::to_string(&canonical).expect("serialize");

    c.bench_function("canonical_validate_roundtrip", |b| {
        b.iter(|| {
            // Validation = parse + re-serialize + reparse; bounds the
            // worst-case path for any IPC payload that enters the Rust
            // shell carrying a canonical config.
            let parsed: McpCanonical = serde_json::from_str(&json).expect("parse");
            let again = serde_json::to_string(&parsed).expect("re-serialize");
            let _back: McpCanonical = serde_json::from_str(&again).expect("re-parse");
        });
    });
}

criterion_group!(
    benches,
    bench_injection_claude_roundtrip,
    bench_canonical_validate_roundtrip
);
criterion_main!(benches);
