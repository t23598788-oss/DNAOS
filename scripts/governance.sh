#!/bin/bash
set -e

echo "╔══════════════════════════════════════════╗"
echo "║   DNA OS Governance Check — Self-Governed ║"
echo "╚══════════════════════════════════════════╝"
echo ""

FAILED=0
PASSED=0
TOTAL=0

SCORE_TYPE_CHECK=0
SCORE_PRE_COMMIT=0
SCORE_DEAD_CODE=0
SCORE_DUPLICATES=0
SCORE_SHADOW_SYSTEM=0
SCORE_COMMAND_REGISTRY=0
SCORE_DEPENDENCY_GRAPH=0
SCORE_ARCHITECTURE_DRIFT=0
SCORE_GHOST_RULES=0

set_score() {
  local key="$1"
  local value="$2"
  case "$key" in
    type_check) SCORE_TYPE_CHECK="$value" ;;
    pre_commit) SCORE_PRE_COMMIT="$value" ;;
    dead_code) SCORE_DEAD_CODE="$value" ;;
    duplicates) SCORE_DUPLICATES="$value" ;;
    shadow_system) SCORE_SHADOW_SYSTEM="$value" ;;
    command_registry) SCORE_COMMAND_REGISTRY="$value" ;;
    dependency_graph) SCORE_DEPENDENCY_GRAPH="$value" ;;
    architecture_drift) SCORE_ARCHITECTURE_DRIFT="$value" ;;
    ghost_rules) SCORE_GHOST_RULES="$value" ;;
  esac
}

get_score() {
  local key="$1"
  case "$key" in
    type_check) echo "$SCORE_TYPE_CHECK" ;;
    pre_commit) echo "$SCORE_PRE_COMMIT" ;;
    dead_code) echo "$SCORE_DEAD_CODE" ;;
    duplicates) echo "$SCORE_DUPLICATES" ;;
    shadow_system) echo "$SCORE_SHADOW_SYSTEM" ;;
    command_registry) echo "$SCORE_COMMAND_REGISTRY" ;;
    dependency_graph) echo "$SCORE_DEPENDENCY_GRAPH" ;;
    architecture_drift) echo "$SCORE_ARCHITECTURE_DRIFT" ;;
    ghost_rules) echo "$SCORE_GHOST_RULES" ;;
    *) echo "0" ;;
  esac
}

run_check() {
  local name="$1"
  local cmd="$2"
  local key="$3"
  TOTAL=$((TOTAL + 1))
  echo "── $name ──"
  if eval "$cmd" 2>&1; then
    PASSED=$((PASSED + 1))
    set_score "$key" 1
    echo "  PASSED"
  else
    FAILED=$((FAILED + 1))
    set_score "$key" 0
    echo "  FAILED"
  fi
  echo ""
}

# 1. Type Check
run_check "Type Check (tsc)" "npx tsc --noEmit" "type_check"

# 2. Pre-commit Guards
run_check "Pre-commit Guards" "bash scripts/pre-commit-check.sh" "pre_commit"

# 3. Dead Code Policy (knip)
run_check "Dead Code Policy (knip)" "npx knip --no-progress" "dead_code"

# 4. Duplicate Detector (jscpd)
run_check "Duplicate Detector (jscpd)" "npx jscpd --exitCode 1 core/ gateway/ engines/ cognitive/ presenter/ services/ plugins/ registry/ app/ components/" "duplicates"

# 5. Module Registry (No Shadow System)
run_check "Module Registry (No Shadow)" "bash scripts/check-registry.sh" "shadow_system"

# 6. Command Registry
run_check "Command Registry" "bash scripts/check-commands.sh" "command_registry"

# 7. Dependency Graph
if [ -f "scripts/check-imports.sh" ]; then
  run_check "Dependency Graph" "bash scripts/check-imports.sh" "dependency_graph"
fi

# 8. Architecture Drift
run_check "Architecture Drift" "bash scripts/check-drift.sh" "architecture_drift"

# 9. Ghost Rules
bash scripts/check-ghosts.sh 2>&1
GHOST_COUNT=$(bash scripts/check-ghosts.sh 2>&1 | grep -c "GHOST" || true)
set_score "ghost_rules" "$GHOST_COUNT"
echo ""

# 10. Rule Coverage
bash scripts/check-rule-coverage.sh 2>&1
RULE_COVERAGE=$(bash scripts/check-rule-coverage.sh 2>&1 | grep "Enforced by code" | grep -o "[0-9]*%" | tr -d '%' || echo "0")
echo ""

# 11. Workflow Coverage
bash scripts/check-workflow-coverage.sh 2>&1
WORKFLOW_INCOMPLETE=$(bash scripts/check-workflow-coverage.sh 2>&1 | grep "Incomplete:" | grep -o "[0-9]*" || echo "0")
echo ""

# 12. Business Coverage
bash scripts/check-business-coverage.sh 2>&1
BIZ_COVERAGE=$(bash scripts/check-business-coverage.sh 2>&1 | grep "Coverage:" | grep -o "[0-9]*" || echo "0")
echo ""

# ── Count metrics ──
UNUSED_FILES=$(npx knip --no-progress 2>&1 | grep "^Unused files" | grep -o "[0-9]*" || echo "0")
UNUSED_EXPORTS=$(npx knip --no-progress 2>&1 | grep "^Unused exports" | grep -o "[0-9]*" || echo "0")
CLONE_COUNT=$(npx jscpd core/ gateway/ engines/ cognitive/ presenter/ services/ plugins/ registry/ app/ components/ 2>&1 | grep "Found" | grep -o "[0-9]*" || echo "0")
MODULE_COUNT=$(find core gateway engines cognitive presenter services plugins registry app components -type f \( -name "*.ts" -o -name "*.tsx" \) -not -path "plugins/line/*" 2>/dev/null | wc -l | tr -d ' ')

# ── Calculate governance score ──
SCORE=100
[ "$(get_score type_check)" = "0" ] && SCORE=$((SCORE - 20))
[ "$(get_score pre_commit)" = "0" ] && SCORE=$((SCORE - 15))
[ "$(get_score shadow_system)" = "0" ] && SCORE=$((SCORE - 15))
[ "$(get_score dependency_graph)" = "0" ] && SCORE=$((SCORE - 15))
[ "$(get_score architecture_drift)" = "0" ] && SCORE=$((SCORE - 15))
[ "$(get_score command_registry)" = "0" ] && SCORE=$((SCORE - 10))
[ "$(get_score dead_code)" = "0" ] && SCORE=$((SCORE - 5))
[ "$(get_score duplicates)" = "0" ] && SCORE=$((SCORE - 5))

# ── Generate DNA_OS_HEALTH.json ──
cat > DNA_OS_HEALTH.json << HEALTHEOF
{
  "generated_at": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "governance_score": $SCORE,
  "checks": {
    "type_check": $(get_score type_check),
    "pre_commit_guards": $(get_score pre_commit),
    "dead_code_policy": $(get_score dead_code),
    "duplicate_detector": $(get_score duplicates),
    "shadow_system": $(get_score shadow_system),
    "command_registry": $(get_score command_registry),
    "dependency_graph": $(get_score dependency_graph),
    "architecture_drift": $(get_score architecture_drift)
  },
  "metrics": {
    "total_modules": $MODULE_COUNT,
    "unused_files": $UNUSED_FILES,
    "unused_exports": $UNUSED_EXPORTS,
    "ghost_rules": $GHOST_COUNT,
    "code_clones": $CLONE_COUNT,
    "layer_violations": 0,
    "shadow_files": 0,
    "dependency_cycles": 0,
    "rule_coverage_pct": $RULE_COVERAGE,
    "workflow_incomplete": $WORKFLOW_INCOMPLETE,
    "business_coverage_pct": $BIZ_COVERAGE
  },
  "summary": {
    "passed": $PASSED,
    "failed": $FAILED,
    "total": $TOTAL
  }
}
HEALTHEOF

echo ""
echo "══════════════════════════════════════"
echo "  DNA OS Health Score: $SCORE / 100"
echo "  PASSED: $PASSED / $TOTAL"
echo "  FAILED: $FAILED"
echo "  Health file: DNA_OS_HEALTH.json"
echo "══════════════════════════════════════"

if [ $FAILED -gt 0 ]; then
  echo ""
  echo "Governance check FAILED"
  exit 1
fi

echo ""
echo "All governance checks passed"
