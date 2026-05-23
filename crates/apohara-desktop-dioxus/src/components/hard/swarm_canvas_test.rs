//! SSR tests for the SwarmCanvas port (G2.D.3).
//!
//! Reference: `packages/desktop/src/components/SwarmCanvas.tsx`.

use crate::components::hard::swarm_canvas::{SwarmCanvas, SwarmEdge, SwarmTask};
use dioxus::prelude::*;

fn task(id: &str) -> SwarmTask {
    SwarmTask {
        id: id.into(),
        label: id.to_ascii_uppercase(),
        state: "scheduled".into(),
    }
}

fn edge(from: &str, to: &str) -> SwarmEdge {
    SwarmEdge {
        from: from.into(),
        to: to.into(),
    }
}

#[test]
fn renders_one_dag_node_group_per_task() {
    let tasks = vec![task("a"), task("b"), task("c")];
    let edges = vec![edge("a", "b"), edge("b", "c")];
    let html = dioxus_ssr::render_element(rsx! {
        SwarmCanvas { tasks, edges }
    });
    let node_count = html.matches("class=\"dag-node\"").count();
    assert_eq!(node_count, 3, "expected 3 dag-node groups, got: {html}");
}

#[test]
fn renders_one_dag_edge_line_per_dependency() {
    let tasks = vec![task("a"), task("b"), task("c")];
    let edges = vec![edge("a", "b"), edge("b", "c")];
    let html = dioxus_ssr::render_element(rsx! {
        SwarmCanvas { tasks, edges }
    });
    let edge_count = html.matches("class=\"dag-edge\"").count();
    assert_eq!(edge_count, 2, "expected 2 dag-edge lines, got: {html}");
}

#[test]
fn empty_state_when_no_tasks() {
    let tasks: Vec<SwarmTask> = vec![];
    let edges: Vec<SwarmEdge> = vec![];
    let html = dioxus_ssr::render_element(rsx! {
        SwarmCanvas { tasks, edges }
    });
    assert!(
        html.contains("swarm-empty"),
        "expected swarm-empty placeholder when DAG empty, got: {html}"
    );
}

#[test]
fn node_label_is_rendered_inside_group() {
    let tasks = vec![SwarmTask {
        id: "alpha".into(),
        label: "Decompose objective".into(),
        state: "completed".into(),
    }];
    let html = dioxus_ssr::render_element(rsx! {
        SwarmCanvas { tasks, edges: Vec::<SwarmEdge>::new() }
    });
    assert!(
        html.contains("Decompose objective"),
        "label text missing: {html}"
    );
    assert!(
        html.contains("data-state=\"completed\""),
        "state attr should propagate for CSS theming: {html}"
    );
}

#[test]
fn edges_with_dangling_endpoints_are_silently_dropped() {
    // 'c' has no matching task — the edge must NOT render and must NOT panic.
    let tasks = vec![task("a"), task("b")];
    let edges = vec![edge("a", "b"), edge("b", "c")];
    let html = dioxus_ssr::render_element(rsx! {
        SwarmCanvas { tasks, edges }
    });
    let edge_count = html.matches("class=\"dag-edge\"").count();
    assert_eq!(
        edge_count, 1,
        "dangling edge must be dropped (no panic, no orphan line): {html}"
    );
}
