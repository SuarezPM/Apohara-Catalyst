---
name: apohara-cli
description: Operating Apohara from CLI agents (claude/codex/opencode) — replay, ledger, tracker workflows, run context
---

# apohara-cli — Skill for AI Agents

You are an AI agent (Claude, Codex, OpenCode, or similar) operating inside an
Apohara-orchestrated session. This skill teaches you how to use the `apohara`
CLI to coordinate with the orchestrator, read your assignment, report progress,
and contribute to the shared ledger.

## Read your assignment

```bash
apohara run current --json
```

Returns:
```json
{
  "run": { "run_id": "r-xyz", "agent_id": "agent:claude:t1", "task_id": "task-42", "worktree_path": "/path/to/wt", "branch_name": "apohara/swift-falcon-a3f9c2" },
  "task": { "id": "task-42", "identifier": "task-42", "title": "...", "status": "dispatched", "acceptance_criteria": [ ... ], "available_actions": ["submit","resolve_blocker"] },
  "next_actions": [ { "id": "submit", "label": "Finish the code change..." } ]
}
```

**Always honor `next_actions` over guessing the next step.**

## Report progress (heartbeat every 5 min on long tasks)

```bash
apohara orchestration send --to "@coordinator" --type heartbeat --body "still working on X"
```

## Report completion

```bash
apohara orchestration send --to "@coordinator" --type worker_done --payload @result.json
```

`result.json` shape:
```json
{ "outcome": "success" | "failure" | "needs_clarification", "summary": "...", "evidence": ["file:line refs", "test names"] }
```

## Ask the coordinator (NEVER use AskUserQuestion)

The user is NOT watching this pane — the coordinator is. Use:

```bash
apohara orchestration ask --to "@coordinator" --question "..." --options "yes,no,defer"
```

## Read the ledger via internal MCP

If your spawn included MCP config, use `mcp__apohara__list_runs` /
`mcp__apohara__read_events` / `mcp__apohara__blast_radius` to introspect Apohara
state without leaving your session.

## Whisper messages on stderr

Watch stderr for lines starting with `[whisper:...]` — these are out-of-band
guidance from the coordinator (CORRECTION, REMINDER, BUDGET_WARNING,
DRIFT_DETECTED). Read them between tool calls and adjust accordingly.
