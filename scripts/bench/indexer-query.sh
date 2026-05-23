#!/usr/bin/env bash
# scripts/bench/indexer-query.sh
# Measure apohara-indexer knn_query latency with 10k chunks pre-indexed.
#
# Usage: ./scripts/bench/indexer-query.sh
# Output: /tmp/apohara-indexer-query.json + summary on stdout

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BIN="$REPO_ROOT/target/release/apohara-indexer"

if [ ! -f "$BIN" ]; then
  echo "Error: indexer not built. Run 'cargo build --release -p apohara-indexer'."
  exit 1
fi

if ! command -v hyperfine > /dev/null; then
  echo "Error: hyperfine not installed."
  exit 1
fi

CORPUS=/tmp/apohara-indexer-bench-corpus
DB=/tmp/apohara-indexer-bench.sqlite

rm -rf "$CORPUS" "$DB"
mkdir -p "$CORPUS"

echo "Seeding 10k synthetic chunks into $CORPUS..."
for i in $(seq 1 10000); do
  echo "pub fn func_${i}() { /* chunk ${i} body */ }" > "$CORPUS/file_${i}.rs"
done

echo "Indexing..."
"$BIN" index "$DB" "$CORPUS"/*.rs > /dev/null

echo "Benching knn_query..."
OUT_JSON=/tmp/apohara-indexer-query.json
hyperfine \
  --warmup 5 \
  --runs 30 \
  --command-name "indexer knn_query (10k chunks)" \
  --export-json "$OUT_JSON" \
  "$BIN query $DB 'func_4242 chunk'"

if command -v jq > /dev/null; then
  P50_MS=$(jq '.results[0].mean * 1000' "$OUT_JSON")
  MAX_MS=$(jq '.results[0].max * 1000' "$OUT_JSON")
  echo ""
  echo "  indexer p50: ${P50_MS} ms"
  echo "  indexer max: ${MAX_MS} ms"
  echo "  target:      < 50ms (p50)"
fi
