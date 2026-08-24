# observability/joint-monitor/ — Pillar 1 of the 3-pillar OS-level enforcement plan

**หน้าที่:** the live dashboard every real cross-capability call ("joint")
is automatically mirrored to, without the calling capability needing to
opt in per-call — Owner instruction 2026-08-22 ("Zero-Trust Interceptor
Layer"). Serves `http://localhost:5178/`. **CORRECTION (owner, 2026-08-22,
"FIX RESEARCH API NAVIGATION" task):** this originally bound `:5177`,
justified here as "confirmed unclaimed" per
`../../reports/SYSTEM_JOINT_AND_SEARCH_WASTE_AUDIT_2026-08-22.md` — that
claim was false. `:5177` is DNA-LAB-PERMISSION-REASONER's real, permanent,
LaunchAgent-managed Research Monitor UI
(`research/dashboard/monitor-ui/serve-static.mjs`), running since before
that audit was written; the audit only grepped this repo's own source, never
checked actual host process state or sibling repos. Moved to `:5178` to stop
squatting on that port. See `./start.ts`'s own header comment for the full
correction.

**Architecture:**

```
control/command-router/router.ts (admitAndBuildResult) ─┐
control/agent-gateway/gateway.ts (persistStatus)        ├─→ reportJoint() ─→ POST /joints ─→ JointStore ─→ SSE GET /events ─→ browser
control/circuit-breaker/ (future)                       ─┘─→ reportViolation() ─→ POST /violations ─┘
```

**Scope, stated honestly, not implied wider than it is:** this captures
every `routeOwnerCommand`-driven step (`control/command-router/router.ts`'s
`admitAndBuildResult` — the one function every `CapabilityResult` this
router returns is minted through) and every `control/agent-gateway/`
task-status transition (`gateway.ts`'s `persistStatus` — the one function
every status change in that file funnels through, including
`dna-os-circuit/runtime/server.ts`'s own direct `/gateway/*` calls into
`agent-gateway`, since those also call `submitTask`/`ownerDecision` which
call `persistStatus`). It does **not** see joints *inside* one adapter's
own execution (e.g. `control/agent-gateway/adapters/ai-write-adapter.ts`'s
internal calls into `control/ai-write-control`/`permissions/write-gate`/
`execution/file-write`) — this repo's capabilities communicate as plain
same-process TypeScript function calls with no network/process hop to
generically intercept, so "every joint, unconditionally" would require
codegen-wrapping all ~40 capability `contract.ts` files' exports, which
the Owner explicitly chose not to do this round (see
`/Users/tam/.claude/plans/zesty-spinning-ripple.md`).

**Input:** `POST /joints` / `POST /violations` — real capabilities calling
`reportJoint()`/`reportViolation()`. No caller-supplied `event_id`/`at`
(both are stamped by this folder, never trusted from a reporter).

**Output:** `GET /events` (SSE, snapshot + live change stream), `GET /joints`,
`GET /violations`, `GET /` (a small inline HTML viewer).

**Dependency ที่อนุญาต:** none outside this folder — a pure leaf
observability capability. Nothing in this repo is required to depend on
it either; a down/never-started dashboard must never block a real Owner
command (`reportJoint`/`reportViolation` never throw, never await-block
their caller — see `./client.ts`).

**สิ่งที่ห้ามแตะ:**
- ห้าม import `contracts/command/capability-result.ts`'s
  `CapabilityResultStatus` or `control/agent-gateway/types.ts`'s `Status`
  here — this folder observes both callers' different status
  vocabularies and must stay decoupled from either (see `./types.ts`).
- ห้ามเพิ่ม express/ws/socket.io หรือ npm dependency ใดๆ — Node built-ins
  only (`http`/`fs`/`path`/`crypto`/`fetch`), matching
  `../../dna-os-circuit/runtime/server.ts`'s own hard constraint.
- ห้ามให้ event ปลอมที่ไม่มี real call site อ้างอิงอยู่เบื้องหลัง — every
  row this store ever holds came from a real `POST /joints`/`POST /violations`
  call by a real capability, never synthesized here.
- ห้ามปล่อยให้ dashboard ที่ down ทำให้ caller จริง (Owner command) พัง —
  `reportJoint`/`reportViolation` are `void`-fired and never reject.

---

## ไฟล์ในโฟลเดอร์นี้

| ไฟล์ | ประเภท | หน้าที่ |
|---|---|---|
| `types.ts` | contract | `JointEvent`, `ViolationEvent`, snapshot shape |
| `joint-store.ts` | source | pure in-memory state — bounded ring buffer + change emitter, mirrors `../../dna-os-circuit/runtime/circuit-state.ts` |
| `host-runtime.ts` | source | ambient `http`/`fs`/`path`/`crypto`/`fetch` — the only file touching Node built-ins |
| `client.ts` | source | `reportJoint()`/`reportViolation()` — the fire-and-forget reporter every caller imports |
| `server.ts` | source | the SSE/JSON HTTP server + inline HTML viewer |
| `start.ts` | entrypoint | `npx tsx observability/joint-monitor/start.ts` — binds `:5178` (override with `JOINT_MONITOR_PORT`) |
| `contract.ts` | contract | **the only file a caller outside this folder may import** |
| `tests/joint-broadcast-proof.test.ts` | test | live proof — real server, real POST, real SSE frame received |

## วิธีรัน

```
npx tsx observability/joint-monitor/start.ts
# then, from another capability:
JOINT_MONITOR_URL=http://127.0.0.1:5178 npx tsx <whatever calls reportJoint>
```

```
npx tsx observability/joint-monitor/tests/joint-broadcast-proof.test.ts
```

## NOT_YET_BUILT

- Nothing calls `reportJoint`/`reportViolation` from
  `control/command-router/router.ts` or `control/agent-gateway/gateway.ts`
  yet — that wiring is the plan's step 4, done after this folder exists
  standalone and is proven (step 1).
- `control/circuit-breaker/` (the `reportViolation` caller) does not
  exist yet — plan step 6.
- No durable-log rotation/retention policy — `data/joints.jsonl` and
  `data/violations.jsonl` grow unbounded on disk (the in-memory ring
  buffer this folder serves live IS bounded, at `MAX_JOINTS_IN_MEMORY`/
  `MAX_VIOLATIONS_IN_MEMORY` in `joint-store.ts`); acceptable for this
  round, flagged for a future pass rather than silently ignored.
