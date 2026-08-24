# control/command-router/

**หน้าที่:** ศูนย์กระจายคำสั่ง — จุดเดียวที่รับ `CommandEnvelope` ทุกฉบับ
(จาก `../owner-command/` เท่านั้นในรอบนี้) แล้ว classify → (permission
check ถ้าจำเป็น) → route ไปยัง capability ที่ลงทะเบียนไว้ใน
`capability-registry.ts` เท่านั้น — ไม่มี business logic หนักอยู่ที่นี่
ตามที่ระบุไว้เดิม

**Status (2026-08-20):** built and tested. Real loopback transport now reaches
`owner-command` and the router end-to-end. The router has real routing to two CONNECTED
capabilities (`execution`, `github`) and a real permission-gate call to
`permission-reasoner` (this repo's own `permissions/execution-policy/`).
`file-intelligence` and `research-engine` are registered but
`NOT_CONNECTED` — routing to them returns `BLOCKED`, never a faked
result.

**Input:** `CommandEnvelope` (`../../contracts/command/command-envelope.ts`)
+ the raw Owner command text + (optional) an explicit multi-step plan and
an `ExecutionPolicyContext` for any step that needs a permission decision.

**Output:** `CapabilityResult`
(`../../contracts/command/capability-result.ts`) — always exactly ONE
result per Owner command, even when the command took several steps.

**Dependency ที่อนุญาต:** `./types.ts`, `./capability-registry.ts`,
`./host-runtime.ts`, `../../contracts/command/`,
`../../permissions/execution-policy/contract.ts`,
`../../execution/run/contract.ts`,
`../../connections/github/github-adapter.ts` (its one documented public
entry point — see `../../connections/github/adapter-contract.ts`).

**สิ่งที่ห้ามแตะ:**
- ห้าม router รู้วิธี "คุยกับ software จริง" โดยตรง — ทุกการเรียกไปที่
  capability ต้องผ่าน public contract/adapter entry เท่านั้น (ดู
  `../../governance/architecture-rules/CAPABILITY_FOLDER_LAW.md` ข้อ 9)
- ห้ามเรียก `../../execution/run/contract.ts`'s `startExecution` โดยไม่
  ผ่าน `evaluateExecutionPermission` ก่อนในการเรียกเดียวกัน — ไม่มีทาง
  router→executor bypass ไม่ว่ากรณีใด (ดู `./router.ts`'s header และ
  `../ARCHITECTURE_DECISIONS.md` §PERMISSION_BOUNDARY)
- ห้ามเรียก capability ที่ `health_status: "NOT_CONNECTED"` — คืน
  `BLOCKED` เสมอ ไม่ปลอมผลลัพธ์
- ห้าม import implementation ภายในของ capability folder อื่นตรงๆ (เช่น
  `connections/github/status-operations.ts`) — เข้าได้เฉพาะทาง entry
  point ที่ folder นั้นประกาศไว้เอง

**Files:**
- `types.ts` — `CapabilityRegistration`, `RouterStep`,
  `ClassificationOutcome`, `EndpointReference`.
- `capability-registry.ts` — the 5 registered capabilities
  (`file-intelligence`, `permission-reasoner`, `research-engine`,
  `execution`, `github`) with verified `health_status`.
- `router.ts` — `classifyCommand` (keyword-set matching, OWNER_REVIEW on
  ambiguity, UNSUPPORTED_COMMAND on no match) + `routeOwnerCommand` (the
  permission gate + real capability invocation + multi-step sequencing).
  Private.
- `host-runtime.ts` — `crypto.randomUUID`/`Date` ambient. Private.
- `contract.ts` — the ONLY file `../owner-command/` may import from.
- `tests/router.test.ts` — drives `contract.ts` directly, exercises real
  `permissions/execution-policy/`, real `execution/run/`, and the real
  github adapter entry point (deterministic credential rejection, no
  network).

See `../ARCHITECTURE_DECISIONS.md` for why each registry entry is
CONNECTED/NOT_CONNECTED and for the no-cross-repo-import rule.
