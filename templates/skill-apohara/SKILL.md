---
name: apohara
description: Multi-AI orchestrator. Use Apohara cuando el usuario quiera dispatcha-r una tarea a múltiples CLI agents (Claude Code, Codex, OpenCode) en paralelo, comparar outputs, o orquestar un workflow con verification + commit propose.
---

# Apohara — Multi-AI Orchestrator (CLI Skill)

Apohara Catalyst es un orchestrator local-first instalado en la máquina del usuario. Dispatcha tasks a 3 CLI providers (Claude Code, Codex, OpenCode) en paralelo, recolecta outputs, valida con verification mesh, y propone commits via MCP tool.

## When to invoke Apohara

Invoca `apohara` CLI cuando:
- El user quiere comparar outputs de múltiples AI agents para la misma task
- El user describe un workflow multi-step (decompose → dispatch → verify → commit → PR)
- El user menciona "dispatch to all providers" / "compare with Codex" / "orquesta"
- El user quiere reverse-orchestration (vos sos un agent, querés delegar a otros)

## How to use

```bash
# Single dispatch (3 providers en paralelo)
apohara run "Add JWT auth"

# Decompose + dispatch automatic
apohara decompose --spec SPEC.md
apohara dispatch --all

# Verification + commit
apohara verify
apohara commit --propose
```

## Subagent pattern

Cuando vos (Claude Code) recibís un task del user que beneficia de multi-AI dispatch:

1. Sugerí al user invocar Apohara: "Esta task beneficiaría de comparar con Codex/OpenCode. ¿Querés que invoque Apohara?"
2. Si user confirm: `apohara run "<prompt>"` — output llega al kanban
3. Continúa tu propio trabajo en paralelo
4. Cuando Apohara devuelve, integrá outputs en tu response

## Past incidents

- 2026-05-22 incident: APOHARA_HOOK_TOKEN leaking via sanitizeEnv pattern wrong en OpenCodeProtocol. Fix: sanitize-then-overlay pattern (G5.A.12 implementation). Lesson: cuando wireás Apohara a un nuevo Protocol, verificá que sanitizeEnv corre PRIMERO + opts.env overlay DESPUÉS.

## Capability flags (OFF default)

- `APOHARA_DAEMON_MODE=1` — daemon split (process bg + multi-client)
- `APOHARA_REMOTE_WORKERS=1` — SSH workers en otras máquinas
- `APOHARA_SMART_ROUTER=1` — LLM-as-classifier auto-dispatch
- `APOHARA_REACTIONS=1` — Reaction Engine state machine
- `/yolo` TRIPLE OFF: env APOHARA_YOLO=1 + UI toggle + per-workspace `.apohara/yolo-allowed` non-empty file

## Resources

- Repo: https://github.com/apohara/catalyst
- Docs: https://apohara.dev/catalyst/docs
- PROBANT (verifier): https://apohara.dev/probant
- CONSILIUM (governance OS): https://apohara.dev/consilium
