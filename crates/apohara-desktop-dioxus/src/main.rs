//! Apohara Desktop (Dioxus rewrite, Phase 2 bake-off) — binary entry point.

use apohara_desktop_dioxus::App;

fn main() {
    tracing_subscriber::fmt::init();
    dioxus::launch(App);
}
