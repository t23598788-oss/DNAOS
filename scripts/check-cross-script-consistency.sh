#!/bin/bash
# DNA OS Cross-Script Consistency Check
#
# Runtime Knowledge Expansion (MISSION, registry/CHANGELOG.json DNA-000047).
# Real, evidence-based Capability gap: the same KM-001 failure class (the
# same external-command output independently parsed by 2+ shell scripts,
# one copy fixed, one not) recurred 3 times this session (export-scanning
# logic DNA-000023, rule-total hardcoding DNA-000041, clone-count ANSI
# stripping DNA-000046) — clearing the mission's own item 10 threshold
# (pattern repeats > 3 times -> stop fixing ad hoc, build a Capability).
#
# Checked whether an EXISTING capability could already catch this before
# building anything (item 7/8, Rule 101/103): npx jscpd (the real Duplicate
# Detector already wired into scripts/governance.sh) is configured
# (.jscpd.json) to scan format:["typescript","tsx"] only — scripts/*.sh is
# structurally invisible to it. This is a real gap, not assumed.
#
# What this adds: for each known shared external command (npx jscpd, npx
# knip --no-progress — the 2 real, confirmed-shared commands found by
# grepping scripts/*.sh this session), find every real line in scripts/*.sh
# invoking it, and compare each line's POST-PIPE processing. If two
# invocations of the SAME base command process the output differently, WARN
# with both file:line locations — this is exactly the structural precondition
# that caused all 3 real bugs above, caught mechanically now instead of by
# accident during unrelated verification.
#
# WARN only (not REJECT): a real difference in post-processing might be
# intentional (different scripts genuinely need different fields from the
# same command's output) — same reasoning Guard 9 uses for its general
# heuristic. Connects into the existing scripts/governance.sh check chain,
# not a new standalone system.

echo "=== DNA OS Cross-Script Consistency Check ==="
echo ""

SHARED_COMMANDS=("npx jscpd" "npx knip --no-progress")
WARNINGS=0

for cmd in "${SHARED_COMMANDS[@]}"; do
  echo "--- Checking: $cmd ---"

  # Only genuine VALUE-EXTRACTION lines: a shell variable assignment
  # (VAR=$(...)) that pipes through `grep -o` to pull out a number/value.
  # Excludes unrelated usages of the same base command (e.g. governance.sh's
  # own run_check "..." "npx jscpd --exitCode 1 ..." line is a pass/fail exit
  # -code check, not a value extraction — comparing it against CLONE_COUNT's
  # pipeline was a false positive in this check's first version, found and
  # fixed by testing against real output before shipping, same discipline
  # as every guard built this session).
  MATCHES=$(grep -rnE '^[A-Z_]+=\$\(.*'"$cmd"'.*grep -o' scripts/*.sh 2>/dev/null | grep -v "^scripts/check-cross-script-consistency.sh")

  if [ -z "$MATCHES" ]; then
    echo "  (no value-extraction usages found)"
    continue
  fi

  # Group by which real field they target: the first grep pattern that isn't
  # itself the final `-o` numeric extraction (e.g. "Found", "^Unused files",
  # "^Unused exports") — two lines targeting DIFFERENT real fields (like
  # knip's "Unused files" vs "Unused exports") are correctly different, not
  # a bug; only lines targeting the SAME field are a real comparison pair.
  FIELD_KEYS=$(echo "$MATCHES" | grep -oE 'grep "[^"]+"' | grep -v '\[0-9\]' | sort -u)

  echo "$FIELD_KEYS" | while IFS= read -r field; do
    [ -z "$field" ] && continue
    FIELD_MATCHES=$(echo "$MATCHES" | grep -F "$field")
    FIELD_COUNT=$(echo "$FIELD_MATCHES" | grep -c . || true)
    [ "$FIELD_COUNT" -lt 2 ] && continue

    SUFFIXES=$(echo "$FIELD_MATCHES" | sed -E "s/^[^:]+:[0-9]+:.*${field}//" | sed 's/^ *//;s/ *$//' | sort -u)
    SUFFIX_COUNT=$(echo "$SUFFIXES" | grep -c . || true)

    if [ "$SUFFIX_COUNT" -gt 1 ]; then
      echo "  WARNING: field $field (same '$cmd' output) is extracted $SUFFIX_COUNT different ways:"
      echo "$FIELD_MATCHES" | sed 's/^/    /'
      echo "  Same command, same field, different extraction logic — exactly KM-001's recurring failure shape (DNA-000023/041/046). Verify all copies produce the same real value."
    fi
  done
  echo ""
done

# Re-run the loop's warning count outside the subshell (the `while` above ran
# in a pipe subshell, so WARNINGS itself can't be incremented inside it) —
# re-derive it the same way, once, for the real exit summary.
WARNINGS=0
for cmd in "${SHARED_COMMANDS[@]}"; do
  MATCHES=$(grep -rnE '^[A-Z_]+=\$\(.*'"$cmd"'.*grep -o' scripts/*.sh 2>/dev/null | grep -v "^scripts/check-cross-script-consistency.sh")
  [ -z "$MATCHES" ] && continue
  FIELD_KEYS=$(echo "$MATCHES" | grep -oE 'grep "[^"]+"' | grep -v '\[0-9\]' | sort -u)
  while IFS= read -r field; do
    [ -z "$field" ] && continue
    FIELD_MATCHES=$(echo "$MATCHES" | grep -F "$field")
    [ "$(echo "$FIELD_MATCHES" | grep -c .)" -lt 2 ] && continue
    SUFFIXES=$(echo "$FIELD_MATCHES" | sed -E "s/^[^:]+:[0-9]+:.*${field}//" | sed 's/^ *//;s/ *$//' | sort -u)
    [ "$(echo "$SUFFIXES" | grep -c .)" -gt 1 ] && WARNINGS=$((WARNINGS + 1))
  done <<< "$FIELD_KEYS"
done

if [ "$WARNINGS" -gt 0 ]; then
  echo "Found $WARNINGS shared-command inconsistenc(y/ies) — review before assuming they're intentional."
else
  echo "No cross-script inconsistencies found among tracked shared commands."
fi

exit 0
