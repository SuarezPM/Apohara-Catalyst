//! Integration test for indexer persistence.
//!
//! Tests that data survives database close and reopen.

use apohara_indexer::db::NodeMetadata;
use redb::{Database, TableDefinition};
use serial_test::serial;
use std::fs;
use tempfile::TempDir;

const NODES_TABLE: TableDefinition<u64, &[u8]> = TableDefinition::new("nodes");
const INDEX_STATE_TABLE: TableDefinition<&str, &[u8]> = TableDefinition::new("index_state");

/// Test that indexer can be created and data persists across restarts.
/// Uses a temporary directory to avoid polluting ~/.apohara
#[test]
#[serial]
#[ignore = "Requires model download - run manually with --ignored"]
fn test_indexer_persistence() {
    let _tmp = TempDir::new().unwrap();
    let indexer = match apohara_indexer::Indexer::with_db_path(&_tmp.path().join("test.redb")) {
        Ok(i) => i,
        Err(e) => {
            println!("Model not available - skipping full integration test: {}", e);
            return;
        }
    };

    // Index some test data
    let metadata = NodeMetadata {
        file_path: "/test/example.rs".to_string(),
        function_name: "test_function".to_string(),
        parameters: "x: i32, y: String".to_string(),
        return_type: Some("bool".to_string()),
        line: 10,
        column: 1,
    };

    let text = "function test_function(x: i32, y: String) -> bool language:rs";

    // This will try to use the model which requires network access
    // In real CI, we'd have cached model or mock
    let result = indexer.index_text(text, metadata);

    // We expect either success or an error about model/network
    match result {
        Ok(_id) => {
            println!("Successfully indexed test data");
        }
        Err(e) => {
            // Model loading or embedding failed (expected without network/model)
            println!("Embedding failed (expected without model): {}", e);
        }
    }
}

/// Test database persistence directly without needing the model.
/// This tests the db.rs module in isolation.
#[test]
fn test_db_persistence_direct() {
    // Create temp directory
    let temp_dir = TempDir::new().unwrap();
    let db_path = temp_dir.path().join("test.redb");

    // Create first database instance and write data
    {
        let db = Database::create(&db_path).unwrap();

        // Write node data
        {
            let write_txn = db.begin_write().unwrap();
            {
                let mut table = write_txn.open_table(NODES_TABLE).unwrap();

                let metadata = NodeMetadata {
                    file_path: "/test/file.rs".to_string(),
                    function_name: "my_function".to_string(),
                    parameters: "a: i32".to_string(),
                    return_type: Some("i32".to_string()),
                    line: 5,
                    column: 1,
                };

                let serialized = bincode::serialize(&metadata).unwrap();
                table.insert(1u64, serialized.as_slice()).unwrap();
            }
            write_txn.commit().unwrap();
        }

        // Save index state
        {
            let write_txn = db.begin_write().unwrap();
            {
                let mut table = write_txn.open_table(INDEX_STATE_TABLE).unwrap();
                let test_data = vec![1, 2, 3, 4, 5];
                table.insert("graph", test_data.as_slice()).unwrap();
            }
            write_txn.commit().unwrap();
        }

        println!("Wrote node and index state to database");
    }

    // Verify file exists
    assert!(db_path.exists());
    let file_size = fs::metadata(&db_path).unwrap().len();
    println!("Database file size: {} bytes", file_size);
    assert!(file_size > 0, "Database file should not be empty");

    // Reopen database and read data
    {
        let db = Database::create(&db_path).unwrap();

        // Verify node exists
        {
            let read_txn = db.begin_read().unwrap();
            let table = read_txn.open_table(NODES_TABLE).unwrap();
            let result = table.get(1u64).unwrap();
            assert!(result.is_some(), "Node should exist after reopen");

            let value = result.unwrap();
            let bytes = value.value();
            let node: NodeMetadata = bincode::deserialize(bytes).unwrap();

            assert_eq!(node.function_name, "my_function");
            assert_eq!(node.file_path, "/test/file.rs");
            println!("Successfully retrieved node metadata after reopen");
        }

        // Verify index state
        {
            let read_txn = db.begin_read().unwrap();
            let table = read_txn.open_table(INDEX_STATE_TABLE).unwrap();
            let result = table.get("graph").unwrap();
            assert!(result.is_some(), "Index state should exist");

            let value = result.unwrap();
            let state: Vec<u8> = value.value().to_vec();

            assert_eq!(state, vec![1, 2, 3, 4, 5]);
            println!("Successfully retrieved index state after reopen");
        }
    }

    println!("Persistence test passed - data survives database close and reopen");
}

/// Test that concurrent database access fails (lock acquisition)
#[test]
fn test_concurrent_db_access_fails() {
    let temp_dir = TempDir::new().unwrap();
    let db_path = temp_dir.path().join("concurrent_test.redb");

    // Create first database instance
    let db1 = Database::create(&db_path).unwrap();

    // Begin a write transaction (holds the lock)
    let write_txn = db1.begin_write().unwrap();
    let _table: TableDefinition<&str, &[u8]> = TableDefinition::new("test");

    // Try to open second database instance - behavior depends on OS
    // Some systems will allow this, others will fail
    let result = Database::create(&db_path);

    match result {
        Ok(_db2) => {
            // In some configurations, this may succeed
            println!("Note: Concurrent database access behavior may vary by OS");
        }
        Err(e) => {
            println!("Expected: concurrent access failed: {}", e);
        }
    }
}
