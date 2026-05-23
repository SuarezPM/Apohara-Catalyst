//! Locality-Sensitive Hashing for SimHash near-duplicate retrieval.
//!
//! Two pieces:
//!   * **Banding** — split each 64-bit SimHash into `b` bands of `r` bits.
//!     Two signatures sharing at least one band are LSH-candidates for
//!     a low-Hamming match. Probability of being declared a candidate at
//!     Jaccard similarity `s` is roughly `1 - (1 - s^r)^b` — the canonical
//!     Leskovec/Rajaraman/Ullman s-curve.
//!   * **Lookup** — an `LshIndex` holds a `HashMap<(band_idx, band_value),
//!     Vec<SignatureId>>` and a parallel signature store, so neighbor
//!     queries collapse to O(b + |candidates|) hashes instead of O(N)
//!     hamming computations.
//!
//! The hamming-distance ladder ([`MatchConfidence`]) feeds the
//! prompt-cache L2 safety layer described in
//! `docs/superpowers/plans/2026-05-23-apohara-catalyst-rust-phase-3-contextforge.md`.

use crate::simhash::hamming_distance;
use bitvec::prelude::*;
use std::collections::{HashMap, HashSet};

/// Banding scheme: `64 = bands * rows` must hold.
///
/// Valid `bands` values are the divisors of 64: `1, 2, 4, 8, 16, 32, 64`.
/// Constructor validates this at runtime.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BandScheme {
    bands: u8,
    rows: u8,
}

impl BandScheme {
    /// Build a band scheme with `bands` bands. Returns `None` if
    /// `bands` is zero or does not divide 64 evenly.
    pub fn new(bands: u8) -> Option<Self> {
        if bands == 0 || 64 % (bands as u32) != 0 {
            return None;
        }
        let rows = (64 / bands as u32) as u8;
        Some(Self { bands, rows })
    }

    #[inline]
    pub fn bands(&self) -> u8 {
        self.bands
    }
    #[inline]
    pub fn rows(&self) -> u8 {
        self.rows
    }
}

/// Split `signature` into its bands under `scheme`.
///
/// Band `i` (0-indexed) contains bits `[i*rows, (i+1)*rows)` of the
/// signature, returned as the band's right-aligned u64 value. Caller can
/// reconstruct the original signature by OR-ing `band[i] << (i * rows)`.
pub fn lsh_bands(signature: u64, scheme: BandScheme) -> Vec<u64> {
    let rows = scheme.rows as u32;
    let mask: u64 = if rows == 64 {
        u64::MAX
    } else {
        (1u64 << rows) - 1
    };
    (0..scheme.bands)
        .map(|i| (signature >> (i as u32 * rows)) & mask)
        .collect()
}

/// Hamming-distance confidence ladder for L2 cache safety.
///
/// Cutoffs follow `docs/superpowers/plans/...phase-3-contextforge.md`
/// (Step 6) so the prompt-cache classifier can branch on a stable enum
/// instead of magic numbers.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MatchConfidence {
    /// Hamming = 0 — bit-for-bit equal signatures.
    Exact,
    /// 1..=3 bits differ — extremely likely near-duplicate.
    HighConf,
    /// 4..=7 bits differ — likely related.
    MidConf,
    /// 8..=15 bits differ — possible related, treat with care.
    LowConf,
    /// 16+ bits differ — assume unrelated.
    Unrelated,
}

#[inline]
pub fn classify_match(hamming: u32) -> MatchConfidence {
    match hamming {
        0 => MatchConfidence::Exact,
        1..=3 => MatchConfidence::HighConf,
        4..=7 => MatchConfidence::MidConf,
        8..=15 => MatchConfidence::LowConf,
        _ => MatchConfidence::Unrelated,
    }
}

/// Opaque identifier for a signature stored inside an [`LshIndex`].
pub type SignatureId = u32;

/// A single neighbour match returned from a candidate query.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LshMatch {
    pub id: SignatureId,
    pub signature: u64,
    pub hamming: u32,
    pub confidence: MatchConfidence,
}

/// In-memory LSH index over 64-bit SimHash signatures.
///
/// Uses `bitvec` only to mark "which bands hit at least once" per query
/// (cheap dedup of repeated `(band_idx, band_value)` collisions on the
/// same candidate id without re-allocating a `HashSet` per band).
pub struct LshIndex {
    scheme: BandScheme,
    signatures: Vec<u64>,
    /// Bucket key encodes (band_index, band_value) packed into one u64
    /// so a single hash lookup retrieves all candidates.
    buckets: HashMap<u64, Vec<SignatureId>>,
}

impl LshIndex {
    pub fn new(scheme: BandScheme) -> Self {
        Self {
            scheme,
            signatures: Vec::new(),
            buckets: HashMap::new(),
        }
    }

    #[inline]
    pub fn scheme(&self) -> BandScheme {
        self.scheme
    }

    #[inline]
    pub fn len(&self) -> usize {
        self.signatures.len()
    }

    #[inline]
    pub fn is_empty(&self) -> bool {
        self.signatures.is_empty()
    }

    /// Insert `signature` and return its [`SignatureId`].
    pub fn insert(&mut self, signature: u64) -> SignatureId {
        let id = self.signatures.len() as SignatureId;
        self.signatures.push(signature);
        for (band_idx, band_value) in lsh_bands(signature, self.scheme).into_iter().enumerate() {
            let key = pack_key(band_idx as u8, band_value);
            self.buckets.entry(key).or_default().push(id);
        }
        id
    }

    /// Retrieve every stored signature whose Hamming distance to
    /// `query` is `<= max_hamming`. Candidates are gathered via the
    /// band index and verified by exact Hamming, so the result is
    /// precise (no false positives).
    pub fn query(&self, query: u64, max_hamming: u32) -> Vec<LshMatch> {
        if self.signatures.is_empty() {
            return Vec::new();
        }

        // De-dup candidate ids across bands using a bitvec sized to the
        // current population. O(N/8) bytes — beats HashSet allocator
        // churn at index sizes ≤ 10⁶.
        let mut seen: BitVec = bitvec![0; self.signatures.len()];

        let mut out = Vec::new();
        for (band_idx, band_value) in lsh_bands(query, self.scheme).into_iter().enumerate() {
            let key = pack_key(band_idx as u8, band_value);
            if let Some(ids) = self.buckets.get(&key) {
                for &id in ids {
                    let idx = id as usize;
                    if seen[idx] {
                        continue;
                    }
                    seen.set(idx, true);
                    let candidate = self.signatures[idx];
                    let hd = hamming_distance(query, candidate);
                    if hd <= max_hamming {
                        out.push(LshMatch {
                            id,
                            signature: candidate,
                            hamming: hd,
                            confidence: classify_match(hd),
                        });
                    }
                }
            }
        }
        // Lowest Hamming first — callers typically want the best match.
        out.sort_by_key(|m| m.hamming);
        out
    }

    /// Approximate-only candidate set (no Hamming verification).
    /// Useful when callers want to filter on payload metadata before
    /// running the exact distance check themselves. Returned ids are
    /// unique (de-duped via the same bitvec scheme as [`Self::query`]).
    pub fn candidates(&self, query: u64) -> HashSet<SignatureId> {
        let mut out = HashSet::new();
        for (band_idx, band_value) in lsh_bands(query, self.scheme).into_iter().enumerate() {
            let key = pack_key(band_idx as u8, band_value);
            if let Some(ids) = self.buckets.get(&key) {
                for &id in ids {
                    out.insert(id);
                }
            }
        }
        out
    }
}

#[inline]
fn pack_key(band_idx: u8, band_value: u64) -> u64 {
    // Band index occupies the top 8 bits; band value sits in the low 56.
    // Safe because `rows = 64/bands ≤ 64`, so even with bands=1 the value
    // is a full u64 — in that single-band case the packing collides only
    // when band_value == query, which is fine (everything goes into one
    // bucket and the exact Hamming check filters).
    ((band_idx as u64) << 56) | (band_value & ((1u64 << 56) - 1))
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    #[test]
    fn scheme_rejects_non_divisor() {
        assert!(BandScheme::new(0).is_none());
        assert!(BandScheme::new(3).is_none());
        assert!(BandScheme::new(5).is_none());
        assert!(BandScheme::new(7).is_none());
        // Valid divisors of 64
        for b in [1, 2, 4, 8, 16, 32, 64] {
            let s = BandScheme::new(b).unwrap();
            assert_eq!(s.bands() as u32 * s.rows() as u32, 64);
        }
    }

    #[test]
    fn bands_partition_signature_round_trip() {
        let sig: u64 = 0xDEAD_BEEF_CAFE_BABE;
        for bands in [1u8, 2, 4, 8, 16, 32, 64] {
            let scheme = BandScheme::new(bands).unwrap();
            let parts = lsh_bands(sig, scheme);
            assert_eq!(parts.len(), bands as usize);
            let rows = scheme.rows() as u32;
            let mut recon: u64 = 0;
            for (i, &p) in parts.iter().enumerate() {
                recon |= p << (i as u32 * rows);
            }
            assert_eq!(recon, sig, "round-trip failed for bands={bands}");
        }
    }

    #[test]
    fn similar_signatures_share_band_4x16() {
        let scheme = BandScheme::new(4).unwrap();
        let a: u64 = 0xDEAD_BEEF_CAFE_BABE;
        let b = a ^ 0x0000_0000_0000_0003; // flip 2 bits in band 0 only
        let ba = lsh_bands(a, scheme);
        let bb = lsh_bands(b, scheme);
        let shared = ba.iter().zip(&bb).filter(|(x, y)| x == y).count();
        assert_eq!(shared, 3, "expected 3 of 4 bands to match");
    }

    #[test]
    fn classify_match_ladder_boundaries() {
        assert_eq!(classify_match(0), MatchConfidence::Exact);
        assert_eq!(classify_match(1), MatchConfidence::HighConf);
        assert_eq!(classify_match(3), MatchConfidence::HighConf);
        assert_eq!(classify_match(4), MatchConfidence::MidConf);
        assert_eq!(classify_match(7), MatchConfidence::MidConf);
        assert_eq!(classify_match(8), MatchConfidence::LowConf);
        assert_eq!(classify_match(15), MatchConfidence::LowConf);
        assert_eq!(classify_match(16), MatchConfidence::Unrelated);
        assert_eq!(classify_match(64), MatchConfidence::Unrelated);
    }

    #[test]
    fn index_recovers_exact_match() {
        let mut idx = LshIndex::new(BandScheme::new(8).unwrap());
        idx.insert(0xDEAD_BEEF);
        idx.insert(0xCAFE_BABE);
        let hits = idx.query(0xDEAD_BEEF, 0);
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].hamming, 0);
        assert_eq!(hits[0].confidence, MatchConfidence::Exact);
    }

    #[test]
    fn index_recovers_near_match_within_threshold() {
        let mut idx = LshIndex::new(BandScheme::new(8).unwrap());
        let sig = 0xDEAD_BEEF_CAFE_BABEu64;
        idx.insert(sig);
        // Flip 2 bits in low band → same band collisions for the other 7.
        let query = sig ^ 0b11;
        let hits = idx.query(query, 4);
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].hamming, 2);
        assert_eq!(hits[0].confidence, MatchConfidence::HighConf);
    }

    #[test]
    fn index_rejects_unrelated_signatures() {
        let mut idx = LshIndex::new(BandScheme::new(8).unwrap());
        idx.insert(0x0000_0000_0000_0000);
        let hits = idx.query(0xFFFF_FFFF_FFFF_FFFF, 4);
        assert!(hits.is_empty(), "fully-flipped query should not match zero");
    }

    #[test]
    fn index_returns_sorted_by_hamming() {
        let mut idx = LshIndex::new(BandScheme::new(8).unwrap());
        let base = 0u64;
        idx.insert(base ^ 0b1111);     // hd = 4
        idx.insert(base);              // hd = 0
        idx.insert(base ^ 0b1);        // hd = 1
        let hits = idx.query(base, 8);
        let hd_sequence: Vec<u32> = hits.iter().map(|m| m.hamming).collect();
        assert_eq!(hd_sequence, vec![0, 1, 4]);
    }

    #[test]
    fn empty_index_yields_no_hits() {
        let idx = LshIndex::new(BandScheme::new(8).unwrap());
        assert!(idx.query(0xDEAD, 32).is_empty());
        assert!(idx.candidates(0xDEAD).is_empty());
        assert!(idx.is_empty());
    }

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(64))]

        /// Round-trip: bands ∘ reconstruct = identity for every valid scheme.
        #[test]
        fn prop_bands_round_trip(
            sig in any::<u64>(),
            bands_idx in 0usize..7,
        ) {
            let bands = [1u8, 2, 4, 8, 16, 32, 64][bands_idx];
            let scheme = BandScheme::new(bands).unwrap();
            let parts = lsh_bands(sig, scheme);
            let rows = scheme.rows() as u32;
            let mut recon: u64 = 0;
            for (i, &p) in parts.iter().enumerate() {
                recon |= p << (i as u32 * rows);
            }
            prop_assert_eq!(recon, sig);
        }

        /// An exact insert is always recoverable at distance 0.
        #[test]
        fn prop_insert_recovers_exact(
            sig in any::<u64>(),
            bands_idx in 0usize..6, // skip bands=64 (each bucket holds 1 bit only)
        ) {
            let bands = [1u8, 2, 4, 8, 16, 32][bands_idx];
            let mut idx = LshIndex::new(BandScheme::new(bands).unwrap());
            idx.insert(sig);
            let hits = idx.query(sig, 0);
            prop_assert_eq!(hits.len(), 1);
            prop_assert_eq!(hits[0].hamming, 0);
        }
    }
}
