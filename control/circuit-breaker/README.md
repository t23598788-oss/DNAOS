# control/circuit-breaker/ — Pillar 3 of the 3-pillar OS-level enforcement plan

**หน้าที่:** an independent poll daemon that watches every currently-active
`control/agent-host/`-launched subprocess and kills it (when enforcement
is on) the moment it writes a file that violates Capability Folder Law's
import-boundary rule — Owner instruction 2026-08-22 ("Deterministic
Circuit Breaker"). See `/Users/tam/.claude/plans/zesty-spinning-ripple.md`
for the full 3-pillar plan this folder is one part of.

**Scope, stated honestly:** this can only ever act on PIDs
`control/agent-host/`'s own live registry (`listActiveLaunches()`) is
already tracking — a kernel sandbox can only confine a process launched
inside it, so this daemon has no mechanism to reach, watch, or kill an
interactive coding-agent session (Claude Code, Codex) working on this
repo directly, including the session that built this folder. That is a
structural boundary, not a gap this round left unfinished.

**Architecture:**

```
control/agent-host/ (listActiveLaunches) ──┐
                                            ├─→ control/circuit-breaker/daemon.ts (poll, default 2s)
governance/source-validation/ (checkImportBoundaries) ──┘        │
                                                                  ├─→ observability/joint-monitor/ (reportViolation — ALWAYS)
                                                                  └─→ control/agent-host/ (killLaunch — ONLY if CIRCUIT_BREAKER_ENFORCE=1)
```

**Input:** none from a caller — `startCircuitBreaker(options?)` polls
real, already-existing state (`listActiveLaunches`, on-disk file mtimes,
`checkImportBoundaries`); `pollOnce(options?)` runs exactly one poll
cycle synchronously, for tests.

**Output:** every detected violation reaches
`observability/joint-monitor/`'s dashboard (`:5177`) via `reportViolation`
— regardless of enforcement mode, so the dashboard goes red even in
dry-run. A process is only actually killed when `enforce`/
`CIRCUIT_BREAKER_ENFORCE=1` is set.

**Dependency ที่อนุญาต:** `../agent-host/contract.ts` (`listActiveLaunches`,
`killLaunch`), `../../governance/source-validation/contract.ts`
(`checkImportBoundaries`), `../../observability/joint-monitor/contract.ts`
(`reportViolation`).

**สิ่งที่ห้ามแตะ:**
- ห้าม kill PID ใดๆ ที่ไม่ได้มาจาก `listActiveLaunches()` ใน poll cycle
  เดียวกัน — ไม่มี launchId ที่ cache ไว้ข้าม cycle, ไม่มี PID จาก caller
- ห้าม kill เมื่อ `enforce`/`CIRCUIT_BREAKER_ENFORCE` เป็น false ไม่ว่า
  violation จะรุนแรงแค่ไหน — dry-run คือ dry-run จริง
- ห้าม poll `execution/run/`'s `workspacePolicyViolation` เพื่อ kill —
  สัญญาณนั้นคำนวณหลัง process ตายแล้วเสมอ (ดู `./daemon.ts`'s header) และ
  `execution/run/` ไม่ได้ spawn ผ่าน `../agent-host/` — นอกขอบเขตนี้เต็มๆ

---

## ไฟล์ในโฟลเดอร์นี้

| ไฟล์ | ประเภท | หน้าที่ |
|---|---|---|
| `types.ts` | contract | `CircuitBreakerOptions`, `CircuitBreakerHandle`, `PollResult` |
| `host-runtime.ts` | source | ambient `fs`/`path`/timer — read-only + interval control |
| `daemon.ts` | source | `pollOnce()` (one real cycle) + `startCircuitBreaker()` (the live timer loop) |
| `contract.ts` | contract | **the only file a caller outside this folder may import** |
| `tests/kill-on-violation-proof.test.ts` | test | live proof — real launch, real violating write, real detection, real kill (enforce=true) and real survival (enforce=false) |

## วิธีรัน

```
npx tsx control/circuit-breaker/tests/kill-on-violation-proof.test.ts
```

## Risk staging (per the plan — genuinely destructive-capable code)

Default **OFF** (`CIRCUIT_BREAKER_ENFORCE` unset ⇒ report-only/dry-run).
A real dry-run period (watching, never killing) is required before this
is ever turned on for real agent-host launches — a false-positive kill
mid-write could corrupt work.

## NOT_YET_BUILT

- No process supervises `startCircuitBreaker()` itself yet (no launchd
  plist, no `npm run` script) — it is a real, callable, tested function,
  not yet a running background service.
- The 91 pre-existing Capability-Folder-Law violations
  `governance/source-validation/`'s checker finds at repo scale (see its
  own README) are not remediated by this folder — this daemon only acts
  on NEW writes from a currently-tracked launch, never retroactively.
