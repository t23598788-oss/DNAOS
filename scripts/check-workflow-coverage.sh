#!/bin/bash

echo "=== DNA OS Workflow Coverage ==="

WORKFLOWS="lib/commands/workflows.json"
COMMANDS="lib/commands/commands.json"
EVENTS="lib/registry/events.json"

INCOMPLETE=0

echo "--- Checking workflow completeness ---"

# Extract workflow names
WF_NAMES=$(grep -E '^\s*"[a-z].*"steps"' "$WORKFLOWS" | sed 's/^[[:space:]]*"//;s/".*//')

for wf in $WF_NAMES; do
  ISSUES=""

  # Check 1: Has steps (always true if in workflows.json)
  STEPS=$(grep "\"$wf\"" "$WORKFLOWS" | grep -o '"steps"' | wc -l | tr -d ' ')

  # Check 2: Has a command entry that triggers this workflow
  TRIGGER=$(grep -rn "\"$wf\"" "$COMMANDS" 2>/dev/null | wc -l | tr -d ' ')
  if [ "$TRIGGER" = "0" ]; then
    # Also check source code for direct references
    CODE_REF=$(grep -rn "\"$wf\"" --include="*.ts" lib/ app/ 2>/dev/null | grep -v node_modules | wc -l | tr -d ' ')
    if [ "$CODE_REF" = "0" ]; then
      ISSUES="${ISSUES} no-trigger"
    fi
  fi

  # Check 3: Has confirm flag (write operations)
  HAS_CONFIRM=$(grep "\"$wf\"" "$WORKFLOWS" | grep -c '"confirm"' || true)

  # Report
  if [ -n "$ISSUES" ]; then
    echo "  INCOMPLETE: $wf —$ISSUES"
    INCOMPLETE=$((INCOMPLETE + 1))
  fi
done

TOTAL=$(echo "$WF_NAMES" | wc -w | tr -d ' ')
COMPLETE=$((TOTAL - INCOMPLETE))

echo ""
echo "  Total workflows: $TOTAL"
echo "  Complete chain:  $COMPLETE"
echo "  Incomplete:      $INCOMPLETE"
echo ""

if [ $INCOMPLETE -gt 0 ]; then
  echo "Found $INCOMPLETE incomplete workflows — ต้องเชื่อมต่อ trigger"
else
  echo "All workflows have complete chains"
fi
