---
name: apohara-orchestration
description: Multi-agent coordination protocol — message types, decision gates, drift detection
---

# apohara-orchestration — Skill for AI Agents

This skill explains the message bus and coordination protocol that Apohara
agents use among themselves.

## Message types

- `status` — informational state update
- `dispatch` — coordinator → worker assignment
- `worker_done` — worker → coordinator completion
- `merge_ready` — consolidator-ready signal
- `escalation` — needs human intervention
- `handoff` — pass work to another agent
- `decision_gate` — coordinator → blocked queue
- `heartbeat` — keep-alive (every 5 min on long tasks)

## Group addresses

- `@all` — broadcast to every running agent
- `@idle` — first available agent
- `@claude` / `@codex` / `@opencode` — provider-specific
- `@worktree:<id>` — agents in a specific worktree
- `@coordinator` — the orchestrator itself

## Decision gates

When two tasks have overlapping reads/writes/renames (semantic conflict
matrix), the coordinator opens a `decision_gate` blocking the second task
until the first releases. You will receive a `dispatch` message with
`reason=blocked_on_<task_id>` in payload. Wait for `unblocked` signal.

## Drift detection

If your worktree base is N commits behind origin, the dispatch preamble
includes a `BASE DRIFT WARNING` section listing recent commits you do NOT
have. Proceed with caution. If your changes conflict, emit
`worker_done { outcome: "failure", reason: "drift_conflict" }` and the
coordinator will rebase or escalate.

## Symbol manifest contract

Your assignment includes `task.symbols` with `reads`, `writes`, `renames`
arrays of `SymbolRef`. If you find yourself needing to touch a symbol
NOT in your declaration, STOP and emit `coord_manifest_drift` via:

```bash
apohara orchestration send --to "@coordinator" --type status \
  --body "manifest_drift: needs to touch <symbol> (was not declared)"
```

The coordinator will either expand your manifest (if blast radius allows)
or re-plan the task with the decomposer.
