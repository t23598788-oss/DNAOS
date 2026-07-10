#!/bin/bash
# ────────────────────────────────────────────────────────────────────────────
# DNA OS — Registry Integrity Check
#
# ตรวจสอบ 5 ระดับ:
#   Level 1 — Source files → must be in module-registry.json
#   Level 2 — module-registry.json → source files must exist on disk
#   Level 3 — command-registry.json → owner modules must exist in module-registry
#   Level 4 — workflow-registry.json → commands referenced must exist in command-registry
#   Level 5 — command-registry.json → no duplicate command names
#
# Usage:
#   ./scripts/check-registry.sh   (run from project root)
#
# Exit 0 = clean | Exit 1 = violations found
# ────────────────────────────────────────────────────────────────────────────

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

MODULE_REGISTRY="registry/module-registry.json"
COMMAND_REGISTRY="registry/command-registry.json"
WORKFLOW_REGISTRY="07-workflow-registry.json"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
RESET='\033[0m'

VIOLATIONS=0
WARNINGS=0

log_ok()   { echo -e "${GREEN}  ✓${RESET} $1"; }
log_err()  { echo -e "${RED}  ✗ ERROR:${RESET} $1"; VIOLATIONS=$((VIOLATIONS + 1)); }
log_warn() { echo -e "${YELLOW}  ⚠ WARN:${RESET} $1"; WARNINGS=$((WARNINGS + 1)); }
log_head() { echo -e "\n${CYAN}── $1 ──${RESET}"; }

# ── Prerequisites ──
if ! command -v jq &>/dev/null; then
  echo "ERROR: jq is required — brew install jq"
  exit 1
fi
for f in "$MODULE_REGISTRY" "$COMMAND_REGISTRY"; do
  if [ ! -f "$f" ]; then
    echo "ERROR: Registry file not found: $f"
    exit 1
  fi
done

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║        DNA OS — Registry Integrity Check             ║"
echo "╚══════════════════════════════════════════════════════╝"

# ══════════════════════════════════════════════════════════
# LEVEL 1 — Source files must be in module-registry
# ══════════════════════════════════════════════════════════
log_head "Level 1: Source files → Module Registry"

REGISTERED=$(jq -r '.modules | keys[]' "$MODULE_REGISTRY")

SOURCE_FILES=$(find lib app -type f \( -name "*.ts" -o -name "*.tsx" \) \
  ! -path "registry/*" \
  ! -path "*/.next/*" \
  ! -path "*/node_modules/*" \
  ! -name "*.d.ts" \
  2>/dev/null | sort)

L1_UNREGISTERED=0
while IFS= read -r file; do
  if ! echo "$REGISTERED" | grep -Fxq "$file"; then
    log_warn "Not registered: $file"
    L1_UNREGISTERED=$((L1_UNREGISTERED + 1))
  fi
done <<< "$SOURCE_FILES"

TOTAL_SOURCE=$(echo "$SOURCE_FILES" | wc -l | tr -d ' ')
if [ "$L1_UNREGISTERED" -eq 0 ]; then
  log_ok "All $TOTAL_SOURCE source files are registered"
else
  echo -e "  ${YELLOW}→ $L1_UNREGISTERED unregistered file(s) — add to module-registry.json${RESET}"
  VIOLATIONS=$((VIOLATIONS + L1_UNREGISTERED))
fi

# ══════════════════════════════════════════════════════════
# LEVEL 2 — module-registry entries must point to real files
# ══════════════════════════════════════════════════════════
log_head "Level 2: Module Registry → Files on disk"

L2_MISSING=0
while IFS= read -r reg_path; do
  [[ "$reg_path" == _* ]] && continue
  if [ ! -f "$reg_path" ]; then
    log_err "Registry entry has no file on disk: $reg_path"
    L2_MISSING=$((L2_MISSING + 1))
  fi
done < <(jq -r '.modules | keys[]' "$MODULE_REGISTRY")

if [ "$L2_MISSING" -eq 0 ]; then
  TOTAL_REG=$(jq -r '.modules | keys[]' "$MODULE_REGISTRY" | grep -vc '^_' || true)
  log_ok "All $TOTAL_REG registry entries point to real files"
fi

# ══════════════════════════════════════════════════════════
# LEVEL 3 — Commands must reference existing owner modules
# ══════════════════════════════════════════════════════════
log_head "Level 3: Command owners → Module Registry"

L3_MISSING=0
while IFS= read -r cmd_owner; do
  if ! jq -r '.modules | keys[]' "$MODULE_REGISTRY" | grep -q "$cmd_owner" 2>/dev/null; then
    log_warn "Command owner not traceable to any module: $cmd_owner"
    L3_MISSING=$((L3_MISSING + 1))
  fi
done < <(jq -r '.commands | to_entries[] | select(.key | startswith("_") | not) | .value.owner' "$COMMAND_REGISTRY" | sort -u)

if [ "$L3_MISSING" -eq 0 ]; then
  log_ok "All command owners are traceable to registered modules"
fi

# ══════════════════════════════════════════════════════════
# LEVEL 4 — Workflows must reference commands that exist
# ══════════════════════════════════════════════════════════
log_head "Level 4: Workflow commands → Command Registry"

if [ ! -f "$WORKFLOW_REGISTRY" ]; then
  log_warn "Workflow registry not found: $WORKFLOW_REGISTRY (skipping)"
else
  COMMAND_NAMES=$(jq -r '.commands | keys[]' "$COMMAND_REGISTRY")
  L4_MISSING=0

  while IFS= read -r ref_cmd; do
    [[ -z "$ref_cmd" ]] && continue
    if ! echo "$COMMAND_NAMES" | grep -Fxq "$ref_cmd"; then
      log_warn "Workflow references unknown command: $ref_cmd"
      L4_MISSING=$((L4_MISSING + 1))
    fi
  done < <(jq -r '
    .workflows // {} |
    to_entries[] |
    .value.steps_commands? // [] |
    .[]
  ' "$WORKFLOW_REGISTRY" 2>/dev/null || true)

  if [ "$L4_MISSING" -eq 0 ]; then
    log_ok "All workflow command references resolve"
  fi
fi

# ══════════════════════════════════════════════════════════
# LEVEL 5 — No duplicate command names
# ══════════════════════════════════════════════════════════
log_head "Level 5: Command Registry → No duplicates"

DUPES=$(jq -r '.commands | keys[]' "$COMMAND_REGISTRY" | tr '[:upper:]' '[:lower:]' | sort | uniq -d)
if [ -n "$DUPES" ]; then
  while IFS= read -r d; do
    log_err "Duplicate command name: $d"
  done <<< "$DUPES"
else
  log_ok "No duplicate command names"
fi

# ══════════════════════════════════════════════════════════
# Summary
# ══════════════════════════════════════════════════════════
echo ""
echo "══════════════════════════════════════════════════════"
if [ "$VIOLATIONS" -eq 0 ] && [ "$WARNINGS" -eq 0 ]; then
  echo -e "${GREEN}  PASS — Registry is clean. No violations, no warnings.${RESET}"
elif [ "$VIOLATIONS" -eq 0 ]; then
  echo -e "${YELLOW}  PASS with $WARNINGS warning(s) — 0 hard violations.${RESET}"
  echo -e "${YELLOW}  Consider registering all files to keep registry complete.${RESET}"
else
  echo -e "${RED}  FAIL — $VIOLATIONS violation(s), $WARNINGS warning(s).${RESET}"
  echo -e "${RED}  Fix all violations before merging to main.${RESET}"
fi
echo "══════════════════════════════════════════════════════"
echo ""

[ "$VIOLATIONS" -eq 0 ]
