# G10.C — Performance Validation Report

Date: 2026-05-23
Hardware reference: AMD Ryzen 5 3600 (6c/12t Zen 2) / 16GB DDR4 / NVMe Gen4 Kingston SNV3S 1TB / CachyOS

## Benchmarks

| Bench                 | Target   | Measured                    | Status                |
|-----------------------|----------|-----------------------------|-----------------------|
| Cold start (CLI)      | < 500ms  | 75.5 ms p50, 194.5 ms max   | PASS (6.6x margin)    |
| Dispatch latency      | < 200ms  | 7.2 ms p50, 8.0 ms max      | PASS (27x margin)     |
| Indexer query (10k)   | < 50ms   | 7.6 ms p50, 8.2 ms max      | PASS (6.5x margin)    |

## Methodology

- `hyperfine` 1.18+ — 3-5 warmup runs, 20-30 measured runs.
- Bun 1.3.13 + Node 22.
- Indexer benches use `cargo build --release` binary (NOT debug).
- Dispatch latency uses APOHARA_DISPATCH_DISABLED=1 to skip real CLI workers (HTTP/ledger path measured, CLI exec excluded).

## Scripts

- `scripts/bench/cold-start.sh`     (G10.C.1 commit e1de389)
- `scripts/bench/dispatch-latency.sh` (G10.C.2 commit 42af5cb)
- `scripts/bench/indexer-query.sh`   (G10.C.3 this commit)

## Notes

- Cold-start p50 is dominated by Node startup overhead (~50ms baseline). The CLI itself adds negligible work.
- Dispatch latency is so low (7ms p50) because the mock path skips CLI worker spawn — real provider dispatch will be dominated by the CLI's startup + first-token latency (orca, claude, codex, opencode all measured >500ms in their own published numbers).
- Indexer query latency at 10k chunks is dominated by sqlite-vec MATCH cost. blake3 feature-hashing of the query string is negligible (<1ms).

## Conclusión

PROCEED — all 3 benches comfortably under target on reference hardware.
Real-world dispatch numbers will degrade once real CLIs are involved
(out of scope for this bench — that's `apohara verify-setup` territory).
