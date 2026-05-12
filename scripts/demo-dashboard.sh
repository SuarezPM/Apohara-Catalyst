#!/usr/bin/env bash
set -euo pipefail

# Demo orchestration script for Clarity dashboard E2E pipeline
# Orchestrates: prerequisite checks → auto execution → event parsing →
# metric verification → JSON + human-readable summary output

# ─── Colors ─────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# ─── Configuration ──────────────────────────────────────────────────
PROMPT="Build a simple hello-world API in TypeScript"
AUTO_LOG=".apohara/demo-auto.log"
DEMO_SUMMARY_NAME="demo-summary.json"

# ─── Helpers ────────────────────────────────────────────────────────
phase()  { echo -e "${BLUE}===> $1${NC}"; }
ok()     { echo -e "${GREEN}  ✓ $1${NC}"; }
fail()   { echo -e "${RED}  ✗ $1${NC}"; }
warn()   { echo -e "${YELLOW}  ⚠ $1${NC}"; }

# Resolve the apohara CLI command
resolve_apohara() {
    if command -v apohara >/dev/null 2>&1; then
        echo "apohara"
    elif [ -f "src/cli.ts" ]; then
        echo "bun src/cli.ts"
    else
        echo ""
    fi
}

# ─── Phase 1: Prerequisites ─────────────────────────────────────────
phase "Phase 1: Checking prerequisites"

if ! command -v bun >/dev/null 2>&1; then
    fail "bun is not installed. See https://bun.sh"
    exit 1
fi
ok "bun is installed ($(bun --version))"

if [ ! -f ".env" ]; then
    fail ".env file not found"
    exit 1
fi
ok ".env file exists"

# Check API keys without echoing values
api_keys_ok=false
for key in OPENCODE_API_KEY DEEPSEEK_API_KEY GEMINI_API_KEY TAVILY_API_KEY; do
    if grep -q "^${key}=" .env 2>/dev/null; then
        ok "${key} is present"
        api_keys_ok=true
    fi
done

if [ "$api_keys_ok" = false ]; then
    fail "No API keys found in .env"
    exit 1
fi

CLARITY_CMD=$(resolve_apohara)
if [ -z "$CLARITY_CMD" ]; then
    fail "Cannot find apohara CLI (expected 'apohara' in PATH or src/cli.ts)"
    exit 1
fi
ok "CLI resolved: ${CLARITY_CMD}"

# ─── Phase 2: Start auto in background ──────────────────────────────
phase "Phase 2: Starting apohara auto"

mkdir -p .apohara/runs

# Snapshot existing event files so we can identify the new one
EXISTING_EVENTS=$(mktemp)
ls -1 .events/run-*.jsonl 2>/dev/null > "$EXISTING_EVENTS" || true

# Start apohara auto in background, capturing all output
AUTO_CMD="${CLARITY_CMD} auto ${PROMPT} --simulate-failure --no-pr -w 4"
echo "  Command: ${AUTO_CMD}"
${AUTO_CMD} > "$AUTO_LOG" 2>&1 &
AUTO_PID=$!

ok "apohara auto started (PID: ${AUTO_PID})"
ok "Log file: ${AUTO_LOG}"

# ─── Phase 3: Dashboard instruction ─────────────────────────────────
phase "Phase 3: Dashboard instruction"
cat <<'BANNER'

  ╔═══════════════════════════════════════════════════════════════╗
  ║  INSTRUCTION: Open a second terminal and run:                 ║
  ║                                                               ║
  ║      apohara dashboard                                        ║
  ║      # or if apohara is not in PATH:                          ║
  ║      bun src/cli.ts dashboard                                 ║
  ║                                                               ║
  ║  This will launch the interactive TUI showing live progress.  ║
  ╚═══════════════════════════════════════════════════════════════╝

BANNER

# ─── Phase 4: Wait for completion ───────────────────────────────────
phase "Phase 4: Waiting for auto completion"

if wait "$AUTO_PID"; then
    AUTO_EXIT=0
    ok "apohara auto finished successfully"
else
    AUTO_EXIT=$?
    warn "apohara auto exited with code ${AUTO_EXIT}"
fi

# ─── Phase 5: Parse event ledger ────────────────────────────────────
phase "Phase 5: Parsing event ledger"

# Identify the newest run-* file that didn't exist before
NEWEST_EVENT=""
for f in .events/run-*.jsonl; do
    [ -f "$f" ] || continue
    base=$(basename "$f")
    if ! grep -qxF "$base" "$EXISTING_EVENTS" 2>/dev/null; then
        if [ -z "$NEWEST_EVENT" ] || [ "$f" -nt "$NEWEST_EVENT" ]; then
            NEWEST_EVENT=$f
        fi
    fi
done
rm -f "$EXISTING_EVENTS"

if [ -z "$NEWEST_EVENT" ] || [ ! -f "$NEWEST_EVENT" ]; then
    fail "No new event file found in .events/"
    exit 1
fi

ok "Event file: ${NEWEST_EVENT}"

# Extract runId from filename: run-<id>.jsonl → <id>
RUN_ID=$(basename "$NEWEST_EVENT" .jsonl | sed 's/^run-//')
ok "Run ID: ${RUN_ID}"

# Use bun for reliable JSON parsing
METRICS_JSON=$(bun -e "
const fs = require('fs');
const lines = fs.readFileSync('${NEWEST_EVENT}', 'utf-8')
  .split('\n')
  .filter(l => l.trim());

const providers = new Set();
let fallbackCount = 0;
let totalCost = 0;

for (const line of lines) {
  try {
    const ev = JSON.parse(line);
    if (ev.type === 'provider_selected') {
      const p = ev.metadata?.provider || ev.payload?.provider;
      if (p) providers.add(p);
    }
    if (ev.type === 'provider_fallback') {
      fallbackCount++;
    }
    if (typeof ev.metadata?.costUsd === 'number') {
      totalCost += ev.metadata.costUsd;
    } else if (typeof ev.payload?.costUsd === 'number') {
      totalCost += ev.payload.costUsd;
    }
  } catch { /* skip malformed */ }
}

console.log(JSON.stringify({
  uniqueProviders: providers.size,
  fallbackCount,
  totalCost: Math.round(totalCost * 10000) / 10000
}));
")

UNIQUE_PROVIDERS=$(echo "$METRICS_JSON" | bun -e "const d=await Bun.stdin.text(); console.log(JSON.parse(d).uniqueProviders);")
FALLBACK_COUNT=$(echo "$METRICS_JSON" | bun -e "const d=await Bun.stdin.text(); console.log(JSON.parse(d).fallbackCount);")
TOTAL_COST=$(echo "$METRICS_JSON" | bun -e "const d=await Bun.stdin.text(); console.log(JSON.parse(d).totalCost);")

echo ""
printf "  %-20s %s\n" "Unique providers:" "$UNIQUE_PROVIDERS"
printf "  %-20s %s\n" "Fallback events:" "$FALLBACK_COUNT"
printf "  %-20s %s\n" "Total cost USD:" "\$${TOTAL_COST}"
echo ""

# ─── Phase 6: Verify metrics ────────────────────────────────────────
phase "Phase 6: Verifying metrics"

VERIFICATION_PASSED=true

if [ "$UNIQUE_PROVIDERS" -ge 4 ]; then
    ok "Unique providers: ${UNIQUE_PROVIDERS} (expected >= 4)"
else
    fail "Expected >= 4 unique providers, found ${UNIQUE_PROVIDERS}"
    VERIFICATION_PASSED=false
fi

if [ "$FALLBACK_COUNT" -ge 1 ]; then
    ok "Fallback events: ${FALLBACK_COUNT} (expected >= 1)"
else
    fail "Expected >= 1 fallback event, found ${FALLBACK_COUNT}"
    VERIFICATION_PASSED=false
fi

COST_OK=$(bun -e "console.log(${TOTAL_COST} < 0.50 ? 'true' : 'false')")
if [ "$COST_OK" = "true" ]; then
    ok "Total cost: \$${TOTAL_COST} (expected < \$0.50)"
else
    fail "Expected cost < \$0.50, found \$${TOTAL_COST}"
    VERIFICATION_PASSED=false
fi

# ─── Phase 7: Write JSON summary ────────────────────────────────────
phase "Phase 7: Writing JSON summary"

SUMMARY_DIR=".apohara/runs/${RUN_ID}"
mkdir -p "$SUMMARY_DIR"
SUMMARY_FILE="${SUMMARY_DIR}/${DEMO_SUMMARY_NAME}"

bun -e "
const fs = require('fs');
const data = {
  runId: '${RUN_ID}',
  timestamp: new Date().toISOString(),
  prompt: '${PROMPT}',
  metrics: {
    uniqueProviders: ${UNIQUE_PROVIDERS},
    fallbackEvents: ${FALLBACK_COUNT},
    totalCostUsd: ${TOTAL_COST}
  },
  verification: {
    uniqueProvidersPassed: ${UNIQUE_PROVIDERS} >= 4,
    fallbackEventsPassed: ${FALLBACK_COUNT} >= 1,
    costBoundPassed: ${COST_OK} === 'true',
    allPassed: ${VERIFICATION_PASSED}
  },
  eventFile: '${NEWEST_EVENT}',
  autoLog: '${AUTO_LOG}',
  autoExitCode: ${AUTO_EXIT}
};
fs.writeFileSync('${SUMMARY_FILE}', JSON.stringify(data, null, 2) + '\n');
"

ok "Summary written to ${SUMMARY_FILE}"

# ─── Phase 8: Human-readable summary ────────────────────────────────
phase "Demo Summary"

cat <<SUMMARY

┌─────────────────────────────────────────────────────────────────────┐
│                    CLARITY DASHBOARD DEMO                           │
├─────────────────────────────────────────────────────────────────────┤
│  Run ID:           ${RUN_ID}
│  Auto Exit Code:   ${AUTO_EXIT}
│  Event File:       ${NEWEST_EVENT}
├─────────────────────────────────────────────────────────────────────┤
│  METRICS                                                            │
│    • Unique providers used:  ${UNIQUE_PROVIDERS}
│    • Provider fallbacks:     ${FALLBACK_COUNT}
│    • Total estimated cost:   \$${TOTAL_COST}
├─────────────────────────────────────────────────────────────────────┤
│  VERIFICATION                                                       │
SUMMARY

if [ "$VERIFICATION_PASSED" = true ]; then
    echo "│    ✅ All metrics passed                                            │"
else
    echo "│    ❌ Some metrics failed                                           │"
fi

cat <<SUMMARY
└─────────────────────────────────────────────────────────────────────┘

SUMMARY

if [ "$VERIFICATION_PASSED" = true ]; then
    ok "Demo completed successfully!"
    exit 0
else
    fail "Demo completed with metric failures."
    exit 1
fi
