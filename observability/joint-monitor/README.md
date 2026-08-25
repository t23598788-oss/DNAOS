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
control/circuit-breaker/daemon.ts (real, since 2026-08-24)─→ reportViolation() ─→ POST /violations ─┘
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
| `tests/router-wiring-proof.test.ts` | test | live proof — real `routeOwnerCommand()`/`persistStatus` reach this dashboard |
| `tests/authenticated-report-proof.test.ts` | test | live proof — reporting into a `JOINT_MONITOR_SHARED_SECRET`-protected server works, and a missing/wrong secret is still refused 401 |

## วิธีรัน

```
npx tsx observability/joint-monitor/start.ts
# then, from another capability:
JOINT_MONITOR_URL=http://127.0.0.1:5178 npx tsx <whatever calls reportJoint>
```

```
npx tsx observability/joint-monitor/tests/joint-broadcast-proof.test.ts
npx tsx observability/joint-monitor/tests/router-wiring-proof.test.ts
npx tsx observability/joint-monitor/tests/authenticated-report-proof.test.ts
```

**Node >=18 is required, and `../../.nvmrc` pins 24 — run these with it.**
Under Node 16 there is no global `fetch`, so `./host-runtime.ts`'s
`hostPostJson` throws, `./client.ts` swallows it by design (never throw at
a real caller), and every POST silently does nothing: the SSE half of
`joint-broadcast-proof.test.ts` passes and the reporting half fails.
`../../reports/RECOVERY_INDEX_2026-08-24.md` recorded that as a "known
pre-existing flake" — it is not flaky, it is Node 16; all three tests pass
deterministically under the pinned 24 (verified 2026-08-26).

## Reaching a remote joint-monitor

`JOINT_MONITOR_URL` points `./client.ts` at a non-loopback dashboard (the
Railway `joint-monitor` service). If that server has
`JOINT_MONITOR_SHARED_SECRET` set — the production one does — the reporter
must send the same secret, so set **both** variables on every reporting
service:

```
JOINT_MONITOR_URL=https://joint-monitor-production.up.railway.app
JOINT_MONITOR_SHARED_SECRET=<the same secret that server has>
```

Set only the URL and every report is answered 401 and dropped in silence
(`reportJoint` never throws). Set neither and reports go to this
container's own empty `127.0.0.1:5178`, which is exactly the state the
Railway deployment sat in from 2026-08-24 to 2026-08-26: a live dashboard
holding one manual probe row and no real traffic. Both variables are wired
in `../../.railway/railway.ts` (URL) plus `railway variables --set`
(secret, never committed).

## NOT_YET_BUILT

- ~~Nothing calls `reportJoint`/`reportViolation`~~ — **done**: real call
  sites are `control/command-router/router.ts#admitAndBuildResult`,
  `control/agent-gateway/gateway.ts#persistStatus` (plan step 4) and
  `control/circuit-breaker/daemon.ts` (plan step 6), all three proven live
  by `tests/router-wiring-proof.test.ts` and this folder's other tests.
- No durable-log rotation/retention policy — `data/joints.jsonl` and
  `data/violations.jsonl` grow unbounded on disk (the in-memory ring
  buffer this folder serves live IS bounded, at `MAX_JOINTS_IN_MEMORY`/
  `MAX_VIOLATIONS_IN_MEMORY` in `joint-store.ts`); acceptable for this
  round, flagged for a future pass rather than silently ignored.
