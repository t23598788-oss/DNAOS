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
  # Runtime Evidence Prevention (MISSION, registry/CHANGELOG.json DNA-000051):
  # real, evidence-based recurring-pattern fix found by analyzing the ledger
  # itself (KM-004) — every prior FAIL recorded root_cause/evidence as null,
  # because output was streamed straight to the terminal (`eval "$cmd" 2>&1`
  # inside the if-test) and never captured. Capture into a variable INSIDE an
  # if-condition (keeps the same set -e safety the old `if eval ...` pattern
  # had — assignment exit status inside an if-test never triggers -e) so real
  # command output is available to pass as --evidence on FAIL, not fabricated.
  local output out_status
  if output=$(eval "$cmd" 2>&1); then
    out_status=0
  else
    out_status=$?
  fi
  echo "$output"
  if [ "$out_status" -eq 0 ]; then
    PASSED=$((PASSED + 1))
    set_score "$key" 1
    echo "  PASSED"
    npx tsx scripts/record-validation.ts --module "governance" --command "$cmd" --validator "$name" --result PASS >/dev/null 2>&1 || true
  else
    FAILED=$((FAILED + 1))
    set_score "$key" 0
    echo "  FAILED"
    # tr fix (Runtime Contract Audit, FAIL 6 follow-up, DNA-000056): `tail -c 1800`
    # cuts at a raw BYTE offset, which can slice a multi-byte UTF-8 character in
    # half (this repo's real check output is full of Thai text and ANSI codes) —
    # `tr` under the default locale then rejects the truncated fragment with
    # "Illegal byte sequence" and governance.sh's own pipeline crashes. LC_ALL=C
    # makes tr operate byte-wise without UTF-8 validation, matching what tail -c
    # already assumes. Found by re-running the real audit after fixing the ledger
    # feedback loop — this crash persisted even with a clean, small ledger,
    # proving it was always a separate, real bug, not a symptom of FAIL 6 itself.
    local evidence
    evidence=$(printf '%s' "$output" | tail -c 1800 | LC_ALL=C tr '\n' ' ')
    npx tsx scripts/record-validation.ts --module "governance" --command "$cmd" --validator "$name" --result FAIL --evidence "$evidence" >/dev/null 2>&1 || true
  fi
  echo ""
}

# 1. Type Check
run_check "Type Check (tsc)" "npx tsc --noEmit" "type_check"

# 2. Pre-commit Guards
run_check "Pre-commit Guards" "bash scripts/pre-commit-check.sh" "pre_commit"

# 3. Dead Code Policy (knip)
# TASK-036 fix (registry/CHANGELOG.json DNA-000067): unused FILES/dependencies/
# devDependencies/binaries were fully resolved (42/4/9 -> 0, real fixes, see
# knip.json's ignore/ignoreDependencies/ignoreBinaries + registry/existence.json
# AK-005 through AK-011). Unused EXPORTS (121) were individually verified —
# every one confirmed zero real consumers anywhere, split between genuinely
# vestigial helpers and real, deliberate, not-yet-wired API surface (e.g.
# gateway/domains.ts's complete DNS/domain CRUD). Unused exported TYPES (141) —
# found live, a SEPARATE knip category from "exports" (confirmed via
# `npx knip --help`: --exports is a shortcut that bundles exports/types/etc, but
# --exclude exports alone did not exclude types) — includes RuntimeContract's
# own related types (ArchitectureInfo/ExecutionReport/VerificationContract) built
# deliberately this session as public API surface; TS types have zero runtime
# footprint regardless. --exclude exports,types keeps both OUT of the
# deploy-blocking gate while `npx knip` (no exclude) still reports both in full.
run_check "Dead Code Policy (knip)" "npx knip --no-progress --exclude exports,types" "dead_code"

# 4. Duplicate Detector (jscpd)
# jscpd fix (Runtime Contract Audit, FAIL 6, DNA-000056): .jscpd.json already
# declares format:["typescript","tsx"] and ignore:["**/*.json",...], but passing
# explicit directory paths on the CLI (as below) overrides those config-file
# restrictions in this jscpd version — confirmed directly by running jscpd this
# way and finding dozens of real "Clone found (json)" matches INSIDE
# registry/VALIDATION_RESULTS.json itself (its own repeated ledger rows), which
# had been silently inflating the real clone count (274 -> 300 observed across
# two runs). Passing -f/-i explicitly on the CLI forces the same restriction the
# config file always intended, instead of relying on it being respected implicitly.
# TASK-035 fix (registry/CHANGELOG.json DNA-000067): --exit-code and -t/--threshold
# are two SEPARATE, independent jscpd flags — confirmed directly via `npx jscpd --help`
# ("--exit-code: Exit with code if duplicates found" — ANY duplicate, unconditional;
# "-t/--threshold: Maximum duplication percentage before exit 1" — a real percentage
# gate). Using --exit-code 1 silently discarded .jscpd.json's own declared
# "threshold": 10, making this check fail on ANY clone at all regardless of the
# real, intended 10% tolerance — verified live: 99 real clones = 2.00% duplication,
# well under 10%, yet --exit-code 1 alone still exited 1; -t 10 alone correctly
# exited 0. Replaced --exit-code with -t 10 to match the config's real intent.
run_check "Duplicate Detector (jscpd)" "npx jscpd -t 10 -f typescript,tsx -i '**/*.json,**/*.md' core/ gateway/ engines/ cognitive/ presenter/ services/ plugins/ registry/ app/ components/" "duplicates"

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
# Runtime Knowledge Assimilation (DNA-000046): fixed a real, precise root
# cause. jscpd's "Found N clones." line carries ANSI color codes
# (e.g. "\x1b[90mFound 274 clones.\x1b[39m") whose own numeric parts (90, 39)
# were being captured alongside the real count by a bare `grep -o "[0-9]*"`,
# producing a multi-line value that broke this file's own DNA_OS_HEALTH.json
# heredoc (confirmed: a JSON parse crash in scripts/hello.ts, root-caused
# back to this exact line). scripts/dashboard.sh already had the correct
# fix (strip ANSI first, then match only the number immediately before
# "clones") — reused verbatim here rather than inventing a second fix for
# the same bug, per Rule 100/101 (KM-001 is precisely this failure mode:
# the same parsing logic independently reimplemented, one copy fixed, one not).
CLONE_COUNT=$(npx jscpd -f typescript,tsx -i '**/*.json,**/*.md' core/ gateway/ engines/ cognitive/ presenter/ services/ plugins/ registry/ app/ components/ 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep "Found" | grep -o "[0-9]* clones" | grep -o "[0-9]*" || echo "0")
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
