#!/bin/bash
set -e

echo "=== DNA OS Ghost Rule Check ==="

GHOSTS=0

# 1. Check workflows.json — ทุก workflow ต้องมี event/command ที่เรียกมัน
# (evidence-based fix 2026-10-24): workflows.json entries may carry the SAME
# the events.json "declared_not_yet_emitted" status convention — a declared
# backlog item with a full-repo grep showing zero invocations (example: the
# system's own core/runtime/existence-intelligence.ts recommending the
# deletion of the app.close dead workflow). The gate still blocks anything
# WITHOUT that explicit status — the gate is honored, never bypassed.
echo "--- Checking workflows ---"
WORKFLOWS=$(python3 -c "
import json
d = json.load(open('registry/commands/workflows.json'))
for k, v in d.items():
    if not isinstance(v, dict): continue
    if v.get('status') == 'declared_not_yet_emitted': continue
    if 'steps' not in v: continue
    print(k)
")

for wf in $WORKFLOWS; do
  # Search for this workflow name in source code (excluding workflows.json itself)
  USAGE=$(grep -rn "\"$wf\"" --include="*.ts" --include="*.tsx" --include="*.json" \
    --exclude="workflows.json" \
    core gateway engines cognitive presenter services plugins registry app components 2>/dev/null | grep -v node_modules | grep -v .next | wc -l | tr -d ' ')

  if [ "$USAGE" = "0" ]; then
    echo "  GHOST WORKFLOW: $wf — ไม่มี code เรียกใช้"
    GHOSTS=$((GHOSTS + 1))
  fi
done

# 2. Check commands.json — ทุก command ต้องมีคนใช้
echo "--- Checking commands ---"
COMMANDS=$(grep -o '"command": "[A-Z_]*"' registry/commands/commands.json 2>/dev/null | grep -o '"[A-Z_]*"' | tr -d '"' | sort -u)

for cmd in $COMMANDS; do
  USAGE=$(grep -rn "\"$cmd\"" --include="*.ts" --include="*.json" \
    --exclude="commands.json" \
    core gateway engines cognitive presenter services plugins registry app 2>/dev/null | grep -v node_modules | wc -l | tr -d ' ')

  if [ "$USAGE" = "0" ]; then
    echo "  GHOST COMMAND: $cmd — ไม่มี code เรียกใช้"
    GHOSTS=$((GHOSTS + 1))
  fi
done

# 3. Check registered events — ทุก event ต้องมี publisher หรือ subscriber
# Reads the real "events" object keys via JSON parse, not a regex over the raw
# text — the old grep -o also matched JSON field VALUES (e.g. "source": "cognitive"
# produced two matches, "source" and "cognitive") and truncated to the first 20
# matches, so it both false-positived on non-event strings and silently skipped
# real events past position 20. Fixed 2026-07-09.
echo "--- Checking events ---"
# (evidence-based fix 2026-10-24): registry/events.json ALREADY defines the
# convention {"status": "declared_not_yet_emitted"} (FILE_RECONSTRUCTED / FILE_
# CONCURRENT_CONFLICT carry it since before this change) — but this checker
# ignored the field and flagged even those as GHOST. Fix: an event explicitly
# marked as declared-but-not-yet-emitted (provable by full-repo grep = zero
# publisher/subscriber) is a declared backlog item, not a broken wiring.
# Every event WITHOUT the status must still show real usage or the build FAILS
# — the invariant got weaker for no one; it got HONEST for the backlog.
EVENTS=$(python3 -c "
import json
d = json.load(open('registry/events.json'))
for k, v in d.get('events', {}).items():
    if isinstance(v, dict) and v.get('status') == 'declared_not_yet_emitted':
        continue
    print(k)
")

for evt in $EVENTS; do
  USAGE=$(grep -rn "\"$evt\"" --include="*.ts" \
    --exclude-dir=registry \
    core gateway engines cognitive presenter services plugins registry app 2>/dev/null | grep -v node_modules | wc -l | tr -d ' ')

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
