//! Sugiyama-style layered DAG layout for `SwarmCanvas`.
//!
//! Topological depth → x coordinate (column).
//! In-column appearance order → y coordinate (row).
//!
//! Stays decoupled from Dioxus so it's straightforward to unit-test the
//! geometry without spinning up a `VirtualDom`. Reference behaviour:
//! `packages/desktop/src/components/SwarmCanvas.tsx::buildGraph()`.

use petgraph::{
    algo::toposort,
    graph::{DiGraph, NodeIndex},
};
use std::collections::HashMap;

/// DAG node — only the data the layout needs. UI-specific styling (state,
/// provider) is carried separately by [`SwarmTask`](super::swarm_canvas::SwarmTask).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LayoutNode {
    pub id: String,
}

/// Directed edge — `from` is the upstream/parent, `to` the downstream child.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LayoutEdge {
    pub from: String,
    pub to: String,
}

/// Placed node — `id` plus pre-computed `(x, y)` in SVG user space (pixels).
#[derive(Clone, Debug, PartialEq)]
pub struct PlacedNode {
    pub id: String,
    pub x: f64,
    pub y: f64,
}

/// Horizontal spacing between depth columns (pixels).
pub const COLUMN_WIDTH: f64 = 160.0;
/// Vertical spacing between siblings in the same depth column (pixels).
pub const ROW_HEIGHT: f64 = 90.0;
/// Padding from the SVG origin so the first node isn't flush against the
/// canvas edge.
pub const ORIGIN_PAD: f64 = 40.0;
/// Node box width (pixels) — keeps edge anchor math in sync with the renderer.
pub const NODE_WIDTH: f64 = 120.0;
/// Node box height (pixels).
pub const NODE_HEIGHT: f64 = 40.0;

/// Compute SVG positions for every node.
///
/// Returns nodes in topological order (or the petgraph iteration order on the
/// fallback path when the input contains a cycle — Apohara orchestration
/// guarantees acyclic DAGs from the decomposer, so the fallback only matters
/// for defensive correctness, not the visual common case).
pub fn layout_nodes(nodes: &[LayoutNode], edges: &[LayoutEdge]) -> Vec<PlacedNode> {
    let mut graph = DiGraph::<String, ()>::new();
    let mut id_to_idx: HashMap<String, NodeIndex> = HashMap::new();

    for n in nodes {
        let idx = graph.add_node(n.id.clone());
        id_to_idx.insert(n.id.clone(), idx);
    }
    for e in edges {
        if let (Some(&from), Some(&to)) = (id_to_idx.get(&e.from), id_to_idx.get(&e.to)) {
            graph.add_edge(from, to, ());
        }
    }

    // Topological sort gives us a depth-respecting visit order. On cycle we
    // fall back to insertion order so the canvas still renders SOMETHING
    // rather than blanking out the whole pane.
    let sorted = toposort(&graph, None).unwrap_or_else(|_| graph.node_indices().collect());

    // depth = longest path from any root to this node.
    let mut depth_of: HashMap<NodeIndex, usize> = HashMap::new();
    for idx in &sorted {
        let max_pred_depth = graph
            .neighbors_directed(*idx, petgraph::Direction::Incoming)
            .map(|p| depth_of.get(&p).copied().unwrap_or(0) + 1)
            .max()
            .unwrap_or(0);
        depth_of.insert(*idx, max_pred_depth);
    }

    // Stack siblings vertically per depth column in their topological order
    // (the same order React's `buildGraph` walks the Map insertion order).
    let mut per_depth: HashMap<usize, usize> = HashMap::new();
    let mut out = Vec::with_capacity(sorted.len());
    for idx in &sorted {
        let depth = *depth_of.get(idx).unwrap_or(&0);
        let row_idx = *per_depth.entry(depth).or_insert(0);
        per_depth.insert(depth, row_idx + 1);
        let x = (depth as f64) * COLUMN_WIDTH + ORIGIN_PAD;
        let y = (row_idx as f64) * ROW_HEIGHT + ORIGIN_PAD;
        out.push(PlacedNode {
            id: graph[*idx].clone(),
            x,
            y,
        });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn n(id: &str) -> LayoutNode {
        LayoutNode { id: id.into() }
    }
    fn e(from: &str, to: &str) -> LayoutEdge {
        LayoutEdge {
            from: from.into(),
            to: to.into(),
        }
    }

    #[test]
    fn layout_assigns_positions_to_all_nodes() {
        let nodes = vec![n("a"), n("b"), n("c")];
        let edges = vec![e("a", "b"), e("b", "c")];
        let placed = layout_nodes(&nodes, &edges);
        assert_eq!(placed.len(), 3, "all nodes positioned");
        assert!(placed.iter().any(|p| p.id == "a"));
        assert!(placed.iter().any(|p| p.id == "c"));
    }

    #[test]
    fn layout_layers_by_topological_depth() {
        let nodes = vec![n("a"), n("b"), n("c")];
        let edges = vec![e("a", "b"), e("b", "c")];
        let placed = layout_nodes(&nodes, &edges);
        let x_of = |id: &str| placed.iter().find(|p| p.id == id).unwrap().x;
        // a is depth 0, b depth 1, c depth 2 — strictly increasing x.
        assert!(x_of("a") < x_of("b"));
        assert!(x_of("b") < x_of("c"));
    }

    #[test]
    fn siblings_share_column_and_stack_vertically() {
        // Two roots → same depth (0), different rows.
        let nodes = vec![n("a"), n("b"), n("c")];
        let edges = vec![e("a", "c"), e("b", "c")];
        let placed = layout_nodes(&nodes, &edges);
        let pa = placed.iter().find(|p| p.id == "a").unwrap();
        let pb = placed.iter().find(|p| p.id == "b").unwrap();
        assert_eq!(pa.x, pb.x, "roots share column");
        assert_ne!(pa.y, pb.y, "siblings stack vertically");
    }

    #[test]
    fn cycle_falls_back_to_insertion_order_without_panic() {
        let nodes = vec![n("a"), n("b")];
        let edges = vec![e("a", "b"), e("b", "a")];
        let placed = layout_nodes(&nodes, &edges);
        assert_eq!(placed.len(), 2, "cycle must not lose nodes");
    }
}
