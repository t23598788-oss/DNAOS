#!/bin/bash
set -e

echo "=== DNA OS Pre-Commit Guard ==="

# Guard 1: No Supabase credentials in source
if grep -rn "supabase.co" --include="*.ts" --include="*.tsx" --include="*.json" \
   --exclude-dir=node_modules --exclude-dir=.next \
   --exclude="supabase/.temp/*" --exclude="package*.json" . 2>/dev/null | grep -v "process.env" | grep -v "NEXT_PUBLIC"; then
  echo "ERROR: Supabase URL hardcoded in source — use env var"
  exit 1
fi

# Guard 2: No mock/fake in v3-engines
if grep -rn "Mock\|mock\|fake\|Fake\|MOCK\|FAKE" --include="*.ts" lib/v3-engines/ 2>/dev/null; then
  echo "ERROR: Mock/Fake data found in v3-engines — Rule 94"
  exit 1
fi

# Guard 3: No direct supabase import in v1-v5
for layer in lib/v1-input lib/v2-rules lib/v3-engines lib/v4-ai lib/v5-presenter; do
  if grep -rn "from.*@supabase/supabase-js" --include="*.ts" "$layer/" 2>/dev/null; then
    echo "ERROR: $layer imports @supabase/supabase-js directly — Rule 71"
    exit 1
  fi
done

# Guard 4: No duplicate type definitions
if grep -rn "export interface Command {" --include="*.ts" \
   --exclude-dir=node_modules --exclude-dir=.next . 2>/dev/null | grep -v "lib/shared/types.ts" | grep -v "RuntimeCommand" | grep -v "BridgeCommand"; then
  echo "ERROR: Command type defined outside lib/shared/types.ts"
  exit 1
fi

# Guard 5: types/command.ts must not exist
if [ -f "types/command.ts" ]; then
  echo "ERROR: types/command.ts exists — use lib/shared/types.ts"
  exit 1
fi

# Guard 6: No duplicate lib/core/ or lib/drivers/*.ts
if [ -d "lib/core" ]; then
  echo "ERROR: lib/core/ exists — use lib/v6-executor/core/"
  exit 1
fi
if find lib/drivers -maxdepth 1 -name "*.ts" 2>/dev/null | head -1 | grep -q .; then
  echo "ERROR: lib/drivers/*.ts exists — use lib/v6-executor/drivers/"
  exit 1
fi

# Guard 7: Dependency graph — no undeclared cross-layer imports
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [ -x "$SCRIPT_DIR/check-imports.sh" ]; then
  echo "--- Running dependency graph check ---"
  if ! "$SCRIPT_DIR/check-imports.sh" --staged; then
    echo "ERROR: Dependency graph violation — see above"
    exit 1
  fi
fi

echo "All guards passed"
