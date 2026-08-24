# control/agent-production-ingress/

**หน้าที่:** ONE INGRESS — ทางเดียวที่ Agent ส่งงานเข้ามา หลังจุดนี้ Agent
ไม่มีอำนาจตัดสินใจต่อ เสนอได้แค่ intent/candidate/evidence Agent เลือก
repository/workspace/lock/duplicate/admission เองไม่ได้ — DNA OS ตัดสิน
ทั้งหมดผ่าน capability จริงที่มีอยู่แล้วเท่านั้น:

```
REPOSITORY_AUTHORITY_RESOLUTION (software/repository-registry, real — Agent's claim ถูก verify ซ้ำเสมอ, อ่านอย่างเดียว ไม่ lock)
  -> WORK_OWNERSHIP (control/work-coordination -> execution/process-lock, real cross-process, scoped ด้วย repository_id ที่ resolve แล้ว)
  -> SOURCE_WORKSPACE_ISOLATION (control/source-workspace, real local git worktree — เฉพาะเมื่อ resource_scope ไม่ว่าง)
  -> EXISTING_ASSET_LOOKUP (software/capability-registrar's searchOverlap, real, reused)
  -> DUPLICATE_RESERVATION (control/duplicate-reservation -> control/registration-pipeline, real, atomic authoritative read/write)
  -> COMPLETE
```

**เหตุผลที่ REPOSITORY_AUTHORITY_RESOLUTION มาก่อน WORK_OWNERSHIP (พิสูจน์
จริงจาก test):** claim lock ก่อน resolve repository จะได้ SOURCE lock key
เป็น `SOURCE:unscoped:<resource>` แทนที่จะเป็น
`SOURCE:<repository_id>:<resource>` จริง — ทำให้สอง Agent บนคนละ
repository_id ที่ยังไม่ resolve ชนกันผิดที่ (หรือไม่ชนกันตอนที่ควรชน) —
พบและแก้จริงระหว่างเขียน test ข้อ C

**Input:** `AgentProductionRequest`, `storeFactory: () => RegistryStore`
(ไม่ใช่ store สำเร็จรูป — ดู `control/duplicate-reservation/`'s ATOMIC
AUTHORITATIVE READ/WRITE)

**Output:** `AgentProductionResult` (รวม `workspace: WorkspaceReservation
| null` — ค่าจริงเมื่อสร้าง worktree, `null` เมื่อ NOT_APPLICABLE)

**Dependency ที่อนุญาต:** `../../software/repository-registry/contract.ts`,
`../work-coordination/coordination.ts`, `../source-workspace/contract.ts`,
`../../software/capability-registrar/contract.ts`,
`../duplicate-reservation/contract.ts`,
`../../software/registry-database/contract.ts` (type เท่านั้น), `./types.ts`

**SOURCE_WORKSPACE_ISOLATION (real, 2026-08-21):** ใช้ local `git
worktree` จริงผ่าน `control/source-workspace/` — REMOTE GitHub branch/ref
creation ยัง **BLOCKED จริง** ด้วย Owner lock 2 จุด (ไม่แตะ):
`execution/run/contract.ts`'s hard block ห้าม `control/` import,
`connections/github/host-runtime.ts`'s GET-only/PUT-only lock ถาวร local
worktree isolation คือเส้นทางจริงที่ไม่ชน lock ใดเลย — ดู
`../source-workspace/README.md`

**ขอบเขตที่ยังไม่ได้ทำรอบนี้ (honest, NOT_YET_BUILT):** WORLD RESOLUTION
(ยังไม่มี real classifier — ดู System-of-Systems report ก่อนหน้า)

**Responsibility boundary (Owner, 2026-08-21, SOFTWARE PRODUCTION PATH
COMPOSITION round):** this folder owns **PRE-WRITE production
preparation only** — REPOSITORY_AUTHORITY_RESOLUTION -> WORK_OWNERSHIP
-> SOURCE_WORKSPACE_ISOLATION -> EXISTING_ASSET_LOOKUP ->
DUPLICATE_RESERVATION -> `COMPLETE`. It never continues past `COMPLETE`
into destination/target/policy/admission/execution — that continuation
is `control/work-result-ingress/`'s own responsibility
(**POST-WORK result ingestion and registration**, see its README), once
the Agent has actually done real work inside the real, isolated
`control/source-workspace/` worktree this folder handed it and submits
the result. WRITE ADMISSION for real SOURCE CODE reuses
`control/work-result-ingress/`'s real `continueRegisteredArtifact()` (->
`control/artifact-destination/` -> `control/target-resolution/` ->
`control/permission-policy-resolution/` -> `control/admission/` ->
`control/source-execution/`) — this folder does not duplicate any of it.

**สิ่งที่ห้ามแตะ:** ห้ามเชื่อ `requested_owner`/`requested_repository`
ของ Agent โดยตรง — ต้อง resolve ผ่าน `software/repository-registry/`
เสมอ ห้ามเรียก `runRegistrationPipeline`/`classifyCandidate`/
`resolveDuplicate` ตรงๆ — ต้องผ่าน `control/duplicate-reservation/`
เท่านั้น ห้ามปล่อย work claim ค้าง (`finally` block เสมอ) ห้ามให้ Agent
เลือก branch_ref/worktree_path เอง — derive จาก work_id เสมอ (ดู
`control/source-workspace/`)
