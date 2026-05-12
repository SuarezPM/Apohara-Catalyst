/// HNSW-style vector index for nearest neighbor search.
/// 
/// Provides an in-memory vector index that stores embeddings and supports
/// fast similarity search. Supports serialization for persistence.
/// 
/// Note: Uses cosine similarity for nearest neighbor search.

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Configuration for vector index parameters.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexConfig {
    /// Dimension of vectors (must match embedding dimension).
    pub dim: usize,
}

impl Default for IndexConfig {
    fn default() -> Self {
        Self {
            dim: 768, // Match Nomic Bert embedding dimension
        }
    }
}

/// In-memory vector index with simple search.
pub struct VectorIndex {
    vectors: HashMap<u64, Vec<f32>>,
    dimension: usize,
}

impl VectorIndex {
    /// Create a new vector index with the given configuration.
    pub fn new(config: IndexConfig) -> Self {
        Self {
            vectors: HashMap::new(),
            dimension: config.dim,
        }
    }

    /// Insert a vector into the index with a unique ID.
    ///
    /// # Arguments
    /// - `id`: Unique identifier for the vector
    /// - `vector`: The embedding vector (must match configured dimension)
    ///
    /// # Errors
    /// Returns an error if the vector dimension doesn't match or if the
    /// vector contains NaN/Inf values.
    pub fn insert(&mut self, id: u64, vector: &[f32]) -> Result<()> {
        // Validate dimension
        if vector.len() != self.dimension {
            anyhow::bail!(
                "Vector dimension mismatch: expected {}, got {}",
                self.dimension,
                vector.len()
            );
        }

        // Validate no NaN/Inf
        for (i, v) in vector.iter().enumerate() {
            if !v.is_finite() {
                anyhow::bail!(
                    "Vector contains non-finite value at index {}: {}",
                    i,
                    v
                );
            }
        }

        // Store normalized vector for cosine similarity
        let normalized = normalize(vector);
        
        self.vectors.insert(id, normalized);
        
        tracing::debug!(
            "Inserted vector with id {} into index (total dimension: {})",
            id,
            self.dimension
        );

        Ok(())
    }

    /// Search for the k nearest neighbors to the query vector.
    ///
    /// # Arguments
    /// - `query`: The query embedding vector
    /// - `k`: Number of nearest neighbors to return
    ///
    /// # Returns
    /// Vector of (id, distance) tuples, sorted by distance (ascending).
    /// Returns empty vector if the index is empty.
    ///
    /// # Errors
    /// Returns an error if the query vector dimension doesn't match.
    pub fn search(&self, query: &[f32], k: usize) -> Result<Vec<(u64, f32)>> {
        if self.vectors.is_empty() {
            tracing::debug!("Search on empty index returned empty result");
            return Ok(Vec::new());
        }

        // Validate dimension
        if query.len() != self.dimension {
            anyhow::bail!(
                "Query dimension mismatch: expected {}, got {}",
                self.dimension,
                query.len()
            );
        }

        // Validate query doesn't contain NaN/Inf
        for v in query {
            if !v.is_finite() {
                anyhow::bail!("Query contains non-finite value: {}", v);
            }
        }

        // Normalize query for cosine similarity
        let normalized_query = normalize(query);
        
        // Compute distances to all vectors
        let mut distances: Vec<(u64, f32)> = self.vectors
            .iter()
            .map(|(id, vec)| {
                let distance = cosine_distance(&normalized_query, vec);
                (*id, distance)
            })
            .collect();
        
        // Sort by distance (ascending for cosine similarity, lower = more similar)
        distances.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal));
        
        // Return top k results
        let results: Vec<(u64, f32)> = distances.into_iter().take(k).collect();
        
        tracing::debug!(
            "Search for k={} returned {} results from index of size {}",
            k,
            results.len(),
            self.vectors.len()
        );

        Ok(results)
    }

    /// Get the number of vectors in the index.
    pub fn len(&self) -> usize {
        self.vectors.len()
    }

    /// Check if the index is empty.
    pub fn is_empty(&self) -> bool {
        self.vectors.is_empty()
    }

    /// Get the dimension of vectors in this index.
    pub fn dimension(&self) -> usize {
        self.dimension
    }

    /// Serialize the index to a byte vector.
    ///
    /// # Returns
    /// A byte vector containing the serialized index data.
    pub fn to_bytes(&self) -> Result<Vec<u8>> {
        let config = IndexConfig {
            dim: self.dimension,
        };
        
        // Serialize config + vectors
        let mut output = Vec::new();
        
        // Write config first
        let config_bytes = serde_json::to_vec(&config)
            .context("Failed to serialize index config")?;
        let config_len = config_bytes.len() as u32;
        output.extend_from_slice(&config_len.to_le_bytes());
        output.extend_from_slice(&config_bytes);
        
        // Write vectors as JSON
        let vectors_bytes = serde_json::to_vec(&self.vectors)
            .context("Failed to serialize vectors")?;
        let vectors_len = vectors_bytes.len() as u32;
        output.extend_from_slice(&vectors_len.to_le_bytes());
        output.extend_from_slice(&vectors_bytes);

        tracing::debug!(
            "Serialized index: config={} bytes, vectors={} bytes, total={} bytes",
            config_bytes.len(),
            vectors_bytes.len(),
            output.len()
        );

        Ok(output)
    }

    /// Deserialize an index from a byte vector.
    ///
    /// # Arguments
    /// - `data`: The serialized byte data
    ///
    /// # Returns
    /// A new VectorIndex instance restored from the data.
    pub fn from_bytes(data: &[u8]) -> Result<Self> {
        let mut offset = 0;
        
        // Read config length
        if data.len() < 4 {
            anyhow::bail!("Invalid serialized data: too short for config length");
        }
        let config_len = u32::from_le_bytes([data[0], data[1], data[2], data[3]]) as usize;
        offset += 4;

        // Read config
        if data.len() < 4 + config_len {
            anyhow::bail!("Invalid serialized data: truncated config");
        }
        let config: IndexConfig = serde_json::from_slice(&data[4..4 + config_len])
            .context("Failed to deserialize index config")?;
        offset += config_len;

        // Read vectors length
        if data.len() < offset + 4 {
            anyhow::bail!("Invalid serialized data: too short for vectors length");
        }
        let vectors_len = u32::from_le_bytes([data[offset], data[offset+1], data[offset+2], data[offset+3]]) as usize;
        offset += 4;

        // Read vectors
        if data.len() < offset + vectors_len {
            anyhow::bail!("Invalid serialized data: truncated vectors");
        }
        let vectors: HashMap<u64, Vec<f32>> = serde_json::from_slice(&data[offset..offset + vectors_len])
            .context("Failed to deserialize vectors")?;

        tracing::debug!(
            "Deserialized index: dimension={}, index_size={}",
            config.dim,
            vectors.len()
        );

        Ok(Self {
            vectors,
            dimension: config.dim,
        })
    }
}

/// Normalize a vector to unit length (for cosine similarity).
fn normalize(vector: &[f32]) -> Vec<f32> {
    let norm: f32 = vector.iter().map(|x| x * x).sum::<f32>().sqrt();
    if norm == 0.0 {
        return vec![0.0; vector.len()];
    }
    vector.iter().map(|x| x / norm).collect()
}

/// Compute cosine distance between two normalized vectors.
fn cosine_distance(a: &[f32], b: &[f32]) -> f32 {
    // For normalized vectors, cosine distance = 1 - cosine_similarity
    // cosine_similarity = dot(a, b) since both are normalized
    let dot: f32 = a.iter().zip(b.iter()).map(|(x, y)| x * y).sum();
    // Return distance (1 - similarity), clamp to avoid floating point issues
    (1.0 - dot).max(0.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_insert_and_search() {
        let config = IndexConfig { dim: 3 };
        let mut index = VectorIndex::new(config);

        // Insert some vectors
        let v1 = vec![1.0, 0.0, 0.0];
        let v2 = vec![0.0, 1.0, 0.0];
        let v3 = vec![0.0, 0.0, 1.0];
        let v4 = vec![0.9, 0.1, 0.0]; // Close to v1

        index.insert(1, &v1).unwrap();
        index.insert(2, &v2).unwrap();
        index.insert(3, &v3).unwrap();
        index.insert(4, &v4).unwrap();

        // Query for something close to v1
        let query = vec![1.0, 0.0, 0.0];
        let results = index.search(&query, 2).unwrap();

        assert_eq!(results.len(), 2);
        // The closest should be v1 (id=1) or v4 (id=4) - both very close to query
        assert!(results[0].0 == 1 || results[0].0 == 4, 
            "Expected id 1 or 4, got {}", results[0].0);
    }

    #[test]
    fn test_empty_index_search() {
        let config = IndexConfig::default();
        let index = VectorIndex::new(config);

        let query = vec![0.0; 768];
        let results = index.search(&query, 5).unwrap();

        assert!(results.is_empty(), "Search on empty index should return empty");
    }

    #[test]
    fn test_dimension_mismatch_insert() {
        let config = IndexConfig { dim: 3 };
        let mut index = VectorIndex::new(config);

        // Try to insert vector with wrong dimension
        let result = index.insert(1, &vec![1.0, 2.0]); // Only 2 elements
        assert!(result.is_err());
    }

    #[test]
    fn test_dimension_mismatch_search() {
        let config = IndexConfig { dim: 3 };
        let mut index = VectorIndex::new(config);

        // Insert a valid vector first
        index.insert(1, &[1.0, 0.0, 0.0]).unwrap();

        // Now search with wrong dimension
        let result = index.search(&vec![1.0, 2.0], 5);
        assert!(result.is_err());
    }

    #[test]
    fn test_nan_rejection_insert() {
        let config = IndexConfig { dim: 3 };
        let mut index = VectorIndex::new(config);

        // Insert vector with NaN
        let result = index.insert(1, &vec![1.0, std::f32::NAN, 0.0]);
        assert!(result.is_err());

        // Insert vector with Inf
        let result = index.insert(2, &vec![1.0, std::f32::INFINITY, 0.0]);
        assert!(result.is_err());
    }

    #[test]
    fn test_nan_rejection_search() {
        let config = IndexConfig { dim: 3 };
        let mut index = VectorIndex::new(config);

        // Insert valid vector first
        index.insert(1, &vec![1.0, 0.0, 0.0]).unwrap();

        // Search with NaN query
        let result = index.search(&vec![std::f32::NAN, 0.0, 0.0], 1);
        assert!(result.is_err());
    }

    #[test]
    fn test_serialization_roundtrip() {
        let config = IndexConfig { dim: 4 };
        let mut index = VectorIndex::new(config);

        // Insert some vectors
        index.insert(1, &[1.0, 0.0, 0.0, 0.0]).unwrap();
        index.insert(2, &[0.0, 1.0, 0.0, 0.0]).unwrap();
        index.insert(3, &[0.0, 0.0, 1.0, 0.0]).unwrap();

        // Serialize
        let bytes = index.to_bytes().unwrap();

        // Deserialize
        let restored = VectorIndex::from_bytes(&bytes).unwrap();

        // Verify
        assert_eq!(restored.len(), 3);
        assert_eq!(restored.dimension(), 4);

        // Search should work on restored index
        let results = restored.search(&[1.0, 0.0, 0.0, 0.0], 2).unwrap();
        assert!(!results.is_empty());
    }

    #[test]
    fn test_exact_dimension_768() {
        // Verify the index works with the actual embedding dimension
        let config = IndexConfig::default(); // dim = 768
        let mut index = VectorIndex::new(config);

        let vec = vec![0.1; 768];
        index.insert(1, &vec).unwrap();

        let query = vec![0.1; 768];
        let results = index.search(&query, 1).unwrap();

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].0, 1);
    }

    #[test]
    fn test_cosine_similarity_ordering() {
        // Test that the index correctly orders by cosine similarity
        let config = IndexConfig { dim: 2 };
        let mut index = VectorIndex::new(config);

        // Insert vectors at different angles
        index.insert(1, &[1.0, 0.0]).unwrap();      // 0 degrees
        index.insert(2, &[0.0, 1.0]).unwrap();      // 90 degrees  
        index.insert(3, &[-1.0, 0.0]).unwrap();    // 180 degrees

        // Query at 0 degrees - should return id=1 as closest
        let query = vec![1.0, 0.0];
        let results = index.search(&query, 3).unwrap();

        assert_eq!(results[0].0, 1); // Should be closest to query
    }
}