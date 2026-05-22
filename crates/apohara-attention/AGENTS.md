# apohara-attention — Agent Notes

> Attention bands state machine (HOT / WARM / COOL / IDLE) per spec §4
> (culture #3 inspiration). Used by Stage 7 TaskBoard "Smart Attention" sort.

## Responsibility

Pure, backend-independent state machine that tracks "how attention-worthy"
a given target (task / thread / agent / file) is over time.

- **Bands:** `Hot`, `Warm`, `Cool`, `Idle`.
- **Stimuli:** `Direct` (e.g., @mention, DM, blocked-on-this) jumps to `Hot`
  instantly. `Ambient` (e.g., generic activity in a thread) promotes
  **directly to the `Warm` cap** (does not walk one band at a time); never
  demotes `Hot`.
- **Decay:** without stimulus, `tick()` walks `Hot → Warm → Cool → Idle`
  using per-band hold timers.

## Hold timings

| Band | Hold       |
|------|-----------:|
| Hot  | 60 s       |
| Warm | 240 s      |
| Cool | 720 s      |
| Idle | `Duration::MAX` (terminal) |

Full decay window `Hot → Idle` ≈ 1020 s (~17 min).

## Public API

- `Band` enum + `Band::spec() -> BandSpec { hold: Duration }`.
- `Stimulus` enum (`Direct`, `Ambient`).
- `AttentionState { target, band, last_promote }` with `new()`, `apply(stim, now)`,
  `tick(now)`, `band()`.

`Band` is `Serialize + Deserialize + TS` (snake_case) so it can cross the
Rust↔TS boundary via `apohara-types` codegen.

## What this crate is NOT

- **Not** a scheduler. Callers decide when to `apply()` / `tick()`.
- **Not** persistent. Holding state across restarts is the orchestrator's job.
- **Not** aware of backend transport (CLI, MCP, Slack, etc.). Stimuli are
  abstract; mapping events → `Direct` / `Ambient` lives upstream.

## Tests

```
cargo test -p apohara-attention
```

Three integration tests in `tests/state_machine.rs`:
1. `direct_stimulus_promotes_to_hot`
2. `ambient_promotes_one_step_capped_at_warm`
3. `decay_walks_hot_to_idle_over_full_window` (61 + 241 + 721 s walk)

No OOM hazard — pure logic, no model loads, no I/O.

## See also

- Spec §4 (Smart Attention) in `docs/superpowers/specs/2026-05-21-apohara-v1-design.md`.
- Plan task 1.13 in `docs/superpowers/plans/2026-05-22-apohara-v1.md`.
