//! SwarmCanvas — DAG visualization for the orchestration swarm.
//!
//! Replaces `@xyflow/react` (~250 kB JS + DOM transforms) with `petgraph`
//! topological layout + a hand-rolled SVG renderer. See `swarm_layout` for
//! the layered Sugiyama-style geometry.
//!
//! Feature reduction vs. React original (documented in `hard/mod.rs`):
//!   * no zoom / pan
//!   * no draggable / connectable nodes
//!   * no `Controls` / `Background` overlays
//!   * no MiniMap
//!
//! What we keep:
//!   * one node group per task with state-driven CSS hooks
//!   * one line per dependency edge
//!   * topological layered layout (depth -> column, sibling -> row)
//!   * empty-state placeholder so the pane never blanks out
//!
//! Reference: `packages/desktop/src/components/SwarmCanvas.tsx`.

use crate::components::hard::swarm_layout::{
    layout_nodes, LayoutEdge, LayoutNode, NODE_HEIGHT, NODE_WIDTH,
};
use dioxus::prelude::*;
use std::collections::HashMap;

/// A single task in the swarm DAG. `state` is a free-form CSS hook
/// (`scheduled` / `running` / `completed` / `failed` / `mesh`) propagated
/// through `data-state` so theming stays in CSS, not Rust.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SwarmTask {
    pub id: String,
    pub label: String,
    pub state: String,
}

/// Dependency edge — `from` is the upstream task id, `to` the downstream.
/// Edges referencing unknown task ids are silently dropped (matches the
/// React `buildGraph` `tasks.has(parent)` guard).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SwarmEdge {
    pub from: String,
    pub to: String,
}

/// Render the swarm DAG as an SVG with `dag-node` + `dag-edge` class hooks.
#[component]
pub fn SwarmCanvas(
    tasks: Vec<SwarmTask>,
    edges: Vec<SwarmEdge>,
    /// Optional callback fired with a task id when its node is clicked. The
    /// CenterPane binds this to `SELECTED_TASK` (W3.B.2).
    on_select: Option<EventHandler<String>>,
) -> Element {
    if tasks.is_empty() {
        return rsx! {
            section {
                class: "pane pane-canvas",
                div {
                    class: "swarm-empty",
                    "data-testid": "swarm-empty",
                    "DAG appears here once an objective is decomposed"
                }
            }
        };
    }

    // Delegate geometry to the layout helper so the SVG render stays flat
    // and the layered math is unit-tested in isolation.
    let layout_in: Vec<LayoutNode> = tasks
        .iter()
        .map(|t| LayoutNode { id: t.id.clone() })
        .collect();
    let layout_edges: Vec<LayoutEdge> = edges
        .iter()
        .map(|e| LayoutEdge {
            from: e.from.clone(),
            to: e.to.clone(),
        })
        .collect();
    let placed = layout_nodes(&layout_in, &layout_edges);

    // Look-up tables so edges + nodes can resolve their per-task data
    // without re-scanning the input vectors per iteration.
    let id_to_xy: HashMap<String, (f64, f64)> = placed
        .iter()
        .map(|p| (p.id.clone(), (p.x, p.y)))
        .collect();
    let id_to_state: HashMap<String, String> = tasks
        .iter()
        .map(|t| (t.id.clone(), t.state.clone()))
        .collect();
    let id_to_label: HashMap<String, String> = tasks
        .iter()
        .map(|t| (t.id.clone(), t.label.clone()))
        .collect();

    rsx! {
        section {
            class: "pane pane-canvas",
            svg {
                class: "swarm-canvas",
                width: "800",
                height: "600",
                "data-testid": "swarm-canvas",
                // Edges first so node rects paint on top.
                for edge in edges.iter() {
                    if let (Some(&(x1, y1)), Some(&(x2, y2))) =
                        (id_to_xy.get(&edge.from), id_to_xy.get(&edge.to))
                    {
                        line {
                            class: "dag-edge",
                            x1: "{x1 + NODE_WIDTH}",
                            y1: "{y1 + NODE_HEIGHT / 2.0}",
                            x2: "{x2}",
                            y2: "{y2 + NODE_HEIGHT / 2.0}",
                            stroke: "var(--apohara-lime)",
                            "stroke-width": "1.5",
                        }
                    }
                }
                for placed_node in placed.iter() {
                    {
                        let id = placed_node.id.clone();
                        let x = placed_node.x;
                        let y = placed_node.y;
                        let state = id_to_state
                            .get(&id)
                            .cloned()
                            .unwrap_or_else(|| "scheduled".into());
                        let label = id_to_label
                            .get(&id)
                            .cloned()
                            .unwrap_or_else(|| id.clone());
                        let id_for_click = id.clone();
                        rsx! {
                            g {
                                class: "dag-node",
                                "data-state": "{state}",
                                "data-task-id": "{id}",
                                transform: "translate({x}, {y})",
                                onclick: move |_| {
                                    if let Some(h) = &on_select {
                                        h.call(id_for_click.clone());
                                    }
                                },
                                rect {
                                    width: "{NODE_WIDTH}",
                                    height: "{NODE_HEIGHT}",
                                    fill: "var(--apohara-ink)",
                                    stroke: "var(--apohara-lime)",
                                    "stroke-width": "1",
                                    rx: "2",
                                }
                                text {
                                    x: "{NODE_WIDTH / 2.0}",
                                    y: "{NODE_HEIGHT / 2.0 + 4.0}",
                                    fill: "var(--apohara-bone)",
                                    "text-anchor": "middle",
                                    "font-family": "var(--font-mono)",
                                    "font-size": "11",
                                    "{label}"
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
