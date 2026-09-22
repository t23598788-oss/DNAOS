# CLINE BEHAVIOR → DNA OS MAP (PHASE 3, deliverable 1/4)

> **STOP ก่อน coding** — เอกสารนี้เป็นการ map หลักการทำงาน (behavior) ไม่ใช่การ copy source code และไม่ผูก DNA OS กับ Cline
> ทุกช่อง "ของเดิมใน DNA OS" ชี้ไฟล์/ทะเบียน **ที่มีจริง** (ตรวจเมื่อ 2026-09-22) · ไม่มีข้อใดถูกแต่งขึ้น
> สถานะ: `EXISTS` = มีกลไกจริงใช้ได้ · `DUPLICATED` = มีมากกว่า 1 ที่ทำเรื่องเดียวกัน (ต้องรวม) · `MISSING` = ยังไม่มีกลไก
> คู่กับ: `DNA_OS_EXECUTION_LIFECYCLE.md` · `CANONICAL_JOB_CONTRACT.md` · `CONTROL_ENGINE_GAP_ANALYSIS.md`

## สรุปผล map (13 behaviors)
| # | Behavior | สถานะรวม | ของเดิมที่ใช้ได้จริง | สิ่งที่ต้องทำ (integration · ไม่ใช่สร้างใหม่) |
|---|---|---|---|---|
| 1 | Planning | **EXISTS** | `executionPlannerRuntime.ts`, `executionPlanRuntime.ts`, `contextPlannerRuntime.ts`, `switchBasedOrchestratorRuntime.ts`, `execution_context/approve-plan` | ผูก business workflow ให้มี plan object เดียวกัน |
| 2 | Scope | **DUPLICATED** | `EXECUTION_CONTRACT.json` (execution_order/output_contract) · `LOCK_MANAGER.json` (per-file lock) · `targetPolicy.ts`/`restrictedCapabilityRegistry.ts` | รวม "scope" เป็น 1 สัญญา: file scope + path scope + capability scope |
| 3 | Context | **EXISTS** | `aiContextRuntime.ts`, `executionContextRuntime.ts`, `EXECUTION_CONTEXT.json` (162KB checkpoints + hash), `contextPlannerRuntime.ts` | ให้ business job อ่าน/เขียน checkpoint ชุดเดียวกัน |
| 4 | Tool selection | **EXISTS** | `worker-tool-registry.json` (per-tool read/write scope + approvalPolicy), `capabilityResolverRuntime.ts`, `workerSelectorRuntime.ts`, `command-registry.json` (99 commands) | ขยายทะเบียนให้ครอบ business actions (ไม่ใช่แค่ IDE tools) |
| 5 | Model selection | **EXISTS** | `AI_REGISTRY.json` (13 agents), `workerRegistry.ts` + `workerAdapters/`, `providerRegistryRuntime.ts`, `workerUsageEvents` (38 cols) | เพิ่ม Cline/Codex ให้ครบ + ผูก model กับ cost tier |
| 6 | Cost awareness | **EXISTS (dual)** | `COST_BUDGETS.json` (owner authorization) + `costGateRuntime.ts` + `COST_LEDGER.json` (append-only actual) + `executionBudgetRuntime.ts` (safety ceiling 1.0) + `usageMeterRuntime.ts` | ประกาศชัดว่านี่คือ 2 ชั้น (ceiling vs authorization) — อย่ารวมเป็นตัวเดียว |
| 7 | Approval | **EXISTS (หลายชั้น)** | owner passkey/Touch ID + `pending_authorizations` + `execution-context/approve` + `owner-command/approve` + connector `OWNER_REQUIRED` + `destructive_action_gate` | รวมเป็น approval matrix เดียว (ดู `DNA_OS_AUTHORITY_BOUNDARY_MATRIX.md`) |
| 8 | Execution | **EXISTS** | `executionRuntime.ts`, `execution/run` + `run/[id]` + `commands` + `stream/[id]` + `cancel/[id]`, `codeWorkerRuntime.ts`, `edgeFunctionWorkerRuntime.ts`, `executionHandRuntime.ts` | ให้ business write (canonical) เดินใน lifecycle เดียวกัน |
| 9 | Observation | **EXISTS** | `monitoringRuntime.ts`/`alertRuntime.ts`, `evidenceCollectorRuntime.ts`, `worker_usage_events`, `audit_logs`, `connector_webhook_events`, `system_health_status`, `systemRealityRuntime.ts` | ผูก observation ของ job ธุรกิจ (order/slip/job) เข้า evidence model เดียว |
| 10 | Retry | **EXISTS** | `queue/retry/[id]`, `queueRuntime.ts` (+ `queue/types`), `gapLoopRuntime.ts`, `deadEndSweepRuntime.ts` | กำหนด retry policy ต่อ stop condition (ดู lifecycle §stop) |
| 11 | Verification | **EXISTS (แข็ง)** | `acceptanceContractRuntime.ts`, `testRegistry/testRuntime`, `VALIDATION_RESULTS.json` (VR-xxxx), 16+ verifier scripts, `governance/verify`, `architecture-drift-alert` | เพิ่ม acceptance contract ให้ business job (ใบเงิน/งานขนส่ง) |
| 12 | Progress | **EXISTS** | `EXECUTION_CONTEXT.json` checkpoints (step_status/step_report), `queueRegistry.ts`, `CURRENT_STATE.json`, `MASTER_EXECUTION_STATE.md`, `state-reconcile.ts` | ทำให้ business job รายงาน progress ที่เดียวกัน |
| 13 | Handoff | **EXISTS** | `HANDOFF.json`, `executionHandRuntime.ts`, `workers/execution-hand` (INBOX/OUTBOX), `factoryWorkspaceRuntime.ts` (`approve-context`/`release`), `FACTORY_CENTRAL_REGISTRY.json` (Rule 253: รายงานเข้า central ก่อน) | ให้ handoff ข้ามเครื่อง (agent ↔ มนุษย์ ↔ worker) ใช้รูปแบบเดียว |

## ตารางละเอียด (behavior → ของเดิม → ช่องที่ต้องปิด)
### 1. Planning
- **หลักการ Cline**: แยก "เข้าใจ-วางแผน-ลงมือ" ชัด · แผนต้องมีลำดับและจุดหยุด
- **ของเดิม**: `executionPlannerRuntime.ts`, `executionPlanRuntime.ts`, `contextPlannerRuntime.ts`, route `ide/execution-context/approve-plan`, `ide/factory-workspace/sessions/[id]/create-plan`
- **สถานะ**: EXISTS (สำหรับงาน IDE) · **ช่อง**: งานธุรกิจ (เช่น รับคำขอ→เสนอราคา) ยังไม่มี plan object — มีแต่ business_event status
- **Integration point**: ให้ business job สร้าง plan ผ่าน `executionPlanRuntime` แล้วเก็บใน `EXECUTION_CONTEXT.json` (ไม่สร้างตารางใหม่)
- **Authority**: วางแผนได้ทุกระดับ · **อนุมัติแผนก่อนรัน = owner** เมื่อเป็นงานเกิน 1 capability หรือแตะเงิน
- **Cost boundary**: ประเมินก่อน dispatch (`executionBudgetRuntime` ceiling + `COST_BUDGETS` authorization)
- **Stop condition**: ข้อมูลไม่พอ (plan incomplete) → `awaiting_info` (pattern เดียวกับ `auto-create.ts` ที่รายงานว่าขาดอะไร)
- **Recovery**: กลับไปเก็บข้อมูล → re-plan (ไม่เริ่มใหม่ทั้งงาน)

### 2. Scope
- **หลักการ Cline**: ทำงานเฉพาะในขอบเขตที่ได้รับอนุญาต · แตะไฟล์เท่าที่จำเป็น · ประกาศก่อนทำ
- **ของเดิม 3 ที่**: `EXECUTION_CONTRACT.json` (execution_order/output_contract) · `LOCK_MANAGER.json` (per-file lock ledger, หลาย agent พร้อมกันได้ถ้าไฟล์ต่างกัน) · `targetPolicy.ts` + `restrictedCapabilityRegistry.ts` (ข้อจำกัดปลายทาง)
- **สถานะ**: **DUPLICATED** — มี 3 กลไกที่ตอบคำถาม "ทำได้แค่ไหน" แต่ไม่พูดภาษาเดียวกัน
- **Integration point**: ประกาศสัญญาเดียว `scope = {files, paths, capabilities, data, spend}` แล้วให้ทั้ง 3 กลไกอ่านสัญญานี้ (ไม่ต้อง merge โค้ด — เพิ่ม field อ้างอิง)
- **Authority**: เกิน scope = ต้องขอ amendment (owner) · **Cost boundary**: spend scope = `COST_BUDGETS`
- **Stop condition**: ต้องแตะไฟล์/ตารางที่ไม่ได้ประกาศ → หยุดและรายงาน (ไม่ silent ขยาย)
- **Recovery**: ขอ scope เพิ่มจาก owner แล้วทำต่อจากจุดเดิม (checkpoint ยังอยู่)

### 3. Context
- **ของเดิม**: `aiContextRuntime.ts`, `executionContextRuntime.ts`, `EXECUTION_CONTEXT.json` (checkpoints มี checkpointId/hash/actor/trigger/current_step/step_status/step_report/previousCheckpointId), `contextPlannerRuntime.ts`
- **สถานะ**: EXISTS — และแข็งกว่าที่คาด (มี hash + previousCheckpointId = chain ตรวจสอบได้)
- **Integration point**: business job ใช้ checkpoint ชุดเดียวกัน (ไม่สร้างระบบ context ใหม่)
- **Authority**: อ่านได้ตาม scope · **Cost boundary**: context ใหญ่ = ต้นทุน token → ต้องมีเพดานขนาด context
- **Stop condition**: context ขัดแย้งกับความจริง (registry/DB) → หยุด ยึดความจริงจาก DB
- **Recovery**: โหลด checkpoint ล่าสุดที่ hash ตรง แล้วทำต่อ

### 4. Tool selection
- **ของเดิม**: `worker-tool-registry.json` (ต่อ tool: readOnly/permittedReadScope/permittedWriteScope/approvalPolicy/privacyLevel/networkPolicy/backingRoute/sourceFile), `capabilityResolverRuntime.ts`, `workerSelectorRuntime.ts`, `registry/command-registry.json` (99 commands), `capability-registry.json` (202 capabilities พร้อม InputContract/OutputContract/ExecutionType/Mutability)
- **สถานะ**: EXISTS (สำหรับ IDE/MCP) · **ช่อง**: business actions (ออกเอกสาร/จัดสรรเงิน) ยังไม่อยู่ในทะเบียนเดียวกัน
- **Integration point**: ลงทะเบียน business capability เข้า `capability-registry` โดยชี้ OwnerModule = `engines/canonical/*`
- **Authority**: tool ที่ `requiresOwnerApproval` ต้องมี approval record · **Cost boundary**: tool ที่มีค่าใช้จ่ายต้องผ่าน cost gate
- **Stop condition**: ไม่มี tool ที่ตรงความต้องการ → หยุด (ห้ามประดิษฐ์ทางลัด)
- **Recovery**: เลือก tool อื่นที่อยู่ในทะเบียน / ขอ owner

### 5. Model selection
- **ของเดิม**: `AI_REGISTRY.json` (13 agents + compatibility_contract), `workerRegistry.ts` + `workerAdapters/`, `providerRegistryRuntime.ts`, `workerUsageEvents` (38 คอลัมน์), `ai_connection_status` (**0 แถว = ยังไม่มีสถานะจริง**)
- **สถานะ**: EXISTS (ทะเบียน) / **PARTIAL** (สถานะจริงว่าง + Cline/Codex ไม่อยู่ในทะเบียน)
- **Integration point**: ให้ทุก AI (รวม Cline ในรอบนี้) มีแถวใน `AI_REGISTRY` + สถานะจริงใน `ai_connection_status`
- **Authority**: model ที่แตะข้อมูลจริงต้องมี scope + approvalPolicy · **Cost boundary**: แต่ละ model มี cost tier → gate ก่อน dispatch
- **Stop condition**: model ไม่มีสิทธิ์/ไม่มี authorization → หยุด (ห้ามใช้ model อื่นแทนโดยไม่แจ้ง)
- **Recovery**: switch model ตามนโยบาย + บันทึกเหตุผลลง usage events

### 6. Cost awareness
- **ของเดิม 2 ชั้นชัดเจน**: ① `executionBudgetRuntime.ts` = **safety ceiling** ต่อ session/step (maxEstimatedCost default 1.0) ② `COST_BUDGETS.json` = **owner authorization ledger** ต่อ task/capability + `costGateRuntime.ts` ตรวจก่อน dispatch PAID/UNKNOWN_COST + `COST_LEDGER.json` = append-only actual cost (เขียนโดย `recordActualCost()` เท่านั้น) + `usageMeterRuntime.ts`
- **สถานะ**: EXISTS — **ไม่ควร merge** 2 ชั้นนี้ (คนละความหมาย) แต่ต้องอธิบายให้ชัดใน contract
- **Integration point**: ทุก job (รวมงานธุรกิจ) ต้องระบุ `cost.kind` = FREE/PAID/UNKNOWN_COST และผ่าน gate
- **Authority**: เกิน authorization = owner เท่านั้น · **Cost boundary**: hard stop เมื่อ ceiling/budget หมด
- **Stop condition**: ประมาณการเกิน budget, provider ตอบราคาไม่ชัด (UNKNOWN_COST) โดยไม่มี authorization → หยุดก่อนจ่าย
- **Recovery**: owner เพิ่ม authorization → รันต่อจาก checkpoint (ledger เก็บของเดิมไว้แล้ว)

### 7. Approval
- **ของเดิม**: owner passkey/QR/Touch ID (`owner_devices`, `owner_verification`, infra `control/owner-authentication`) · `pending_authorizations` (10) · `execution-context/approve` + `/gate` · `owner-command/approve` · connector `OWNER_REQUIRED` + `gateway/proposals/[id]/decide` · `destructive_action_gate` + `destructive_action_log` · `approve-context`/`approve-plan`/`approve-review`/`approve-proposal`
- **สถานะ**: EXISTS แต่ **กระจายหลายทาง** → ต้องมี "approval matrix" เป็นเอกสารอ้างอิงเดียว (ทำไว้แล้วใน `DNA_OS_AUTHORITY_BOUNDARY_MATRIX.md`)
- **Integration point**: approval ทุกทางเขียนหลักฐานลงที่เดียวกัน (`audit_logs`/`pending_authorizations`/proposal)
- **Stop condition**: ต้องการ approval แต่ยังไม่ได้รับ → job ค้างสถานะ `PENDING_APPROVAL` (ห้ามทำงานแทน)
- **Recovery**: approve → ทำต่อ · reject → ปิดงานพร้อมเหตุผล

### 8. Execution
- **ของเดิม**: `executionRuntime.ts`, `execution/{run,runs,commands,stream,cancel}`, `codeWorkerRuntime.ts`, `edgeFunctionWorkerRuntime.ts`, `executionHandRuntime.ts`, `queueRuntime.ts`, `workerTaskOrchestrator.ts`, `switchBasedOrchestratorRuntime.ts`, `businessFailureBridge.ts`
- **สถานะ**: EXISTS (สำหรับงาน IDE/worker) · **ช่อง**: business write (canonical) วิ่งแยก ไม่ได้อยู่ใน lifecycle นี้
- **Integration point**: business job = job type หนึ่งใน execution registry (ไม่ใช่ระบบใหม่)
- **Authority**: งานที่ mutating ต้องมี scope + approval ตาม matrix · **Cost boundary**: ก่อน dispatch + หลังจบ (ledger)
- **Stop condition**: ตรวจพบความขัดแย้ง (lock ไม่ได้/ข้อมูลไม่ตรง) → หยุดก่อนเขียน
- **Recovery**: rollback/void ตาม business semantics (documents = void ไม่ลบ)

### 9. Observation
- **ของเดิม**: `monitoringRuntime.ts` + `monitoringRegistry.ts`, `alertRuntime.ts` + `alertRegistry.ts`, `evidenceCollectorRuntime.ts`, `worker_usage_events` (38 คอลัมน์), `usageMeterRuntime.ts`, `audit_logs`, `connector_webhook_events`, `integration_gateway_events`, `system_health_status`, `systemRealityRuntime.ts`, `digitalForensicsRuntime.ts`
- **สถานะ**: EXISTS (แยกเป็น observational plane ของ IDE) · **ช่อง**: observation ของงานธุรกิจ (order/slip/job) ยังอยู่คนละที่
- **Integration point**: ทุก job ทิ้ง evidence ลงรูปแบบเดียว (event + artifact + metric) แล้วให้ dashboard อ่านรวม
- **Authority**: อ่านได้ตาม scope · **Cost boundary**: เก็บ log/metric ต้องมี retention (ไม่ให้บวม → มี storage threshold watcher อยู่แล้ว)
- **Stop condition**: สัญญาณสุขภาพตก (health/error rate) → หยุดรับงานใหม่ (drain)
- **Recovery**: แก้สาเหตุ → resume จาก checkpoint

### 10. Retry
- **ของเดิม**: `queue/retry/[id]`, `queueRuntime.ts`, `queue/types`, `gapLoopRuntime.ts`, `deadEndSweepRuntime.ts`, `recoveryRegistry.ts` + `recoveryRuntime.ts`, `restoreTestRegistry/Runtime`, `backupRegistry/Runtime`
- **สถานะ**: EXISTS · **ช่อง**: ยังไม่มีการกำหนด "retry policy ต่อประเภทความล้มเหลว" เป็นสัญญาเดียว
- **Integration point**: ผูก retry policy กับ stop condition ใน `CANONICAL_JOB_CONTRACT`
- **Cost boundary**: retry ที่มีค่าใช้จ่ายต้องนับเข้า budget เดิม (ไม่ใช่ budget ใหม่ต่อครั้ง)
- **Stop condition**: retry ครบจำนวน/ล้มเหลวซ้ำเหตุเดิม → escalate (owner)
- **Recovery**: ใช้ recovery plan/restore test ที่มีอยู่ (ห้าม retry แบบเดาสุ่ม)

### 11. Verification
- **ของเดิม**: `acceptanceContractRuntime.ts`, `testRegistry/testRuntime` + route `ide/test/runs`, `VALIDATION_RESULTS.json` (VR-xxxx: module/command/validator/result/root_cause/evidence/verification_result), verifier scripts 16+ ชุด (`canonical:*`, `connect-core:test`, `check-imports.sh`, `check-drift.sh`, `governance.sh`, `guard`), `governance/verify`, `architecture-drift-alert`, `factoryReadinessGateRuntime.ts`
- **สถานะ**: EXISTS และแข็ง (เป็นจุดที่ระบบนี้เหนือกว่า agent ทั่วไป)
- **Integration point**: business job ต้องมี acceptance contract ของตัวเอง (เช่น "ยอดตรง SQL ดิบ 100%", "เอกสารเปิดได้ตรง snapshot")
- **Authority**: ผลตรวจเป็นข้อเท็จจริง ไม่ให้ AI ตีความเอง · **Cost boundary**: verification ต้องไม่ใช้เงิน (read-only เป็นหลัก)
- **Stop condition**: verification FAIL → ห้ามประกาศสำเร็จ/ห้าม commit
- **Recovery**: แก้ที่สาเหตุแล้วรัน verification ใหม่ (เก็บทั้งผลเก่าและใหม่)

### 12. Progress
- **ของเดิม**: `EXECUTION_CONTEXT.json` (step_status/step_report + hash chain), `executionRegistry.ts`/`queueRegistry.ts`, `CURRENT_STATE.json`, `MASTER_EXECUTION_STATE.md`, `HANDOFF.json`, `scripts/state-reconcile.ts` (no-op ถ้าไม่เปลี่ยน), `CHANGELOG.json`
- **สถานะ**: EXISTS (มี 2 ระดับ: รายงาน step + รายงานสถานะระบบ) · **ช่อง**: งานธุรกิจไม่รายงานเข้า state เดียวกัน
- **Integration point**: business job เขียน progress ผ่าน `executionContextRuntime` (ไม่สร้างไฟล์ใหม่)
- **Stop condition**: state ขัดกับความจริง (drift) → หยุดและรายงาน (state-reconcile ทำหน้าที่นี้)
- **Recovery**: reconcile ใหม่จากความจริง (state = ผลลัพธ์ ไม่ใช่ความจริง)

### 13. Handoff
- **ของเดิม**: `HANDOFF.json`, `executionHandRuntime.ts`, `workers/execution-hand` (INBOX/OUTBOX + STATUS.json), `factoryWorkspaceRuntime.ts` (`prepare-context`/`approve-context`/`release`, sessions), `FACTORY_CENTRAL_REGISTRY.json` (**Rule 253: ไม่มี AI รายงาน owner ตรง — เข้า central ก่อน, MANAGER-07 triage**), `dev_loop_*` tables
- **สถานะ**: EXISTS · **ช่อง**: handoff ข้ามเครื่อง (มนุษย์ ↔ agent ↔ worker ↔ edge function) ยังไม่มีรูปแบบเดียว
- **Integration point**: ใช้ `CANONICAL_JOB_CONTRACT` เป็นซองกลางสำหรับ handoff ทุกทิศ
- **Authority**: ผู้รับช่วงต้องมี scope เท่ากับหรือแคบกว่าเดิม · **Cost boundary**: งานที่ส่งต่อต้องมีงบเหลือ/อนุมัติใหม่
- **Stop condition**: ผู้รับไม่มีสิทธิ์/ไม่มีข้อมูลครบ → ค้างที่ INBOX พร้อมเหตุผล (ไม่ทิ้งงาน)
- **Recovery**: ผู้ส่งเดิมรับคืน (กลับเป็นเจ้าของ) และบันทึกเหตุผล

## สรุปช่องว่างเชิงโครงสร้าง (3 ข้อใหญ่)
1. **สองระนาบ**: IDE/agent plane มี lifecycle ครบ · **business plane** (canonical write, edge functions, LINE) ยังไม่มี job object เดียวกัน → ต้องรวมด้วย `CANONICAL_JOB_CONTRACT` ไม่ใช่เขียนใหม่
2. **Scope ซ้ำ 3 ที่** (EXECUTION_CONTRACT / LOCK_MANAGER / targetPolicy) → ต้องมีสัญญา scope เดียวที่ทั้งสามอ้าง
3. **Approval หลายทาง** → มี matrix แล้ว (`DNA_OS_AUTHORITY_BOUNDARY_MATRIX.md`) แต่ยังไม่มี "จุดเขียนหลักฐานเดียว" ให้ครบทุกทาง

**ห้าม coding ก่อน owner อนุมัติ 3 ข้อนี้** — เอกสารนี้เป็นแผนที่เท่านั้น


