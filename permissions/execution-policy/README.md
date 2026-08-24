# permissions/execution-policy/

**หน้าที่:** สิทธิ์การ Run/Test/Deploy — ใครมีสิทธิ์สั่งให้ Software ตัวไหน
รัน/ทดสอบ/deploy ได้บ้าง แยกจาก `../access-control/` (ซึ่งตอบแค่ "identity
นี้คือใคร ผูกกับ account ไหน") และแยกจาก `../software-scope/` (ซึ่งตอบว่า
account ไหนถือ software ตัวไหน) — ไฟล์นี้ตอบคำถามที่สามคือ "ถือ software
แล้ว มีสิทธิ์สั่ง execution จริงแค่ไหน"

**Status (2026-08-16):** the deterministic policy layer itself is built
and tested — `evaluateExecutionPermission()` in `contract.ts`. What is
still `NOT_YET_BUILT` is everything around it: `../../execution/run/`
(the executor this policy is meant to gate) and
`../../control/command-router/` (the only intended real caller). This
folder was deliberately built first, ahead of both, per Owner instruction
2026-08-16, so that wiring the runtime entrypoint later never has to
happen without a permission boundary already in place — see
`../../reports/EXECUTION_MIGRATION_PLAN.md` STEP 9.

**Input:** `ExecutionPermissionRequest` + `ExecutionPolicyContext`
(resolved Identity, Membership rows, ExecutionGrant rows, and a
`CommandPolicyDescriptor` — all supplied by the caller; this module
resolves none of them itself). See `types.ts`.

**Output:** `ExecutionPermissionDecision` — `ALLOW` / `DENY` /
`OWNER_REVIEW`, always with full rule-by-rule evidence, never a bare
boolean. See `contract.ts`.

**Dependency ที่อนุญาต:** `../access-control/` (`Identity`, `Membership`
types only). No dependency on `../software-scope/`, `../../execution/`,
or `../../control/` — none of those are imported here, and none of them
may be until a future round explicitly wires them.

**สิ่งที่ห้ามแตะ:**
- ห้ามให้ policy นี้กลายเป็นจุดเดียวที่ authorize ทั้งระบบ — ยังต้องผ่าน
  access-control ก่อนเสมอ (this ต่อยอด ไม่ทดแทน).
- Never let this module resolve identity, sessions, or tokens itself —
  it consumes already-resolved `Identity`/`Membership` context only.
- Never let it execute a command, import an executor, or accept a raw
  shell string — see `types.ts`'s `CommandPolicyDescriptor` /
  `ExecutionPermissionRequest.requested_args` (structured tokens only).
- Never call this from `../../execution/run/` or
  `../../control/command-router/` yet — both are `NOT_YET_BUILT`. Wiring
  either is explicitly out of scope until a separate, later round.

**Files:**
- `types.ts` — `ExecutionPermissionRequest`, `ExecutionPermissionDecision`,
  `ExecutionGrant`, `CommandPolicyDescriptor`, `ExecutionPolicyContext`.
- `evidence.ts` — `pass()` / `fail()` / `skipped()` — the only place a
  `RuleEvidence` record is constructed.
- `rules.ts` — the nine deterministic rules, in fixed evaluation order.
  Private implementation — do not import from outside this folder.
- `policy.ts` — `evaluateExecutionPermission()`, the orchestrator. Private
  implementation — do not import from outside this folder.
- `contract.ts` — **the only file a caller outside this folder may
  import.** Re-exports `evaluateExecutionPermission` and every type
  needed to call it.
- `tests/policy.test.ts` — plain-program test (no framework/package.json
  in this repo yet), drives `contract.ts` only. Run with:
  `npx tsx permissions/execution-policy/tests/policy.test.ts`
  22/22 passing as of 2026-08-16.
