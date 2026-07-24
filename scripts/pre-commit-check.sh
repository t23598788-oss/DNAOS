#!/bin/bash
set -e

echo "=== DNA OS Pre-Commit Guard ==="

# Step 0: Sync Registry และสร้าง Architecture Book ก่อนทุกอย่าง
echo "--- Syncing Registry + Architecture Book ---"
npx tsx scripts/sync-registry.ts
npx tsx scripts/build-arch-book.ts
echo "Registry synced"

# Guard 0: Architecture health — ไม่ยอมรับ BROKEN หรือ UNUSED โมดูลใหม่
ARCH_BOOK="registry/architecture-book.json"
if [ -f "$ARCH_BOOK" ]; then
  BROKEN=$(node -e "const b=require('./$ARCH_BOOK'); console.log(b.summary.broken)")
  UNUSED=$(node -e "const b=require('./$ARCH_BOOK'); console.log(b.summary.unused)")
  if [ "$BROKEN" -gt 0 ]; then
    echo "ERROR: มี $BROKEN โมดูล BROKEN — รัน 'npm run arch' และแก้ไขก่อน commit"
    node -e "const b=require('./$ARCH_BOOK'); b.nodes.filter(n=>n.status==='BROKEN').forEach(n=>console.log('  BROKEN:',n.name_en,'|',n.error_th??''))"
    exit 1
  fi
  if [ "$UNUSED" -gt 0 ]; then
    echo "ERROR: มี $UNUSED โมดูล UNUSED — เพิ่ม declared_callers ใน module-registry.json หรือตั้ง entry_point: true"
    node -e "const b=require('./$ARCH_BOOK'); b.nodes.filter(n=>n.status==='UNUSED').forEach(n=>console.log('  UNUSED:',n.name_en))"
    exit 1
  fi
  echo "Architecture OK: ${BROKEN} broken, ${UNUSED} unused"
fi

# Guard 1: No Supabase credentials in source
# Fixed (Autonomous Runtime Evolution pass, DNA-000044): the old pattern
# "supabase.co" was an UNESCAPED basic regex — the bare "." matched ANY
# character, so it also matched "supabase/config.toml" and
# "supabase/functions/**" (real false positives in config/system-links.ts's
# legitimate env-var-built dashboard URLs and registry/CHANGELOG.json's own
# prose). It also matched as a plain substring of "supabase.com" (the public
# dashboard site), a second false-positive source. Now requires a literal,
# escaped ".supabase.co" substring (the real shape of a hardcoded Supabase
# project hostname, e.g. xxxxx.supabase.co) and explicitly excludes
# ".supabase.com". Verified this still catches the one REAL violation found
# during this same pass: registry/communication/line.registry.json's
# hardcoded "https://tmxkiripdvorrcnuezvm.supabase.co/..." — not fixed here,
# since fixing that data file wasn't in scope for a guard-precision fix, but
# the check now correctly flags it instead of being drowned out by noise.
# Guard 1 fix (Runtime Contract Audit, FAIL 6, DNA-000056): registry/VALIDATION_RESULTS.json
# is an append-only LEDGER of past validation --evidence strings, not source. Once
# this file legitimately contained a copy of THIS guard's own real "ERROR: Supabase
# URL hardcoded..." output (captured as real --evidence per DNA-000051), this grep
# started matching that ledger row too, feeding the match text back in as NEW
# evidence on the next governance.sh run — an unbounded self-feedback loop (44
# entries / 54KB and climbing, confirmed directly). Excluding it here breaks the
# loop at the source; the real underlying violation (line.registry.json) is still
# caught untouched.
# NOTE: --exclude matches the file's BASENAME only, not a full relative path —
# a first attempt using "registry/VALIDATION_RESULTS.json" (with the directory
# prefix) silently matched nothing under the real /usr/bin/grep this script
# actually runs with, and the bug appeared fixed only because this environment's
# interactive shell wraps `grep` through a different tool (ugrep, with different
# --exclude semantics) that is NOT what a real `bash scripts/pre-commit-check.sh`
# process uses. Verified against the real binary directly (bash -x trace +
# /usr/bin/grep), not just an interactive command, before trusting this fix.
if grep -rEn '\.supabase\.co' --include="*.ts" --include="*.tsx" --include="*.json" \
   --exclude-dir=node_modules --exclude-dir=.next \
   --exclude="supabase/.temp/*" --exclude="package*.json" \
   --exclude="VALIDATION_RESULTS.json" . 2>/dev/null \
   | grep -v '\.supabase\.com' | grep -v "process.env" | grep -v "NEXT_PUBLIC"; then
  echo "ERROR: Supabase URL hardcoded in source — use env var"
  exit 1
fi

# Guard 2: No mock/fake in engines
# Fixed (TASK-036 follow-up, registry/CHANGELOG.json DNA-000067): a real,
# pre-existing bug this deploy-blocking check had before this session ever
# touched it — hidden until now because Guard 1 always failed first. The bare
# pattern matched the words "mock"/"fake" ANYWHERE, including inside comments
# PROHIBITING mocking (e.g. "ไม่มี mock/fake" = "no mock/fake", "No mock/fake
# responses", "ห้าม mock" = "must not mock") — confirmed live: all 3 real
# matches in this repo today are exactly this false positive, zero real
# mock/fake code exists. Excludes comment-only lines (// or * after the
# file:line: prefix) so real mock/fake CODE is still caught, policy comments
# describing the rule are not.
if grep -rn "Mock\|mock\|fake\|Fake\|MOCK\|FAKE" --include="*.ts" engines/ 2>/dev/null | grep -vE '^[^:]+:[0-9]+: *(//|\*)'; then
  echo "ERROR: Mock/Fake data found in engines — Rule 94"
  exit 1
fi

# Guard 3: No direct supabase import in engines/cognitive/presenter/services-ai
for layer in engines/validation engines cognitive presenter services/ai; do
  if grep -rn "from.*@supabase/supabase-js" --include="*.ts" "$layer/" 2>/dev/null; then
    echo "ERROR: $layer imports @supabase/supabase-js directly — Rule 71"
    exit 1
  fi
done

# Guard 4: No duplicate type definitions
if grep -rn "export interface Command {" --include="*.ts" \
   --exclude-dir=node_modules --exclude-dir=.next . 2>/dev/null | grep -v "core/shared/types.ts" | grep -v "RuntimeCommand" | grep -v "BridgeCommand"; then
  echo "ERROR: Command type defined outside core/shared/types.ts"
  exit 1
fi

# Guard 5: types/command.ts must not exist
if [ -f "types/command.ts" ]; then
  echo "ERROR: types/command.ts exists — use core/shared/types.ts"
  exit 1
fi

# Guard 6: No duplicate lib/core/ or lib/drivers/*.ts (Core/drivers live at top-level core/, plugins/drivers/)
if [ -d "lib/core" ]; then
  echo "ERROR: lib/core/ exists — use core/"
  exit 1
fi
if find lib/drivers -maxdepth 1 -name "*.ts" 2>/dev/null | head -1 | grep -q .; then
  echo "ERROR: lib/drivers/*.ts exists — use plugins/drivers/"
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

# Guard 8: Connector Lifecycle Law (LOCKED 2026-07-07, registry/connector-lifecycle.json)
# Connect → Register → Test → Enable → Run — no exceptions, no skipped stages,
# no Core edits to support a new Connector
if [ -x "$SCRIPT_DIR/check-connector-lifecycle.sh" ]; then
  echo "--- Running Connector Lifecycle guard ---"
  if ! "$SCRIPT_DIR/check-connector-lifecycle.sh"; then
    echo "ERROR: Connector Lifecycle Law violation — see registry/connector-lifecycle.json"
    exit 1
  fi
fi

# Guard 9: Known Mistake Pattern Check (DNA OS Core Learning Policy, CONST-100,
# registry/existence.json known_mistakes.KM-002) — WARN only, does not block commit.
# A file basename that already exists under a different directory is a real, mechanical
# signal for "this responsibility may already be implemented elsewhere" — confirmed real
# case: plugins/drivers/line.ts vs plugins/line/line.ts (KM-002). False-positive-prone for
# generic/conventional names, so this stays advisory rather than a hard reject.
echo "--- Known Mistake Pattern Check (Guard 9 / KM-002) ---"
DUPES=$(find app components core engines gateway cognitive presenter services plugins registry scripts config \
  -type f \( -name "*.ts" -o -name "*.tsx" \) \
  ! -name "*.test.ts" ! -name "*.spec.ts" ! -name "*.d.ts" \
  ! -name "index.ts" ! -name "index.tsx" ! -name "route.ts" ! -name "page.tsx" \
  ! -name "layout.tsx" ! -name "loading.tsx" ! -name "types.ts" ! -name "engine.ts" \
  ! -name "_loader.ts" ! -name "_resolver.ts" ! -name "_schema.ts" ! -name "_validator.ts" \
  2>/dev/null | xargs -n1 basename | sort | uniq -d)
if [ -n "$DUPES" ]; then
  echo "$DUPES" | while read -r name; do
    [ -z "$name" ] && continue
    echo "WARNING: Module '$name' exists in more than one location (KM-002):"
    find app components core engines gateway cognitive presenter services plugins registry scripts config \
      -type f -name "$name" 2>/dev/null | sed 's/^/    /'
    echo "  Registry เดิมมีอยู่แล้ว — โปรดตรวจสอบว่าเป็น duplicate responsibility จริงหรือไม่ ก่อนสร้าง/แก้ไขต่อ"
  done
fi

# Guard 10: Archived Mistake Recreation Check (Rule 104, CONST-104, DNA-000037/038/039).
# Unlike Guard 9 (general basename heuristic across ALL source, WARN only —
# real false-positive rate for generic names like session.ts/timeline.ts),
# this checks ONLY basenames of files already confirmed ARCHIVED in
# module-registry.json (archival_status:"ARCHIVED"), each with a real,
# evidence-backed registry/existence.json#archived_knowledge entry explaining
# exactly why it stopped being used and what replaced it. A second file
# reappearing with that exact basename is a much stronger, curated signal
# than Guard 9's generic check, so this is a hard REJECT, not a warning —
# same reasoning that justified Rule 100/101's confirmed_duplicate_pairs
# hard-reject in scripts/check-imports.sh.
#
# Excludes the same conventional/repeated-by-design basenames Guard 9
# already excludes (index.ts, engine.ts, etc.) — verified by dry-run before
# shipping this guard: 2 of the 4 currently-archived files (engines/impact/
# engine.ts, core/auth/index.ts) have exactly this problem and would have
# hard-rejected the repo against its own real, unrelated, legitimate files
# (10+ real "engine.ts" files, 30+ real "index.ts" files) had this exclusion
# not been added. Those 2 archived entries remain fully real, documented,
# and searchable (npm run hello -- --archive) — just not eligible for THIS
# specific recreation check, since their basename alone isn't a reliable signal.
echo "--- Archived Mistake Recreation Check (Guard 10 / Rule 104) ---"
ARCHIVED_BASENAMES=$(node -e "
const r = require('./registry/module-registry.json');
const path = require('path');
const CONVENTIONAL = new Set(['index.ts','index.tsx','route.ts','page.tsx','layout.tsx','loading.tsx','types.ts','engine.ts','_loader.ts','_resolver.ts','_schema.ts','_validator.ts']);
Object.entries(r.modules)
  .filter(([,m]) => m.archival_status === 'ARCHIVED')
  .filter(([file]) => !CONVENTIONAL.has(path.basename(file)))
  .forEach(([file]) => console.log(path.basename(file) + '\t' + file));
")
GUARD10_VIOLATIONS=0
if [ -n "$ARCHIVED_BASENAMES" ]; then
  while IFS=$'\t' read -r basename archived_file; do
    [ -z "$basename" ] && continue
    # Real bug fix (TASK-036 follow-up, DNA-000067): when grep -v correctly
    # filters out the archived file's own self-match and finds nothing left
    # (the normal, expected, non-violation case), grep's exit status is 1
    # ("no lines selected") — under set -e this killed the whole script right
    # here, every time, for every archived module with no real duplicate.
    # Latent since Guard 10 was built (DNA-000040); never reached until Guard 1
    # (DNA-000067/TASK-034) finally passed for the first time this session.
    # || true is safe: the real violation check below (`if [ -n "$MATCHES" ]`)
    # is unaffected either way.
    MATCHES=$(find app components core engines gateway cognitive presenter services plugins registry scripts config supabase \
      -type f -name "$basename" 2>/dev/null | grep -v "^\./${archived_file}$" | grep -v "^${archived_file}$" || true)
    if [ -n "$MATCHES" ]; then
      GUARD10_VIOLATIONS=$((GUARD10_VIOLATIONS + 1))
      # Mission: Runtime Immune Memory (DNA-000040) — a rejection must cite
      # WHICH historical knowledge matched and WHAT to reuse instead, not
      # just point generically at the file. Resolve the real archived_knowledge
      # entry (by matching module-registry.json's archived_knowledge_ref for
      # this exact file) and print its real failure_reason/replacement_successor.
      node -e "
        const r = require('./registry/module-registry.json');
        const existence = require('./registry/existence.json');
        const entries = existence.archived_knowledge?.entries ?? [];
        const ref = r.modules['$archived_file']?.archived_knowledge_ref ?? '';
        const idMatch = ref.match(/\[([A-Z]+-\d+)\]/);
        const entry = idMatch ? entries.find(e => e.id === idMatch[1]) : undefined;
        console.log('REJECTED: \'$basename\' recreates an already-archived module.');
        console.log('  New/other file(s) with the same name:');
        console.log('$MATCHES'.split('\n').map(l => '    ' + l).join('\n'));
        if (entry) {
          console.log('  Historical knowledge matched: ' + entry.id + ' (' + entry.file + ')');
          console.log('  Why it was archived: ' + entry.failure_reason);
          console.log('  Use this instead: ' + entry.replacement_successor);
        } else {
          console.log('  WARNING: archival_status is ARCHIVED but no matching registry/existence.json#archived_knowledge entry was found for $archived_file — the reference itself may be broken (Rule 104).');
        }
      "
    fi
  done <<< "$ARCHIVED_BASENAMES"
fi
if [ "$GUARD10_VIOLATIONS" -gt 0 ]; then
  echo ""
  echo "=== $GUARD10_VIOLATIONS ARCHIVED-MISTAKE RECREATION(S) FOUND (Rule 104) ==="
  exit 1
fi

# Guard 11: Cross-Script Consistency Check (Runtime Knowledge Expansion
# MISSION, DNA-000047). Real Capability gap found this pass: the existing
# Duplicate Detector (jscpd) only scans format:["typescript","tsx"]
# (.jscpd.json), so it structurally cannot see scripts/*.sh — exactly where
# the same KM-001 failure class (same external command, independently
# reimplemented extraction logic, one copy fixed, one not) recurred 3 times
# this session (DNA-000023, 041, 046). WARN only, same reasoning as Guard 9 —
# a real difference can be intentional (verified true for one case while
# building this: dashboard.sh's `${VAR:-0}` idiom vs governance.sh's
# `|| echo "0"` are functionally equivalent, just stylistically different).
if [ -x "$SCRIPT_DIR/check-cross-script-consistency.sh" ]; then
  "$SCRIPT_DIR/check-cross-script-consistency.sh"
fi

# Guard 12: Evidence Isolation (Rule 107, DNA-000057) — WARN only, same
# reasoning as Guard 9/11: verifies the known Evidence Zone exclusions found
# during the DNA-000056 audit stay in place, so a future edit can't silently
# reintroduce the self-feedback loop.
if [ -x "$SCRIPT_DIR/check-evidence-isolation.sh" ]; then
  "$SCRIPT_DIR/check-evidence-isolation.sh"
fi

# Guard 13: No Unfilled Registry Stub On Staged Files (owner, 2026-07-24).
# Real incident: 22 real, live, actively-imported modules (payment-claim.ts,
# registry/communication.ts, receipt-documents confirm/reject routes, etc.,
# built across several sessions since 2026-07-17) sat with the auto-generated
# placeholder purpose_th ("[ตรวจพบอัตโนมัติ] ...") for days/weeks — because
# Guard 0 only ever rejected BROKEN/UNUSED status, never "still an unfilled
# stub". A file can be perfectly wired, imported, and running in production
# and still never get a real description, silently, forever. This guard
# closes exactly that gap: any file in THIS commit whose registry entry still
# carries the literal auto-stub placeholder is a hard reject, not a warning —
# same severity class as Guard 0, because the failure mode (silent, invisible,
# accumulates across sessions/AI-agents) is identical.
echo "--- Unfilled Registry Stub Check (Guard 13) ---"
STAGED_FILES=$(git diff --cached --name-only --diff-filter=ACM 2>/dev/null)
if [ -n "$STAGED_FILES" ]; then
  STUB_VIOLATIONS=$(node -e "
    const fs = require('fs');
    const r = JSON.parse(fs.readFileSync('registry/module-registry.json', 'utf8'));
    const staged = \`$STAGED_FILES\`.split('\n').filter(Boolean);
    const bad = staged.filter((f) => {
      const m = r.modules[f];
      if (!m) return false;
      return m.status === 'unregistered' || String(m.purpose_th || '').startsWith('[ตรวจพบอัตโนมัติ]');
    });
    bad.forEach((f) => console.log(f));
  " 2>/dev/null)
  if [ -n "$STUB_VIOLATIONS" ]; then
    echo "ERROR: ไฟล์ต่อไปนี้อยู่ในทะเบียนแต่ยังไม่มีคำอธิบายจริง (purpose_th ยังเป็น auto-stub) — ต้องเขียนคำอธิบายจริงใน registry/module-registry.json ก่อน commit:"
    echo "$STUB_VIOLATIONS" | sed 's/^/    /'
    exit 1
  fi
fi
echo "Registry stub check OK"

echo "All guards passed"
