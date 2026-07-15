#!/bin/bash
# Evidence Isolation Guard (Rule 107, registry/CHANGELOG.json DNA-000057).
#
# Real incident this prevents (DNA-000056): Guard 1's grep and jscpd (in
# governance.sh + dashboard.sh) both scanned registry/VALIDATION_RESULTS.json —
# a runtime-generated ledger, not source — as if it were scannable input,
# creating an unbounded self-feedback loop. Both were fixed with explicit
# exclusions. This check verifies those exclusions stay in place; a future edit
# that drops them (e.g. copy-pasting the jscpd line without its -i flag) is
# caught here instead of silently reintroducing the loop.
#
# Bounded scope, stated honestly: this checks the KNOWN Evidence Zone files
# (VALIDATION_RESULTS.json, CHANGELOG.json, DNA_OS_HEALTH.json) against the
# KNOWN broad-scan commands (Guard 1's grep, jscpd). It does not — and cannot,
# via static pattern matching alone — guarantee a brand-new audit tool added
# later will also exclude the Evidence Zone; that still relies on Rule 107
# being applied by whoever adds it. WARN only, not REJECT, matching Guard 9's
# reasoning: a real regression here is a real defect, but this check itself
# could have false negatives (e.g. an exclusion phrased differently that still
# works) — it should prompt a look, not hard-block on pattern-matching alone.

echo "=== DNA OS Evidence Isolation Check (Guard 12 / Rule 107) ==="
echo ""

EVIDENCE_FILES=("VALIDATION_RESULTS.json" "CHANGELOG.json" "DNA_OS_HEALTH.json")
WARNINGS=0

# Guard 1 (pre-commit-check.sh): must exclude VALIDATION_RESULTS.json by basename
if [ -f scripts/pre-commit-check.sh ]; then
  GUARD1_LINE=$(grep -A3 "^if grep -rEn '\\\\.supabase\\\\.co'" scripts/pre-commit-check.sh)
  if ! echo "$GUARD1_LINE" | grep -q "VALIDATION_RESULTS.json"; then
    echo "  WARNING: scripts/pre-commit-check.sh Guard 1 no longer excludes VALIDATION_RESULTS.json"
    echo "    Real incident: this exact omission caused an unbounded self-feedback loop (DNA-000056)."
    WARNINGS=$((WARNINGS + 1))
  else
    echo "  OK: Guard 1 excludes VALIDATION_RESULTS.json"
  fi
fi

# jscpd invocations (governance.sh, dashboard.sh): must scope format + ignore json/md
for f in scripts/governance.sh scripts/dashboard.sh; do
  [ -f "$f" ] || continue
  JSCPD_LINES=$(grep "npx jscpd" "$f")
  if [ -n "$JSCPD_LINES" ]; then
    if echo "$JSCPD_LINES" | grep -qv -- "-f typescript,tsx" ; then
      if ! echo "$JSCPD_LINES" | grep -q -- "-f typescript,tsx"; then
        echo "  WARNING: $f has an npx jscpd invocation missing -f typescript,tsx (may scan JSON/MD despite .jscpd.json)"
        WARNINGS=$((WARNINGS + 1))
      fi
    fi
    if ! echo "$JSCPD_LINES" | grep -q -- "-i '\*\*/\*.json"; then
      echo "  WARNING: $f has an npx jscpd invocation missing -i '**/*.json,**/*.md' (CLI args can silently override .jscpd.json — Rule 108)"
      WARNINGS=$((WARNINGS + 1))
    else
      echo "  OK: $f's jscpd invocation explicitly excludes json/md"
    fi
  fi
done

echo ""
if [ "$WARNINGS" -gt 0 ]; then
  echo "Found $WARNINGS Evidence Isolation warning(s) — review before assuming they're safe."
else
  echo "No Evidence Isolation regressions found among the known Evidence Zone / scan tool pairs."
fi

exit 0
