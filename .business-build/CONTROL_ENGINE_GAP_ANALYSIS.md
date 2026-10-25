# CONTROL ENGINE GAP ANALYSIS (PHASE 3, deliverable 4/4)

> ตรวจว่า DNA OS มี "สิ่งที่ต้องมีเพื่อเป็น execution control engine กลาง" อะไรแล้ว / ซ้ำ / ขาด
> ทุกบรรทัดอ้างของจริง (ไฟล์/ทะเบียน/ตาราง/route) · **STOP ก่อน coding** · ไม่มีข้อใดเสนอ "สร้าง framework ใหม่"

## 1. สรุปคะแนนความพร้อม (อิงกลไกจริง 13 ด้าน)
| # | ความสามารถที่ engine ต้องมี | มีแล้ว | ซ้ำ | ขาด | ระดับ |
|---|---|---|---|---|---|
| 1 | Job identity + registry | `executionRegistry.ts`, `queueRegistry.ts`, `live_commands`, `ai_tasks` | — | ยังไม่ครอบงานธุรกิจ | 70% |
| 2 | Planning | `executionPlannerRuntime`, `executionPlanRuntime`, `contextPlannerRuntime` | 2 planner (planner/plan) | plan ของงานธุรกิจ | 75% |
| 3 | Scope + lock | `LOCK_MANAGER.json`, `workspace_locks/conflicts`, `targetPolicy`, `restrictedCapabilityRegistry` | **3 ที่** | สัญญา scope เดียว | 60% |
| 4 | Context + checkpoint | `EXECUTION_CONTEXT.json` (hash chain), `aiContextRuntime`, `executionContextRuntime` | — | งานธุรกิจไม่เขียน | 80% |
| 5 | Tool/capability registry | `worker-tool-registry.json`, `capability-registry.json` (202), `command-registry.json` (99), `capabilityResolverRuntime` | capability 2 ทะเบียน (capability-registry + worker-tool) | business capability ยังไม่ลงทะเบียน | 75% |
| 6 | Worker/model selection | `AI_REGISTRY.json` (13), `workerRegistry`, `workerAdapters/`, `workerSelectorRuntime`, `providerRegistryRuntime`, `worker_usage_events` | — | Cline/Codex ไม่มีแถว + `ai_connection_status` ว่าง | 70% |
| 7 | Cost gate | `COST_BUDGETS.json`, `costGateRuntime`, `COST_LEDGER.json`, `executionBudgetRuntime`, `usageMeterRuntime` | 2 ชั้น (ceiling/authorization) — **โดยเจตนา ไม่ซ้ำ** | งานธุรกิจยังไม่ผ่าน gate | 85% |
| 8 | Approval | passkey/Touch ID, `pending_authorizations`, `execution-context/approve`, `owner-command/approve`, connector proposal, `destructive_action_gate` | **หลายทาง (6+)** | จุดเขียนหลักฐานเดียว | 70% |
| 9 | Execution runtime | `executionRuntime` + `execution/{run,runs,commands,stream,cancel}`, `codeWorkerRuntime`, `edgeFunctionWorkerRuntime`, `executionHandRuntime`, `engines/canonical/*` | 2 engine (IDE worker / canonical business) | ยังไม่ใช้ job เดียวกัน | 80% |
| 10 | Observation/evidence | `monitoringRuntime`, `alertRuntime`, `evidenceCollectorRuntime`, `audit_logs`, `worker_usage_events`, `system_health_status`, `systemRealityRuntime` | — | evidence งานธุรกิจคนละรูปแบบ | 75% |
| 11 | Verification | `acceptanceContractRuntime`, `testRuntime`, `VALIDATION_RESULTS.json`, verifier 16+ ชุด, `governance/verify`, `factoryReadinessGateRuntime` | — | acceptance ของงานธุรกิจ | 85% |
| 12 | Progress/handoff | `EXECUTION_CONTEXT`, `CURRENT_STATE.json`, `MASTER_EXECUTION_STATE.md`, `HANDOFF.json`, `state-reconcile.ts`, `executionHandRuntime`, `workers/execution-hand`, `FACTORY_CENTRAL_REGISTRY` (Rule 253) | state 2 ระดับ (step/ระบบ) | รูปแบบ handoff ข้ามเครื่อง | 80% |
| 13 | Repair/recovery | `recoveryRegistry/Runtime`, `restoreTestRegistry/Runtime`, `backupRegistry/Runtime`, `gapLoopRuntime`, `deadEndSweepRuntime`, `changeSetRuntime`, `reviewRegistry`, `incidentRuntime` | — | retry policy ต่อ stop condition | 85% |

**สรุป**: engine นี้ **มีอยู่จริงและค่อนข้างครบ (เฉลี่ย ~77%)** — ปัญหาไม่ใช่ "ขาดเครื่องยนต์" แต่คือ **สองระนาบยังไม่ใช้เครื่องยนต์เดียวกัน**

## 2. capability แยก 3 ประเภท
### 2.1 มีแล้ว (ใช้ต่อทันที ไม่ต้องแตะ)
`executionRegistry` · `executionRuntime` · `queueRuntime` + `queue/{jobs,retry,cancel,clear,types}` · `workerRegistry`/`workerAdapter`/`workerContract`/`workerTaskOrchestrator` · `costGateRuntime` + `COST_BUDGETS` + `COST_LEDGER` + `usageMeterRuntime` · `LOCK_MANAGER` + `workspace_locks` · `executionContextRuntime` + `EXECUTION_CONTEXT.json` · `acceptanceContractRuntime` + `VALIDATION_RESULTS.json` · `evidenceCollectorRuntime` · `monitoringRuntime`/`alertRuntime` · `recoveryRegistry/Runtime` + restore/backup · `factoryWorkspaceRuntime` + `FACTORY_CENTRAL_REGISTRY` · `state-reconcile.ts` · canonical write services (`engines/canonical/*`) · verifier suites 16+ · `owner-verification` (passkey/Touch ID)

### 2.2 ซ้ำ (ต้องรวมเป็นสัญญาเดียว — **ไม่ต้องลบโค้ด**)
| ความซ้ำ | ที่ 1 | ที่ 2 | ที่ 3 | วิธีรวม (เบาที่สุด) |
|---|---|---|---|---|
| "ขอบเขตงาน" | `EXECUTION_CONTRACT.json` | `LOCK_MANAGER.json` | `targetPolicy.ts` + `restrictedCapabilityRegistry.ts` | ประกาศ `scope` ใน job contract แล้วให้ทั้งสามอ่านค่านั้น |
| "แผน" | `executionPlannerRuntime` | `executionPlanRuntime` | `contextPlannerRuntime` (บริบท) | ให้ planner เขียน plan เดียวลง `EXECUTION_CONTEXT` |
| "ทะเบียน capability" | `capability-registry.json` (202, frozen) | `worker-tool-registry.json` (MCP) | `command-registry.json` (99) | ใช้ `capability_id` เป็นกุญแจร่วม; MCP/command อ้าง id เดียวกัน |
| "state ของงาน" | `executionRegistry` | `queueRegistry` | `CURRENT_STATE.json`/`MASTER_EXECUTION_STATE.md` | job id เดียวอ้างทั้งสาม |
| "การอนุมัติ" | `pending_authorizations` | `execution-context/approve` | `owner-command/approve` + connector proposal + `destructive_action_gate` + `factory-workspace approve-*` | ทุกทางเขียนหลักฐานลงตาราง/ที่เดียว (proposal/pending_authorizations) |
| "ค่าจริง (cost)" | `COST_LEDGER.json` | `worker_usage_events` | `usageMeterRuntime` | ledger = ของจริง, usage = metric (ระบุบทบาทให้ชัด — ไม่ merge) |

### 2.3 ขาดจริง (missing — ต้องสร้างน้อยที่สุด)
| # | สิ่งที่ขาด | หลักฐาน | ทางปิด (เบาที่สุด) | ต้องอนุมัติ |
|---|---|---|---|---|
| G1 | **job object ของงานธุรกิจ** | business plane ไม่มี job/plan/scope/acceptance — มีแต่ business_event status | ให้ canonical write สร้าง job ผ่าน `CANONICAL_JOB_CONTRACT` แล้วบันทึกใน `executionRegistry` | ✅ owner |
| G2 | **transport ให้ edge/LINE เขียนผ่าน canonical** | `supabase/functions/*` เขียน DB ตรง (import Next ไม่ได้) | transport หรือ dual-write ที่ชี้ `engines/canonical/inbound-write` | ✅ owner |
| G3 | **acceptance contract ของงานธุรกิจ** | acceptance มีเฉพาะงาน IDE | 4 acceptance: เงินตรง SQL ดิบ / เอกสารตรง snapshot / ไม่มี orphan / ไม่นับ quotation เป็นรายได้ | ✅ owner |
| G4 | **retry policy ต่อ stop condition** | retry มีกลไก แต่ไม่มีนโยบาย | ใส่ `retry` ใน job contract (transient vs manual) | ✅ owner |
| G5 | **จุดเขียนหลักฐานเดียวของการอนุมัติ** | approval 6+ ทาง เขียนคนละที่ | ทุกทางเขียน `pending_authorizations` + `audit_logs` | ✅ owner |
| G6 | **ทะเบียน AI ครบจริง** | Cline/Codex ไม่อยู่ใน `AI_REGISTRY` · `ai_connection_status` = 0 แถว | เพิ่มแถวจริง + สถานะจริง | ✅ owner |
| G7 | **scope declaration เดียว** (G ย่อย) | scope กระจาย 3 ที่ | field `scope` ใน contract | ✅ owner |
| G8 | **progress ของงานธุรกิจเข้า checkpoint** | `EXECUTION_CONTEXT` ใช้กับ IDE เท่านั้น | hook ตอนจบ step ของ canonical write | ✅ owner |

## 3. Integration points (จุดเชื่อมที่ไม่ต้องรื้อ)
| จุดเชื่อม | เชื่อมอะไรกับอะไร | กลไกเดิม |
|---|---|---|
| IP-1 | งานธุรกิจ ↔ execution registry | `executionRegistry.ts` + job contract (เพิ่ม adapter บาง) |
| IP-2 | scope ↔ lock ledger | `LOCK_MANAGER.json` (ใช้ `scope.files` เป็น input) |
| IP-3 | cost ↔ canonical/Provider | `costGateRuntime` + `COST_BUDGETS` (เดิมใช้กับ worker — ขยายให้งานธุรกิจที่เรียก provider) |
| IP-4 | acceptance ↔ verifiers ที่มี | `acceptanceContractRuntime` ชี้ไป `npm run canonical:*` ที่มีอยู่ |
| IP-5 | evidence ↔ `audit_logs` | canonical write เขียน audit อยู่แล้ว — เพิ่ม job id |
| IP-6 | progress ↔ state | `state-reconcile.ts` (มีแล้ว, no-op เมื่อไม่เปลี่ยน) |
| IP-7 | handoff ↔ ในเครื่อง/ข้ามเครื่อง | `executionHandRuntime` + `workers/execution-hand` INBOX/OUTBOX + `HANDOFF.json` |

## 4. Authority / Cost boundary / Stop / Recovery (สรุปเป็นคำสั่งใช้งาน)
```
AUTHORITY   อ่านตาม scope · เขียนเฉพาะ scope.data_write · เกินเพดาน = owner (passkey/decide) · destructive = owner เท่านั้น
COST        FREE/PAID/UNKNOWN_COST ต้องประกาศ · PAID/UNKNOWN ต้องมี authorization_ref · ceiling ไม่ใช่ authorization · ledger append-only
STOP        10 เงื่อนไข (DNA_OS_EXECUTION_LIFECYCLE §4) — หยุดแล้วแจ้ง owner พร้อมบริบท ไม่เดาต่อ
RECOVERY    resume_checkpoint | void_and_reissue | manual_owner | escalate_central — ห้าม retry แบบเดา
```

## 5. ลำดับการปิด gap (dependency — ทำทีละข้อ, ห้ามรวบ)
| ลำดับ | gap | ขึ้นกับ | ผลลัพธ์ที่วัดได้ |
|---|---|---|---|
| 1 | G6 (ทะเบียน AI ครบ) | — | Cline/Codex มีแถว + `ai_connection_status` มีข้อมูลจริง |
| 2 | G7+G1 (scope + job object) | G6 | งานธุรกิจ 1 งาน (quotation) มี job id + scope + plan |
| 3 | G3 (acceptance ธุรกิจ) | G2? ไม่ | quotation/order/invoice มี acceptance ผ่าน verifier ที่มีอยู่ |
| 4 | G5 (evidence การอนุมัติ) | G1 | ทุก approval มีแถวในที่เดียว |
| 5 | G8 (progress) | G1 | `EXECUTION_CONTEXT` มี step ของงานธุรกิจ |
| 6 | G4 (retry policy) | G1 | retry ตัดสินจาก policy ไม่ใช่คนเดา |
| 7 | G2 (transport edge) | G1,G3 | LINE/slip เขียนผ่าน canonical 100% |

## 6. สิ่งที่ **ห้าม** ทำในเฟสนี้ (ตามคำสั่ง)
- ห้าม copy source code ของ Cline หรือผูก DNA OS ให้ต้องใช้ Cline
- ห้ามสร้าง orchestration framework ใหม่ (มีอยู่แล้ว: execution/queue/worker/registry/cost/approval/evidence)
- ห้ามเขียนโค้ดก่อน owner อนุมัติ contract (`registry/CANONICAL_JOB_CONTRACT.json` = PROPOSED)
- ห้ามแตะ production business truth / schema / UI ในเฟสนี้
- ห้าม "รวม" ชั้น cost 2 ชั้นเข้าด้วยกัน (คนละความหมาย)
- ห้ามลบ/ปิด capability ที่มีอยู่เพียงเพราะมีชื่อคล้ายกัน (ต้องพิสูจน์ว่าใช้แทนกันได้ก่อน)

## 7. ข้อสรุปสุดท้าย (คำตอบตรงคำถาม "ทุกอย่างใช้ lifecycle เดียวกันได้ไหม")
**ได้** — เพราะเครื่องยนต์ครบอยู่แล้ว: registry/queue/worker/cost/approval/evidence/verify/recovery + state
สิ่งที่ต้องทำคือ **3 อย่าง**: (1) ประกาศ job contract กลาง (2) ให้งานธุรกิจและ edge สร้าง job ตาม contract (3) ปิด acceptance/progress/retry ให้ครบ — ทั้งหมดเป็นการ *เชื่อม* ไม่ใช่ *สร้างใหม่*
**แต่ต้องรอ owner อนุมัติ** ก่อนเริ่มข้อ 1 (ตาม G1–G8)

