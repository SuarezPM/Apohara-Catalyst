---
name: test-audit-and-classification
description: Workflow command scaffold for test-audit-and-classification in Apohara.
allowed_tools: ["Bash", "Read", "Write", "Grep", "Glob"]
---

# /test-audit-and-classification

Use this workflow when working on **test-audit-and-classification** in `Apohara`.

## Goal

Audit, classify, and empirically validate the project's test files, producing batch and summary reports.

## Common Files

- `.claude/specs/tests/PHASE_5_2_AUDIT_BATCH1.md`
- `.claude/specs/tests/PHASE_5_2_AUDIT_BATCH2.md`
- `.claude/specs/tests/PHASE_5_2_AUDIT_BATCH3.md`
- `.claude/specs/tests/PHASE_5_2_AUDIT_BATCH4.md`
- `.claude/specs/tests/PHASE_5_2_AUDIT_SUMMARY.md`

## Suggested Sequence

1. Understand the current state and failure mode before editing.
2. Make the smallest coherent change that satisfies the workflow goal.
3. Run the most relevant verification for touched files.
4. Summarize what changed and what still needs review.

## Typical Commit Signals

- Run static audit on batches of test files, classifying each as KEEP_GREEN, KEEP_REFACTOR, INVESTIGATE, or KILL.
- Write per-batch audit results to .claude/specs/tests/PHASE_5_2_AUDIT_BATCH{N}.md.
- Update or create .claude/specs/tests/PHASE_5_2_AUDIT_SUMMARY.md with overall tallies and recommendations.
- Empirically run the KEEP_GREEN and KEEP_REFACTOR cohorts, updating the summary with pass/fail counts.
- Repeat for additional batches until all test files are covered.

## Notes

- Treat this as a scaffold, not a hard-coded script.
- Update the command if the workflow evolves materially.