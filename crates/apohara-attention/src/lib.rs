//! Attention bands state machine per spec §4 (culture #3 inspiration).
//!
//! Four bands HOT/WARM/COOL/IDLE with per-band hold timers. Direct stimulus
//! (e.g., @mention/DM/blocked-on-this-task) promotes to Hot instantly.
//! Ambient stimulus (e.g., messages-in-this-thread) promotes up to Warm
//! (the ambient cap) without ever demoting Hot. Decay walks
//! Hot→Warm→Cool→Idle without stimulus.

use serde::{Deserialize, Serialize};
use std::time::{Duration, Instant};
use ts_rs::TS;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum Band {
    Hot,
    Warm,
    Cool,
    Idle,
}

#[derive(Debug, Clone, Copy)]
pub enum Stimulus {
    Direct,
    Ambient,
}

#[derive(Debug, Clone)]
pub struct BandSpec {
    pub hold: Duration,
}

impl Band {
    pub fn spec(self) -> BandSpec {
        match self {
            Band::Hot => BandSpec { hold: Duration::from_secs(60) },
            Band::Warm => BandSpec { hold: Duration::from_secs(240) },
            Band::Cool => BandSpec { hold: Duration::from_secs(720) },
            Band::Idle => BandSpec { hold: Duration::MAX },
        }
    }

    fn cooler(self) -> Band {
        match self {
            Band::Hot => Band::Warm,
            Band::Warm => Band::Cool,
            Band::Cool => Band::Idle,
            Band::Idle => Band::Idle,
        }
    }

    /// Ambient promotion: caps at `Warm`. Never demotes (`Hot` stays `Hot`).
    ///
    /// Note: spec §4 acceptance test asserts that a single ambient stimulus
    /// from a fresh (`Idle`) state lands in `Warm` directly — i.e. "promote
    /// to the cap", not "promote one band toward the cap".
    fn promote(self) -> Band {
        match self {
            Band::Hot => Band::Hot,                              // never demote
            Band::Warm | Band::Cool | Band::Idle => Band::Warm,  // ambient cap
        }
    }
}

#[derive(Debug, Clone)]
pub struct AttentionState {
    pub target: String,
    band: Band,
    last_promote: Instant,
}

impl AttentionState {
    pub fn new(target: impl Into<String>, now: Instant) -> Self {
        Self {
            target: target.into(),
            band: Band::Idle,
            last_promote: now,
        }
    }

    pub fn band(&self) -> Band {
        self.band
    }

    pub fn apply(&mut self, stim: Stimulus, now: Instant) {
        self.band = match stim {
            Stimulus::Direct => Band::Hot,
            Stimulus::Ambient => self.band.promote(),
        };
        self.last_promote = now;
    }

    pub fn tick(&mut self, now: Instant) {
        loop {
            let spec = self.band.spec();
            if now.duration_since(self.last_promote) < spec.hold {
                return;
            }
            let cooler = self.band.cooler();
            if cooler == self.band {
                return; // Idle is terminal
            }
            self.last_promote += spec.hold;
            self.band = cooler;
        }
    }
}
