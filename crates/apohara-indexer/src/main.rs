//! Binary entry point for the apohara-indexer daemon
//! 
//! Runs the JSON-RPC Unix socket server

use apohara_indexer::run_server;
use anyhow::Result;

#[tokio::main]
async fn main() -> Result<()> {
    // Initialize logging
    tracing_subscriber::fmt::init();
    
    println!("Starting apohara-indexer daemon...");
    run_server().await
}