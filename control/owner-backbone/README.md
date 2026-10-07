# owner-backbone — Owner command in, system events out

**หน้าที่:** the ONE realtime path between the Owner and the system.
An Owner command arrives on any interface, is persisted, is acknowledged
immediately, dispatches itself asynchronously, and reports back as
`SystemEvent`s that every surface reads in the same shape.

DNA OS is the authority. An AI may translate the Owner's words INTO an
`OwnerCommandEnvelope` and may render `SystemEvent`s back out. It never
resolves architecture, never chooses a resource, never executes, and never
decides that work succeeded.

**Input:** `OwnerCommandEnvelope` (see `./types.ts`), over HTTP at
`transport/owner-command-http/owner-backbone-routes.ts` or in-process
through `./contract.ts`.

**Output:** `CommandAcknowledgement` synchronously; `SystemEvent`s
asynchronously, persisted as evidence and delivered to the joint-monitor
consumer; `WorkStateView` on read.

**Dependency ที่อนุญาต:**
`../work-resolution/` (architecture, persisted before dispatch),
`../work-continuation/` (waiting and resume),
`../runtime-control/` (launchd operations and real health probes),
`../agent-gateway/` (evidence store, and the real Agent Host),
`../scheduler/` (which execution resource),
`../incident-remediation/` (incident state),
`../output-routing/` + `../../observability/joint-monitor/` (who receives
events, and delivery).

**สิ่งที่ห้ามแตะ:**
- Never execute inside `submitOwnerCommandEnvelope`. It persists, emits
  `COMMAND_RECEIVED`, schedules dispatch, and returns. Nothing awaits work.
- Never decide a code change succeeded from what an Agent reported. Only
  real file digests taken before and after decide that — see
  `./gateway.ts#scopeDigest`.
- Never mint a `work_id` for work that already has one. A command carrying
  `work_id_if_existing` continues that work, including across a resume.
- Never build a second waiting store, event bus, scheduler or transport.
  Each already exists and is listed above.
- Never infer delivery from "the call returned". `./events.ts` reads the
  transport's real result, and a failure is recorded against an event that
  stays persisted regardless.

## The autonomous loop

`./autonomous-recovery.ts` is the sequencing that did not exist: a real
health fact from `../runtime-control/`, a deterministic policy lookup
(is this service declared under the launchd authority?), the EXISTING
bounded recovery in `../work-session-state/#recoverRuntime`, real process
evidence from `../machine-observation/`, a re-probe of the ORIGINAL
condition, and a `DependencyEvent` per waiting work item into
`../work-continuation/`.

It contains no launchctl call, no kill, no spawn and no process
supervision. The restart's own report never decides anything — only the
re-probe does.

## What keeps it running

`./start.ts` is the long-lived runtime, declared as the `recovery-supervisor`
service in `../runtime-control/#SERVICES` and kept alive by launchd
(`RunAtLoad` + `KeepAlive`). DNA OS does not supervise it — the machine
already has a process supervisor, and a second one would be duplication.
It never watches itself, for the same reason.

Its memory does not matter. Conditions, attempts, blockers and canonical
actions all live in `./action-ledger.ts`, which is an append-only view over
the EXISTING evidence store. Kill the process and it comes back knowing
everything it knew; nothing is reconstructed by an AI and nothing is
re-derived by scanning the repo.

`./action-ledger.ts` also separates WAITERS from PHYSICAL ACTIONS. Nine work
items waiting on one service is nine waiters and ONE restart; the other
eight share that restart's evidence. Work identities are never merged.

## How it is proven

- `tests/backbone-proof.test.ts` — the contracts and the in-process path.
- `tests/production-loop-proof.test.ts` — the production loop: real HTTP
  over a real socket, dispatch with no caller invoking it, a real unmet
  prerequisite parked in `../work-continuation/` and resumed on the same
  work_id, real SSE reconnect by `Last-Event-ID`, real delivery to a real
  consumer, and a real kernel-confined process making a real approved file
  mutation (with the out-of-scope write denied as the control).

- `tests/live-recovery-proof.test.ts` — the autonomous loop against a REAL
  fault, watched rather than driven. It starts the supervisor and asserts
  afterwards; it never triggers a step itself, and it never creates an
  outage.
- `tests/resource-failover-proof.test.ts` — a real unavailable execution
  resource, failed over on the SAME work_id with a new execution_id, and
  parked as WAITING_FOR_RESOURCE when every authorized resource is gone.

- `tests/zero-touch-proof.test.ts` — from T0 onward, ZERO Owner commands: a
  real induced-and-reverted fault is consumed, decided, executed, verified
  and fanned out to nine waiting work items on one physical restart; then
  the supervisor is killed and launchd restores it with its state intact.
- `tests/loop-safety-proof.test.ts` — bounded retry, blockers, reuse
  expiry, and resource availability decided without launching anything.

`tests/agent-target/` is the isolated write target those proofs mutate.
Production business code is never the subject of a proof.
