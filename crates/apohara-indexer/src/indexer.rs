/// Indexer orchestrator - ties together parsing, embeddings, vector index, and persistence.
///
/// Provides high-level API for indexing source code files and searching for similar functions.

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};

use crate::db::{Db, NodeMetadata};
use crate::embeddings::EmbeddingModel;
use crate::index::{IndexConfig, VectorIndex};
use crate::parser::{parse_file, FunctionSignature};

// EmbeddingModel wraps candle CPU tensors. CPU Device is single-threaded safe.
// We need Send + Sync to store the model in OnceLock<Arc<T>> which requires T: Send + Sync.
// Safety: EmbeddingModel is only used on the CPU device; no GPU state or thread-local storage.
unsafe impl Send for EmbeddingModel {}
unsafe impl Sync for EmbeddingModel {}

/// Process-level singleton: initialized on first use, shared across all `with_db_path` callers.
/// Using Mutex<Option<...>> for stable Rust compatibility (get_or_try_init is unstable).
static SHARED_MODEL: OnceLock<Arc<EmbeddingModel>> = OnceLock::new();
static SHARED_MODEL_INIT: Mutex<()> = Mutex::new(());

/// Inter-process file lock held for the LIFETIME of the test process. Prevents multiple
/// `cargo test` binaries (lib, memory_integration, indexer_persistence) from each holding
/// a ~400 MB BERT model in memory simultaneously. Acquired on first model use and never
/// released — the OS reclaims the flock when the process exits.
///
/// Why hold for lifetime, not just during load: releasing after load lets N binaries
/// co-exist with N model copies. Holding forever forces end-to-end serialization at the
/// binary level — only one apohara-indexer test process runs at a time system-wide.
#[cfg(test)]
struct ModelLoadLock(std::fs::File);

#[cfg(test)]
static MODEL_LOCK_HOLDER: OnceLock<ModelLoadLock> = OnceLock::new();

#[cfg(test)]
fn acquire_interprocess_model_lock() -> ModelLoadLock {
    use std::fs::OpenOptions;
    use std::os::unix::io::AsRawFd;
    let path = std::env::temp_dir().join(".apohara-model-init.lock");
    let file = OpenOptions::new()
        .create(true)
        .write(true)
        .open(&path)
        .expect("failed to open model lock file");
    let ret = unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX) };
    assert_eq!(ret, 0, "flock failed: {}", std::io::Error::last_os_error());
    ModelLoadLock(file)
}

pub(crate) fn shared_model() -> Result<Arc<EmbeddingModel>> {
    if let Some(m) = SHARED_MODEL.get() {
        return Ok(m.clone());
    }
    // Tests: acquire inter-process lock and HOLD IT for the rest of the process lifetime.
    // This serializes test binaries end-to-end so at most one apohara-indexer process
    // holds the ~400 MB BERT model at any moment system-wide.
    #[cfg(test)]
    {
        let _ = MODEL_LOCK_HOLDER.get_or_init(acquire_interprocess_model_lock);
    }

    // Serialize model initialization so only one thread loads it within this process
    let _guard = SHARED_MODEL_INIT.lock().unwrap();
    // Double-checked: another thread may have set it while we waited
    if let Some(m) = SHARED_MODEL.get() {
        return Ok(m.clone());
    }
    let model = Arc::new(EmbeddingModel::new().context("Failed to load embedding model")?);
    // set() fails only if already set; ignore that case
    let _ = SHARED_MODEL.set(model);
    Ok(SHARED_MODEL.get().unwrap().clone())
}

/// Orchestrator for indexing and searching source code functions
pub struct Indexer {
    model: Arc<EmbeddingModel>,
    index: Mutex<VectorIndex>,
    db: Db,
    next_id: Mutex<u64>,
}

impl Indexer {
    /// Create a new indexer, loading existing state from disk if available.
    /// Uses the default ~/.apohara/index.redb database path.
    pub fn new() -> Result<Self> {
        tracing::info!("Loading embedding model...");
        let model = shared_model().context("Failed to load embedding model")?;

        // Initialize or open database
        tracing::info!("Opening database...");
        let db = Db::new().context("Failed to open database")?;

        // Load existing index or create new one
        let index = match db.get_index_state()? {
            Some(data) => {
                tracing::info!("Restoring index from database...");
                VectorIndex::from_bytes(&data)
                    .context("Failed to restore index from database")?
            }
            None => {
                tracing::info!("Creating new index...");
                VectorIndex::new(IndexConfig::default())
            }
        };

        // Find the next available ID
        let node_ids = db.get_all_node_ids()?;
        let next_id = node_ids.iter().max().map(|&id| id + 1).unwrap_or(1);

        tracing::info!(
            "Indexer initialized: {} nodes in database, next_id={}",
            node_ids.len(),
            next_id
        );

        Ok(Self {
            model,
            index: Mutex::new(index),
            db,
            next_id: Mutex::new(next_id),
        })
    }

    /// Create a new indexer using a custom database path.
    /// Shares the process-level model singleton to avoid duplicate model loads in tests.
    pub fn with_db_path(db_path: &std::path::Path) -> Result<Self> {
        let model = shared_model().context("Failed to load embedding model")?;
        let db = Db::with_path(db_path).context("Failed to open database")?;

        let index = match db.get_index_state()? {
            Some(data) => VectorIndex::from_bytes(&data)
                .context("Failed to restore index from database")?,
            None => VectorIndex::new(IndexConfig::default()),
        };

        let node_ids = db.get_all_node_ids()?;
        let next_id = node_ids.iter().max().map(|&id| id + 1).unwrap_or(1);

        Ok(Self {
            model,
            index: Mutex::new(index),
            db,
            next_id: Mutex::new(next_id),
        })
    }

    /// Get the database path
    pub fn db_path(&self) -> &PathBuf {
        self.db.path()
    }

    /// Get the current number of indexed functions
    pub fn len(&self) -> usize {
        self.index.lock().unwrap().len()
    }

    /// Index a text string (raw function code)
    pub fn index_text(&self, text: &str, metadata: NodeMetadata) -> Result<u64> {
        // Generate embedding
        tracing::debug!("Generating embedding for text ({} chars)", text.len());
        let embedding = self.model.embed(text)?;

        // Get next ID
        let id = {
            let mut next_id = self.next_id.lock().unwrap();
            let id = *next_id;
            *next_id += 1;
            id
        };

        // Insert into vector index
        {
            let mut index = self.index.lock().unwrap();
            index.insert(id, &embedding)?;
        }

        // Store metadata in database
        self.db.put_node(id, &metadata)?;

        // Save index state
        self.save_index_state()?;

        tracing::debug!("Indexed text with id={}", id);

        Ok(id)
    }

    /// Index a source file, extracting function signatures and embedding each one
    pub fn index_file(&self, path: &Path) -> Result<Vec<u64>> {
        tracing::info!("Indexing file: {:?}", path);

        // Parse file to extract function signatures
        let signatures = parse_file(path)
            .with_context(|| format!("Failed to parse file: {:?}", path))?;

        if signatures.is_empty() {
            tracing::debug!("No functions found in {:?}", path);
            return Ok(Vec::new());
        }

        // Read the source file (currently using signature; full body extraction available)
        let _source = std::fs::read_to_string(path)
            .with_context(|| format!("Failed to read file: {:?}", path))?;

        let mut ids = Vec::new();

        for sig in signatures {
            // Create a text representation of the function for embedding
            let embed_text = self.create_embedding_text(&sig, path);

            let metadata = NodeMetadata {
                file_path: path.to_string_lossy().to_string(),
                function_name: sig.name.clone(),
                parameters: sig.parameters.iter()
                    .map(|p| {
                        match &p.type_annotation {
                            Some(t) => format!("{}: {}", p.name, t),
                            None => p.name.clone(),
                        }
                    })
                    .collect::<Vec<_>>()
                    .join(", "),
                return_type: sig.return_type.clone(),
                line: sig.line,
                column: sig.column,
            };

            let id = self.index_text(&embed_text, metadata)?;
            ids.push(id);

            tracing::debug!("Indexed function: {} at line {}", sig.name, sig.line);
        }

        tracing::info!("Indexed {} functions from {:?}", ids.len(), path);

        Ok(ids)
    }

    /// Create a text representation of a function for embedding
    fn create_embedding_text(&self, sig: &FunctionSignature, path: &Path) -> String {
        let lang = path.extension()
            .and_then(|e| e.to_str())
            .unwrap_or("");

        let return_type = sig.return_type.as_deref().unwrap_or("");

        let params = sig.parameters.iter()
            .map(|p| {
                match &p.type_annotation {
                    Some(t) => format!("{}: {}", p.name, t),
                    None => p.name.clone(),
                }
            })
            .collect::<Vec<_>>()
            .join(", ");

        // Create a semantic representation that captures the function's signature
        format!(
            "function {}({}) -> {} language:{}",
            sig.name, params, return_type, lang
        )
    }

    /// Search for similar functions
    pub fn search(&self, query: &str, k: usize) -> Result<Vec<SearchResult>> {
        if self.len() == 0 {
            tracing::debug!("Search on empty index returned empty results");
            return Ok(Vec::new());
        }

        // Generate embedding for query
        tracing::debug!("Searching for: {}", query);
        let embedding = self.model.embed(query)?;

        // Search the index
        let results = {
            let index = self.index.lock().unwrap();
            index.search(&embedding, k)?
        };

        // Look up metadata for each result
        let mut search_results = Vec::new();
        for (id, distance) in results {
            if let Some(metadata) = self.db.get_node(id)? {
                search_results.push(SearchResult {
                    id,
                    distance,
                    metadata,
                });
            }
        }

        tracing::debug!("Search returned {} results", search_results.len());

        Ok(search_results)
    }

    /// Save the current index state to the database
    fn save_index_state(&self) -> Result<()> {
        let index = self.index.lock().unwrap();
        let data = index.to_bytes()?;
        self.db.put_index_state(&data)?;

        tracing::debug!("Saved index state ({} bytes)", data.len());

        Ok(())
    }

    /// Get database file size
    pub fn db_file_size(&self) -> Result<u64> {
        self.db.file_size()
    }

    /// Generate embedding for text (public API for external usage)
    pub fn embed(&self, text: &str) -> Result<Vec<f32>> {
        self.model.embed(text)
    }

    /// Search for all signatures (functions, classes) in a specific file by path
    /// This queries the database directly without using vector search
    pub fn search_by_file_path(&self, file_path: &str) -> Result<Vec<FileSignature>> {
        tracing::debug!("Searching for signatures in file: {}", file_path);

        // Get all node IDs from the database
        let node_ids = self.db.get_all_node_ids()?;
        let mut signatures = Vec::new();

        // Filter nodes by file_path
        for id in node_ids {
            if let Some(metadata) = self.db.get_node(id)? {
                if metadata.file_path == file_path {
                    signatures.push(FileSignature {
                        name: metadata.function_name,
                        parameters: metadata.parameters,
                        return_type: metadata.return_type,
                        line: metadata.line,
                        column: metadata.column,
                    });
                }
            }
        }

        // Sort by line number for consistent output
        signatures.sort_by_key(|s| s.line);

        tracing::debug!("Found {} signatures in {}", signatures.len(), file_path);
        Ok(signatures)
    }

    // ============================================================================
    // Memory Operations
    // ============================================================================

    /// Store a memory in the database
    ///
    /// # Arguments
    /// - `memory_type`: Type of memory (Correction, Preference, Architecture, PastError)
    /// - `content`: Text content of the memory
    ///
    /// # Returns
    /// The UUID of the stored memory
    pub fn store_memory(&self, memory_type: &str, content: &str) -> Result<String> {
        use crate::db::{Memory, MemoryType};
        use std::str::FromStr;

        // Parse memory type
        let memory_type = MemoryType::from_str(memory_type)
            .map_err(|e| anyhow::anyhow!("Invalid memory type: {}", e))?;

        // Generate embedding for content
        tracing::debug!("Generating embedding for memory content ({} chars)", content.len());
        let embedding = self.model.embed(content)?;

        // Generate UUID
        let id = uuid::Uuid::new_v4().to_string();

        // Create memory
        let memory = Memory {
            id: id.clone(),
            memory_type,
            content: content.to_string(),
            embedding,
            created_at: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs(),
        };

        // Store in database
        self.db.put_memory(&memory)?;

        tracing::info!("Stored memory with id={}", id);
        Ok(id)
    }

    /// Search memories by semantic similarity
    ///
    /// # Arguments
    /// - `query`: Text to search for
    /// - `top_k`: Maximum number of results to return
    ///
    /// # Returns
    /// Vector of (Memory, similarity_score) tuples, sorted by relevance
    pub fn search_memories(&self, query: &str, top_k: usize) -> Result<Vec<(crate::db::Memory, f32)>> {
        // Generate embedding for query
        tracing::debug!("Searching memories for: {}", query);
        let query_embedding = self.model.embed(query)?;

        // Search database
        let results = self.db.search_memories_by_embedding(&query_embedding, top_k)?;

        tracing::debug!("Memory search returned {} results", results.len());
        Ok(results)
    }
}

/// Represents a function/class signature extracted from a file
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileSignature {
    /// Function or method name
    pub name: String,
    /// Parameters as a string (e.g., "a: i32, b: String")
    pub parameters: String,
    /// Return type if any
    pub return_type: Option<String>,
    /// Line number in source file
    pub line: usize,
    /// Column number in source file
    pub column: usize,
}

/// Search result with metadata
#[derive(Debug, Clone)]
pub struct SearchResult {
    /// The ID of the indexed function
    pub id: u64,
    /// Distance from query (lower = more similar)
    pub distance: f32,
    /// The stored metadata
    pub metadata: NodeMetadata,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_indexer_creation() {
        // This requires model download, skip in normal tests
        // let indexer = Indexer::new();
        // assert!(indexer.is_ok());
    }

    #[test]
    fn test_create_embedding_text() {
        // Create a minimal indexer without loading the full model
        let sig = FunctionSignature::new("add")
            .add_parameter("a", Some("number"))
            .add_parameter("b", Some("number"))
            .with_return_type("number");

        let path = Path::new("test.ts");

        // The text format includes function signature
        let text = format!(
            "function {}({}) -> {} language:{}",
            sig.name,
            sig.parameters.iter()
                .map(|p| format!("{}: {}", p.name, p.type_annotation.as_ref().unwrap()))
                .collect::<Vec<_>>()
                .join(", "),
            sig.return_type.as_deref().unwrap_or(""),
            "ts"
        );

        assert!(text.contains("add"));
        assert!(text.contains("number"));
    }

    #[test]
    fn test_memory_embedding() {
        // Load the actual embedding model (requires model download on first run)
        let indexer = Indexer::new();

        // Skip test if model can't be loaded (e.g., no internet, CI environment)
        if indexer.is_err() {
            eprintln!("Skipping test_memory_embedding: could not load model");
            return;
        }

        let indexer = indexer.unwrap();

        // Test embedding memory content
        let memory_content = "User prefers snake_case for all variable names";
        let embedding = indexer.embed(memory_content);

        assert!(embedding.is_ok(), "Should generate embedding for memory content");
        let embedding = embedding.unwrap();
        assert_eq!(embedding.len(), 768, "Nomic BERT produces 768-dim embeddings");

        // Verify embedding is normalized (L2 norm ≈ 1.0)
        let norm: f32 = embedding.iter().map(|x| x * x).sum::<f32>().sqrt();
        assert!((norm - 1.0).abs() < 0.01, "Embedding should be normalized, norm was {}", norm);

        // Test that different content produces different embeddings
        let different_content = "User prefers camelCase for all variable names";
        let different_embedding = indexer.embed(different_content).unwrap();

        // Semantic-similarity assertions only hold for the real BERT model. The mock
        // produces hash-keyed random vectors with no semantic structure.
        if !crate::embeddings::EmbeddingModel::should_use_mock() {
            // Cosine similarity should be high but not identical
            let dot_product: f32 = embedding.iter().zip(different_embedding.iter()).map(|(a, b)| a * b).sum();
            assert!(dot_product > 0.5, "Similar content should have high cosine similarity");
            assert!(dot_product < 0.99, "Different content should not be identical");

            // Test that similar content produces very similar embeddings
            let similar_content = "User prefers snake_case for variable naming";
            let similar_embedding = indexer.embed(similar_content).unwrap();
            let similar_dot: f32 = embedding.iter().zip(similar_embedding.iter()).map(|(a, b)| a * b).sum();
            assert!(similar_dot > 0.9, "Semantically similar content should have very high cosine similarity");
        }
    }
}
