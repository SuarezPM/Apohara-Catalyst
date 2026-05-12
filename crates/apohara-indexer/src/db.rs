/// Database persistence layer using redb (embedded key-value store).
///
/// Provides durable storage for the vector index metadata and serialized index state.
/// The database file is stored at ~/.apohara/index.redb

use anyhow::{Context, Result};
use redb::{Database, ReadableTable, ReadableTableMetadata, TableDefinition};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Table definitions for redb database
const NODES_TABLE: TableDefinition<u64, &[u8]> = TableDefinition::new("nodes");
const INDEX_STATE_TABLE: TableDefinition<&str, &[u8]> = TableDefinition::new("index_state");
const MEMORIES_TABLE: TableDefinition<&str, &[u8]> = TableDefinition::new("memories");

/// Types of memories stored in the system
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum MemoryType {
    /// Correction to previous output
    Correction,
    /// User preference or style guide
    Preference,
    /// Architectural decision or pattern
    Architecture,
    /// Past error to avoid
    PastError,
}

impl std::fmt::Display for MemoryType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            MemoryType::Correction => write!(f, "correction"),
            MemoryType::Preference => write!(f, "preference"),
            MemoryType::Architecture => write!(f, "architecture"),
            MemoryType::PastError => write!(f, "past_error"),
        }
    }
}

impl std::str::FromStr for MemoryType {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "correction" => Ok(MemoryType::Correction),
            "preference" => Ok(MemoryType::Preference),
            "architecture" => Ok(MemoryType::Architecture),
            "past_error" | "pasterror" => Ok(MemoryType::PastError),
            _ => Err(format!("Unknown memory type: {}", s)),
        }
    }
}

/// Memory entry stored in the database
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Memory {
    /// Unique identifier (UUID)
    pub id: String,
    /// Type of memory
    pub memory_type: MemoryType,
    /// Content of the memory (text)
    pub content: String,
    /// Vector embedding of the content for semantic search
    pub embedding: Vec<f32>,
    /// Timestamp when created
    pub created_at: u64,
}

/// Metadata stored for each indexed function
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeMetadata {
    /// File path where the function was found
    pub file_path: String,
    /// Function name
    pub function_name: String,
    /// Parameters as JSON string
    pub parameters: String,
    /// Return type (if any)
    pub return_type: Option<String>,
    /// Line number in source file
    pub line: usize,
    /// Column number in source file
    pub column: usize,
}

/// Database handle for persistent storage
pub struct Db {
    db: Database,
    path: PathBuf,
}

impl Db {
    /// Open or create the database at the default location (~/.apohara/index.redb)
    pub fn new() -> Result<Self> {
        let path = Self::default_path()?;

        // Ensure parent directory exists
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .context(format!("Failed to create directory: {:?}", parent))?;
        }

        // Open database - creates if doesn't exist
        let db = Database::create(&path)
            .context(format!("Failed to open database at {:?}", path))?;

        tracing::info!("Opened database at {:?}", path);

        Ok(Self { db, path })
    }

    /// Open or create the database at the given path
    pub fn with_path(path: &std::path::Path) -> Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .context(format!("Failed to create directory: {:?}", parent))?;
        }
        let db = Database::create(path)
            .context(format!("Failed to open database at {:?}", path))?;
        tracing::info!("Opened database at {:?}", path);
        Ok(Self { db, path: path.to_path_buf() })
    }

    /// Get the default database path
    fn default_path() -> Result<PathBuf> {
        let mut path = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
        path.push(".apohara");
        path.push("index.redb");
        Ok(path)
    }

    /// Get the database file path
    pub fn path(&self) -> &PathBuf {
        &self.path
    }

    /// Store node metadata in the database
    pub fn put_node(&self, id: u64, metadata: &NodeMetadata) -> Result<()> {
        let write_txn = self.db.begin_write()
            .context("Failed to begin write transaction")?;

        {
            let mut table = write_txn.open_table(NODES_TABLE)
                .context("Failed to open nodes table")?;

            let serialized = bincode::serialize(metadata)
                .context("Failed to serialize metadata")?;

            table.insert(id, serialized.as_slice())
                .context("Failed to insert node")?;
        }

        write_txn.commit()
            .context("Failed to commit node insert")?;

        tracing::debug!("Stored node metadata for id={}", id);
        Ok(())
    }

    /// Retrieve node metadata by ID
    pub fn get_node(&self, id: u64) -> Result<Option<NodeMetadata>> {
        let read_txn = self.db.begin_read()
            .context("Failed to begin read transaction")?;

        // Try to open the table - if it doesn't exist, return None
        let table = match read_txn.open_table(NODES_TABLE) {
            Ok(t) => t,
            Err(e) => {
                // Table doesn't exist - return empty result
                tracing::debug!("Nodes table doesn't exist yet: {}", e);
                return Ok(None);
            }
        };

        let result = table.get(id)
            .context("Failed to get node")?;

        match result {
            Some(value) => {
                let bytes = value.value();
                let metadata: NodeMetadata = bincode::deserialize(bytes)
                    .context("Failed to deserialize metadata")?;
                Ok(Some(metadata))
            }
            None => Ok(None),
        }
    }

    /// Get all node IDs in the database
    pub fn get_all_node_ids(&self) -> Result<Vec<u64>> {
        let read_txn = self.db.begin_read()
            .context("Failed to begin read transaction")?;

        // Handle missing table gracefully - return empty vec if tables don't exist yet
        let table = match read_txn.open_table(NODES_TABLE) {
            Ok(t) => t,
            Err(e) => {
                tracing::debug!("Nodes table doesn't exist yet: {}", e);
                return Ok(Vec::new());
            }
        };

        let mut ids = Vec::new();
        for entry in table.iter()? {
            let (id, _) = entry?;
            ids.push(id.value());
        }

        Ok(ids)
    }

    /// Remove a node by ID
    pub fn delete_node(&self, id: u64) -> Result<()> {
        let write_txn = self.db.begin_write()
            .context("Failed to begin write transaction")?;

        {
            let mut table = write_txn.open_table(NODES_TABLE)
                .context("Failed to open nodes table")?;

            table.remove(id)
                .context("Failed to delete node")?;
        }

        write_txn.commit()
            .context("Failed to commit node delete")?;

        tracing::debug!("Deleted node with id={}", id);
        Ok(())
    }

    /// Store the serialized index state
    pub fn put_index_state(&self, data: &[u8]) -> Result<()> {
        let write_txn = self.db.begin_write()
            .context("Failed to begin write transaction")?;

        {
            let mut table = write_txn.open_table(INDEX_STATE_TABLE)
                .context("Failed to open index_state table")?;

            table.insert("graph", data)
                .context("Failed to insert index state")?;
        }

        write_txn.commit()
            .context("Failed to commit index state insert")?;

        tracing::debug!("Stored index state ({} bytes)", data.len());
        Ok(())
    }

    /// Retrieve the serialized index state
    pub fn get_index_state(&self) -> Result<Option<Vec<u8>>> {
        let read_txn = self.db.begin_read()
            .context("Failed to begin read transaction")?;

        // Try to open the table - if it doesn't exist, return None
        let table = match read_txn.open_table(INDEX_STATE_TABLE) {
            Ok(t) => t,
            Err(e) => {
                tracing::debug!("Index state table doesn't exist yet: {}", e);
                return Ok(None);
            }
        };

        let result = table.get("graph")
            .context("Failed to get index state")?;

        match result {
            Some(value) => {
                let bytes = value.value().to_vec();
                Ok(Some(bytes))
            }
            None => Ok(None),
        }
    }

    /// Get the number of nodes in the database
    pub fn node_count(&self) -> Result<usize> {
        let read_txn = self.db.begin_read()
            .context("Failed to begin read transaction")?;

        // Try to open the table - if it doesn't exist, return 0
        let table = match read_txn.open_table(NODES_TABLE) {
            Ok(t) => t,
            Err(e) => {
                tracing::debug!("Nodes table doesn't exist yet: {}", e);
                return Ok(0);
            }
        };

        Ok(table.len()? as usize)
    }

    /// Check if the database file exists
    pub fn exists() -> bool {
        Self::default_path().map(|p| p.exists()).unwrap_or(false)
    }

    /// Get the database file size in bytes
    pub fn file_size(&self) -> Result<u64> {
        let metadata = std::fs::metadata(&self.path)
            .context("Failed to get file metadata")?;
        Ok(metadata.len())
    }

    // ============================================================================
    // Memory Operations
    // ============================================================================

    /// Store a memory in the database
    pub fn put_memory(&self, memory: &Memory) -> Result<()> {
        let write_txn = self.db.begin_write()
            .context("Failed to begin write transaction")?;

        {
            let mut table = write_txn.open_table(MEMORIES_TABLE)
                .context("Failed to open memories table")?;

            let serialized = bincode::serialize(memory)
                .context("Failed to serialize memory")?;

            table.insert(memory.id.as_str(), serialized.as_slice())
                .context("Failed to insert memory")?;
        }

        write_txn.commit()
            .context("Failed to commit memory insert")?;

        tracing::debug!("Stored memory with id={}", memory.id);
        Ok(())
    }

    /// Retrieve a memory by ID
    pub fn get_memory(&self, id: &str) -> Result<Option<Memory>> {
        let read_txn = self.db.begin_read()
            .context("Failed to begin read transaction")?;

        // Try to open the table - if it doesn't exist, return None
        let table = match read_txn.open_table(MEMORIES_TABLE) {
            Ok(t) => t,
            Err(e) => {
                tracing::debug!("Memories table doesn't exist yet: {}", e);
                return Ok(None);
            }
        };

        let result = table.get(id)
            .context("Failed to get memory")?;

        match result {
            Some(value) => {
                let bytes = value.value();
                let memory: Memory = bincode::deserialize(bytes)
                    .context("Failed to deserialize memory")?;
                Ok(Some(memory))
            }
            None => Ok(None),
        }
    }

    /// Get all memories from the database
    pub fn get_all_memories(&self) -> Result<Vec<Memory>> {
        let read_txn = self.db.begin_read()
            .context("Failed to begin read transaction")?;

        // Handle missing table gracefully - return empty vec if tables don't exist yet
        let table = match read_txn.open_table(MEMORIES_TABLE) {
            Ok(t) => t,
            Err(e) => {
                tracing::debug!("Memories table doesn't exist yet: {}", e);
                return Ok(Vec::new());
            }
        };

        let mut memories = Vec::new();
        for entry in table.iter()? {
            let (_, value) = entry?;
            let bytes = value.value();
            let memory: Memory = bincode::deserialize(bytes)
                .context("Failed to deserialize memory")?;
            memories.push(memory);
        }

        Ok(memories)
    }

    /// Search memories by embedding similarity (cosine similarity)
    /// Returns top-k most similar memories
    pub fn search_memories_by_embedding(
        &self,
        query_embedding: &[f32],
        top_k: usize,
    ) -> Result<Vec<(Memory, f32)>> {
        let memories = self.get_all_memories()?;

        if memories.is_empty() {
            return Ok(Vec::new());
        }

        // Calculate cosine similarity for each memory
        let mut scored_memories: Vec<(Memory, f32)> = memories
            .into_iter()
            .map(|memory| {
                let similarity = cosine_similarity(query_embedding, &memory.embedding);
                (memory, similarity)
            })
            .collect();

        // Sort by similarity (highest first)
        scored_memories.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap());

        // Return top-k
        Ok(scored_memories.into_iter().take(top_k).collect())
    }

    /// Get the number of memories in the database
    pub fn memory_count(&self) -> Result<usize> {
        let read_txn = self.db.begin_read()
            .context("Failed to begin read transaction")?;

        // Try to open the table - if it doesn't exist, return 0
        let table = match read_txn.open_table(MEMORIES_TABLE) {
            Ok(t) => t,
            Err(e) => {
                tracing::debug!("Memories table doesn't exist yet: {}", e);
                return Ok(0);
            }
        };

        Ok(table.len()? as usize)
    }
}

/// Calculate cosine similarity between two vectors
fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    if a.len() != b.len() {
        return 0.0;
    }

    let dot_product: f32 = a.iter().zip(b.iter()).map(|(x, y)| x * y).sum();
    let norm_a: f32 = a.iter().map(|x| x * x).sum::<f32>().sqrt();
    let norm_b: f32 = b.iter().map(|x| x * x).sum::<f32>().sqrt();

    if norm_a == 0.0 || norm_b == 0.0 {
        return 0.0;
    }

    dot_product / (norm_a * norm_b)
}

impl std::fmt::Debug for Db {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Db")
            .field("path", &self.path)
            .finish()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn create_test_db() -> (Db, TempDir) {
        let temp_dir = TempDir::new().unwrap();
        let path = temp_dir.path().join("test.redb");

        let db = Database::create(&path).unwrap();
        let db = Db { db, path };

        (db, temp_dir)
    }

    #[test]
    fn test_put_and_get_node() {
        let (db, _temp) = create_test_db();

        let metadata = NodeMetadata {
            file_path: "/test/file.rs".to_string(),
            function_name: "test_fn".to_string(),
            parameters: "a: i32, b: String".to_string(),
            return_type: Some("bool".to_string()),
            line: 10,
            column: 5,
        };

        db.put_node(1, &metadata).unwrap();

        let retrieved = db.get_node(1).unwrap();
        assert!(retrieved.is_some());

        let retrieved = retrieved.unwrap();
        assert_eq!(retrieved.function_name, "test_fn");
        assert_eq!(retrieved.file_path, "/test/file.rs");
        assert_eq!(retrieved.line, 10);
    }

    #[test]
    fn test_get_nonexistent_node() {
        let (db, _temp) = create_test_db();

        let result = db.get_node(999).unwrap();
        assert!(result.is_none());
    }

    #[test]
    fn test_get_all_node_ids() {
        let (db, _temp) = create_test_db();

        db.put_node(1, &NodeMetadata {
            file_path: "/test/file.rs".to_string(),
            function_name: "fn1".to_string(),
            parameters: "".to_string(),
            return_type: None,
            line: 1,
            column: 1,
        }).unwrap();

        db.put_node(5, &NodeMetadata {
            file_path: "/test/file.rs".to_string(),
            function_name: "fn2".to_string(),
            parameters: "".to_string(),
            return_type: None,
            line: 2,
            column: 1,
        }).unwrap();

        let ids = db.get_all_node_ids().unwrap();
        assert_eq!(ids.len(), 2);
        assert!(ids.contains(&1));
        assert!(ids.contains(&5));
    }

    #[test]
    fn test_delete_node() {
        let (db, _temp) = create_test_db();

        db.put_node(1, &NodeMetadata {
            file_path: "/test/file.rs".to_string(),
            function_name: "fn1".to_string(),
            parameters: "".to_string(),
            return_type: None,
            line: 1,
            column: 1,
        }).unwrap();

        db.delete_node(1).unwrap();

        let result = db.get_node(1).unwrap();
        assert!(result.is_none());
    }

    #[test]
    fn test_index_state_persistence() {
        let (db, _temp) = create_test_db();

        let data = vec![1, 2, 3, 4, 5];
        db.put_index_state(&data).unwrap();

        let retrieved = db.get_index_state().unwrap();
        assert!(retrieved.is_some());
        assert_eq!(retrieved.unwrap(), data);
    }

    #[test]
    fn test_node_count() {
        let (db, _temp) = create_test_db();

        assert_eq!(db.node_count().unwrap(), 0);

        db.put_node(1, &NodeMetadata {
            file_path: "/test/file.rs".to_string(),
            function_name: "fn1".to_string(),
            parameters: "".to_string(),
            return_type: None,
            line: 1,
            column: 1,
        }).unwrap();

        assert_eq!(db.node_count().unwrap(), 1);
    }

    #[test]
    fn test_memory_table() {
        let (db, _temp) = create_test_db();

        // Create a memory
        let memory = Memory {
            id: "test-uuid-123".to_string(),
            memory_type: MemoryType::Architecture,
            content: "Use redb for embedded storage".to_string(),
            embedding: vec![0.1, 0.2, 0.3, 0.4, 0.5],
            created_at: 1234567890,
        };

        // Store the memory
        db.put_memory(&memory).unwrap();

        // Retrieve the memory
        let retrieved = db.get_memory("test-uuid-123").unwrap();
        assert!(retrieved.is_some());

        let retrieved = retrieved.unwrap();
        assert_eq!(retrieved.id, "test-uuid-123");
        assert_eq!(retrieved.memory_type, MemoryType::Architecture);
        assert_eq!(retrieved.content, "Use redb for embedded storage");
        assert_eq!(retrieved.embedding, vec![0.1, 0.2, 0.3, 0.4, 0.5]);
        assert_eq!(retrieved.created_at, 1234567890);

        // Test memory count
        assert_eq!(db.memory_count().unwrap(), 1);

        // Test get_all_memories
        let all_memories = db.get_all_memories().unwrap();
        assert_eq!(all_memories.len(), 1);
        assert_eq!(all_memories[0].id, "test-uuid-123");

        // Test search by embedding
        let results = db.search_memories_by_embedding(&[0.1, 0.2, 0.3, 0.4, 0.5], 5).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].0.id, "test-uuid-123");
        assert!(results[0].1 > 0.99); // High similarity for exact match

        // Test non-existent memory
        let not_found = db.get_memory("non-existent").unwrap();
        assert!(not_found.is_none());
    }

    #[test]
    fn test_memory_search_similarity() {
        let (db, _temp) = create_test_db();

        // Create multiple memories with different embeddings
        let memory1 = Memory {
            id: "mem-1".to_string(),
            memory_type: MemoryType::Preference,
            content: "Prefer snake_case".to_string(),
            embedding: vec![1.0, 0.0, 0.0, 0.0, 0.0],
            created_at: 1,
        };

        let memory2 = Memory {
            id: "mem-2".to_string(),
            memory_type: MemoryType::PastError,
            content: "Avoid unwrap".to_string(),
            embedding: vec![0.0, 1.0, 0.0, 0.0, 0.0],
            created_at: 2,
        };

        let memory3 = Memory {
            id: "mem-3".to_string(),
            memory_type: MemoryType::Correction,
            content: "Use ? operator".to_string(),
            embedding: vec![0.7, 0.7, 0.0, 0.0, 0.0], // Similar to both above
            created_at: 3,
        };

        db.put_memory(&memory1).unwrap();
        db.put_memory(&memory2).unwrap();
        db.put_memory(&memory3).unwrap();

        // Search with query close to memory1
        let results = db.search_memories_by_embedding(&[1.0, 0.0, 0.0, 0.0, 0.0], 2).unwrap();
        assert_eq!(results.len(), 2);
        assert_eq!(results[0].0.id, "mem-1"); // Exact match first
        assert!(results[0].1 > 0.99);

        // Search with query close to memory3 (diagonal)
        let results = db.search_memories_by_embedding(&[0.7, 0.7, 0.0, 0.0, 0.0], 3).unwrap();
        assert_eq!(results.len(), 3);
        // mem-3 should be first (exact match to query)
        assert_eq!(results[0].0.id, "mem-3");
    }

    #[test]
    fn test_memory_empty_search() {
        let (db, _temp) = create_test_db();

        // Search on empty database should return empty
        let results = db.search_memories_by_embedding(&[1.0, 0.0, 0.0, 0.0, 0.0], 5).unwrap();
        assert!(results.is_empty());

        // get_all_memories should return empty
        let all = db.get_all_memories().unwrap();
        assert!(all.is_empty());

        // memory_count should return 0
        assert_eq!(db.memory_count().unwrap(), 0);
    }

    #[test]
    fn test_memory_search() {
        // Comprehensive test for memory search functionality
        let (db, _temp) = create_test_db();

        // Create memories with distinct embedding patterns
        let memories = vec![
            Memory {
                id: "mem-pref-1".to_string(),
                memory_type: MemoryType::Preference,
                content: "Use snake_case for variables".to_string(),
                embedding: vec![1.0, 0.0, 0.0, 0.0, 0.0],
                created_at: 1000,
            },
            Memory {
                id: "mem-arch-1".to_string(),
                memory_type: MemoryType::Architecture,
                content: "Use repository pattern".to_string(),
                embedding: vec![0.0, 1.0, 0.0, 0.0, 0.0],
                created_at: 2000,
            },
            Memory {
                id: "mem-error-1".to_string(),
                memory_type: MemoryType::PastError,
                content: "Avoid unwrap in production".to_string(),
                embedding: vec![0.0, 0.0, 1.0, 0.0, 0.0],
                created_at: 3000,
            },
            Memory {
                id: "mem-corr-1".to_string(),
                memory_type: MemoryType::Correction,
                content: "Use Result type properly".to_string(),
                embedding: vec![0.7, 0.0, 0.7, 0.0, 0.0], // Close to both pref and error
                created_at: 4000,
            },
        ];

        // Store all memories
        for memory in &memories {
            db.put_memory(memory).unwrap();
        }

        assert_eq!(db.memory_count().unwrap(), 4);

        // Test 1: Search with query matching preference memory exactly
        let results = db.search_memories_by_embedding(&[1.0, 0.0, 0.0, 0.0, 0.0], 2).unwrap();
        assert_eq!(results.len(), 2);
        assert_eq!(results[0].0.id, "mem-pref-1"); // Exact match
        assert!(results[0].1 > 0.99);

        // Test 2: Search with query matching architecture memory
        let results = db.search_memories_by_embedding(&[0.0, 1.0, 0.0, 0.0, 0.0], 1).unwrap();
        assert_eq!(results[0].0.id, "mem-arch-1");

        // Test 3: Search with query close to correction memory (diagonal)
        let results = db.search_memories_by_embedding(&[0.7, 0.0, 0.7, 0.0, 0.0], 3).unwrap();
        assert_eq!(results[0].0.id, "mem-corr-1"); // Exact match
        // Results should include both correction and the closest others

        // Test 4: Search with limit (top_k=1)
        let results = db.search_memories_by_embedding(&[1.0, 1.0, 0.0, 0.0, 0.0], 1).unwrap();
        assert_eq!(results.len(), 1);

        // Test 5: Search returns scores
        let results = db.search_memories_by_embedding(&[1.0, 0.0, 0.0, 0.0, 0.0], 4).unwrap();
        for (_, score) in &results {
            assert!(*score >= 0.0 && *score <= 1.0, "Cosine similarity should be in [0, 1]");
        }

        // Test 6: Verify returned memories have correct types
        let results = db.search_memories_by_embedding(&[0.0, 1.0, 0.0, 0.0, 0.0], 2).unwrap();
        assert!(results.iter().any(|(m, _)| m.memory_type == MemoryType::Architecture));
    }
}
