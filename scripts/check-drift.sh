#!/bin/bash
set -e

echo "=== DNA OS Architecture Drift Check ==="

DRIFT=0

ARCH="registry/architecture.json"
if [ ! -f "$ARCH" ]; then
  echo "ERROR: $ARCH not found"
  exit 1
fi

# 1. Check that every layer in architecture.json has actual files
echo "--- Checking layers exist ---"

check_layer() {
  local layer="$1"
  local path="$2"

  if [ ! -d "$path" ]; then
    echo "  DRIFT: Layer '$layer' declared in architecture.json but directory $path missing"
    DRIFT=$((DRIFT + 1))
  fi
}

check_layer "core" "core"
check_layer "gateway" "gateway"
check_layer "engines" "engines"
check_layer "cognitive" "cognitive"
check_layer "presenter" "presenter"
check_layer "services" "services"
check_layer "plugins" "plugins"
check_layer "registry" "registry"

# 2. Check for undeclared directories (new folders not in architecture)
echo "--- Checking for undeclared top-level directories ---"

# docs/ (20 real policy .md files) and styles/ (real design tokens, imported by
# app/page.tsx) were both real, pre-existing folders this list simply never
# named — found via scripts/check-drift.sh's own DRIFT output (Autonomous
# Runtime Evolution pass, DNA-000044). Added rather than left flagging real,
# legitimate folders as a "Shadow Layer" every run.
# src-tauri/ (owner, 2026-07-30) — the native desktop wrapper (Tauri/Rust)
# around the existing Next.js app, per the local-migration effort (wraps
# the same app, no separate business logic of its own — just window/build
# config + a Rust entrypoint that loads the real Next.js UI).
DECLARED_TOP_LEVEL="core gateway engines cognitive presenter services plugins registry app components scripts supabase config node_modules backups public observatory docs styles src-tauri"

for dir in */; do
  dirname=$(basename "$dir")
  FOUND=0
  for declared in $DECLARED_TOP_LEVEL; do
    if [ "$dirname" = "$declared" ]; then
      FOUND=1
      break
    fi
  done

  if [ $FOUND -eq 0 ]; then
    echo "  DRIFT: $dirname/ exists but is not declared in architecture — Shadow Layer"
    DRIFT=$((DRIFT + 1))
  fi
done

# lib/ must not exist at all — every layer (including registry) moved to top-level in the 2026-07 reorg
if [ -d "lib" ]; then
  echo "  DRIFT: lib/ still exists — every layer moved to top-level folders in the 2026-07 reorg"
  DRIFT=$((DRIFT + 1))
fi

# 3. Check Constitution compliance — specific structural rules
echo "--- Checking Constitution structural rules ---"

# Rule: types/command.ts must not exist (unified into core/shared/types.ts)
if [ -f "types/command.ts" ]; then
  echo "  DRIFT: types/command.ts exists — must use core/shared/types.ts"
  DRIFT=$((DRIFT + 1))
fi

# Rule: lib/core/ must not exist (Core lives at top-level core/)
if [ -d "lib/core" ]; then
  echo "  DRIFT: lib/core/ exists — must use core/"
  DRIFT=$((DRIFT + 1))
fi

# Rule: No .ts files in lib/drivers/ (drivers live at plugins/drivers/)
if find lib/drivers -maxdepth 1 -name "*.ts" 2>/dev/null | grep -q .; then
  echo "  DRIFT: lib/drivers/*.ts exists — must use plugins/drivers/"
  DRIFT=$((DRIFT + 1))
fi

# Rule: No hardcoded credentials in source
if grep -rn "eyJ" --include="*.json" --include="*.ts" \
   --exclude-dir=node_modules --exclude-dir=.next . 2>/dev/null | grep -v "package" | grep -q .; then
  echo "  DRIFT: JWT token found hardcoded in source — Rule 67, 69"
  DRIFT=$((DRIFT + 1))
fi

# 4. Check module count matches registry
echo "--- Checking module count ---"

ACTUAL_FILES=$(find core gateway engines cognitive presenter services plugins registry app components -type f \( -name "*.ts" -o -name "*.tsx" \) \
  -not -path "plugins/line/*" 2>/dev/null | wc -l | tr -d ' ')

if [ -f "registry/module-registry.json" ]; then
  # Only count registered entries whose path actually falls inside the scanned
  # directories — module-registry.json also legitimately covers supabase/functions,
  # config/, scripts/, and root files (middleware.ts, next.config.ts), which this
  # scan intentionally excludes. Comparing against the full registry count produced
  # a permanently-wrong negative drift once those out-of-scope files were registered.
  REGISTERED=$(python3 -c "
import json
d = json.load(open('registry/module-registry.json'))
scanned = ('core/','gateway/','engines/','cognitive/','presenter/','services/','plugins/','registry/','app/','components/')
print(sum(1 for k in d['modules'] if k.startswith(scanned) and not k.startswith('plugins/line/')))
")
  if [ "$ACTUAL_FILES" != "$REGISTERED" ]; then
    echo "  DRIFT: $ACTUAL_FILES files on disk but $REGISTERED registered — $(( ACTUAL_FILES - REGISTERED )) unaccounted"
    DRIFT=$((DRIFT + 1))
  else
    echo "  OK: $ACTUAL_FILES files = $REGISTERED registered"
  fi
fi

# 5. No Module exists without Registration — this previously only compared
# FILE COUNT against module-registry.json's key count, which already matched
# even for the 97 modules whose own status field literally says "unregistered"
# (sync-registry.ts auto-adds a stub key for every unregistered file it finds,
# so the count matched while the modules themselves were still genuinely
# unregistered — a real enforcement gap, not a false alarm). This reads
# architecture-book.json's real computed status instead of the raw key count
# (System Invariant "No Module exists without Registration", owner, 2026-07-16
# — measured by impossibility of violation, not existence of a rule).
echo "--- Checking for unregistered modules (System Invariant) ---"
if [ -f "registry/architecture-book.json" ]; then
  UNREGISTERED=$(python3 -c "
import json
d = json.load(open('registry/architecture-book.json'))
print(d.get('summary', {}).get('unregistered', 0))
")
  if [ "$UNREGISTERED" -gt 0 ]; then
    echo "  DRIFT: $UNREGISTERED module(s) have status UNREGISTERED in architecture-book.json — every module must be registered with a real purpose_th/owner before deploy, not just auto-stubbed"
    DRIFT=$((DRIFT + 1))
  else
    echo "  OK: 0 unregistered modules"
  fi
fi

# 6. No Platform owns Knowledge — no directory under registry/ may be named
# after an execution platform (System Invariant, owner, 2026-07-16). Real
# incident this catches: this session built registry/platforms/{vercel,supabase}/
# minutes before this check existed, self-corrected only because a human caught
# it verbally — proof this needed a mechanical gate, not just discipline.
echo "--- Checking Registry is not organized by platform ---"
PLATFORM_NAMES="vercel supabase line github cloudflare google aws azure netlify"
if [ -d "registry" ]; then
  for sub in registry/*/; do
    subname=$(basename "$sub")
    for p in $PLATFORM_NAMES; do
      if [ "$subname" = "$p" ]; then
        echo "  DRIFT: registry/$subname/ exists — Registry must never be organized by platform folder (platform is an attribute on an entry, e.g. registry/constraints.json's \"platform\" field, not a directory)"
        DRIFT=$((DRIFT + 1))
      fi
    done
  done
fi

echo ""
if [ $DRIFT -gt 0 ]; then
  echo "ERROR: $DRIFT architecture drifts detected"
  exit 1
fi

echo "Architecture matches design — no drift"
