//! Criterion bench for HeroBanner SSR render time (G2.A.5).
//!
//! Establishes a baseline for component-level render perf so any regression
//! introduced by future Sprint 17-19 changes shows up immediately. The
//! VirtualDom path is used (vs. render_element) because more complex
//! components in later sprints will need a runtime context for signals.

use apohara_desktop_dioxus::components::HeroBanner;
use criterion::{criterion_group, criterion_main, Criterion};
use dioxus::prelude::*;

#[allow(non_snake_case)]
fn HeroBannerApp() -> Element {
    rsx! {
        HeroBanner {
            session_id: None,
            tasks_empty: true,
            tagline: "Three sanctioned CLI drivers, one ledger, zero cloud sync.".to_string(),
            on_seed_demo: None,
        }
    }
}

fn bench_hero_banner_render(c: &mut Criterion) {
    c.bench_function("hero_banner_render", |b| {
        b.iter(|| {
            let mut vdom = VirtualDom::new(HeroBannerApp);
            vdom.rebuild_in_place();
            let _ = dioxus_ssr::render(&vdom);
        });
    });
}

criterion_group!(benches, bench_hero_banner_render);
criterion_main!(benches);
