# Apohara ContextForge Integration Tracker

## Crates nuevos Phase 3

| Crate | LOC est. | Source upstream | Status |
|---|---|---|---|
| apohara-tui | ~2k | replaces packages/tui (Ink TS, deleted in G2.D.4) | TODO |
| apohara-context-primitives | ~4k | upstream ContextForge (dedup/lsh_engine.py + scheduling/queueing_controller.py) | TODO |
| apohara-prompt-cache | ~3k | NEW (HOT DashMap + WARM SQLite WAL + 3 layers safety) | TODO |

## Z3 INV-15 port

| Asset | Source | Target | Status |
|---|---|---|---|
| Z3 SMT proof | ContextForge paper/inv15_paper.tex Python listing | crates/apohara-safety/src/inv_bash_scope_proof.rs | TODO |
| Verification-mesh wiring | apohara-verification gates | apohara-verification with INV-bash-scope as enforced invariant | TODO |

## 3-layer cache safety

| Layer | Implementation | Status |
|---|---|---|
| L1 cache key scoping | provider_id + model_id en cache key | TODO |
| L2 confidence threshold | hamming distance ladder (0/1-3/4-7/8-15/16+) + threshold per layer | TODO |
| L3 opt-in flag | APOHARA_PROMPT_CACHE=1 env var + telemetry self-tuning | TODO |
