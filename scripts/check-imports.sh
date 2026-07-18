#!/bin/bash
# =============================================================================
# DNA OS Dependency Graph Checker
#
# ตรวจสอบว่า import ข้าม layer ทุกตัวอยู่ในกราฟที่อนุญาต
# ถ้ามี import ที่ไม่อยู่ในกราฟ = violation → exit 1
#
# Usage:
#   ./scripts/check-imports.sh              # ตรวจสอบทั้งหมด
#   ./scripts/check-imports.sh --staged     # ตรวจสอบเฉพาะไฟล์ที่ staged (สำหรับ pre-commit)
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
GRAPH_FILE="$PROJECT_DIR/registry/dependency-graph.json"

# Colors (only if terminal supports them)
if [ -t 1 ]; then
  RED='\033[0;31m'
  GREEN='\033[0;32m'
  YELLOW='\033[0;33m'
  CYAN='\033[0;36m'
  NC='\033[0m'
else
  RED='' GREEN='' YELLOW='' CYAN='' NC=''
fi

echo "=== DNA OS Dependency Graph Check ==="
echo ""

# ---------------------------------------------------------------------------
# Verify dependency-graph.json exists
# ---------------------------------------------------------------------------
if [ ! -f "$GRAPH_FILE" ]; then
  echo -e "${RED}ERROR: dependency-graph.json not found at $GRAPH_FILE${NC}"
  exit 1
fi

# ---------------------------------------------------------------------------
# Node-based JSON queries (owner, 2026-07-18) — jq is not installed in
# Vercel's build environment; Node always is. See scripts/lib/registry-query.cjs.
# ---------------------------------------------------------------------------
rq() { node "$SCRIPT_DIR/lib/registry-query.cjs" "$@"; }

# ---------------------------------------------------------------------------
# Build the allowed-edges lookup table
# Format: "source_layer:target_layer" per line
# ---------------------------------------------------------------------------
ALLOWED_EDGES_FILE="$(mktemp)"
trap 'rm -f "$ALLOWED_EDGES_FILE"' EXIT

rq allowed-edges "$GRAPH_FILE" > "$ALLOWED_EDGES_FILE"

# ---------------------------------------------------------------------------
# Determine which files to scan
# ---------------------------------------------------------------------------
MODE="all"
if [ "${1:-}" = "--staged" ]; then
  MODE="staged"
fi

cd "$PROJECT_DIR"

if [ "$MODE" = "staged" ]; then
  FILES=$(git diff --cached --name-only --diff-filter=ACMR 2>/dev/null \
    | grep -E '\.(ts|tsx)$' \
    | grep -v node_modules \
    | grep -v '.next' || true)
else
  FILES=$(find app components core engines gateway cognitive presenter services plugins -type f \( -name "*.ts" -o -name "*.tsx" \) \
    ! -path "*/node_modules/*" \
    ! -path "*/.next/*" 2>/dev/null || true)
fi

if [ -z "$FILES" ]; then
  echo -e "${GREEN}No files to check.${NC}"
  exit 0
fi

# ---------------------------------------------------------------------------
# Helper: determine the layer for a given file path (post-reorg 2026-07)
#   app/api/action/route.ts    → app
#   components/CommandBox.tsx   → components
#   engines/debt/x.ts           → engines
#   core/shared/types.ts        → core
#   registry/...            → registry (last remaining lib/ tenant)
# ---------------------------------------------------------------------------
get_layer() {
  local filepath="$1"
  case "$filepath" in
    app/*)        echo "app" ;;
    components/*) echo "components" ;;
    core/*)       echo "core" ;;
    gateway/*)    echo "gateway" ;;
    engines/*)    echo "engines" ;;
    cognitive/*)  echo "cognitive" ;;
    presenter/*)  echo "presenter" ;;
    services/*)   echo "services" ;;
    plugins/*)    echo "plugins" ;;
    registry/*)   echo "registry" ;;
    registry/*) echo "registry" ;;
    *) echo "unknown" ;;
  esac
}

# ---------------------------------------------------------------------------
# Helper: extract the target layer from an import path
#   @/core/shared/types      → core
#   @/engines/debt/engine    → engines
#   @/registry/architecture  → registry
# ---------------------------------------------------------------------------
get_target_layer() {
  local import_path="$1"
  echo "$import_path" | sed 's|^@/||' | sed 's|^\(registry\)/.*|registry|; s|^\([^/]*\)/.*|\1|; s|^\([^/]*\)$|\1|'
}

# ---------------------------------------------------------------------------
# Scan and check
# ---------------------------------------------------------------------------
VIOLATIONS=0
VIOLATION_LINES=""
CHECKED=0
NEW_EDGES=""

while IFS= read -r file; do
  [ -z "$file" ] && continue
  [ ! -f "$file" ] && continue

  src_layer=$(get_layer "$file")

  # Skip unknown layers
  if [ "$src_layer" = "unknown" ]; then
    continue
  fi

  # Extract all @/lib/ imports from this file
  import_targets=$(grep -oE 'from\s+"@/(core|gateway|engines|cognitive|presenter|services|plugins|registry|lib)/[^"]+"|from\s+'\''@/(core|gateway|engines|cognitive|presenter|services|plugins|registry|lib)/[^'\'']+'\''' "$file" 2>/dev/null \
    | grep -oE '@/(core|gateway|engines|cognitive|presenter|services|plugins|registry|lib)/[^"'\'']+' || true)

  while IFS= read -r target; do
    [ -z "$target" ] && continue
    CHECKED=$((CHECKED + 1))

    target_layer=$(get_target_layer "$target")

    # Self-import: same layer importing itself → always OK
    if [ "$src_layer" = "$target_layer" ]; then
      continue
    fi

    # Check if this edge is in the allowed list
    edge="${src_layer}:${target_layer}"
    if grep -qxF "$edge" "$ALLOWED_EDGES_FILE"; then
      continue
    fi

    # This is a violation
    VIOLATIONS=$((VIOLATIONS + 1))
    line_info=$(grep -n "$target" "$file" 2>/dev/null | head -1 | cut -d: -f1)
    VIOLATION_LINES="${VIOLATION_LINES}  ${RED}VIOLATION${NC}  ${file}:${line_info}
    ${src_layer} -> ${target_layer}  (import: ${target})
"

  done <<< "$import_targets"

done <<< "$FILES"

# ---------------------------------------------------------------------------
# Task 3: Detect NEW edges not in dependency-graph.json
# Scan all imports and find edges that exist but are not declared
# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------
# Known Mistake Enforcement (Rule 100 — Core Learning Policy, registry/existence.json
# known_mistakes.confirmed_duplicate_pairs). Single source of truth read here, not
# hardcoded — the same list scripts/build-arch-book.ts and scripts/sync-registry.ts read.
# Unlike Guard 9's general basename heuristic (WARN only), these are evidence-confirmed
# pairs: if the deprecated side gains a new real importer, REJECT.
# ---------------------------------------------------------------------------
echo -e "${CYAN}--- Known Duplicate Enforcement (Rule 100 / KM-002) ---${NC}"
KM_VIOLATIONS=0
# Process substitution (`< <(...)`) needs /dev/fd, which Vercel's build
# container doesn't provide ("/dev/fd/63: No such file or directory") — a
# real, environment-specific portability gap (owner, 2026-07-18), not caused
# by the earlier jq removal (jq's own missing-binary check simply exited
# before ever reaching this line). A plain temp file works everywhere.
DUP_PAIRS_FILE="$(mktemp)"
rq dup-pairs-tsv "$PROJECT_DIR/registry/existence.json" > "$DUP_PAIRS_FILE" 2>/dev/null || true
while IFS=$'\t' read -r deprecated_path keep_path reason; do
  [ -z "$deprecated_path" ] && continue
  while IFS= read -r file; do
    [ -z "$file" ] && continue
    [ ! -f "$file" ] && continue
    [ "$file" = "$deprecated_path" ] && continue
    if grep -qE "from\s+['\"]@/${deprecated_path%.ts}['\"]|from\s+['\"]@/${deprecated_path%.tsx}['\"]" "$file" 2>/dev/null; then
      KM_VIOLATIONS=$((KM_VIOLATIONS + 1))
      echo -e "  ${RED}WARNING: Dependency รูปแบบนี้เคยทำให้เกิด duplicate module (KM-002)${NC}"
      echo -e "  ${file} imports the DEPRECATED module ${deprecated_path}"
      echo -e "  Registry เดิมมีอยู่แล้ว: ${keep_path} — ${reason}"
    fi
  done <<< "$FILES"
done < "$DUP_PAIRS_FILE"
rm -f "$DUP_PAIRS_FILE" 2>/dev/null || true

if [ "$KM_VIOLATIONS" -gt 0 ]; then
  echo ""
  echo -e "${RED}=== $KM_VIOLATIONS KNOWN-DUPLICATE VIOLATION(S) FOUND (Rule 100) ===${NC}"
  echo -e "${RED}Fix: import the 'keep' module instead, or if un-deprecating on purpose, update registry/existence.json confirmed_duplicate_pairs and module-registry.json's deprecated field together.${NC}"
  exit 1
fi

echo -e "${CYAN}--- New Edge Detection ---${NC}"

ALL_EDGES_FILE="$(mktemp)"
trap 'rm -f "$ALLOWED_EDGES_FILE" "$ALL_EDGES_FILE"' EXIT

# Collect all actual cross-layer edges
while IFS= read -r file; do
  [ -z "$file" ] && continue
  [ ! -f "$file" ] && continue

  src_layer=$(get_layer "$file")
  [ "$src_layer" = "unknown" ] && continue

  import_targets=$(grep -oE 'from\s+"@/(core|gateway|engines|cognitive|presenter|services|plugins|registry|lib)/[^"]+"|from\s+'\''@/(core|gateway|engines|cognitive|presenter|services|plugins|registry|lib)/[^'\'']+'\''' "$file" 2>/dev/null \
    | grep -oE '@/(core|gateway|engines|cognitive|presenter|services|plugins|registry|lib)/[^"'\'']+' || true)

  while IFS= read -r target; do
    [ -z "$target" ] && continue
    target_layer=$(get_target_layer "$target")
    if [ "$src_layer" != "$target_layer" ]; then
      echo "${src_layer}:${target_layer}" >> "$ALL_EDGES_FILE"
    fi
  done <<< "$import_targets"

done <<< "$FILES"

# Deduplicate actual edges
UNIQUE_EDGES=$(sort -u "$ALL_EDGES_FILE" 2>/dev/null || true)
NEW_EDGE_COUNT=0

if [ -n "$UNIQUE_EDGES" ]; then
  while IFS= read -r edge; do
    [ -z "$edge" ] && continue
    if ! grep -qxF "$edge" "$ALLOWED_EDGES_FILE"; then
      NEW_EDGE_COUNT=$((NEW_EDGE_COUNT + 1))
      src=$(echo "$edge" | cut -d: -f1)
      tgt=$(echo "$edge" | cut -d: -f2)
      echo -e "  ${YELLOW}NEW EDGE${NC}  ${src} -> ${tgt}  (not in dependency-graph.json)"
    fi
  done <<< "$UNIQUE_EDGES"
fi

if [ "$NEW_EDGE_COUNT" -eq 0 ]; then
  echo -e "  ${GREEN}No new edges detected — all imports match the declared graph.${NC}"
fi

# ---------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------
echo ""
echo "--- Summary ---"
echo "  Files scanned:     $(echo "$FILES" | grep -c . || echo 0)"
echo "  Imports checked:   $CHECKED"
echo "  Allowed edges:     $(wc -l < "$ALLOWED_EDGES_FILE" | tr -d ' ')"

if [ "$VIOLATIONS" -gt 0 ]; then
  echo ""
  echo -e "${RED}=== $VIOLATIONS DEPENDENCY VIOLATION(S) FOUND ===${NC}"
  echo ""
  echo -e "$VIOLATION_LINES"
  echo ""
  echo -e "${RED}Fix: either remove the import or add the edge to registry/dependency-graph.json${NC}"
  exit 1
fi

if [ "$NEW_EDGE_COUNT" -gt 0 ]; then
  echo ""
  echo -e "${YELLOW}WARNING: $NEW_EDGE_COUNT undeclared edge(s) found.${NC}"
  echo -e "${YELLOW}Add them to dependency-graph.json or remove the imports.${NC}"
  exit 1
fi

echo ""
echo -e "${GREEN}All imports follow the dependency graph.${NC}"
exit 0
