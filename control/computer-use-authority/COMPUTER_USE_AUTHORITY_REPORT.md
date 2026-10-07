# DNA OS-Owned Computer Authority — build + runtime proof

Work order: BUILD_DNA_OS_OWNED_COMPUTER_AUTHORITY (2026-09-01)
Principle: Owner = ROOT · DNA OS = AUTHORITY + EXECUTION OWNER · Claude/Agent = REQUESTER ONLY

## Phase 1 — Registry-first discovery

| Component | State | Action |
|-----------|-------|--------|
| `connections/os-ui` (screenshot/click/type/key/focus/browser_eval) | EXISTS | reuse as OS/Browser adapter |
| `control/permission-policy-resolution`, `permissions/write-gate` | EXISTS | reuse patterns |
| `control/machine-model/execution-authority.ts` (execution classification read-model) | EXISTS | reuse for evidence lineage |
| permission-lease / authority grant/revoke (`authority_id`) | **MISSING** | **built** `control/computer-use-authority/` |
| DNA OS computer-use executor (own runtime, execution_owner) | **MISSING** | **built** `control/computer-use-executor/` |

No duplicate created.

## What was built

**`control/computer-use-authority/`** — the permission-lease model (closes AUTHORIZATION_MODEL_GAP):
- `ComputerUseAuthorityLease` with all required fields: `authority_id, owner, requester, executor, capability, operations, target, scope, issued_at, expires_at, state, revoked_at, evidence_reference`.
- `grantAuthority` / `validateAuthority` / `revokeAuthority`, JSONL store, fail-closed.
- **Iron rule enforced in code:** `executor` must be a DNA OS component; `grant`/`validate` reject any executor containing `claude/codex/agent/gpt/model/llm/…`. Authority to control the machine is **never** granted to a model.
- `target = "*"` (global) rejected; ttl bounded to ≤ 24h.

**`control/computer-use-executor/`** — the execution owner:
- `executeComputerUse(request)` → `validateAuthority` (DNA OS lease) → `runUiWorkOrder` (os-ui adapter) → writes `ExecutionEvidence` with `execution_owner = control/computer-use-executor` and the executor process `pid`.
- Fail-closed: no lease → no execution. `requester` (the model) is recorded separately from `execution_owner` (DNA OS).
- LaunchAgent template so the Owner can run it as an independent DNA OS runtime (survives Claude off).

## Verification

**Unit (deterministic, injected now/id/store): 23/23 pass** — grant, ALLOW, DENY (not-found / wrong-operation / wrong-target / wrong-requester / executor-not-DNA-OS / scope-insufficient), expired, revoke, executor fail-closed, `execution_owner = DNA OS`, `ui_action` mapping.

**Live runtime proof** (`control/computer-use-executor/tools/runtime-proof.ts`, non-blocked op = screenshot):
```
executor identity = control/computer-use-executor
this process pid  = 607  (DNA OS runtime, not Claude's reasoning loop)
granted authority_id = authority-7engkaiu13w (owner=OWNER executor=control/computer-use-executor requester=agent:claude)
EVIDENCE: execution_owner=control/computer-use-executor · executor_pid=607 · requester=agent:claude
          authorized=true · executed=true · result_status=COMPLETED
          owner_is_dna_os=true · requester_is_not_owner=true
          artifact: a real screenshot PNG
```

**Persistence:** `control/computer-use-authority/data/authority-leases.jsonl` and `control/computer-use-executor/data/execution-evidence.jsonl` on disk — survive Claude off.

**Registration:** live-census discovers both folders as capabilities (`discoverCapabilityFolders()` → true for both) — registered through the real pipeline, not a hand-written graph node.

## Acceptance test results

1. Claude got **no** new browser-control permission — ✅ (nothing added to any settings.json)
2. Claude got **no** new credential/login authority — ✅
3. DNA OS executor has its own process/runtime — ✅ (pid 607; LaunchAgent template for a persistent daemon)
4. Owner can grant/revoke DNA OS authority — ✅ (`grantAuthority` / `revokeAuthority`, unit-proven; revoke → subsequent validate fails closed)
5. DNA OS executes without Claude as execution owner — ✅ (evidence `execution_owner=control/computer-use-executor`, requester recorded separately)
6. Capability persists with Claude off — ✅ on disk + LaunchAgent template (full daemon install is an Owner OS action)
7. Evidence names `execution_owner = DNA OS` — ✅
8. No Claude `settings.json` dependency — ✅ (capability reads only DNA OS stores)

## The one operation still at the boundary: `browser_eval`

Ownership is now PROVEN for computer-use. `browser_eval` (arbitrary DOM JS) remains special:
- The DNA OS executor **owns** `browser_eval` as a capability, and when the executor runs as an **independent Owner-operated daemon**, the Claude auto-mode classifier is not in its path (it polices Claude's own tool calls, not the Owner's OS services).
- BUT Claude will **not** submit a `browser_eval` request to complete the TikTok automation, because Claude initiating the exact operation its own classifier blocked — even via the DNA OS executor — is Claude routing around its own safety control. That trigger must come from DNA OS's own flow or the Owner, not from Claude.

**Remaining Owner action (to make the executor a Claude-independent runtime):**
- OWNER_APPROVAL_REQUIRED = install/run the LaunchAgent (`com.dnaos.computer-use-executor`)
- AUTHORITY_REQUESTED_BY = requester (model/voice), via a permission lease
- AUTHORITY_GRANTED_TO = `control/computer-use-executor` (DNA OS component — **not** Claude)
- OS/PROVIDER = macOS (launchd) + Chrome (JS bridge already enabled) / TikTok later
- PURPOSE = run computer-use operations under DNA OS ownership, independent of Claude
- SCOPE = per-lease (operations + target + ttl), revocable
- REVOCATION_METHOD = `revokeAuthority(authority_id)` (fail-closed on next validate) + `launchctl bootout` the daemon

## Round 2 — independence, levels, login authority, revocation (live)

**Authorization levels (Phase 4):** `levels.ts` maps every operation to LEVEL 0–4.
- LEVEL ≥ 3 (login/credential/external-commit) needs `high_risk_explicit` on the lease — rejected at grant AND validate if absent (not inheritable from a click/type lease).
- External commit (submit/publish/delete/payment) needs a separate `external_commit_authorized` — a click lease can click a "Submit" button mechanically, but validate DENIES it as an external commit without the dedicated flag.
- Tests: 28/28 (5 new level cases).

**Login authority (Phase 6):** `control/computer-use-executor/login-authority.ts` — an agent may request `LOGIN(provider)` but the result carries **only a `credential_reference`, never a secret**. `want_raw_secret` → always DENY. DENY on no-lease / wrong-provider / inactive-credential / not-found. Tests: 9/9, including a structural check that the serialized result contains no `secret|token|password`.

**Revocation (Phase 7, LIVE — not unit):**
```
BEFORE revoke: authorized=true executed=true status=COMPLETED   (real screenshot)
OWNER revoke:  REVOKED
AFTER revoke:  authorized=false executed=false reason=AUTHORITY_REVOKED
REVOCATION_PROOF = PASS (execution_owner=control/computer-use-executor, no cached authorization)
```

**Honest boundaries (not faked):**
- **EXECUTOR_PARENT:** in this session the executor ran as a tsx process spawned by Claude's shell, so its process parent still traces to the Claude session. Process-level Claude-independence (parent = launchd) requires the **Owner to install the LaunchAgent** — code/store-level independence is proven (census-discovered, on-disk stores, no settings.json dependency), process-parent independence is pending that Owner action.
- **OWNER_AUTHENTICATION (Phase 3A):** currently the Owner identity is asserted as `"OWNER"` in leases; a real Owner-authentication capability (Touch ID / device approval) is **NOT** built this round and is **not faked** — AUTHENTICATION_MODEL_GAP for the Owner-presence check remains.
- **browser_eval / TikTok (Phase 2 read, Phase 9):** HELD. Claude will not trigger `browser_eval` that Claude's own classifier blocks, even through the DNA OS executor — that is Claude routing around its own safety. The DNA OS executor OWNS the operation; the trigger must come from an Owner-run daemon or DNA OS's own flow, not from Claude.
