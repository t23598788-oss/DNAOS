#!/bin/bash
set -e

echo "=== DNA OS Architecture Drift Check ==="

DRIFT=0

ARCH="lib/registry/architecture.json"
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

check_layer "v1-input" "lib/v1-input"
check_layer "v2-rules" "lib/v2-rules"
check_layer "v3-engines" "lib/v3-engines"
check_layer "v4-ai" "lib/v4-ai"
check_layer "v5-presenter" "lib/v5-presenter"
check_layer "v6-executor" "lib/v6-executor"
check_layer "documents" "lib/documents"
check_layer "shared" "lib/shared"
check_layer "supabase" "lib/supabase"
check_layer "registry" "lib/registry"
check_layer "runtime" "lib/runtime"

# 2. Check for undeclared directories (new folders not in architecture)
echo "--- Checking for undeclared directories ---"

DECLARED_LAYERS="v1-input v2-rules v3-engines v4-ai v5-presenter v6-executor documents commands shared supabase registry runtime browser agent platform drivers middleware macos"

for dir in lib/*/; do
  dirname=$(basename "$dir")
  FOUND=0
  for declared in $DECLARED_LAYERS; do
    if [ "$dirname" = "$declared" ]; then
      FOUND=1
      break
    fi
  done

  if [ $FOUND -eq 0 ]; then
    echo "  DRIFT: lib/$dirname/ exists but is not declared in architecture — Shadow Layer"
    DRIFT=$((DRIFT + 1))
  fi
done

# 3. Check Constitution compliance — specific structural rules
echo "--- Checking Constitution structural rules ---"

# Rule: types/command.ts must not exist (unified into shared/types.ts)
if [ -f "types/command.ts" ]; then
  echo "  DRIFT: types/command.ts exists — must use lib/shared/types.ts"
  DRIFT=$((DRIFT + 1))
fi

# Rule: lib/core/ must not exist (moved to v6-executor/core/)
if [ -d "lib/core" ]; then
  echo "  DRIFT: lib/core/ exists — must use lib/v6-executor/core/"
  DRIFT=$((DRIFT + 1))
fi

# Rule: No .ts files in lib/drivers/ root (only v6-executor/drivers/)
if find lib/drivers -maxdepth 1 -name "*.ts" 2>/dev/null | grep -q .; then
  echo "  DRIFT: lib/drivers/*.ts exists — must use lib/v6-executor/drivers/"
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

ACTUAL_FILES=$(find lib app components -type f \( -name "*.ts" -o -name "*.tsx" \) \
  -not -path "lib/drivers/line/*" 2>/dev/null | wc -l | tr -d ' ')

if [ -f "lib/registry/module-registry.json" ]; then
  REGISTERED=$(grep -c '"owner"' lib/registry/module-registry.json 2>/dev/null || echo "0")
  if [ "$ACTUAL_FILES" != "$REGISTERED" ]; then
    echo "  DRIFT: $ACTUAL_FILES files on disk but $REGISTERED registered — $(( ACTUAL_FILES - REGISTERED )) unaccounted"
    DRIFT=$((DRIFT + 1))
  else
    echo "  OK: $ACTUAL_FILES files = $REGISTERED registered"
  fi
fi

echo ""
if [ $DRIFT -gt 0 ]; then
  echo "ERROR: $DRIFT architecture drifts detected"
  exit 1
fi

echo "Architecture matches design — no drift"
