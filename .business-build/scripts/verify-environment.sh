#!/bin/bash
# Environment Verification Before Audit (Rule 109, registry/CHANGELOG.json DNA-000057).
#
# Real incident this prevents (DNA-000056): this session's interactive shell had
# `grep` wrapped through a different tool (ugrep, via a Claude Code shell-snapshot
# function) with different --exclude semantics than the real /usr/bin/grep that
# scripts/pre-commit-check.sh actually runs under as a subprocess. A fix that
# tested correctly interactively did nothing when the real script ran — caught
# only by tracing with bash -x and testing the real binary directly. This script
# makes that check upfront and mechanical instead of accidental.
#
# WARN only, not REJECT: a wrapped tool is not necessarily wrong (many are
# transparent), but any audit result produced without knowing which binary
# actually ran is unverified, per Rule 109.

echo "=== DNA OS Environment Verification (Rule 109) ==="
echo ""

TOOLS=("grep" "sed" "awk" "tail" "tr" "find")
WARNED=0

for tool in "${TOOLS[@]}"; do
  TYPE_OUTPUT=$(type "$tool" 2>&1)
  if echo "$TYPE_OUTPUT" | grep -q "is a function\|is aliased to"; then
    echo "  WARNING: '$tool' is NOT a plain binary in this shell — $TYPE_OUTPUT" | head -1
    echo "    Audit results produced via THIS interactive shell may not match what a real"
    echo "    subprocess (bash script.sh, CI, Vercel) actually does. Verify against the"
    echo "    real binary directly (e.g. /usr/bin/$tool) before trusting a fix."
    WARNED=$((WARNED + 1))
  else
    REAL_PATH=$(command -v "$tool" 2>/dev/null || echo "NOT FOUND")
    echo "  OK: $tool -> $REAL_PATH"
  fi
done

echo ""
if [ "$WARNED" -gt 0 ]; then
  echo "$WARNED tool(s) are wrapped in this shell — see warnings above."
else
  echo "All checked tools resolve to real binaries."
fi

exit 0
