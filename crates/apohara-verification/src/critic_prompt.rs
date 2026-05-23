//! chorus H5 — critic system reminder prompts.
//!
//! Direct port of `src/core/verification/prompts/critic.ts`. Injected
//! into verification mesh runs to make the critic an explicit role:
//! surface red flags, cite past incidents, request a
//! rationalization-detection checklist. The output is plain Markdown
//! because every wrapped CLI consumes Markdown as system context.
//!
//! Pure function — callers compose the incidents list from the
//! persistent ledger and pass it here; no I/O.

use serde::{Deserialize, Serialize};

/// Inputs to [`build_critic_prompt`]. Optional `incidents` is dropped
/// from the rendered prompt when empty (TS parity: `if (length > 0)`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CriticContext {
    pub task_description: String,
    pub prior_attempts: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub incidents: Option<Vec<String>>,
}

/// Static checklist appended to every critic prompt. Kept as a
/// `&'static str` slice so the build is allocation-free for the
/// no-incidents path.
const CHECKLIST: &str = "\n## Red flags / rationalization checklist\n- Is this solving the wrong problem?\n- Does the implementation match the spec exactly?\n- Are there over-engineered abstractions?\n- Is error handling defensive without justification?\n- Are tests verifying behavior or just mocks?\n- Did the prior attempts fail for the same root cause?\n\nReport: APPROVE | NEEDS_CHANGES (with specific items) | REJECT (with rationale).";

/// Render the critic prompt as Markdown. Output is byte-for-byte
/// identical to the TS `buildCriticPrompt` so the two implementations
/// can be A/B tested against the same provider transcripts during
/// Phase 1 double-maintenance.
pub fn build_critic_prompt(ctx: &CriticContext) -> String {
    let mut out = String::with_capacity(512);
    out.push_str("You are the critic. Review the proposed implementation.\n\n## Task\n");
    out.push_str(&ctx.task_description);
    out.push_str("\n\n## Prior attempts: ");
    out.push_str(&ctx.prior_attempts.to_string());

    if let Some(incidents) = ctx.incidents.as_ref() {
        if !incidents.is_empty() {
            out.push_str("\n\n## Past incidents to watch for");
            for inc in incidents {
                out.push_str("\n- ");
                out.push_str(inc);
            }
        }
    }

    out.push_str(CHECKLIST);
    out
}
