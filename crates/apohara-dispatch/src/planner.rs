//! Native Socratic planner: an objective → a MASTER PLAN DAG, **zero tokens**
//! (US-F3.1).
//!
//! Apohara's own decomposition logic — no LLM, no provider call. The output is
//! a [`TaskGraph`] DAG with declared dependencies, the same structure the F2.1
//! coordinator schedules over. This is where good orthogonal decomposition is
//! born (pre-mortem Escenario 3: F1's parallelism is only worth as much as the
//! decomposition feeding it).
//!
//! Heuristic (own logic, deterministic):
//!   * a leading **plan** node (the shared analysis every slice depends on),
//!   * one **implement** node per declared work *area* — file-disjoint and
//!     mutually independent, each gated ONLY on `plan` so they run in parallel
//!     (the F1.7 manual discipline — disjoint paths — now automated),
//!   * a trailing **integrate** node gated on every implement slice (the
//!     single-writer merge of F1.6).
//!
//! When fewer than two areas are discernible, it still yields a ≥2-node chain
//! `plan → implement → verify` so the result is always a real DAG with at
//! least one declared dependency. Acyclicity is guaranteed structurally and
//! re-checked by [`TaskGraph::add_node`]'s `has_cycle` on persist.

use crate::task_graph::{GraphError, TaskGraph, TaskNode};

/// A node in the master plan before it is persisted to the graph.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlannedNode {
    pub id: String,
    pub title: String,
    pub deps: Vec<String>,
}

/// Lowercase, hyphenate, strip to `[a-z0-9-]` so an area string becomes a
/// stable node id. Collapses runs of separators; trims leading/trailing ones.
fn slug(s: &str) -> String {
    let mut out = String::new();
    let mut last_dash = true; // suppress a leading dash
    for ch in s.chars() {
        let c = ch.to_ascii_lowercase();
        if c.is_ascii_alphanumeric() {
            out.push(c);
            last_dash = false;
        } else if !last_dash {
            out.push('-');
            last_dash = true;
        }
    }
    while out.ends_with('-') {
        out.pop();
    }
    if out.is_empty() {
        "area".to_string()
    } else {
        out
    }
}

/// Derive work areas from an objective with own heuristics (no LLM):
///   1. path-like tokens (containing `/` or a `.ext`) — the strongest
///      file-disjoint signal,
///   2. else clauses split on `","` / `" and "` / `" y "` (bilingual).
///
/// Returns de-duplicated, order-preserving areas; empty when nothing splits.
pub fn derive_areas(objective: &str) -> Vec<String> {
    // 1. Path-like tokens first.
    let paths: Vec<String> = objective
        .split_whitespace()
        .map(|t| t.trim_matches(|c: char| !c.is_ascii_alphanumeric() && c != '/' && c != '.' && c != '_' && c != '-'))
        .filter(|t| {
            let looks_path = t.contains('/')
                || (t.contains('.') && !t.ends_with('.') && t.split('.').next_back().is_some_and(|e| e.len() <= 4 && e.chars().all(|c| c.is_ascii_alphabetic())));
            looks_path && t.len() > 1
        })
        .map(|t| t.to_string())
        .collect();
    if paths.len() >= 2 {
        return dedup_preserve(paths);
    }

    // 2. Conjunction split.
    let normalized = objective.replace(" and ", ",").replace(" y ", ",");
    let clauses: Vec<String> = normalized
        .split(',')
        .map(|c| c.trim().to_string())
        .filter(|c| c.len() > 2)
        .collect();
    if clauses.len() >= 2 {
        return dedup_preserve(clauses);
    }

    Vec::new()
}

fn dedup_preserve(items: Vec<String>) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    items
        .into_iter()
        .filter(|i| seen.insert(i.to_lowercase()))
        .collect()
}

/// Decompose `objective` into a MASTER PLAN. Pure — no IO, no graph write.
///
/// `areas` overrides the derived areas when non-empty (a caller that already
/// knows the disjoint surfaces passes them); otherwise areas are derived from
/// the objective. The id namespace is prefixed so two plans in one graph never
/// collide is the caller's job — these ids are plan-local.
pub fn plan_master(objective: &str, areas: &[&str]) -> Vec<PlannedNode> {
    let derived: Vec<String> = if areas.is_empty() {
        derive_areas(objective)
    } else {
        areas.iter().map(|a| a.to_string()).collect()
    };

    let plan = PlannedNode {
        id: "plan".to_string(),
        title: format!("Plan: {objective}"),
        deps: vec![],
    };

    if derived.len() < 2 {
        // Linear fallback: plan → implement → verify (≥2 nodes, real deps).
        return vec![
            plan,
            PlannedNode {
                id: "implement".to_string(),
                title: format!("Implement: {objective}"),
                deps: vec!["plan".to_string()],
            },
            PlannedNode {
                id: "verify".to_string(),
                title: "Verify the implementation".to_string(),
                deps: vec!["implement".to_string()],
            },
        ];
    }

    // File-disjoint fan-out: one implement slice per area, all gated on plan,
    // then a single integrate gated on every slice.
    let mut nodes = vec![plan];
    let mut slice_ids = Vec::new();
    let mut used = std::collections::HashSet::new();
    for area in &derived {
        let mut id = format!("impl-{}", slug(area));
        // Guarantee unique ids even if two areas slug-collide.
        let mut n = 1;
        while !used.insert(id.clone()) {
            n += 1;
            id = format!("impl-{}-{n}", slug(area));
        }
        nodes.push(PlannedNode {
            id: id.clone(),
            title: format!("Implement: {area}"),
            deps: vec!["plan".to_string()],
        });
        slice_ids.push(id);
    }
    nodes.push(PlannedNode {
        id: "integrate".to_string(),
        title: "Integrate all slices".to_string(),
        deps: slice_ids,
    });
    nodes
}

/// Build the MASTER PLAN and persist it into `graph`, returning the node ids
/// in plan order. Each [`TaskGraph::add_node`] re-runs the `has_cycle` guard,
/// so a (would-be) cyclic plan is rejected at persist — the structural
/// guarantee is double-checked against the storage layer.
pub fn build_master_plan(
    graph: &TaskGraph,
    objective: &str,
    areas: &[&str],
) -> Result<Vec<String>, GraphError> {
    let nodes = plan_master(objective, areas);
    let mut ids = Vec::with_capacity(nodes.len());
    for n in nodes {
        graph.add_node(TaskNode {
            id: n.id.clone(),
            title: n.title,
            deps: n.deps,
        })?;
        ids.push(n.id);
    }
    Ok(ids)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn linear_plan_when_no_areas() {
        let nodes = plan_master("make the thing better", &[]);
        assert_eq!(nodes.len(), 3, "plan -> implement -> verify");
        assert_eq!(nodes[0].id, "plan");
        assert_eq!(nodes[1].deps, vec!["plan".to_string()]);
        assert_eq!(nodes[2].deps, vec!["implement".to_string()]);
    }

    #[test]
    fn file_disjoint_fanout_from_paths() {
        let nodes = plan_master("update src/auth.rs and src/db.rs", &[]);
        // plan + 2 disjoint implement slices + integrate.
        assert_eq!(nodes.len(), 4);
        assert_eq!(nodes[0].id, "plan");
        let impls: Vec<&PlannedNode> = nodes.iter().filter(|n| n.id.starts_with("impl-")).collect();
        assert_eq!(impls.len(), 2, "one slice per file");
        // Each slice depends ONLY on plan (mutually independent → parallel).
        for s in &impls {
            assert_eq!(s.deps, vec!["plan".to_string()]);
        }
        // integrate depends on every slice.
        let integrate = nodes.iter().find(|n| n.id == "integrate").unwrap();
        assert_eq!(integrate.deps.len(), 2);
    }

    #[test]
    fn explicit_areas_override_derivation() {
        let nodes = plan_master("anything", &["frontend", "backend", "docs"]);
        let impls = nodes.iter().filter(|n| n.id.starts_with("impl-")).count();
        assert_eq!(impls, 3);
    }

    #[test]
    fn conjunction_split_when_no_paths() {
        let nodes = plan_master("add login and add logout", &[]);
        assert!(nodes.len() >= 4, "two clauses fan out");
    }

    #[test]
    fn persisted_master_plan_is_acyclic_with_deps() {
        let dir = TempDir::new().unwrap();
        let graph = TaskGraph::new(dir.path().join("tasks"));
        let ids = build_master_plan(&graph, "refactor src/a.rs and src/b.rs", &[]).unwrap();

        // >=2 nodes persisted, and a fresh handle reads them back.
        assert!(ids.len() >= 2);
        let persisted = graph.nodes().unwrap();
        assert_eq!(persisted.len(), ids.len());
        // At least one node declares a dependency.
        assert!(persisted.iter().any(|n| !n.deps.is_empty()), "plan must declare deps");
        // add_node already enforced acyclicity; the plan persisted, so it's a DAG.
    }

    #[test]
    fn slug_sanitizes_ids() {
        assert_eq!(slug("src/Auth Service.rs"), "src-auth-service-rs");
        assert_eq!(slug("  "), "area");
    }
}
