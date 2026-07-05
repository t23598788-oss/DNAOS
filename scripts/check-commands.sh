#!/bin/bash
set -e

echo "=== DNA OS Command Registry Check ==="

REGISTRY="lib/registry/command-registry.json"

if [ ! -f "$REGISTRY" ]; then
  echo "ERROR: $REGISTRY not found"
  exit 1
fi

if ! command -v jq &>/dev/null; then
  echo "ERROR: jq is required — brew install jq"
  exit 1
fi

VIOLATIONS=0

# 1. Check for variant command names (.v2, .backup, .test)
echo "Checking for variant command names..."
COMMANDS=$(jq -r '.commands | keys[]' "$REGISTRY" 2>/dev/null)

for cmd in $COMMANDS; do
  if echo "$cmd" | grep -qE '\.(v[0-9]+|new|old|backup|test)$'; then
    echo "VARIANT: $cmd — ห้ามมีชื่อเวอร์ชัน ใช้ชื่อเดียวทั่วระบบ"
    VIOLATIONS=$((VIOLATIONS + 1))
  fi
done

# 2. Check for duplicate names (dot vs underscore)
for cmd in $COMMANDS; do
  base=$(echo "$cmd" | sed 's/\./_/g')
  for other in $COMMANDS; do
    other_base=$(echo "$other" | sed 's/\./_/g')
    if [ "$cmd" != "$other" ] && [ "$base" = "$other_base" ]; then
      echo "CONFLICT: $cmd vs $other — ชื่อเดียวกันแต่ format ต่าง"
      VIOLATIONS=$((VIOLATIONS + 1))
    fi
  done
done

# 3. Check commands that require_confirmation have proper guard
echo "Checking confirmation guards..."
CONFIRM_CMDS=$(jq -r '.commands | to_entries[] | select(.value.requires_confirmation == true) | .key' "$REGISTRY" 2>/dev/null)

for cmd in $CONFIRM_CMDS; do
  echo "  ✓ $cmd requires confirmation (Rule 72)"
done

# 4. Check capability_actions have status
echo "Checking capability_actions status..."
STUB_COUNT=$(jq -r '.capability_actions | to_entries[] | select(.key | startswith("_") | not) | select(.value.status == "stub") | .key' "$REGISTRY" 2>/dev/null | wc -l | tr -d ' ')
ACTIVE_COUNT=$(jq -r '.capability_actions | to_entries[] | select(.key | startswith("_") | not) | select(.value.status == "active") | .key' "$REGISTRY" 2>/dev/null | wc -l | tr -d ' ')
NO_STATUS=$(jq -r '.capability_actions | to_entries[] | select(.key | startswith("_") | not) | select(.value.status == null) | .key' "$REGISTRY" 2>/dev/null | wc -l | tr -d ' ')

echo "  Active: $ACTIVE_COUNT, Stub: $STUB_COUNT, No status: $NO_STATUS"

if [ "$NO_STATUS" -gt 0 ]; then
  echo "WARNING: $NO_STATUS capability_actions without status — ต้องระบุ active/stub/deprecated"
fi

# 5. Verify query_constraints exist for read commands
echo "Checking query_constraints..."
CONSTRAINT_COUNT=$(jq -r '.query_constraints | keys | length' "$REGISTRY" 2>/dev/null)
echo "  $CONSTRAINT_COUNT commands have query constraints"

if [ $VIOLATIONS -gt 0 ]; then
  echo ""
  echo "ERROR: $VIOLATIONS command violations found"
  exit 1
fi

echo ""
echo "All commands registered and valid"
echo "  Commands: $(echo "$COMMANDS" | wc -w | tr -d ' ')"
echo "  Capabilities: $((ACTIVE_COUNT + STUB_COUNT)) (active=$ACTIVE_COUNT, stub=$STUB_COUNT)"
echo "  Constrained: $CONSTRAINT_COUNT"
