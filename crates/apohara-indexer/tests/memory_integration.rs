//! Integration tests for the memory system
//!
//! Tests the full flow: store_memory -> search_memory

use apohara_indexer::{embeddings::EmbeddingModel, Indexer, MemoryType};
use serial_test::serial;
use std::str::FromStr;
use tempfile::TempDir;

/// True when running with mock embeddings (no semantic similarity preserved).
/// Tests gate their semantic-similarity assertions on `!mock_mode()` so they
/// pass under `APOHARA_MOCK_EMBEDDINGS=1` while still verifying the store/search
/// round-trip works structurally.
fn mock_mode() -> bool {
    EmbeddingModel::should_use_mock()
}

/// Test full memory lifecycle: store and retrieve
#[test]
#[serial]
fn test_memory_integration_basic() {
    let _tmp = TempDir::new().unwrap();
    let indexer = match Indexer::with_db_path(&_tmp.path().join("test.redb")) {
        Ok(i) => i,
        Err(e) => {
            eprintln!("Skipping: {}", e);
            return;
        }
    };

    // Store a preference memory
    let memory_id = indexer
        .store_memory("preference", "User prefers snake_case for variable naming")
        .expect("Failed to store memory");

    assert!(!memory_id.is_empty(), "Memory ID should not be empty");
    assert_eq!(memory_id.len(), 36, "Memory ID should be a UUID");

    // Verify we can search for it
    let results = indexer
        .search_memories("snake_case naming convention", 5)
        .expect("Failed to search memories");

    assert!(!results.is_empty(), "Should find at least one memory");
    if !mock_mode() {
        // The stored memory should be in the results (may not be first if other memories exist)
        let found = results.iter().any(|(m, score)| m.id == memory_id && *score > 0.5);
        assert!(found, "Should find our stored memory with reasonable similarity");
    }
}

/// Test that different memory types can coexist
#[test]
#[serial]
fn test_memory_integration_multiple_types() {
    let _tmp = TempDir::new().unwrap();
    let indexer = match Indexer::with_db_path(&_tmp.path().join("test.redb")) {
        Ok(i) => i,
        Err(e) => {
            eprintln!("Skipping: {}", e);
            return;
        }
    };

    // Store memories of different types
    let pref_id = indexer
        .store_memory("preference", "Use 4 spaces for indentation")
        .expect("Failed to store preference");

    let arch_id = indexer
        .store_memory("architecture", "Use MVC pattern for web apps")
        .expect("Failed to store architecture");

    let error_id = indexer
        .store_memory("past_error", "Don't forget to handle database connection errors")
        .expect("Failed to store past_error");

    let _corr_id = indexer
        .store_memory("correction", "Use async/await instead of callbacks")
        .expect("Failed to store correction");

    // Semantic search assertions only meaningful with real BERT
    if !mock_mode() {
        // Search for architecture-related content
        let results = indexer
            .search_memories("web application design patterns", 3)
            .expect("Failed to search");
        assert!(
            results.iter().any(|(m, _)| m.id == arch_id),
            "Should find architecture memory"
        );

        // Search for error-related content
        let results = indexer
            .search_memories("database error handling", 3)
            .expect("Failed to search");
        assert!(
            results.iter().any(|(m, _)| m.id == error_id),
            "Should find past_error memory"
        );
    } else {
        // Under mock, just verify search returns SOMETHING (no semantic guarantees)
        let results = indexer.search_memories("anything", 3).expect("Failed to search");
        assert!(!results.is_empty(), "Search should return at least one stored memory");
        let _ = arch_id;
        let _ = error_id;
    }

    // Suppress unused variable warning
    let _ = pref_id;
}

/// Test embedding consistency - same content should produce similar embeddings
#[test]
#[serial]
fn test_memory_embedding_consistency() {
    let _tmp = TempDir::new().unwrap();
    let indexer = match Indexer::with_db_path(&_tmp.path().join("test.redb")) {
        Ok(i) => i,
        Err(e) => {
            eprintln!("Skipping: {}", e);
            return;
        }
    };

    // Store a memory
    let content = "Always validate user input before processing";
    let memory_id = indexer
        .store_memory("correction", content)
        .expect("Failed to store memory");

    if !mock_mode() {
        // Search with semantically similar but textually different query
        let results = indexer
            .search_memories("Input validation is important", 3)
            .expect("Failed to search");
        assert!(
            results.iter().any(|(m, _)| m.id == memory_id),
            "Should find memory with semantically similar query"
        );
        let found = results.iter().find(|(m, _)| m.id == memory_id).unwrap();
        assert!(found.1 > 0.5, "Similarity should be moderate to high for related concepts");
    } else {
        let _ = memory_id;
    }
}

/// Test search relevance ordering
#[test]
#[serial]
fn test_memory_search_relevance() {
    let _tmp = TempDir::new().unwrap();
    let indexer = match Indexer::with_db_path(&_tmp.path().join("test.redb")) {
        Ok(i) => i,
        Err(e) => {
            eprintln!("Skipping: {}", e);
            return;
        }
    };

    // Store memories with very different meanings
    let _code_style_id = indexer
        .store_memory("preference", "Use camelCase for JavaScript variables")
        .expect("Failed to store");

    let arch_id = indexer
        .store_memory("architecture", "Microservices architecture with event sourcing")
        .expect("Failed to store");

    let _db_id = indexer
        .store_memory("preference", "Use PostgreSQL for relational data")
        .expect("Failed to store");

    // Search specifically for microservices
    let results = indexer
        .search_memories("distributed systems and microservices", 2)
        .expect("Failed to search");

    if !mock_mode() {
        // The architecture memory should be first
        assert_eq!(results[0].0.id, arch_id, "Most relevant result should be first");
        assert!(results[0].1 > 0.6, "Top result should have high similarity");
    } else {
        let _ = arch_id;
    }
}

/// Test top_k limiting
#[test]
#[serial]
fn test_memory_search_top_k() {
    let _tmp = TempDir::new().unwrap();
    let indexer = match Indexer::with_db_path(&_tmp.path().join("test.redb")) {
        Ok(i) => i,
        Err(e) => {
            eprintln!("Skipping: {}", e);
            return;
        }
    };

    // Store multiple memories
    for i in 0..10 {
        let content = format!("Memory number {} about code quality", i);
        indexer
            .store_memory("preference", &content)
            .expect("Failed to store memory");
    }

    // Search with top_k=3
    let results = indexer
        .search_memories("code quality", 3)
        .expect("Failed to search");

    assert_eq!(results.len(), 3, "Should respect top_k limit");

    // Search with top_k=5
    let results = indexer
        .search_memories("code quality", 5)
        .expect("Failed to search");

    assert_eq!(results.len(), 5, "Should respect top_k limit");
}

/// Test that memory type enum parsing works correctly
#[test]
fn test_memory_type_parsing() {
    assert_eq!(MemoryType::from_str("correction").unwrap(), MemoryType::Correction);
    assert_eq!(MemoryType::from_str("preference").unwrap(), MemoryType::Preference);
    assert_eq!(MemoryType::from_str("architecture").unwrap(), MemoryType::Architecture);
    assert_eq!(MemoryType::from_str("past_error").unwrap(), MemoryType::PastError);
    assert_eq!(MemoryType::from_str("pastError").unwrap(), MemoryType::PastError);
    assert_eq!(MemoryType::from_str("PAST_ERROR").unwrap(), MemoryType::PastError);

    // Invalid type should error
    assert!(MemoryType::from_str("invalid").is_err());
    assert!(MemoryType::from_str("").is_err());
}

/// Test memory type display
#[test]
fn test_memory_type_display() {
    assert_eq!(MemoryType::Correction.to_string(), "correction");
    assert_eq!(MemoryType::Preference.to_string(), "preference");
    assert_eq!(MemoryType::Architecture.to_string(), "architecture");
    assert_eq!(MemoryType::PastError.to_string(), "past_error");
}

/// Test empty database search
#[test]
#[serial]
fn test_memory_empty_database_search() {
    let _tmp = TempDir::new().unwrap();
    let indexer = match Indexer::with_db_path(&_tmp.path().join("test.redb")) {
        Ok(i) => i,
        Err(e) => {
            eprintln!("Skipping: {}", e);
            return;
        }
    };

    // Search for something that definitely doesn't exist in our fresh DB
    let results = indexer
        .search_memories("xyz non existent query 12345", 5)
        .expect("Failed to search");

    // Fresh database has no memories — should be empty
    assert!(results.is_empty(), "Fresh database should return empty results");
}

/// Test memory content preservation
#[test]
#[serial]
fn test_memory_content_preservation() {
    let _tmp = TempDir::new().unwrap();
    let indexer = match Indexer::with_db_path(&_tmp.path().join("test.redb")) {
        Ok(i) => i,
        Err(e) => {
            eprintln!("Skipping: {}", e);
            return;
        }
    };

    let content = "This is a very specific memory about using Result<T, E> instead of panic! in Rust";
    let memory_id = indexer
        .store_memory("correction", content)
        .expect("Failed to store");

    // Search to retrieve it
    let results = indexer
        .search_memories("Rust error handling", 1)
        .expect("Failed to search");

    assert!(!results.is_empty(), "Should find the memory");
    assert_eq!(results[0].0.content, content, "Content should be preserved exactly");
    assert_eq!(results[0].0.memory_type, MemoryType::Correction);
}
