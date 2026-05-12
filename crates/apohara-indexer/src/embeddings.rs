use anyhow::Result;
use candle_core::{Device, Tensor};
use candle_nn::VarBuilder;
use candle_transformers::models::nomic_bert::{Config, NomicBertModel as BertModel};
use hf_hub::api::sync::ApiBuilder;
use hf_hub::{Repo, RepoType};
use std::path::PathBuf;
use tokenizers::Tokenizer;

/// Embedding model used by the indexer. Two variants:
/// - `Real`: loads Nomic BERT (~400 MB) from HuggingFace, runs CPU inference.
/// - `Mock`: deterministic 768-dim vector keyed on a hash of the input. Used in tests
///   to avoid loading BERT (which caused system-wide OOM under parallel test runs).
///
/// Selection rules (first-match wins):
/// 1. If feature `mock-embeddings` is active at compile time → Mock.
/// 2. If env var `APOHARA_MOCK_EMBEDDINGS=1` at runtime → Mock.
/// 3. Otherwise → Real (production default).
pub enum EmbeddingModel {
    Real {
        model: BertModel,
        tokenizer: Tokenizer,
        device: Device,
    },
    Mock,
}

const EMBEDDING_DIM: usize = 768;

impl EmbeddingModel {
    pub fn new() -> Result<Self> {
        if Self::should_use_mock() {
            return Ok(Self::Mock);
        }
        Self::new_real()
    }

    /// Returns true when the indexer is using the mock variant (no semantic similarity).
    /// Use this in tests to skip assertions that depend on real BERT embeddings.
    pub fn should_use_mock() -> bool {
        if cfg!(feature = "mock-embeddings") {
            return true;
        }
        std::env::var("APOHARA_MOCK_EMBEDDINGS")
            .map(|v| v != "0" && !v.is_empty())
            .unwrap_or(false)
    }

    fn new_real() -> Result<Self> {
        let mut cache_dir = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
        cache_dir.push(".apohara");
        cache_dir.push("models");

        let api = ApiBuilder::new().with_cache_dir(cache_dir).build()?;
        let repo = api.repo(Repo::with_revision(
            "nomic-ai/nomic-embed-text-v1.5".to_string(),
            RepoType::Model,
            "main".to_string(),
        ));

        let config_filename = repo.get("config.json")?;
        let tokenizer_filename = repo.get("tokenizer.json")?;
        let weights_filename = repo.get("model.safetensors")?;

        let config: Config = serde_json::from_slice(&std::fs::read(&config_filename)?)?;

        let device = Device::Cpu;
        let vb = unsafe {
            VarBuilder::from_mmaped_safetensors(
                &[weights_filename],
                candle_core::DType::F32,
                &device,
            )?
        };

        let model = BertModel::load(vb, &config)?;
        let mut tokenizer = Tokenizer::from_file(tokenizer_filename)
            .map_err(|e| anyhow::anyhow!("Failed to load tokenizer: {}", e))?;

        let _ = tokenizer.with_truncation(Some(tokenizers::TruncationParams {
            max_length: 8192,
            ..Default::default()
        }));

        Ok(Self::Real {
            model,
            tokenizer,
            device,
        })
    }

    pub fn embed(&self, text: &str) -> Result<Vec<f32>> {
        match self {
            Self::Real {
                model,
                tokenizer,
                device,
            } => Self::embed_real(text, model, tokenizer, device),
            Self::Mock => Ok(Self::embed_mock(text)),
        }
    }

    fn embed_real(
        text: &str,
        model: &BertModel,
        tokenizer: &Tokenizer,
        device: &Device,
    ) -> Result<Vec<f32>> {
        let prefix = "search_document: ";
        let text_with_prefix = format!("{}{}", prefix, text);
        let tokens = tokenizer
            .encode(text_with_prefix, true)
            .map_err(|e| anyhow::anyhow!("Failed to encode: {}", e))?;

        let token_ids = tokens.get_ids();
        let token_ids_tensor = Tensor::new(token_ids, device)?.unsqueeze(0)?;
        let token_type_ids = Tensor::zeros_like(&token_ids_tensor)?;

        let output = model.forward(&token_ids_tensor, Some(&token_type_ids), None)?;

        let embeddings = (output.sum(1)? / (token_ids.len() as f64))?;
        let embeddings = embeddings.squeeze(0)?;

        let norm = embeddings.sqr()?.sum_all()?.to_scalar::<f32>()?.sqrt();
        let normalized = (embeddings / (norm as f64))?;

        Ok(normalized.to_vec1::<f32>()?)
    }

    /// Deterministic 768-dim embedding keyed on a hash of the input. Same input → same
    /// vector across processes. Different inputs → near-orthogonal vectors. L2-normalized.
    /// Cosine similarity between two distinct mock embeddings is small but nonzero, which
    /// is enough for the indexer's similarity-search code paths to exercise their logic.
    fn embed_mock(text: &str) -> Vec<f32> {
        use std::collections::hash_map::DefaultHasher;
        use std::hash::{Hash, Hasher};

        let mut hasher = DefaultHasher::new();
        text.hash(&mut hasher);
        let seed = hasher.finish();

        // Linear congruential PRNG seeded by the hash. Deterministic, cheap, no extra deps.
        let mut state = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        let mut v: Vec<f32> = Vec::with_capacity(EMBEDDING_DIM);
        for _ in 0..EMBEDDING_DIM {
            state = state
                .wrapping_mul(6364136223846793005)
                .wrapping_add(1442695040888963407);
            // Map u64 → f32 in [-0.5, 0.5)
            let x = ((state >> 32) as u32 as f32 / u32::MAX as f32) - 0.5;
            v.push(x);
        }

        let norm: f32 = v.iter().map(|x| x * x).sum::<f32>().sqrt();
        if norm > 0.0 {
            for x in v.iter_mut() {
                *x /= norm;
            }
        }
        v
    }
}

#[cfg(test)]
mod tests {
    // Route through crate::indexer::shared_model() so these unit tests participate in
    // the inter-process flock and the per-process singleton. In test builds the model
    // is `EmbeddingModel::Mock` (no BERT load).

    #[test]
    fn test_embedding_dimension() {
        let model = crate::indexer::shared_model().expect("Failed to load model");
        let vec = model.embed("Hello world!").expect("Failed to embed short string");
        assert_eq!(vec.len(), 768);
    }

    #[test]
    fn test_empty_string() {
        let model = crate::indexer::shared_model().expect("Failed to load model");
        let result = model.embed("");
        if let Ok(vec) = result {
            assert_eq!(vec.len(), 768);
        }
    }

    #[test]
    fn test_long_string() {
        let model = crate::indexer::shared_model().expect("Failed to load model");
        let long_string = "hello ".repeat(400);
        let vec_long = model.embed(&long_string).expect("Failed to embed long string");
        assert_eq!(vec_long.len(), 768);
    }

    #[test]
    fn test_mock_is_deterministic() {
        let m = super::EmbeddingModel::Mock;
        let a1 = m.embed("hello world").unwrap();
        let a2 = m.embed("hello world").unwrap();
        assert_eq!(a1, a2, "same input must produce identical mock vector");

        let b = m.embed("hello world!").unwrap();
        assert_ne!(a1, b, "different input must produce different mock vector");
    }

    #[test]
    fn test_mock_is_normalized() {
        let m = super::EmbeddingModel::Mock;
        let v = m.embed("normalization test").unwrap();
        let norm: f32 = v.iter().map(|x| x * x).sum::<f32>().sqrt();
        assert!((norm - 1.0).abs() < 1e-5, "mock vector must be L2-normalized; got norm={}", norm);
    }
}
