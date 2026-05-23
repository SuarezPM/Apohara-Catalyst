//! PixelCanvas — render a single sprite frame from a sprite-sheet.
//!
//! React-side reference: `packages/desktop/src/components/PixelCanvas.tsx`.
//! The original fetches a JSON metadata file alongside the sprite PNG and
//! draws the addressed frame onto a `<canvas>` via `drawImage`. That work
//! lives in browser-only APIs (`fetch`, `Image`, 2D context) that don't
//! exist during Dioxus SSR — so this port renders a `<canvas>` skeleton
//! with the data the runtime drawer needs as `data-*` attributes, and
//! defers the actual drawing to a desktop-side JS interop hook landing
//! together with the Tauri webview wiring (Sprint 18 G2.C).
//!
//! The component therefore renders deterministically (good for tests),
//! exposes everything a hydration script needs (`data-sprite-url`,
//! `data-metadata-url`, `data-frame`), and keeps the `image-rendering:
//! pixelated` style so even an undrawn canvas keeps the brand aesthetic
//! when a fallback image is set via CSS later.
//!
//! Props:
//!   - `sprite_url` — required, URL of the sprite-sheet PNG.
//!   - `metadata_url` — optional, defaults to swapping `.png` for `.json`
//!     in the sprite URL when the runtime drawer is invoked.
//!   - `frame` — required, named frame key (`"idle"`, `"working"`,
//!     `"thinking"`, `"happy"`, …). Kept as a free-form string so callers
//!     can grow the metadata schema without breaking the prop API.
//!   - `size` — optional, defaults to 64px (canvas width = height = size).

use dioxus::prelude::*;

#[component]
pub fn PixelCanvas(
    /// URL of the sprite-sheet PNG.
    sprite_url: String,
    /// Optional metadata JSON URL — falls back to `sprite_url` with the
    /// extension swapped to `.json` at runtime when absent.
    #[props(default)]
    metadata_url: Option<String>,
    /// Named frame key (`"idle"`, `"working"`, `"thinking"`, `"happy"`…).
    frame: String,
    /// Canvas edge length in CSS pixels (square). Defaults to 64.
    #[props(default = 64)]
    size: u32,
) -> Element {
    // Emit the metadata URL attribute only when supplied so the runtime
    // drawer can apply its `.png` → `.json` fallback without ambiguity.
    let meta_attr = metadata_url.unwrap_or_default();
    let meta_present = !meta_attr.is_empty();

    rsx! {
        canvas {
            width: "{size}",
            height: "{size}",
            "data-pixel-canvas": "",
            "data-frame": "{frame}",
            "data-sprite-url": "{sprite_url}",
            "data-metadata-url": if meta_present { "{meta_attr}" } else { "" },
            style: "image-rendering: pixelated; display: block;",
        }
    }
}
