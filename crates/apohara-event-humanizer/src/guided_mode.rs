//! Opt-in guided mode + Vibecoding density skin (US-F4.4, R8/R14).
//!
//! Two product layers over the SAME humanizer engine ([`crate::humanize`]):
//!
//!   * **Guided mode (R14, opt-in)** — when the user opts in, every mesh event
//!     is also turned into a human narration line. Crucially this runs *in
//!     parallel*: [`GuidedNarrator::narrate`] is a pure, allocation-cheap
//!     transform (no IO, no lock, no await), so the caller emits it on a side
//!     channel without ever stalling the dispatch loop. Guided OFF returns
//!     `None`, so a non-opted-in run pays nothing.
//!
//!   * **Vibecoding skin (R8)** — one engine, two densities. The SAME narration
//!     renders either IDE-dense (raw, compact) or as the looser Vibecoding
//!     skin. The skin is presentation only; it mounts over the identical
//!     humanized text, so there is no second engine to drift.

use crate::{humanize, EventInput};

/// Presentation density. IDE-dense is the primary (compact, raw label);
/// Vibecoding is the friendlier skin over the SAME narration.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Density {
    IdeDense,
    Vibecoding,
}

/// Opt-in guided-mode narrator. Holds only an enabled flag — narration is a
/// pure function of the event, so the narrator carries no state that could
/// serialize the dispatch path.
#[derive(Debug, Clone, Copy)]
pub struct GuidedNarrator {
    enabled: bool,
}

impl GuidedNarrator {
    /// Guided mode ON (the user opted in).
    pub fn opt_in() -> Self {
        Self { enabled: true }
    }

    /// Guided mode OFF (default) — `narrate` yields nothing.
    pub fn off() -> Self {
        Self { enabled: false }
    }

    pub fn is_enabled(&self) -> bool {
        self.enabled
    }

    /// Narrate one event, or `None` when guided mode is off.
    ///
    /// Non-blocking by construction: this is `humanize` (a pure string
    /// transform) behind an enabled check — no IO, no await, no lock. The
    /// dispatch loop calls it on its observer side channel; the swarm keeps
    /// working while Apohara explains (R14 hybrid).
    pub fn narrate(&self, event: &EventInput) -> Option<String> {
        if self.enabled {
            Some(humanize(event))
        } else {
            None
        }
    }
}

/// Render a narration line at `density`. Both densities consume the SAME
/// humanized `narration` (one engine, two skins — R8):
///   * IDE-dense → the raw label, unchanged (compact).
///   * Vibecoding → a friendlier skin (a speech glyph + breathing room).
pub fn render_density(narration: &str, density: Density) -> String {
    match density {
        Density::IdeDense => narration.to_string(),
        Density::Vibecoding => format!("💬  {narration}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn edit_event() -> EventInput {
        EventInput::new("tool_use")
            .with_tool("Edit")
            .with_field("file_path", "src/foo.rs")
    }

    #[test]
    fn opt_in_narrates_off_is_silent() {
        let on = GuidedNarrator::opt_in();
        let off = GuidedNarrator::off();
        assert!(on.narrate(&edit_event()).is_some(), "opted-in mode narrates");
        assert!(off.narrate(&edit_event()).is_none(), "default mode is silent (opt-in)");
    }

    #[test]
    fn narration_matches_the_humanizer_engine() {
        // Guided narration IS the humanizer output — no second engine.
        let ev = edit_event();
        let narrator = GuidedNarrator::opt_in();
        assert_eq!(narrator.narrate(&ev), Some(humanize(&ev)));
    }

    #[test]
    fn both_densities_render_over_the_same_engine() {
        let ev = edit_event();
        let narration = GuidedNarrator::opt_in().narrate(&ev).unwrap();

        let ide = render_density(&narration, Density::IdeDense);
        let vibe = render_density(&narration, Density::Vibecoding);

        // IDE-dense is the raw label; Vibecoding is a skin over the SAME text.
        assert_eq!(ide, narration);
        assert!(vibe.contains(&narration), "Vibecoding skin wraps the same narration");
        assert_ne!(ide, vibe, "the two densities are visually distinct");
    }

    #[test]
    fn narrate_is_a_pure_cheap_transform() {
        // No IO / no await: calling it many times is just string work, so it
        // can sit on the dispatch observer channel without stalling it.
        let narrator = GuidedNarrator::opt_in();
        let ev = edit_event();
        for _ in 0..1000 {
            assert!(narrator.narrate(&ev).is_some());
        }
    }
}
