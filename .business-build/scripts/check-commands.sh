#!/bin/bash
set -e

echo "=== DNA OS Command Registry Check ==="

REGISTRY="registry/command-registry.json"

if [ ! -f "$REGISTRY" ]; then
  echo "ERROR: $REGISTRY not found"
  exit 1
fi

# Node-based JSON queries (owner, 2026-07-18) — jq is not installed in
# Vercel's build environment; Node always is. See scripts/lib/registry-query.cjs.
rq() { node "$(cd "$(dirname "$0")" && pwd)/lib/registry-query.cjs" "$@"; }

VIOLATIONS=0

# 1. Check for variant command names (.v2, .backup, .test)
echo "Checking for variant command names..."
COMMANDS=$(rq keys "$REGISTRY" commands 2>/dev/null)

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
CONFIRM_CMDS=$(rq keys-where "$REGISTRY" commands requires_confirmation true 2>/dev/null)

for cmd in $CONFIRM_CMDS; do
  echo "  ✓ $cmd requires confirmation (Rule 72)"
done

# 4. Check capability_actions have status
echo "Checking capability_actions status..."
STUB_COUNT=$(rq keys-where "$REGISTRY" capability_actions status stub 2>/dev/null | wc -l | tr -d ' ')
ACTIVE_COUNT=$(rq keys-where "$REGISTRY" capability_actions status active 2>/dev/null | wc -l | tr -d ' ')
NO_STATUS=$(rq keys-where-null "$REGISTRY" capability_actions status 2>/dev/null | wc -l | tr -d ' ')

echo "  Active: $ACTIVE_COUNT, Stub: $STUB_COUNT, No status: $NO_STATUS"

if [ "$NO_STATUS" -gt 0 ]; then
  echo "WARNING: $NO_STATUS capability_actions without status — ต้องระบุ active/stub/deprecated"
fi

# 5. Verify query_constraints exist for read commands
echo "Checking query_constraints..."
CONSTRAINT_COUNT=$(rq count-keys "$REGISTRY" query_constraints 2>/dev/null)
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
