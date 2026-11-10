# DNA OS EXECUTION LIFECYCLE (PHASE 3, deliverable 2/4)

> เป้าหมาย: **ทุก AI / tool / program / business workflow ใช้ lifecycle กลางเดียวกัน**
> ทุกระยะของเอกสารนี้อ้างกลไกที่มีจริงในรีโป (ไม่สร้างใหม่) · **STOP ก่อน coding**
> ฐานอ้าง: `EXECUTION_CONTRACT.json#layer_stack` (Constitution → Execution Contract → Runtime → Scheduler → Workers · `registry/SCHEDULER.json` + `LOCK_MANAGER.json` → `AI_REGISTRY.json` + `AI_SESSIONS.json`)

## 0. หลักการ 6 ข้อที่ lifecycle นี้บังคับ
1. **ความจริงอยู่ที่ DB/registry ไม่ใช่ที่ AI** — AI ให้ข้อเสนอ/การแปลงข้อมูล
2. **ทุกงาน = job เดียว มีซองเดียว** (`CANONICAL_JOB_CONTRACT`) ไม่ว่าจะมาจากคน/agent/edge function/งานธุรกิจ
3. **ทุกการเขียนที่ mutating ต้องผ่าน scope + approval + cost gate + evidence**
4. **หยุดได้ทุกจุด** และ resume จาก checkpoint (hash chain ของ `EXECUTION_CONTEXT.json`)
5. **ยืนยันด้วยข้อเท็จจริง** (verifiers/VALIDATION_RESULTS) ก่อนประกาศสำเร็จ
6. **ห้ามลบหลักฐาน** — เอกสารใช้ void, ledger/audit เป็น append-only

## 1. lifecycle กลาง (L0 → L12) พร้อมกลไกจริงต่อระยะ
| # | Stage | เข้าสู่ระยะนี้เมื่อ | กลไกจริงที่ใช้ | Gate ที่ต้องผ่าน | Evidence ที่ต้องเกิด | Stop condition | Recovery |
|---|---|---|---|---|---|---|---|
| **L0** | REQUEST | มีคำขอ (owner/ลูกค้า/ระบบ/สัญญาณ) | `queueRuntime`, `TASK_QUEUE.json`, `business_events`, `live_commands`, webhook events | ผู้ขอมีสิทธิ์ (`permissions.json`) | แถวคำขอ + ผู้ขอ + เหตุผล | ผู้ขอไม่มีสิทธิ์/คำขอไม่ชัด | ขอข้อมูลเพิ่ม (`awaiting_info`) |
| **L1** | PLAN | รู้ว่าต้องทำอะไร | `executionPlannerRuntime`, `executionPlanRuntime`, `contextPlannerRuntime`, `ide/execution-context/approve-plan` | แผนมีลำดับ + จุดหยุด + acceptance | plan object + `EXECUTION_CONTEXT` checkpoint | ข้อมูลไม่พอ/แผนแตะนอก scope | re-plan จาก checkpoint เดิม |
| **L2** | SCOPE + LOCK | แผนผ่าน | `LOCK_MANAGER.json` (per-file), `targetPolicy`, `restrictedCapabilityRegistry`, `workspace_locks`/`workspace_lock_conflicts` | lock สำเร็จ + scope ประกาศครบ (files/paths/capabilities/data/spend) | lock entry + scope declaration | ไฟล์/ตารางถูกถือโดยงานอื่น | รอ/เลือกงานอื่น (ห้ามแย่ง) |
| **L3** | COST GATE | ก่อน dispatch ที่มีค่าใช้จ่าย | `costGateRuntime`, `COST_BUDGETS.json` (authorization), `executionBudgetRuntime` (ceiling), `usageMeterRuntime` | `cost.kind` ระบุ + authorization พอ + ceiling ไม่เกิน | authorization ref + estimate | UNKNOWN_COST ไม่มี authorization / เกิน budget | owner เพิ่มวงเงิน → รันต่อ |
| **L4** | APPROVAL | งานเกินเพดาน (เงิน/destructive/credential/เอกสารการเงิน) | owner passkey/Touch ID, `pending_authorizations`, `ide/execution-context/approve`, `owner-command/approve`, connector proposal, `destructive_action_gate` | approval record ถูกต้องตาม `DNA_OS_AUTHORITY_BOUNDARY_MATRIX.md` | approval + ผู้อนุมัติ + เวลา | ยังไม่อนุมัติ | ค้าง `PENDING_APPROVAL` (ห้ามทำแทน) |
| **L5** | EXECUTE | ผ่าน gate ทุกตัว | `executionRuntime` + `ide/execution/run` (+`commands`/`stream`/`cancel`), `codeWorkerRuntime`, `edgeFunctionWorkerRuntime`, `executionHandRuntime`, **business: `engines/canonical/*`** | ทุก write ตาม boundary ของ node (ดู graph §5) | run record + stream log + แถวที่เขียน (พร้อม audit) | เขียนครึ่งทาง/ข้อมูลไม่ตรง/lock หาย | rollback/void ตาม business semantics |
| **L6** | OBSERVE | ระหว่าง/หลัง execute | `monitoringRuntime`, `alertRuntime`, `evidenceCollectorRuntime`, `worker_usage_events`, `audit_logs`, `system_health_status` | สัญญาณสุขภาพปกติ | metric + event + artifact | health ตก/error rate สูง | drain: หยุดรับงานใหม่ → แก้สาเหตุ |
| **L7** | VERIFY | งานเขียนเสร็จ | `acceptanceContractRuntime`, `testRuntime`, `VALIDATION_RESULTS.json` (VR-xxxx), verifier 16+ ชุด, `governance/verify` | acceptance ของ job ผ่าน **ทั้งหมด** | ผลรัน + หลักฐาน (raw vs canonical) | FAIL ข้อใดข้อหนึ่ง | แก้ที่สาเหตุ → รันใหม่ (เก็บผลเก่า) |
| **L8** | EVIDENCE + AUDIT | verify ผ่าน | `audit_logs`, `document_versions/artifacts`, `payment_allocations`, `debt_events`, `connector_webhook_events`, artifact sha256 | หลักฐานผูกกับ entity จริง | version/artifact/ledger row | หลักฐานไม่ครบ | backfill จากแหล่งจริง (ห้ามเดา) |
| **L9** | PROGRESS | ตลอดงาน | `EXECUTION_CONTEXT.json` (step_status/step_report + hash), `executionRegistry`, `queueRegistry` | checkpoint เขียนสำเร็จ | checkpoint ใหม่ + hash | state ขัดกับความจริง | reconcile จากความจริง (`state-reconcile`) |
| **L10** | HANDOFF | เมื่อต้องส่งต่อ (คน/agent/worker) | `HANDOFF.json`, `executionHandRuntime`, `workers/execution-hand` (INBOX/OUTBOX), `factoryWorkspaceRuntime` (release), `FACTORY_CENTRAL_REGISTRY` (Rule 253) | ผู้รับมี scope ≤ ผู้ส่ง + งบเหลือ/อนุมัติใหม่ | job envelope + status | ผู้รับไม่มีสิทธิ์/ข้อมูลไม่ครบ | คืนงานให้เจ้าของเดิม + เหตุผล |
| **L11** | RETRY | ล้มเหลวชั่วคราว | `queue/retry/[id]`, `queueRuntime`, `gapLoopRuntime`, `deadEndSweepRuntime`, `recoveryRuntime`, restore tests | สาเหตุเป็น retryable + ยังมี budget | retry record + เหตุผล | retryable=false หรือครบจำนวน | escalate owner (พร้อมบริบทครบ) |
| **L12** | CLOSE | verify ผ่าน + evidence ครบ | `CURRENT_STATE.json`, `MASTER_EXECUTION_STATE.md`, `HANDOFF.json`, `CHANGELOG.json`, `state-reconcile` (no-op ถ้าไม่เปลี่ยน) | state ตรงความจริง + acceptance ครบ | state update + changelog | ยังมี drift ค้าง | เปิดงานใหม่เฉพาะ drift นั้น (ห้ามรวมงาน) |

## 2. แมป "4 ระนาบที่มีจริง" เข้า lifecycle เดียว (ไม่ต้องเขียนใหม่)
| ระนาบ | ตัวอย่างงาน | เข้า lifecycle ตรงไหน | ตัวเชื่อมที่ขาด |
|---|---|---|---|
| **A. Agent/IDE plane** | ซ่อมโค้ด, เพิ่มโมดูล, inspection | L0–L12 ครบแล้ว (แข็งสุด) | — |
| **B. Worker plane** | codeWorker / edgeFunctionWorker / execution-hand | L0–L12 แต่ต้องมี job envelope เดียวกัน | job envelope กลาง (deliverable 3) |
| **C. Business workflow plane** | LINE request → quotation → order → DO/INV → รับเงิน → หนี้ | ใช้ **L5 เดียวกัน** แต่ยังขาด L1/L2/L3/L7/L9 | ① plan object ② scope ต่อ job ธุรกิจ ③ acceptance contract ธุรกิจ ④ progress ลง EXECUTION_CONTEXT |
| **D. Edge/LINE plane (Deno)** | slip inbound, bank sync, cron | execute ได้เอง (L5) แต่ไม่ผ่าน L2/L3/L7 และไม่เขียน canonical | transport ไป canonical write + เขียน evidence เดียวกัน |

**ข้อสรุปสำคัญ**: ระบบนี้ **ไม่ต้องสร้าง orchestration ใหม่** — ต้องทำให้ C และ D **เดินใน lifecycle ที่มีอยู่** ด้วยซองงานกลาง 1 ใบ

## 3. State machine กลาง (ใช้ชื่อเดิมให้มากที่สุด)
```
REQUESTED → PLANNED → SCOPED/LOCKED → COST_CLEARED → (PENDING_APPROVAL) → RUNNING
   → OBSERVED → VERIFYING → VERIFIED → EVIDENCE_RECORDED → HANDED_OFF(optional) → CLOSED
สาขาที่มีจริงแล้วในระบบ:  FAILED_RETRYABLE | FAILED_FINAL | CANCELLED | DRAINED | BLOCKED(drift) | PENDING_APPROVAL
สถานะธุรกิจที่ต้อง map (ไม่สร้างใหม่): business_events(status), customer_orders(CustomerOrderStatus), jobs(job_status),
   document_versions(status), receipt_documents(ai_read→confirmed/rejected), debt_events(event_type)
```
**กฎการแมป**: สถานะธุรกิจ = "สถานะของงานธุรกิจ" · สถานะ lifecycle = "สถานะของงานที่ระบบกำลังทำ" — **ทั้งสองต้องอ้าง job id เดียวกัน** (ไม่ให้มีสองความจริง)

## 4. Stop conditions รวม (ที่ระบบต้องหยุดเองได้ทุกจุด)
| # | สภาพ | หยุดที่ | ต้องแจ้งใคร | Recovery |
|---|---|---|---|---|
| 1 | scope ไม่ครอบสิ่งที่ต้องทำ | L2 | owner | ขอ scope เพิ่ม |
| 2 | lock ไม่ได้ | L2 | ผู้ถือ lock ปัจจุบัน | รอ/สลับงาน |
| 3 | เกิน budget/ไม่มี authorization | L3 | owner | เพิ่มวงเงิน |
| 4 | ต้องอนุมัติแต่ยังไม่ได้ | L4 | owner | approve/reject |
| 5 | ข้อมูลขัดกับความจริง (DB/registry) | L1/L5 | owner | ยึด DB → re-plan |
| 6 | เขียนแล้วตรวจไม่ผ่าน | L7 | owner | แก้สาเหตุ → รันใหม่ |
| 7 | หลักฐานไม่ครบ | L8 | owner | backfill จากแหล่งจริง (ห้ามเดา) |
| 8 | provider ภายนอกล่ม | L6 | owner | retry/รอ (ห้าม fallback ปลอม) |
| 9 | ความล้มเหลวซ้ำเหตุเดิม | L11 | owner + central report | escalate (Rule 253) |
| 10 | destructive ต้องอนุมัติ | L4 | owner (Touch ID) | approve/ยกเลิก |

## 5. Cost boundary รวม (2 ชั้น — ห้ามรวม)
```
ชั้น 1 SAFETY CEILING  — executionBudgetRuntime.ts (ต่อ session/step, maxEstimatedCost default 1.0)
                         → กัน runaway ไม่ใช่การอนุมัติจ่าย
ชั้น 2 AUTHORIZATION   — COST_BUDGETS.json (owner อนุมัติเป็นราย task/capability)
                         + costGateRuntime.ts ตรวจก่อน dispatch PAID/UNKNOWN_COST
                         + COST_LEDGER.json (append-only actual cost, เขียนโดย recordActualCost() เท่านั้น)
ชั้น 3 METERING        — usageMeterRuntime.ts + worker_usage_events (38 คอลัมน์) → วิเคราะห์ย้อนหลัง
```
**กฎ**: งานธุรกิจที่ต้องจ่ายเงินจริง (เช่น ใช้ Google Places จำนวนมาก) ต้องมี authorization ก่อน; retry ทุกครั้งนับเข้า budget เดิม

## 6. Authority boundary (อ้างจาก matrix — ไม่ซ้ำ)
- ทุก write ที่ mutating: ต้องผ่าน scope (L2) + approval ถ้าเกินเพดาน (L4)
- destructive: owner เท่านั้น (`destructive_action_gate` + log)
- เอกสารการเงิน: ต้องผ่าน `engines/canonical/*` + version/void (ห้ามลบ)
- ledger/audit: append-only ทุกกรณี
- AI/worker ทุกตัว: รายงานเข้า `FACTORY_CENTRAL_REGISTRY` ก่อน (Rule 253) ไม่รายงาน owner ตรง

## 7. วิธีทำให้ "ทุกอย่างใช้ lifecycle เดียวกัน" โดยไม่รื้อ (integration order)
| ลำดับ | งาน | ของเดิมที่ใช้ | ต้องเพิ่ม (น้อยที่สุด) |
|---|---|---|---|
| 1 | ประกาศ `CANONICAL_JOB_CONTRACT` | `EXECUTION_CONTRACT.json` | 1 ไฟล์สัญญา (+ schema) |
| 2 | ให้ business job สร้าง job ผ่าน contract | `executionRuntime`/`executionRegistry` | adapter บาง ๆ ใน canonical write |
| 3 | ลด scope ซ้ำ 3 ที่ → 1 สัญญา | `EXECUTION_CONTRACT`, `LOCK_MANAGER`, `targetPolicy` | field อ้างอิง ไม่ merge โค้ด |
| 4 | acceptance contract ต่อ job ธุรกิจ | `acceptanceContractRuntime` | 3–5 acceptance (เงิน/สต็อกไม่มี/งานขนส่ง/เอกสาร) |
| 5 | progress ของงานธุรกิจเข้า checkpoint | `EXECUTION_CONTEXT.json` | hook ตอนจบ step |
| 6 | edge/LINE เขียนผ่าน canonical | `engines/canonical/inbound-write` | transport (BOM-002) |
| 7 | AI/agent ทุกตัวในทะเบียนเดียว | `AI_REGISTRY` + `ai_connection_status` | แถวจริง (Cline ฯลฯ) |

**STOP** — ทั้ง 7 ข้อเป็นการ *เชื่อมของเดิม* ไม่ใช่สร้าง orchestrator ใหม่ · รอ owner อนุมัติก่อนเริ่มข้อใด

