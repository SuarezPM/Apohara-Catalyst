#!/usr/bin/env bash
# scripts/measure_reload.sh — proxy benchmark for hot-reload latency.
#
# subsecond (Dioxus 0.7 hot-patcher) applies rsx! changes WITHOUT a full
# rebuild, so the actual hot-reload p50 in dx serve is typically much
# faster than this number. But this gives us a deterministic worst-case:
# the incremental `cargo build` time for a small src/ edit.
#
# Output: 5 sample run-times in ms + p50.
set -euo pipefail
cd "$(dirname "$0")/.."

target=src/components/hero_banner.rs
samples=()

# Warm up.
cargo build -p apohara-desktop-dioxus --offline >/dev/null 2>&1 || true

for i in 1 2 3 4 5; do
    # Touch then rebuild and measure.
    touch "$target"
    start=$(date +%s%3N)
    cargo build -p apohara-desktop-dioxus >/dev/null 2>&1
    end=$(date +%s%3N)
    samples+=($((end - start)))
    echo "sample $i: ${samples[-1]} ms"
done

# p50 (median of 5 = 3rd smallest).
sorted=($(printf '%s\n' "${samples[@]}" | sort -n))
echo "p50: ${sorted[2]} ms (proxy upper bound; subsecond will be faster)"
