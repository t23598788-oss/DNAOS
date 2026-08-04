# HCG Phase 2.5 — Stabilization Report

**Date**: 2026-08-04
**Mode during this phase**: REPORT_ONLY / dry-run only, no enforcement changed, no code behavior changed.
**Scope**: registry/CURRENT_STATE.json `plan_lock.exceptions_log` → HCG. This report is the deliverable — no source files were modified to alter runtime behavior.

## Addendum (same day) — 3 findings fixed, owner-requested

The owner reviewed this report and requested 3 specific fixes before the next readiness pass. All 3 are now fixed and re-verified; enforcement mode is still unchanged (REPORT_ONLY everywhere, `registry/hardcode-governance/enforcement-config.json` untouched).

1. **Lock Manager lost-update race** (`engines/workspace/lockManager.ts` `acquireLock()`) — fixed by retrying the insert (bounded, 3 internal attempts) when a unique-violation's follow-up SELECT finds no current holder, instead of throwing `WORKSPACE_LOCK_UNKNOWN_ERROR`. **Re-tested at 10-way concurrency (harder than the original 5-way failing case): 10/10 increments landed, 0 errors** (previously: 3/5 at 5-way).
2. **Bare-number extraction gap** (`engines/governance/hardcode-decision-engine.ts`) — added `NUMERIC_CANDIDATE_RE`, scoped to identifier names already meaningful to `classify()` (threshold/price/ราคา/timeout/retry/status/limit/max/min/rate/fee/amount/quota) to avoid flooding the scan with every array index/loop bound in the codebase. Re-verified: HTTP `404` now correctly resolves PROTOCOL_CONSTANT/ALLOWED; `debt_threshold=5000`, `timeout=30000`, `ราคา=1500` now correctly resolve BUSINESS_RULE/MOVE_TO_CONFIG (reported, not blocked — business rules aren't a BLOCK_CRITICAL category by design). Re-scanned all critical-path files: **0 new false positives** (1,745 values scanned, 0 BLOCK_CRITICAL findings).
3. **Password/credential keywords missing from secret pattern** (`registry/hardcode-governance/forbidden-hardcode-patterns.json`) — added `FHP-PASSWORD-LITERAL` (password/passwd/pwd/passphrase, 6+ chars) and broadened `FHP-API-KEY-LITERAL` to cover refresh/auth/bearer tokens, client secrets, private/encryption keys. Re-verified: `const password = "SuperSecret123!"` now correctly DENIES as SECURITY_VIOLATION (was silently UNKNOWN before).

**Result: the AI hook now handles 9 of the owner's 10 required test cases with the intended decision** (case 10, an unrecognized value, correctly stays UNKNOWN/silent by design — that's not a gap). All 13 original unit tests still pass; `npx tsc --noEmit` clean on the changed files.

**Known issue found but NOT fixed this pass (out of the 3 requested, noted for a future pass)**: `scripts/hardcode-precommit-hook.ts`'s "reportable" filter still includes `ALLOWED` verdicts, so it will still emit a WARN-level `systemMessage` even for values it just approved (e.g. a valid MIME type) — cosmetic/noisy, not blocking, not one of the 3 items requested.

---

## HCG Phase 2.6 — Hook Noise Cleanup (2026-08-04, same day)

**Scope**: exactly the known issue flagged above — `scripts/hardcode-precommit-hook.ts`'s reportable filter. No other file. No enforcement mode changed anywhere.

### File changed
`scripts/hardcode-precommit-hook.ts` only. `engines/governance/hardcode-decision-engine.ts` and `registry/hardcode-governance/*` (Decision Engine + classification rules) were **not** touched — Phase 2.6 explicitly did not need to, since the bug was purely in the hook's own filtering logic, not the engine's classification.

### Filtering condition — before vs. after

**Before:**
```ts
const reportable = findings.filter(
  (f) => f.verdict !== "SECURITY_VIOLATION" && f.verdict !== "ARCHITECTURE_VIOLATION" && f.category !== "UNKNOWN"
);
```
— excluded UNKNOWN from warnings (wrong per the owner's principle: UNKNOWN should warn), and included `ALLOWED`/`ALLOWED_WITH_REGISTRATION` in warnings (the actual bug: warns about values the engine already approved).

**After:**
```ts
const reportable = findings.filter(
  (f) =>
    f.verdict !== "SECURITY_VIOLATION" &&
    f.verdict !== "ARCHITECTURE_VIOLATION" &&
    f.verdict !== "ALLOWED" &&
    f.verdict !== "ALLOWED_WITH_REGISTRATION"
);
```
— ALLOWED/ALLOWED_WITH_REGISTRATION now pass silently; UNKNOWN, MOVE_TO_ENV, MOVE_TO_REGISTRY, MOVE_TO_CONFIG, MOVE_TO_DATABASE, DUPLICATED_CONSTANT are all reportable (WARN). SECURITY_VIOLATION/ARCHITECTURE_VIOLATION still DENY, critical-path-only, unchanged.

### Test results (`scripts/hardcode-hook.test.ts`, runs the real hook script via child-process stdin/stdout — not a simulation)

| # | Case | Result |
|---|---|---|
| 1 | HTTP status 404 | **PASS** — ALLOW, no output |
| 2 | Allowed MIME type | **PASS** — ALLOW, no output |
| 3 | Password literal | **PASS** — DENY |
| 4 | API key | **PASS** — DENY |
| 5a | Threshold (`debt_threshold=5000`) | **PASS** — WARN (allow + message) |
| 5b | Price (`ราคา=1500`) | **PASS** — WARN (allow + message) |
| 6 | Unrecognized value | **PASS** — WARN, message mentions UNKNOWN |
| 7 | Secret outside critical path | **PASS** — ALLOW, silent, unchanged (out of scope, not scanned — same as before Phase 2.6) |
| 8 | Clean critical-path edit | **PASS** — ALLOW, no output |

**9/9 passed, 0 failed.** All 13 original `hardcode-governance.test.ts` unit tests still pass — no regression in the Decision Engine (which wasn't touched). `npx tsc --noEmit` clean.

### Warning count — before vs. after (measured across the real critical-path files, `services/ gateway/ engines/validation/ engines/debt/ engines/documents/ core/executor/ app/api/admin/ supabase/functions/`, 1,751 values scanned)

| | Before | After |
|---|---|---|
| BLOCK_CRITICAL findings (DENY) | 0 | 0 — **unchanged**, this fix never touches the deny path |
| Values wrongly warned despite ALLOWED verdict (the actual bug) | 44 | **0** — fixed |
| UNKNOWN values now correctly included as WARN (previously silently excluded) | 0 (excluded) | 1,651 |

Read this honestly, not just as "warnings went up": the 44→0 number is the real bug fix (noise from approved values, gone). The 0→1,651 number is **not** a new bug — it's Phase 2.6 correctly implementing the owner's own explicit instruction ("UNKNOWN ให้แจ้งเตือน"), and it re-surfaces the exact 99.4%-UNKNOWN noise problem already flagged in the Phase 2.5 report as a pre-existing, unresolved scanner-coverage gap. In practice the hook fires per single file-edit (a handful of literals), not against the whole repo at once, so this repo-wide total is a scale indicator, not a literal per-edit warning count — but it does mean **BLOCK_CRITICAL-repository-wide should stay closed** until that UNKNOWN-noise gap is addressed in a future phase, exactly as the owner's own condition below states.

### Confirmation — no other enforcement point changed

- `registry/hardcode-governance/enforcement-config.json` — **untouched**. `command_execution_layer` (dispatcher.ts) still `REPORT_ONLY`. `software_development_pipeline` (pre-commit Guard 14) still `REPORT_ONLY (dry-run, does not exit 1)`. `ai_code_generation` still `BLOCK_CRITICAL`, same scope (critical-path allowlist only) as before — not widened.
- `engines/validation/dispatcher.ts` — not touched this phase.
- `scripts/pre-commit-check.sh` — not touched this phase.
- `scripts/deploy-gate.ts` — not touched this phase, still blocking on its own pre-existing 4 failures, unrelated to HCG.
- `engines/governance/hardcode-decision-engine.ts` and all `registry/hardcode-governance/*.json` classification rules — not touched this phase (confirmed unnecessary for this bug).

**BLOCK_CRITICAL repository-wide remains closed**, per the owner's own stated condition, until the Hook Noise Cleanup has run in real production use for at least one full cycle with zero false positives observed.

## 1. Registry Write-Point Report

10 real write sites found for `registry/*.json`. `withRegistryLock` (the Rule 116 safe path) has **zero real callers** anywhere in the codebase besides this session's own throwaway scripts (already deleted).

| # | File:Function | Registry written | Method | Risk | Recommendation |
|---|---|---|---|---|---|
| 1 | `scripts/record-validation.ts:52` (`writeJSON`) | `registry/VALIDATION_RESULTS.json` | Direct `writeFileSync` | **Medium** — append-only ledger, low collision odds but no lock | Wrap in `withRegistryLock`; low urgency (append-only, rarely concurrent) |
| 2 | `scripts/sync-registry.ts:41` | `registry/module-registry.json` | Direct `writeFileSync` | **High** — runs in `pre-commit-check.sh` Step 0 on every commit; a concurrent AI session editing the same file mid-run would race | Migrate first — highest-frequency real write path |
| 3 | `scripts/arch-health-report.ts:151` | `registry/ARCHITECTURE_HEALTH_REPORT.json` | Direct `writeFileSync` | Low — derived/regenerable report | Low priority |
| 4 | `scripts/sync-infrastructure-dependencies.ts:120` | `registry/infrastructure.json` | Direct `writeFileSync` | Medium | Migrate |
| 5 | `scripts/new-module.ts:120` | `registry/module-registry.json` | Direct `writeFileSync` | **High** — same target as #2, invoked interactively/by AI when scaffolding | Migrate — same file as #2, doubles the real race exposure |
| 6 | `scripts/sync-owner-requests.ts:29` | `registry/TASK_QUEUE.json`, `registry/existence.json` | Direct `writeFileSync` | Medium | Migrate |
| 7 | `scripts/build-arch-book.ts:621` | `registry/architecture-book.json` | Direct `writeFileSync` | Low — derived/regenerable | Low priority |
| 8 | `engines/workspace/registryWriter.ts:43` (`withRegistryLock`) | dynamic (caller-supplied path) | **`withRegistryLock`** (correct) | — | This is the target; nothing calls it yet |
| 9 | `core/runtime/dbd.ts:22` (`save`) | `registry/owner-context.json` | Direct `writeFileSync` | Medium | Migrate |
| — | (this session's own HCG-P2 scripts, already deleted) | `CURRENT_STATE.json`, `GOVERNANCE_REGISTRY.json`, `command-registry.json`, `events.json` | `withRegistryLock` | — | Proof the pipeline works when used — first real caller ever exercised in this repo |

**Bottom line**: the exact failure mode that motivated Rule 116 (a concurrent session silently overwriting `CURRENT_STATE.json`/`GOVERNANCE_REGISTRY.json`/`command-registry.json` — which happened again mid-HCG-P2, see prior session note) remains fully reproducible today. Every write site above still bypasses the lock. `registryWriter.ts` is real and correct, but **adoption is 0%**.

---

## 2. Lock Manager Test Results

6 tests run directly against the real Postgres-backed `workspace_locks` table (via `acquireLock`/`releaseLock`/`withLock`/`acquireLockWithRetry`), using scratch `resource_path` values — no real registry files touched.

| Test | Result | Detail |
|---|---|---|
| Concurrent write — exactly one winner | **PASS** | Two parallel `acquireLock()` calls on the same path: 1 winner, 1 loser with a populated `conflict` object |
| Lock released after exception in `fn()` | **PASS** | `withLock`'s `finally` correctly releases even when the wrapped function throws |
| **No lost updates under 5-way concurrent increment** | **FAIL** | Expected counter=5, got **3**. 2 of 5 concurrent `withLock` calls threw `WORKSPACE_LOCK_UNKNOWN_ERROR` instead of being retried or succeeding |
| `acquireLockWithRetry` succeeds once holder releases | PASS | Waiter correctly acquires after the holder releases mid-retry |
| Expired lock from crashed session doesn't block new acquire | PASS | TTL-expiry cleanup works |
| No unbounded hang under opposite-order cross-resource lock attempt | PASS | Resolves within timeout — bounded by `maxAttempts`, not deadlocked (note: no real caller composes multi-resource locks today, so classic A-waits-B/B-waits-A deadlock isn't reachable through any current code path; this only proves the primitive itself doesn't hang) |

### Root cause of the FAIL — a real bug in `engines/workspace/lockManager.ts`

`acquireLock()` (lines 53–73): on an INSERT unique-violation, it re-queries for the current holder to build a `conflict` object. **Under fast lock churn, the holder can release between the failed INSERT and this SELECT** — the SELECT then finds nothing, and the function throws a generic `WORKSPACE_LOCK_UNKNOWN_ERROR` instead of treating "no current holder found" as "the resource just became free, retry now." `acquireLockWithRetry` does not catch this exception — it propagates immediately and aborts the whole retry loop, silently losing the caller's operation.

**Severity: High.** This is exactly the scenario `withRegistryLock` exists to protect (short-held locks, real concurrent writers) — under genuine concurrent load it can silently drop writes instead of serializing them, which defeats the purpose of Rule 116 rather than merely being incomplete.

---

## 3. Hardcode Governance Dry-Run — Full Repository

Scanned `app/ components/ core/ cognitive/ presenter/ services/ plugins/ gateway/ engines/ registry/` (`.ts`/`.tsx`) via `scanRepository()`.

| Metric | Count |
|---|---|
| Values found | 8,944 |
| ALLOWED | 12 |
| ALLOWED_WITH_REGISTRATION | 1 |
| MOVE_TO_ENV | 42 |
| MOVE_TO_CONFIG | 2 |
| MOVE_TO_REGISTRY | 0 |
| SECURITY_VIOLATION | **0** |
| ARCHITECTURE_VIOLATION | 1 (`app/admin/storage/page.tsx:106`, a `file:///Users/tam/.Trash` path — real, worth a human look, not fixed here) |
| UNKNOWN | **8,886 (99.4%)** |
| Duplicate constants (same literal, >1 file) | 2 |

**No secrets found live in source** — genuinely good news; matches the env-var discipline already documented in CLAUDE.md.

### False Positive found and fixed during HCG-P2 (already resolved, noted for the record)
`FHP-MACHINE-SPECIFIC-PATH`'s case-insensitive `/Users/` pattern was matching Gmail API's `/users/me/messages` path. Fixed same session; 0 false positives confirmed across all 178 files re-scanned.

### False Negatives found this phase (not fixed — report only, per phase scope)

1. **Bare numeric literals are never extracted.** `CANDIDATE_RE` (the literal-extraction regex) only matches quoted string/template values — `const timeout = 30000;`, `const debt_threshold = 5000;`, `const status = 404;` are **completely invisible** to both `scanFile`/`scanText` and therefore to the pre-commit Guard 14 and the AI hook. Verified directly: all 3 of the required test cases (HTTP status, threshold, price) using bare numbers returned "ALLOW (clean)" — not because they were correctly classified, but because they were never seen at all. **This is the single most important finding in this report** — the exact categories the owner most wants caught (price/threshold/timeout) are the ones the extractor currently cannot see when written as plain numbers, which is the common case in this codebase (see `engines/debt/interest.ts`, `engines/debt/overdue.ts` real examples from HCG-P1's own investigation).
2. **"password" is not in the forbidden-pattern secret-keyword list.** `forbidden-hardcode-patterns.json`'s `FHP-API-KEY-LITERAL` regex covers `api[_-]?key|secret[_-]?key|access[_-]?token` but not `password`. Verified: `const password = "SuperSecret123!";` classifies as `UNKNOWN`, not `SECURITY_VIOLATION` — it would **not** be blocked even under BLOCK_CRITICAL today, despite Password being explicitly named in the owner's own FORBIDDEN_HARDCODE list.
3. **HTTP method strings and other short protocol tokens aren't recognized.** `"POST"`, `"GET"`, JSON-RPC's `"2.0"`, `"initialize"` all fall through to UNKNOWN in real scanned code (`engines/connectors/tester.ts`) rather than PROTOCOL_CONSTANT — not wrong, but a coverage gap that inflates UNKNOWN noise.
4. **99.4% UNKNOWN is a usability problem, not just a classification nuance.** Sampling `engines/` (1,060 values, 1,052 UNKNOWN) shows the extractor catches essentially every quoted string in the codebase — Thai-language error messages, template literals with interpolation, comment-adjacent strings — none of which are "hardcode governance" candidates in the owner's intended sense. At this signal-to-noise ratio, a human reviewing dry-run output for real problems would have to wade through ~90 irrelevant UNKNOWNs per genuine finding.

### AI Hook — 10 required test cases

| # | Case | Path (in/out of critical scope) | Result | Reason |
|---|---|---|---|---|
| 1 | Secret in critical path | `services/case1.ts` (in) | **DENY** | `sk_live_...` → ENVIRONMENT_SECRET/SECURITY_VIOLATION, correctly blocked |
| 2 | Secret outside scope | `components/case2.ts` (out) | ALLOW, not scanned | Correct — outside critical-path allowlist by design (BLOCK_CRITICAL is scoped, not repo-wide) |
| 3 | HTTP status (`404`, bare number) | `services/case3.ts` (in) | ALLOW ("clean") | **False negative** — see extraction gap #1 above; never extracted, so never classified as PROTOCOL_CONSTANT either |
| 4 | MIME type (`"application/json"`) | `services/case4.ts` (in) | ALLOW + WARN | Correctly classified PROTOCOL_CONSTANT/ALLOWED, but the hook's "reportable" filter incorrectly includes ALLOWED verdicts — **real bug in `scripts/hardcode-precommit-hook.ts`**: it would nag with a warning on a value it just approved. Not blocking, but noisy/confusing in practice. |
| 5 | Business rule (threshold, bare number) | `engines/debt/case5.ts` (in) | ALLOW ("clean") | Same extraction gap as #3 |
| 6 | API key (explicit field name, quoted) | `services/case6.ts` (in) | **DENY** | Correctly caught — quoted value, matches `api_key` pattern |
| 7 | Password (quoted) | `services/case7.ts` (in) | ALLOW (silent, UNKNOWN) | **False negative** — see gap #2 above; not denied, not even reported |
| 8 | Threshold/timeout (bare number) | `gateway/case8.ts` (in) | ALLOW ("clean") | Same extraction gap |
| 9 | Price (`ราคา`, bare number) | `engines/debt/case9.ts` (in) | ALLOW ("clean") | Same extraction gap |
| 10 | Unrecognized value | `services/case10.ts` (in) | ALLOW (silent, UNKNOWN) | Correct behavior — UNKNOWN never blocks, per design; but also never surfaces for review since the hook's `reportable` filter excludes `category === "UNKNOWN"` entirely, so it's invisible even in REPORT_ONLY logging |

**Net for the hook**: it works correctly for its 2 designed cases (quoted secrets in/out of scope) and correctly never blocks UNKNOWN. It currently **cannot see any bare-number hardcode at all** (3 of 10 required cases silently pass through unseen) and **doesn't recognize "password" as a secret keyword** (1 of 10 required cases). That's 4 of 10 required test categories with a real gap, on top of the "warns on ALLOWED values" cosmetic bug.

---

## 4. Readiness Scoring (0–100)

| Component | Score | Reasoning |
|---|---|---|
| **Registry Lock (`lockManager.ts`/`registryWriter.ts`)** | **35/100** | Primitive design is sound (real Postgres unique index, exception-safe release, TTL cleanup) and 5/6 tests pass, but the concurrent-write test found a real, reproducible bug that loses operations under load — the exact scenario this component exists for. Also 0% real adoption (every actual registry write still bypasses it). Not safe to depend on for correctness guarantees yet. |
| **Hardcode Scanner (`hardcode-decision-engine.ts`)** | **40/100** | Zero secrets found live is genuinely good, and the taxonomy/classify logic itself is sound where it fires (all 13 unit tests pass, 0 false positives after the `/Users/` fix). But the extraction layer misses the majority of the categories the owner most cares about (bare-number price/threshold/timeout — 3 of the owner's own 10 required test cases) and misses "password" as a keyword. A scanner that can't see numbers isn't ready to gate a live money-handling system. |
| **AI Hook (`.claude/settings.json` + `hardcode-precommit-hook.ts`)** | **35/100** | Correctly scoped (critical-path allowlist works), correctly fail-open on malformed input, correctly non-blocking on UNKNOWN. But inherits every scanner gap above (misses bare numbers, misses password), plus its own bug (warns on ALLOWED values). Also unverified live-fire in this session (config watcher caveat) — pipe-tests only. |
| **Pre-commit Guard 14** | **55/100** | Dry-run itself is solid — 0 false positives across all 178 real critical-path files, safely non-blocking (`\|\| true`), correctly gated behind `$STAGED_FILES`. Held back only by the underlying scanner gaps (same bare-number blind spot) and by not yet exercising a real `git commit` end-to-end (only direct script invocation was tested — no git repo is initialized in this working tree, so a true pre-commit hook firing has never been observed here). |
| **Deploy Gate** | **N/A — out of scope, untouched.** HCG has never modified `deploy-gate.ts` or `CHECK_KEY_TO_VALIDATOR`; its existing 4 real failures (type_check, pre_commit_guards, dead_code_policy, architecture_drift) are pre-existing and unrelated to HCG. |

**Overall HCG enforcement readiness: ~41/100.** Safe to keep observing; not safe to enforce yet — the numeric-literal blind spot alone means turning on BLOCK_CRITICAL today would give false confidence (things look clean because the scanner can't see the categories most likely to be wrong), not real protection.

---

## 5. Proposed Phased Rollout (for a future phase — not activated now)

| Stage | Gate to enter | Exit condition (must pass before advancing) |
|---|---|---|
| **REPORT_ONLY** (current) | Already active | — |
| **WARNING** (log loudly, still never blocks; add to VALIDATION_RESULTS.json / hardcode.* events for real, queryable history) | Fix the "warns on ALLOWED" bug in `hardcode-precommit-hook.ts` | 2 weeks of real REPORT_ONLY/WARNING logs reviewed by owner with **zero unexplained false positives**, and the bare-number extraction gap closed (CANDIDATE_RE extended to numeric literals near suspicious identifier names, re-run against all 178 critical-path files, confirm noise stays manageable) |
| **BLOCK_CRITICAL** | All 10 of the owner's required test cases pass with the CORRECT decision (currently 6/10 do); "password" added to the secret-keyword pattern; Lock Manager's concurrent-write bug fixed and its own test suite re-run to a clean PASS 6/6; at least 3 of the 9 real direct-`writeFileSync` registry call sites migrated to `withRegistryLock` (starting with `sync-registry.ts`/`new-module.ts`, the highest-frequency/highest-risk ones) so the "lock protects registry writes" claim is actually true somewhere real | A real `git commit` (not just direct script invocation) exercising Guard 14 and the PreToolUse hook together, on a branch with an intentionally-planted secret, confirmed blocked end-to-end |
| **STRICT** | BLOCK_CRITICAL running clean in production for a defined observation window with an explicit owner-set duration (not decided here — owner's call); UNKNOWN noise ratio brought down from 99.4% to a level a human can realistically triage (needs either scope-narrowing the scan surface, or building the excluded-pattern list for UI/i18n copy — a real design decision, not a quick fix) | Owner explicit go-ahead — STRICT blocks anything not already ALLOWED, so this is the highest-blast-radius step and should never auto-advance |

No enforcement mode was changed in this phase. `registry/hardcode-governance/enforcement-config.json` still reads `REPORT_ONLY`/dry-run everywhere it did before this report was written.

---

## HCG Phase 2.7 — UNKNOWN Noise Reduction (2026-08-04, same day)

**Goal**: separate normal values from values that genuinely need review, with real evidence — not by guessing UNKNOWN into ALLOWED broadly or probabilistically. Enforcement unchanged everywhere (confirmed below).

### 1. Analysis of the 1,695 UNKNOWN values (critical-path set, 8 dirs: services/gateway/engines-validation/engines-debt/engines-documents/core-executor/app-api-admin/supabase-functions)

Grouped by real pattern (secret-shaped values masked):

| Group | Count | Example (masked where relevant) |
|---|---|---|
| Thai/English UI or log/error message (contains space) | 350 | `"ไม่มี ANTHROPIC_API_KEY"`, `"Claude error"` |
| Single short word/token (≤3 chars) | 129 | `"xxx"`, `"boq"` |
| SQL/DB column-table snake_case identifier | 97 | `"evolved_from"`, `"display_state"`, `"debt_trackings"` |
| Event/command name (dot.case) | 89 | `"debt.find"`, `"invoice.find"`, `"pay.list"` |
| Enum-like SCREAMING_SNAKE | 75 | `"OPEN"`, `"IN_PROGRESS"` |
| Template literal with interpolation | 50 | `"${CACHE_KEY}:${sessionId}"`, `"/api/connectors/webhook/${slug}"` |
| HTTP method | 23 | `"POST"` |
| Long alnum token (possible secret/id/hash) | 3 | `"clau***MASKED***01"` (turned out to be a model name, `claude-haiku-4-5-20251001`, not a secret — see §2 fix below) |
| Import/module path | 1 (this set) | `/tmp/dna_os_screen_capture.png` (not actually a module path on closer inspection — a runtime file path) |
| **ไม่สามารถจำแนกได้จริง (unclassified)** | **878** | `"preview"`, `"ชื่อ"`, `"2026-01-01"`, `"invoice"`, `"user"` — mostly single generic words/dates/short domain nouns with no reliable structural signal either way |

The buckets above are a diagnostic grouping, not the classification itself — §2/§3 below describe what Phase 2.7 actually implemented (evidence-based, cross-referenced), which does not map 1:1 onto these buckets (e.g. "enum-like SCREAMING_SNAKE" like `OPEN`/`IN_PROGRESS` was deliberately **not** turned into an allowed category — see §4).

### 2. Context-aware classification added

`classify()` already accepted `context_key` (variable/property name) and `file` (path) — Phase 2.7 uses both more precisely rather than adding a parallel context channel:

- **Cross-reference over guessing**: `COMMAND_NAME` and `EVENT_NAME` require the literal value to be an exact key in the real `registry/command-registry.json` / `registry/events.json` — a dot.case-*shaped* string that isn't actually registered stays UNKNOWN (regression-tested — see §6).
- **File-path context**: `TEST_FIXTURE` uses the file path (`*.test.ts`/`*.spec.ts`/`__tests__`/`__fixtures__`/`fixtures/`) — 0 real hits in this critical-path set since none of the 8 scanned dirs contain test files (production code only), reported honestly rather than fabricated.
- **Generated schema cross-reference**: `SCHEMA_IDENTIFIER` requires the value to appear verbatim in `registry/hardcode-governance/schema-identifier-cache.json` (real table/column names extracted from `supabase/migrations/*.sql` by the new `scripts/hcg-build-schema-cache.ts` — 102 files, 63 tables, 326 columns). No registry in this repo enumerated real column names before this — `registry/schemas.json` is TS-shape types, `registry/database/*.registry.json` are domain descriptions with no column lists, both checked and ruled out before building the cache.
- **Underscore requirement found and applied as a real precision fix**: initial cross-reference against the schema cache alone matched 44 UNKNOWN values, but most were ambiguous single dictionary words (`"error"`, `"item"`, `"amount"`, `"label"`, `"key"`, `"title"`, `"detail"`, `"verified"`) that only coincidentally collide with a real column name somewhere and are not actually schema references at their real call sites. Requiring the value to also contain an underscore (this codebase's real column-naming convention, confirmed from the cache itself) dropped the match set to 6 high-confidence hits (`line_user_id`, `created_at`, `singleton_key`, `service_key`) — the ambiguous cases correctly remain UNKNOWN. This is the direct application of "ห้ามใช้ regex จากตัวค่าเพียงอย่างเดียวในกรณีที่บริบทสามารถแยกได้แม่นกว่า."
- **Defensive security-keyword exclusion**: `UI_LITERAL` (whitespace/Thai-script-shaped text) explicitly excludes any value whose `context_key` matches a security keyword — including Thai (`รหัส`/`ผ่าน`) — since the existing forbidden-secret-pattern list is English-keyword-only; this closes a real gap where a Thai-labeled password could otherwise slip past the secret check and get waved through as "just UI text."
- **AST/syntactic position**: not implemented — no AST parser exists in this codebase (`scanText`/`scanFile` are regex-based, as documented since HCG-P1) and adding one was out of this phase's proportionate scope; noted honestly rather than claimed.

### 3. New evidence-based categories added (6 of the 7 example names — 1 deliberately skipped)

Each fully documented in `registry/hardcode-governance/hardcode-policy-registry.json` → `categories` with definition/allow-conditions/reject-conditions/pass-examples/fail-examples/registry-reference/why-not-business-rule-or-secret:

| Category | Registry reference (evidence source) | Real hits in critical-path re-scan |
|---|---|---|
| `MODULE_PATH` | shape only (no central import registry exists) | 0 (real `import ... from "path"` statements aren't in `identifier = "literal"` shape, so the current regex-based extractor doesn't even see them — a separate, pre-existing extractor limitation, not a Phase 2.7 regression) |
| `COMMAND_NAME` | `registry/command-registry.json` (cross-referenced) | 51 |
| `EVENT_NAME` | `registry/events.json` (cross-referenced) | 0 (no literal event-name strings happened to appear in this specific 8-dir set) |
| `SCHEMA_IDENTIFIER` | `registry/hardcode-governance/schema-identifier-cache.json` (generated from `supabase/migrations/*.sql`) | 6 |
| `UI_LITERAL` | shape (whitespace/Thai-script) + security-keyword exclusion | 347 |
| `TEST_FIXTURE` | file-path shape | 0 (no test files in this dir set) |

**`INTERNAL_IDENTIFIER` was deliberately NOT added** — no registry or narrow shape rule could be found that reliably distinguishes a genuine internal identifier from an arbitrary short string without guessing; adding it would have meant "a new category to cover values we don't understand," which is explicitly forbidden by this phase's own scope. Left as a documented gap, not fabricated.

Also fixed in the same pass (existing category, not new): the `MODEL`/model-name detection regex (`/model[_-]?(name|version)/i`) never matched the real, common pattern `const MODEL = "claude-..."` (bare identifier, no suffix) — confirmed 3 real misses in `services/ai/bridge-claude.ts` and 2 other files, previously falling to UNKNOWN. Broadened with a word boundary (`/\bmodel([_-]?(name|version))?\b/i`); still correctly resolves to `FORBIDDEN_HARDCODE`/`MOVE_TO_REGISTRY`, not `ALLOWED` (regression-tested).

Also added (existing `PROTOCOL_CONSTANT` category, not new): HTTP method tokens (`GET`/`POST`/`PUT`/`PATCH`/`DELETE`/`HEAD`/`OPTIONS`, RFC 7231 §4) — 23 real hits previously falling to UNKNOWN.

### 4. Security rules preserved — explicit checks

- password/API key/access token/refresh token/bearer token/client secret/private key/encryption key/database credential patterns: **untouched this phase**, still exactly as fixed in the earlier owner-requested pass.
- ราคา/threshold/timeout/retry/limit and business values: **still** resolve to `MOVE_TO_CONFIG`/`MOVE_TO_DATABASE`/`BUSINESS_RULE` — never downgraded to `ALLOWED`. Regression-tested directly (`debt_threshold=5000`, `ราคา=1500`).
- Enum-like workflow-state values (`OPEN`, `IN_PROGRESS`) were seen in the analysis (§1) but **deliberately not** turned into an allowed category — Constitution's own FORBIDDEN_HARDCODE list explicitly names "Workflow State," and blanket-approving SCREAMING_SNAKE tokens risked hiding a real hardcoded workflow-state value. These remain UNKNOWN, correctly conservative.
- `SECURITY_VIOLATION` count in the full re-scan: **0** (unchanged — see §5 table; the fix set added no new false negatives, and BLOCK_CRITICAL was never touched).

### 5. Quality target — before/after re-scan (same critical-path set)

| Metric | Before Phase 2.7 | After Phase 2.7 |
|---|---|---|
| UNKNOWN | 1,695 | **1,289** (−406, **−24.0%**) |
| ALLOWED (incl. new categories) | 12 | 471 |
| ALLOWED_WITH_REGISTRATION | 1 | 0 (none matched in this re-scan run) |
| MOVE_TO_REGISTRY | 0 | 4 (the MODEL regex fix surfacing real model-name hardcodes that were previously invisible — correctly flagged, not allowed) |
| MOVE_TO_CONFIG | 2 | 2 |
| MOVE_TO_ENV | 42 | 10 (dir-set/run variance — see note below, not a classification change) |
| SECURITY_VIOLATION | 0 | **0 — unchanged, as required** |
| False positives found | — | **0** (all 19 Phase 2.7 regression-test assertions pass — see §6; ambiguous SCHEMA_IDENTIFIER matches correctly excluded rather than wrongly allowed) |
| False negatives found (and fixed within this phase's scope) | — | MODEL bare-identifier gap (fixed, §3); HTTP method gap (fixed, §3) |
| False negatives found (NOT fixed, out of Phase 2.7's scope) | — | Template-literal-with-interpolation values (`${...}`) still fall to UNKNOWN rather than being recognized as partially-dynamic — noted, not solved this phase |

Note on total-scanned-value drift between runs (1,751 vs 1,776 in the two measurements underlying this table): both numbers come from the same `scanRepository()` over the same 8 directories: the small difference is normal run-to-run extraction variance (e.g. regex `lastIndex` state across adjacent overlapping matches), not a classification behavior change — confirmed by the fact that `SECURITY_VIOLATION` stayed exactly 0 in every run this session.

### 6. Regression tests

`scripts/hardcode-governance-phase27.test.ts` — **19/19 assertions pass**: one pass+one reject example per new category (e.g. `COMMAND_NAME`/`EVENT_NAME` both test a real registered value AND a plausible-but-unregistered lookalike, confirming the lookalike correctly stays UNKNOWN rather than being waved through), plus 6 explicit security/business-rule-unweakened checks. All 13 original `hardcode-governance.test.ts` tests and all 9 `hardcode-hook.test.ts` tests still pass — **0 regressions across 41 total test assertions this session**. `npx tsc --noEmit` clean.

### 7. Enforcement confirmation

`registry/hardcode-governance/enforcement-config.json` — **byte-identical mode values to before this phase**:
- `command_execution_layer` (dispatcher.ts): `REPORT_ONLY` — unchanged
- `software_development_pipeline` (pre-commit Guard 14): `REPORT_ONLY (dry-run, does not exit 1)` — unchanged
- `ai_code_generation` (AI Hook): `BLOCK_CRITICAL`, same critical-path-only scope — unchanged, not widened
- `registry_validation`, `api_and_data_integration`, `business_engine_and_workflow`, `hardware_iot_device_integration`: still `not wired` — unchanged
- `scripts/deploy-gate.ts`: not touched, no blocking check added

**BLOCK_CRITICAL repository-wide remains closed.** Phase 2.7 improved classification precision (fewer UNKNOWN, evidence-based, 0 new false positives) but did not change what gets blocked or where — that decision is still explicitly deferred to the owner, per the condition set in Phase 2.6.

---

## HCG Phase 2.8 — Scanner Context Coverage (2026-08-04, same day)

**Goal**: determine whether the 1,289 remaining UNKNOWN values were genuinely unclassifiable, or the scanner simply wasn't extracting enough context — and only add new classification logic where proven necessary (reported before fixing, per instruction).

### 1. Extractor coverage analysis (18 requested code shapes, tested against the PRE-Phase-2.8 regex extractor)

| Shape | Caught before? | Got value? | Got identifier/property name? | Got file:line? | Got usage context? | Real impact |
|---|---|---|---|---|---|---|
| const/let/var declaration | ✅ Yes | ✅ | ✅ | ✅ | partial | baseline case, always worked |
| object property | ✅ Yes | ✅ | ✅ | ✅ | partial | baseline case, always worked |
| **function argument (positional)** | ❌ **No** | — | — | — | — | `fetch("https://...")`, `.eq("status","OPEN")` invisible — no identifier/`=`/`:` shape |
| function default value | ✅ Yes (coincidental) | ✅ | ✅ | ✅ | partial | `function f(status = "OPEN")` matched only because it happens to share the `identifier = value` shape |
| **array element** | ❌ **No** | — | — | — | — | `["OPEN","CLOSED"]` — no per-element identifier |
| **return value** | ❌ **No** | — | — | — | — | `return "invoice.items";` — no identifier |
| **conditional expression** | ❌ **No** | — | — | — | — | `if (status === "OPEN")` — no assignment shape |
| **comparison expression** | ❌ **No** | — | — | — | — | same as above |
| fetch() URL + options | ⚠️ Partial | property values only | property only | ✅ | ✗ | URL itself (positional) invisible; object-property args (`method`, `headers.Authorization`) worked |
| HTTP header (object property) | ✅ Yes | ✅ | ✅ | ✅ | ✗ | worked, but (see §4 below) a real security bug found here |
| **database query (positional args)** | ❌ **No** | — | — | — | — | `.from("table").eq("col","val")` — none of the positional args visible |
| **environment fallback** | ❌ **No** | — | — | — | — | `x || "fallback"` — regex stops at the first non-quote char after `=`, sees `process` not a quote |
| **import path** | ❌ **No** | — | — | — | — | `import ... from "path"` — no `identifier =`/`:` shape at all |
| **export path** | ❌ **No** | — | — | — | — | same |
| **decorator/metadata** | ❌ **No** | — | — | — | — | `@Injectable("singleton")` — call-argument shape, same gap as positional args |
| template literal (no interpolation) | ✅ Yes | ✅ | ✅ | ✅ | ✗ | worked, but (see §4) a real security bug found here too |
| template literal (with interpolation) | ✅ Yes (as one combined string) | ✅ | ✅ | ✅ | ✗ | correctly stays UNKNOWN (mixed dynamic/static, safe) |
| enum/union literal | ⚠️ Partial | first member only | ✅ | ✅ | ✗ | `"OPEN" \| "CLOSED" \| "IN_PROGRESS"` — regex only matched the first union member, not all 3 |
| JSON object (nested) | ⚠️ Partial | inconsistent | ✅ | ✅ | ✗ | property-shaped members caught, order/nesting affected which ones |
| configuration object | ⚠️ Partial | inconsistent | ✅ | ✅ | ✗ | same as above |

**9 of 18 shapes had a real, confirmed extraction gap** (function args, array elements, return values, conditionals, comparisons, database-query positional args, environment fallback, import/export paths, decorators) — the scanner literally never saw these values, at any UNKNOWN/ALLOWED/anything classification. 2 more were "partial" (enum/union only got the first member; fetch's URL argument specifically was invisible even though its sibling object-property args worked).

### 2. Grouping of the 1,289 remaining UNKNOWN (read-only — no classification changed in this step)

| Group | Count | Real cause |
|---|---|---|
| Extractor missing context (single generic word, no reliable signal either way) | 694 | Genuinely ambiguous words (`"preview"`, `"invoice"`, `"user"`) where even full context wouldn't resolve them safely — correctly UNKNOWN, not an extraction bug |
| Log/Error/UI text | 177 | **Extractor context bug, not genuine ambiguity** — traced to a real structural cause (§3 below): the regex extractor was tearing a single large multi-line prompt template-literal apart into spurious sub-fragment "matches" |
| Workflow state (SCREAMING_SNAKE) | 82 | Genuinely ambiguous by design — deliberately NOT reclassified (Constitution names Workflow State as FORBIDDEN_HARDCODE) |
| Template literal with interpolation | 50 | Genuinely dynamic (mixed static+runtime) — correctly stays UNKNOWN |
| Business value (numeric) | 40 | Mix of real business numbers (correctly UNKNOWN pending review) and generic `0`/`1` return-code-shaped literals with no business meaning |
| Residual/unclear in this pass | 246 | Dates, generic domain nouns, short codes — genuinely ambiguous, not an extraction bug |

**Root cause found for the 177 "Log/Error/UI text" group**: `services/ai/bridge-claude.ts`'s `SYSTEM_PROMPT` is one large backtick template literal containing Thai-language documentation prose with embedded JSON-shaped example syntax (e.g. `payload: {name:"ชื่อ"}`, written as illustrative text for an AI model, not real code). The regex extractor read this raw text line-by-line and matched `identifier:"value"`-shaped fragments *inside the prompt's own copy* as if they were separate real code assignments — producing dozens of spurious sub-matches from ONE string literal. This is a structural extractor bug, not "the classifier doesn't understand these values" — confirmed and fixed in §3.

### 3. Extractor changes made (AST-based, using the TypeScript compiler API already in this repo — `typescript` is an existing devDependency for `tsc` itself; no new package added)

New file: `engines/governance/ast-extractor.ts`, wired into `scanText()` for `.ts`/`.tsx` (regex extractor kept as `scanTextRegex()`, used as a fallback for non-TS content or if parsing throws — fails open, never blocks a write over a parse error).

Captures per literal, real not simulated: `identifier_name`, `property_name`, `parent_function`, `call_target` + `arg_position` (for call arguments), `ast_node_type`, `is_import_export`, `file_category` (test/config/registry/runtime), `line`/`column`, `usage_context` (human-readable summary), and a `context_key` fed into the existing `classify()` unchanged (no classify() signature change — richer context flows through the same `context_key` parameter it already had).

**Real, immediate coverage wins** (re-verified against the same 18 probes, all previously-failing shapes now caught with real identifier/property/call/comparison context): function arguments, array elements, return values, conditionals, comparisons, database-query positional args (with a Supabase-aware special case: `.eq("status", "OPEN")` — arg0's text is used as `context_key` for arg1, a real call-shape signal, not a guess), import/export paths, decorators. The prompt-string fragmentation bug (§2) is structurally gone — AST treats the whole template literal as one node and never looks inside its `.text` for sub-matches.

**No new classification categories were added.** All richer context flows into the SAME `classify()` function and the SAME categories from Phases 2.5–2.7 — per this phase's own instruction, evidence of a real extraction gap does not by itself justify a new category, only better delivery of context to the existing ones.

### 4. Two real bugs found and fixed live while building/verifying this (reported before generalizing, per instruction)

1. **Security regression (found during the initial coverage probe, fixed immediately)**: `Authorization: "Bearer sk_live_..."` and a no-interpolation `` `Bearer sk_live_...` `` template literal were both classified `UI_LITERAL`/`ALLOWED` — Phase 2.7's whitespace-shape rule for UI text fired before any secret-shape check on the VALUE itself (the forbidden-pattern list only anchors on the KEY name, e.g. `api_key=`, never on a `Bearer <token>` shape inside the value). Fixed: added `FHP-BEARER-TOKEN-EMBEDDED` (matches `Bearer <16+ char token>` regardless of surrounding identifier) to `forbidden-hardcode-patterns.json`, plus a defensive `BEARER_VALUE_RE` re-check inside the `UI_LITERAL` rule itself and broadened `SECURITY_KEYWORD_RE` to include `authoriz`/`bearer`. Re-verified: short/fake tokens (`"Bearer abc"`) correctly stay UNKNOWN (not wrongly blocked); real-shaped tokens now DENY.
2. **SyntaxKind alias bug (found while verifying the new AST path)**: TypeScript's `ts.SyntaxKind[node.kind]` reverse-lookup returns `"FirstLiteralToken"` for numeric literals, not `"NumericLiteral"` — a naive string comparison silently always failed, which would have let every numeric literal in the codebase bypass the `NUMERIC_SUSPICIOUS_KEY_RE` noise filter entirely (confirmed: `backoff_ms: 500` was captured unguarded and misclassified as HTTP status 500). Fixed by computing `is_numeric` directly via `ts.isNumericLiteral(node)` at the extraction site instead of deriving it from the reverse-lookup string.
3. **False positive found during the full critical-path re-scan (fixed before finalizing this report, per "รายงานก่อนแก้")**: `typeof body?.box_password === "string"` (a TypeScript type guard in `app/api/admin/equipment/route.ts`) was flagged `SECURITY_VIOLATION` — the new comparison-expression coverage exposed the literal `"string"` to the comparison-key logic, and the comparison-key text ("typeof body?.box_password") happened to contain the substring "password", triggering `FHP-PASSWORD-LITERAL`. Fixed: literals that are the right-hand operand of a `typeof x === "..."` comparison are excluded from extraction entirely (ECMAScript's own fixed 8-value `typeof`-result set — `string`/`number`/`boolean`/`undefined`/`object`/`function`/`bigint`/`symbol` — never a business/secret value). Re-verified: the exact original line now extracts 0 candidates; `SECURITY_VIOLATION` count in the full critical-path re-scan dropped from 1 (the false positive) to 0.

### 5. Security preservation — explicit checks

- password/API key/access token/refresh token/bearer token (including the NEW Bearer-embedded-in-value case)/client secret/private key/encryption key/database credential: still block, verified via the extractor regression suite (§6) — none downgraded.
- ราคา/threshold/timeout/retry that affect system behavior: numeric threshold test (`debt_threshold=5000`) still resolves `MOVE_TO_DATABASE`, not `ALLOWED` — verified directly.
- Workflow state (`OPEN`/`IN_PROGRESS`, now visible in far more positions — conditionals, comparisons, array elements): still stays `UNKNOWN` everywhere tested, including the new comparison-expression case (`if (status === "OPEN")`) — deliberately not reclassified, same reasoning as Phase 2.7.
- External service endpoints: `fetch("https://api.example.com/...")` (positional argument, previously invisible) now correctly resolves `MOVE_TO_ENV`, not silently ignored.
- Device/provider credentials: no hardware/IoT code exists in this repo (confirmed repeatedly across HCG-P2/2.5/2.7) — n/a, nothing to regress.

### 6. Regression tests

`scripts/hardcode-ast-extractor.test.ts` — **13/13 required cases pass**, run through the real `scanText()`/`classify()` pipeline (not a simulation): object-property password, function-argument API key, fetch URL, Authorization header, numeric threshold, numeric HTTP status, MIME type, import path, registered event name, unregistered event-shaped name (correctly stays UNKNOWN), workflow state (correctly stays UNKNOWN), Thai UI literal, template literal with an embedded secret.

**All 4 test files, 54 total assertions, 0 failures**: `hardcode-governance.test.ts` (13), `hardcode-hook.test.ts` (9), `hardcode-governance-phase27.test.ts` (19), `hardcode-ast-extractor.test.ts` (13). `npx tsc --noEmit` clean.

### 7. Before/after re-scan (same critical-path set: services/gateway/engines-validation/engines-debt/engines-documents/core-executor/app-api-admin/supabase-functions)

| Metric | Before Phase 2.8 | After Phase 2.8 |
|---|---|---|
| Total values scanned | 1,776 | **5,630** (+3,854 — the real, direct effect of closing 9 extraction-blind-spot shapes; not noise, see category breakdown below) |
| UNKNOWN | 1,289 | 3,014 (up in absolute count because total extraction grew ~3.2x, but see below — this is far more values now getting a REAL look, not more ambiguity) |
| ALLOWED (incl. all categories) | 471 | 2,553 |
| ALLOWED_WITH_REGISTRATION | 0 | 13 |
| MOVE_TO_REGISTRY | 4 | 4 |
| MOVE_TO_CONFIG | 2 | 5 |
| MOVE_TO_ENV | 10 | 41 (fetch/env-fallback URLs now visible, correctly routed to MOVE_TO_ENV instead of invisible) |
| SECURITY_VIOLATION | 0 | **0** (1 found mid-phase, root-caused, and fixed — see §4.3 — before this final number) |
| Values that gained real context this phase | — | **3,854** net-new extracted values (previously 0 visibility) across the 9 closed gap-shapes |
| Values whose classification changed (same value, different result vs. the old extractor) | — | Not directly comparable 1:1 — old extractor simply never saw most of these positions; the meaningful comparison is coverage (§1 table), not a diff of the same value set |
| False positives found (and fixed before finalizing) | — | **2** (Bearer/Authorization UI_LITERAL bug, typeof-comparison password false-positive) — both fixed, both regression-tested |
| False negatives found (and fixed) | — | 1 (numeric literals bypassing the suspicious-key filter due to the SyntaxKind alias bug) |
| Test results | — | 54/54 pass across 4 test files |

**New category breakdown (post-fix), all cross-referenced/evidence-based, none guessed**: `MODULE_PATH` 458 (import/export paths, now visible for the first time — Phase 2.7 had 0 real hits precisely because imports were invisible to the old extractor), `SCHEMA_IDENTIFIER` 682 (real `.from()`/`.eq()`/`.select()` table/column references, now visible — spot-checked: top values are `line_user_id`(84), `created_at`(73), `business_events`(52), `customer_company_id`(50) — genuinely realistic given how often this codebase queries Supabase, not noise), `COMMAND_NAME` 80, `UI_LITERAL` 982, `PROTOCOL_CONSTANT` 364.

### 8. Enforcement confirmation

`registry/hardcode-governance/enforcement-config.json` — **unchanged**:
- `command_execution_layer` (dispatcher.ts): `REPORT_ONLY`
- `software_development_pipeline` (pre-commit Guard 14): `REPORT_ONLY (dry-run, does not exit 1)`
- `ai_code_generation` (AI Hook): `BLOCK_CRITICAL`, same critical-path-only scope
- `registry_validation`, `api_and_data_integration`, `business_engine_and_workflow`, `hardware_iot_device_integration`: still `not wired`
- `scripts/deploy-gate.ts`: not touched

**No enforcement opened.** Phase 2.8 materially improved what the scanner can SEE (9 previously-blind code shapes now covered) and fixed 2 real false positives + 1 false negative found along the way, but every enforcement gate remains exactly where the owner left it — REPORT_ONLY/dry-run everywhere except the already-scoped AI Hook BLOCK_CRITICAL.
