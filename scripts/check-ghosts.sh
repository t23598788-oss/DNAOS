#!/bin/bash
set -e

echo "=== DNA OS Ghost Rule Check ==="

GHOSTS=0

# 1. Check workflows.json — ทุก workflow ต้องมี event/command ที่เรียกมัน
echo "--- Checking workflows ---"
WORKFLOWS=$(grep -E '^\s*"[a-z].*"steps"' lib/commands/workflows.json | sed 's/^[[:space:]]*"//;s/".*//')

for wf in $WORKFLOWS; do
  # Search for this workflow name in source code (excluding workflows.json itself)
  USAGE=$(grep -rn "\"$wf\"" --include="*.ts" --include="*.tsx" --include="*.json" \
    --exclude="workflows.json" \
    lib/ app/ components/ 2>/dev/null | grep -v node_modules | grep -v .next | wc -l | tr -d ' ')

  if [ "$USAGE" = "0" ]; then
    echo "  GHOST WORKFLOW: $wf — ไม่มี code เรียกใช้"
    GHOSTS=$((GHOSTS + 1))
  fi
done

# 2. Check commands.json — ทุก command ต้องมีคนใช้
echo "--- Checking commands ---"
COMMANDS=$(grep -o '"command": "[A-Z_]*"' lib/commands/commands.json 2>/dev/null | grep -o '"[A-Z_]*"' | tr -d '"' | sort -u)

for cmd in $COMMANDS; do
  USAGE=$(grep -rn "\"$cmd\"" --include="*.ts" --include="*.json" \
    --exclude="commands.json" \
    lib/ app/ 2>/dev/null | grep -v node_modules | wc -l | tr -d ' ')

  if [ "$USAGE" = "0" ]; then
    echo "  GHOST COMMAND: $cmd — ไม่มี code เรียกใช้"
    GHOSTS=$((GHOSTS + 1))
  fi
done

# 3. Check registered events — ทุก event ต้องมี publisher หรือ subscriber
echo "--- Checking events ---"
EVENTS=$(grep -o '"[a-z][a-z._]*"' lib/registry/events.json 2>/dev/null | head -20 | tr -d '"')

for evt in $EVENTS; do
  USAGE=$(grep -rn "\"$evt\"" --include="*.ts" \
    --exclude-dir=registry \
    lib/ app/ 2>/dev/null | grep -v node_modules | wc -l | tr -d ' ')

  if [ "$USAGE" = "0" ]; then
    echo "  GHOST EVENT: $evt — ไม่มี publisher/subscriber"
    GHOSTS=$((GHOSTS + 1))
  fi
done

echo ""
if [ $GHOSTS -gt 0 ]; then
  echo "Found $GHOSTS ghost rules/workflows/commands — พิจารณาลบหรือเชื่อมต่อ"
else
  echo "No ghosts found — ทุก rule/workflow/command มีคนใช้"
fi
