//! Wire envelope shared by every frame. Bumps the version when the schema
//! changes — clients refuse mismatched versions to avoid silent drift.

use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Current envelope version. Bump in lockstep with daemon + client releases.
pub const ENVELOPE_VERSION: u16 = 1;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Envelope {
    pub version: u16,
    pub kind: String,
    pub payload: serde_json::Value,
}

#[derive(Debug, Error)]
pub enum EnvelopeError {
    #[error("unsupported envelope version {got} (expected {expected})")]
    BadVersion { got: u16, expected: u16 },
    #[error("envelope kind cannot be empty")]
    EmptyKind,
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
}

impl Envelope {
    pub fn new(kind: impl Into<String>, payload: serde_json::Value) -> Self {
        Self {
            version: ENVELOPE_VERSION,
            kind: kind.into(),
            payload,
        }
    }

    pub fn validate(&self) -> Result<(), EnvelopeError> {
        if self.version != ENVELOPE_VERSION {
            return Err(EnvelopeError::BadVersion {
                got: self.version,
                expected: ENVELOPE_VERSION,
            });
        }
        if self.kind.trim().is_empty() {
            return Err(EnvelopeError::EmptyKind);
        }
        Ok(())
    }

    pub fn to_bytes(&self) -> Result<Vec<u8>, EnvelopeError> {
        Ok(serde_json::to_vec(self)?)
    }

    pub fn from_slice(bytes: &[u8]) -> Result<Self, EnvelopeError> {
        let e: Envelope = serde_json::from_slice(bytes)?;
        e.validate()?;
        Ok(e)
    }
}
