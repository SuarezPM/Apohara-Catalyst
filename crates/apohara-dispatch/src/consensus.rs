//! Opt-in consensus mode for the PLAN phase (US-F3.2).
//!
//! By default Apohara plans with its own logic ([`crate::planner`], zero
//! tokens). Consensus is **opt-in and PLAN-phase only** (R9): when enabled,
//! ≥2 blades each propose refinements to the draft MASTER PLAN, and those
//! refinements are merged so the final plan reflects more than one viewpoint.
//! It deliberately does NOT run during execution — only the plan is subject to
//! consensus; the swarm then executes the agreed plan.
//!
//! Refiners are injected via the [`PlanRefiner`] trait: in production a real
//! blade implements it by running its CLI over the draft and parsing the
//! proposed changes; tests inject deterministic mocks (no spawns).

use crate::planner::PlannedNode;

/// A blade that proposes refinements to a draft plan.
pub trait PlanRefiner {
    /// Nodes to MERGE into the draft: brand-new nodes, or an existing id with
    /// extra `deps` to union in. An empty Vec means "no change proposed".
    fn refine(&self, draft: &[PlannedNode]) -> Vec<PlannedNode>;

    /// Identifier of the proposing blade (for provenance/audit).
    fn blade_id(&self) -> &str;
}

/// Consensus configuration. Off by default — own-logic planning stands alone
/// unless the operator opts in.
#[derive(Debug, Clone, Default)]
pub struct ConsensusPolicy {
    pub enabled: bool,
}

impl ConsensusPolicy {
    pub fn enabled() -> Self {
        Self { enabled: true }
    }
}

/// Apply PLAN-phase consensus to a `draft`.
///
/// Returns the draft UNCHANGED when consensus is disabled OR fewer than two
/// refiners are available (own logic by default — a single voice is not a
/// consensus). With ≥2 refiners, each one's proposed nodes are merged into the
/// draft (new ids appended; existing ids gain the union of their deps), so the
/// final plan differs from the draft whenever any refiner proposed a change.
pub fn consensus_refine(
    draft: &[PlannedNode],
    refiners: &[&dyn PlanRefiner],
    policy: &ConsensusPolicy,
) -> Vec<PlannedNode> {
    if !policy.enabled || refiners.len() < 2 {
        return draft.to_vec();
    }

    let mut merged: Vec<PlannedNode> = draft.to_vec();
    for refiner in refiners {
        for incoming in refiner.refine(draft) {
            merge_node(&mut merged, incoming);
        }
    }
    merged
}

/// Merge one proposed node into the accumulating plan: a new id is appended;
/// an existing id has the incoming `deps` unioned in (dedup), so two blades
/// proposing the same dependency don't double it.
fn merge_node(merged: &mut Vec<PlannedNode>, incoming: PlannedNode) {
    if let Some(existing) = merged.iter_mut().find(|n| n.id == incoming.id) {
        for dep in incoming.deps {
            if !existing.deps.contains(&dep) {
                existing.deps.push(dep);
            }
        }
    } else {
        merged.push(incoming);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct MockRefiner {
        id: String,
        proposals: Vec<PlannedNode>,
    }
    impl PlanRefiner for MockRefiner {
        fn refine(&self, _draft: &[PlannedNode]) -> Vec<PlannedNode> {
            self.proposals.clone()
        }
        fn blade_id(&self) -> &str {
            &self.id
        }
    }

    fn node(id: &str, deps: &[&str]) -> PlannedNode {
        PlannedNode {
            id: id.to_string(),
            title: format!("t-{id}"),
            deps: deps.iter().map(|d| d.to_string()).collect(),
        }
    }

    fn draft() -> Vec<PlannedNode> {
        vec![node("plan", &[]), node("implement", &["plan"])]
    }

    #[test]
    fn disabled_returns_draft_unchanged() {
        let refiners: Vec<&dyn PlanRefiner> = vec![];
        let out = consensus_refine(&draft(), &refiners, &ConsensusPolicy::default());
        assert_eq!(out, draft());
    }

    #[test]
    fn single_refiner_is_not_consensus() {
        let r = MockRefiner { id: "claude".into(), proposals: vec![node("extra", &["plan"])] };
        let refiners: Vec<&dyn PlanRefiner> = vec![&r];
        // Fewer than 2 refiners → own logic stands, draft unchanged.
        let out = consensus_refine(&draft(), &refiners, &ConsensusPolicy::enabled());
        assert_eq!(out, draft());
    }

    #[test]
    fn two_refiners_alter_the_plan() {
        // THE F2-acceptance: >=2 blades emit refinements; final != draft.
        let r1 = MockRefiner { id: "claude".into(), proposals: vec![node("add-tests", &["implement"])] };
        let r2 = MockRefiner { id: "codex".into(), proposals: vec![node("add-docs", &["implement"])] };
        let refiners: Vec<&dyn PlanRefiner> = vec![&r1, &r2];

        let out = consensus_refine(&draft(), &refiners, &ConsensusPolicy::enabled());
        assert_ne!(out, draft(), "consensus must alter the plan");
        assert!(out.iter().any(|n| n.id == "add-tests"));
        assert!(out.iter().any(|n| n.id == "add-docs"));
        assert_eq!(out.len(), 4, "draft 2 + 2 refinements");
    }

    #[test]
    fn refiners_union_deps_on_existing_node() {
        // Both blades agree `implement` should also depend on a new `design`
        // node; the dep is unioned once, not duplicated.
        let r1 = MockRefiner {
            id: "a".into(),
            proposals: vec![node("design", &["plan"]), node("implement", &["design"])],
        };
        let r2 = MockRefiner {
            id: "b".into(),
            proposals: vec![node("implement", &["design"])],
        };
        let refiners: Vec<&dyn PlanRefiner> = vec![&r1, &r2];

        let out = consensus_refine(&draft(), &refiners, &ConsensusPolicy::enabled());
        let implement = out.iter().find(|n| n.id == "implement").unwrap();
        // Original "plan" dep + the agreed "design" dep, each exactly once.
        assert_eq!(implement.deps, vec!["plan".to_string(), "design".to_string()]);
    }
}
