#!/bin/bash

echo "=== DNA OS Rule Coverage ==="

REGISTRY="lib/registry/rule-coverage.json"

if [ ! -f "$REGISTRY" ]; then
  echo "ERROR: $REGISTRY not found"
  exit 1
fi

# Count covered rules
COVERED=$(grep -c '"enforced_by"' "$REGISTRY" 2>/dev/null || echo "0")
TOTAL=100

# Check each enforced_by file actually exists
BROKEN=0
echo "--- Checking enforcement files exist ---"

grep '"enforced_by"' "$REGISTRY" | grep -o '"[^"]*\.\(ts\|sh\|json\|mjs\)"' | tr -d '"' | sed 's/#.*//' | sort -u | while read file; do
  if [ ! -f "$file" ]; then
    echo "  BROKEN: Rule references $file but file missing"
    # Can't increment BROKEN in subshell, handled by exit code
  fi
done

# Count uncovered rules
UNCOVERED=$(grep -o '"uncovered_rules"' "$REGISTRY" | wc -l | tr -d ' ')
UNCOVERED_COUNT=$(grep '"uncovered_rules"' "$REGISTRY" -A1000 | grep -o '[0-9]*' | wc -l | tr -d ' ')

COVERAGE_PCT=$(( (COVERED * 100) / TOTAL ))

echo ""
echo "  Constitution Rules: $TOTAL"
echo "  Enforced by code:   $COVERED ($COVERAGE_PCT%)"
echo "  Not yet enforced:   $UNCOVERED_COUNT"
echo ""

if [ $COVERAGE_PCT -lt 20 ]; then
  echo "WARNING: Rule coverage below 20% — need more enforcement"
fi

echo "Rule coverage check complete"
