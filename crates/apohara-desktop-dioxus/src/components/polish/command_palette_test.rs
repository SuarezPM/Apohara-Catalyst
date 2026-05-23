//! SSR tests for the CommandPalette port (G2.C.2.1).
//!
//! Reference: `packages/desktop/src/components/CommandPalette.tsx`.

use super::command_palette::CommandPalette;
use dioxus::prelude::*;

#[test]
fn cmd_palette_renders_filtered_results_when_query_matches() {
    let commands = vec![
        ("run.dispatch".to_string(), "Dispatch run".to_string()),
        ("doctor".to_string(), "Run doctor".to_string()),
    ];
    let html = dioxus_ssr::render_element(rsx! {
        CommandPalette {
            commands: commands.clone(),
            query: "disp".to_string(),
            visible: true,
        }
    });
    assert!(html.contains("Dispatch run"), "match missing: {html}");
    assert!(
        !html.contains("Run doctor"),
        "non-match should be filtered out: {html}"
    );
}

#[test]
fn cmd_palette_hidden_when_visible_false() {
    let html = dioxus_ssr::render_element(rsx! {
        CommandPalette {
            commands: vec![],
            query: "".to_string(),
            visible: false,
        }
    });
    assert!(
        !html.contains("command-palette"),
        "palette should be hidden when visible=false: {html}"
    );
}

#[test]
fn cmd_palette_shows_all_when_query_empty() {
    let commands = vec![
        ("a".to_string(), "Alpha".to_string()),
        ("b".to_string(), "Beta".to_string()),
    ];
    let html = dioxus_ssr::render_element(rsx! {
        CommandPalette {
            commands: commands.clone(),
            query: "".to_string(),
            visible: true,
        }
    });
    assert!(html.contains("Alpha"), "Alpha missing: {html}");
    assert!(html.contains("Beta"), "Beta missing: {html}");
}

#[test]
fn cmd_palette_renders_input_with_query_value() {
    let html = dioxus_ssr::render_element(rsx! {
        CommandPalette {
            commands: vec![],
            query: "doc".to_string(),
            visible: true,
        }
    });
    assert!(
        html.contains("value=\"doc\""),
        "input value should reflect query: {html}"
    );
    assert!(
        html.contains("cmd-input"),
        "cmd-input class missing: {html}"
    );
}
