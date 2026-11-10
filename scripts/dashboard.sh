#!/bin/bash

# DNA OS Evolution Dashboard + Risk Score
# ผู้บริหารเปิดมาก็รู้ทันทีว่าระบบสุขภาพดีแค่ไหน

# ── Helpers ──

bar() {
  local pct=$1
  local width=20
  local filled=$(( pct * width / 100 ))
  local empty=$(( width - filled ))
  local bar=""
  for ((i=0; i<filled; i++)); do bar="${bar}#"; done
  for ((i=0; i<empty; i++)); do bar="${bar}-"; done
  printf "[%s] %3d%%" "$bar" "$pct"
}

risk_level() {
  local score=$1
  if [ "$score" -le 2 ]; then echo "Low"
  elif [ "$score" -le 5 ]; then echo "Medium"
  elif [ "$score" -le 10 ]; then echo "High"
  else echo "Critical"
  fi
}

# ── Collect Metrics (silently) ──

# Constitution
# Evidence-First Automation (registry/EXECUTION_CONTRACT.json, DNA-000041) — computed, not hardcoded; see scripts/check-rule-coverage.sh for why.
RULE_TOTAL=$(node -e "const r=require('./registry/rule-coverage.json'); console.log(Object.keys(r.rules).length + r.uncovered_rules.length)")
RULE_ENFORCED=$(grep -c '"enforced_by"' registry/rule-coverage.json 2>/dev/null || echo "0")
RULE_PCT=$(( RULE_ENFORCED * 100 / RULE_TOTAL ))

# Workflow
WF_TOTAL=$(grep -cE '^\s*"[a-z].*"steps"' registry/commands/workflows.json 2>/dev/null || echo "0")
WF_INCOMPLETE=$(bash scripts/check-workflow-coverage.sh 2>/dev/null | grep "Incomplete:" | grep -o "[0-9]*" || echo "0")
WF_COMPLETE=$(( WF_TOTAL - WF_INCOMPLETE ))
WF_PCT=$(( WF_TOTAL > 0 ? WF_COMPLETE * 100 / WF_TOTAL : 0 ))

# Business
BIZ_TOTAL=$(grep -c '"status"' registry/business-coverage.json 2>/dev/null || echo "0")
BIZ_COVERED=$(grep -c '"covered"' registry/business-coverage.json 2>/dev/null || echo "0")
BIZ_PARTIAL=$(grep -c '"partial"' registry/business-coverage.json 2>/dev/null || echo "0")
BIZ_GAPS=$(grep -c '"not_covered"' registry/business-coverage.json 2>/dev/null || echo "0")
BIZ_PCT=$(( BIZ_TOTAL > 0 ? (BIZ_COVERED * 100 + BIZ_PARTIAL * 50) / BIZ_TOTAL : 0 ))

# Documents
DOC_TYPES=$(grep -c '"document_type"' registry/command-registry.json 2>/dev/null || echo "6")
DOC_ENGINE=$([ -f "engines/documents/engine.ts" ] && echo "100" || echo "0")

# Registry
REG_MODULES=$(grep -c '"owner"' registry/module-registry.json 2>/dev/null || echo "0")
REG_COMMANDS=$(grep -c '"owner"' registry/command-registry.json 2>/dev/null || echo "0")
REG_PCT=$(( (REG_MODULES > 0 && REG_COMMANDS > 0) ? 100 : 50 ))

# Governance (scripts count)
GOV_SCRIPTS=0
for s in pre-commit-check check-registry check-commands check-imports check-drift check-ghosts check-rule-coverage check-workflow-coverage check-business-coverage; do
  [ -f "scripts/${s}.sh" ] && GOV_SCRIPTS=$((GOV_SCRIPTS + 1))
done
GOV_PCT=$(( GOV_SCRIPTS * 100 / 9 ))

# Type check
TYPE_ERRORS=$(npx tsc --noEmit 2>&1 | grep -c "error TS" || true)
TYPE_ERRORS=${TYPE_ERRORS:-0}
TYPE_OK=$(( TYPE_ERRORS == 0 ? 1 : 0 ))

# Shadow system
SHADOW=$(bash scripts/check-registry.sh 2>&1 | grep -c "UNREGISTERED" || true)
SHADOW=${SHADOW:-0}

# Duplicates
# jscpd fix (Runtime Contract Audit, FAIL 6, DNA-000056): explicit -f/-i now
# forces the same typescript/tsx-only, ignore-json/md restriction .jscpd.json
# already declares — CLI positional dir args were silently overriding that
# config file, letting jscpd scan registry/VALIDATION_RESULTS.json's own JSON
# content and inflate the real clone count. Same fix applied identically in
# scripts/governance.sh (both copies of this exact command, per KM-001).
CLONE_COUNT=$(npx jscpd -f typescript,tsx -i '**/*.json,**/*.md' core/ gateway/ engines/ cognitive/ presenter/ services/ plugins/ registry/ app/ components/ 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep "Found" | grep -o "[0-9]* clones" | grep -o "[0-9]*" || echo "0")
CLONE_COUNT=${CLONE_COUNT:-0}

# Ghost rules
GHOST_COUNT=$(bash scripts/check-ghosts.sh 2>&1 | grep -c "GHOST" || true)
GHOST_COUNT=${GHOST_COUNT:-0}

# Dead code
UNUSED_RAW=$(npx knip --no-progress 2>&1 | grep "^Unused files" | head -1)
UNUSED_FILES=$(echo "$UNUSED_RAW" | grep -o "[0-9]*" | head -1 || true)
UNUSED_FILES=${UNUSED_FILES:-0}

# ── Risk Score ──
RISK=0
RISK=$((RISK + SHADOW))
RISK=$((RISK + (CLONE_COUNT > 3 ? 1 : 0) ))
RISK=$((RISK + BIZ_GAPS))
RISK=$((RISK + (TYPE_OK == 0 ? 3 : 0) ))
RISK=$((RISK + (GHOST_COUNT > 10 ? 1 : 0) ))
RISK_LABEL=$(risk_level $RISK)

# ── Print Dashboard ──

echo ""
echo "  ╔═══════════════════════════════════════════════════╗"
echo "  ║            DNA OS Evolution Dashboard             ║"
echo "  ║         Operating System Governance Report        ║"
echo "  ╠═══════════════════════════════════════════════════╣"
echo "  ║                                                   ║"
printf "  ║  Constitution   %s  ║\n" "$(bar $RULE_PCT)"
printf "  ║  Workflow        %s  ║\n" "$(bar $WF_PCT)"
printf "  ║  Business        %s  ║\n" "$(bar $BIZ_PCT)"
printf "  ║  Documents       %s  ║\n" "$(bar $DOC_ENGINE)"
printf "  ║  Registry        %s  ║\n" "$(bar $REG_PCT)"
printf "  ║  Governance      %s  ║\n" "$(bar $GOV_PCT)"
echo "  ║                                                   ║"
echo "  ╠═══════════════════════════════════════════════════╣"
echo "  ║                  Risk Assessment                  ║"
echo "  ╠═══════════════════════════════════════════════════╣"
echo "  ║                                                   ║"
printf "  ║  Shadow System        %-4d                        ║\n" "$SHADOW"
printf "  ║  Duplicate Logic      %-4d                        ║\n" "$CLONE_COUNT"
printf "  ║  Ghost Rules          %-4d                        ║\n" "$GHOST_COUNT"
printf "  ║  Dead Code Files      %-4d                        ║\n" "$UNUSED_FILES"
printf "  ║  Business Gaps        %-4d                        ║\n" "$BIZ_GAPS"
printf "  ║  Type Errors          %-4d                        ║\n" "$TYPE_ERRORS"
echo "  ║                                                   ║"
printf "  ║  Overall Risk:        %-10s                  ║\n" "$RISK_LABEL"
echo "  ║                                                   ║"
echo "  ╠═══════════════════════════════════════════════════╣"
echo "  ║                   Key Metrics                     ║"
echo "  ╠═══════════════════════════════════════════════════╣"
echo "  ║                                                   ║"
printf "  ║  Modules Registered    %-4d                       ║\n" "$REG_MODULES"
printf "  ║  Commands Registered   %-4d                       ║\n" "$REG_COMMANDS"
printf "  ║  Rules Enforced        %-4d / %-4d                ║\n" "$RULE_ENFORCED" "$RULE_TOTAL"
printf "  ║  Workflows Complete    %-4d / %-4d                ║\n" "$WF_COMPLETE" "$WF_TOTAL"
printf "  ║  Business Domains      %-4d / %-4d                ║\n" "$BIZ_COVERED" "$BIZ_TOTAL"
echo "  ║                                                   ║"
echo "  ╚═══════════════════════════════════════════════════╝"
echo ""
echo "  Generated: $(date '+%Y-%m-%d %H:%M:%S')"
echo ""

# ── Generate JSON ──
# TASK-051/FCR-012 fix (2026-08-10): this used to write DNA_OS_HEALTH.json,
# the SAME file scripts/governance.sh writes with a genuinely different,
# incompatible schema (checks/summary/governance_score vs this script's
# evolution/risk/metrics) — whichever script ran last silently clobbered the
# other's readers, producing 4 real TS2339 errors on app/OperationalWorkspace.tsx
# (a compile-time `import systemHealth from '@/DNA_OS_HEALTH.json'`, so tsc's
# inferred type depended on which script wrote last). Real investigation found
# load-bearing, still-current consumers of BOTH shapes at once (governance.sh's
# shape: app/OperationalWorkspace.tsx, app/api/admin/workspace/status/route.ts,
# scripts/deploy-gate.ts — the actual deploy-blocking gate; this script's shape:
# scripts/hello.ts's HEALTH section) — two genuinely different purposes (a
# pass/fail CI gate vs an executive evolution/risk report), not one dataset
# duplicated, so a separate file is correct rather than forcing a merged schema.
cat > DNA_OS_DASHBOARD.json << EOF
{
  "generated_at": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "evolution": {
    "constitution_pct": $RULE_PCT,
    "workflow_pct": $WF_PCT,
    "business_pct": $BIZ_PCT,
    "documents_pct": $DOC_ENGINE,
    "registry_pct": $REG_PCT,
    "governance_pct": $GOV_PCT
  },
  "risk": {
    "shadow_system": $SHADOW,
    "duplicate_logic": $CLONE_COUNT,
    "ghost_rules": $GHOST_COUNT,
    "dead_code_files": $UNUSED_FILES,
    "business_gaps": $BIZ_GAPS,
    "type_errors": $TYPE_ERRORS,
    "overall": "$RISK_LABEL",
    "score": $RISK
  },
  "metrics": {
    "modules_registered": $REG_MODULES,
    "commands_registered": $REG_COMMANDS,
    "rules_enforced": $RULE_ENFORCED,
    "rules_total": $RULE_TOTAL,
    "workflows_complete": $WF_COMPLETE,
    "workflows_total": $WF_TOTAL,
    "business_covered": $BIZ_COVERED,
    "business_total": $BIZ_TOTAL
  }
}
EOF
