#!/bin/bash
#
# E2E Swarm Demo Script
# 
# This script verifies the multi-agent swarm integration by running
# integration tests that check:
# 1. TaskDecomposer produces ≥3 tasks with distinct roles
# 2. agent-router maps each role to correct provider
# 3. EventLedger logs role_assignment and provider_selected events
# 4. simulate-failure flag triggers fallback chain
#
# Usage: ./tests/e2e/run-swarm-demo.sh
#

set -e

echo "=========================================="
echo "  E2E Swarm Integration Demo"
echo "=========================================="
echo ""

# Ensure we're in the project root
cd "$(dirname "$0")/../.." 2>/dev/null || cd "$(dirname "$0")/../../"

# Check if bun is available
if ! command -v bun &> /dev/null; then
    echo "ERROR: bun is not installed"
    echo "Install bun: https://bun.sh"
    exit 1
fi

echo "[1/3] Running swarm integration tests..."
echo ""

# Run the integration tests  
bun test ./tests/e2e-swarm-integration.test.ts

TEST_RESULT=$?

echo ""
echo "[2/3] Checking EventLedger output..."
echo ""

# Check for event ledger files (created during test run)
if [ -d ".events" ]; then
    EVENT_FILES=$(find .events -name "*.jsonl" 2>/dev/null | head -5)
    if [ -n "$EVENT_FILES" ]; then
        echo "Found event ledger files:"
        for f in $EVENT_FILES; do
            echo "  - $f"
            EVENT_COUNT=$(wc -l < "$f" 2>/dev/null || echo "0")
            echo "    Events: $EVENT_COUNT"
        done
    else
        echo "  (No event files found in .events/)"
    fi
fi

echo ""
echo "[3/3] Summary"
echo "==========="

if [ $TEST_RESULT -eq 0 ]; then
    echo "✅ All E2E swarm integration tests PASSED"
    echo ""
    echo "Verification Results:"
    echo "  ✓ TaskDecomposer produces ≥3 tasks with distinct roles"
    echo "  ✓ agent-router maps each role to correct provider" 
    echo "  ✓ EventLedger logs role_assignment and provider_selected events"
    echo "  ✓ simulate-failure flag triggers fallback chain"
    echo ""
    exit 0
else
    echo "❌ Some tests FAILED"
    echo ""
    exit 1
fi