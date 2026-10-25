# CANONICAL JOB CONTRACT (PHASE 3, deliverable 3/4)

> ซองงานกลาง **1 ใบ** ที่ทุกงานต้องใช้ — AI agent, worker, edge function, cron, workflow ธุรกิจ
> Machine source of truth: `registry/CANONICAL_JOB_CONTRACT.json` (schema + field rules)
> **ไม่สร้าง orchestrator ใหม่**: contract นี้อ้างกลไกที่มีอยู่ (`executionRegistry`, `queueRuntime`, `EXECUTION_CONTRACT`, `LOCK_MANAGER`, `COST_BUDGETS`/`costGateRuntime`, `EXECUTION_CONTEXT`, `worker-tool-registry`, `AI_REGISTRY`, `FACTORY_CENTRAL_REGISTRY`, `audit_logs`)
> **STOP ก่อน coding** — เอกสารนี้คือสัญญา ยังไม่มีโค้ดถูกเขียน

## 1. หลักการ
1. **งานนอก contract = งานเถื่อน** — ไม่มี job id ⇒ ไม่มี lock/cost/approval/evidence ⇒ ห้ามรัน
2. **ทุก field ต้องชี้ของจริง** (ไฟล์/ตาราง/ทะเบียน) ไม่มี field "ไว้ทีหลัง"
3. **mutating ต้องประกาศก่อน** (scope เขียน) และหลังรันต้องตรงกับที่ประกาศ
4. **cost ต้องประกาศ kind** ก่อนรัน (`FREE`/`PAID`/`UNKNOWN_COST`) เพื่อให้ cost gate ทำงาน
5. **acceptance ต้องประกาศก่อน** เพื่อให้ verification ตัดสินได้ว่าจบจริง
6. **ห้ามเก็บ secret ใน contract** — ใช้ `credential_ref`

## 2. ฟิลด์ identity / authority (บังคับ)
| field | ชนิด | ความหมาย | อ้างของจริง |
|---|---|---|---|
| `job_id` | string | รหัสงาน | `executionRegistry` |
| `contract_version` | string | เวอร์ชัน | ไฟล์นี้ |
| `requested_by` | `{kind: owner\|staff\|agent\|system\|customer, id}` | ผู้ขอ | `permissions.json`, `owner_devices` |
| `requested_at` | ISO | เวลา | — |
| `job_type` | `agent_code \| worker_task \| business_workflow \| edge_function \| cron \| inspection \| repair` | ประเภท | `workerContract.ts`, `queue/types` |
| `plane` | `A_agent \| B_worker \| C_business \| D_edge` | ระนาบ | lifecycle §2 |
| `priority` | `P0..P3` | ลำดับ | `TASK_QUEUE.json` |
| `idempotency_key` | string | กันรันซ้ำ | `queueRuntime` |
| `parent_job_id` | string? | งานแม่ (handoff) | `HANDOFF.json` |

## 3. ฟิลด์ scope (ลดความซ้ำ 3 ที่ → สัญญาเดียว)
| field | ความหมาย | ผูกกับของเดิม |
|---|---|---|
| `scope.files` | ไฟล์ที่จะแตะ | `LOCK_MANAGER.json` (lock เฉพาะไฟล์) |
| `scope.paths` | เส้นทางงาน | `SCHEDULER.json` (path-based) |
| `scope.capabilities` | capability ที่อนุญาต | `capability-registry.json` (202), `command-registry.json` (99) |
| `scope.tools` | tool ที่อนุญาต | `worker-tool-registry.json` |
| `scope.data_read` | ตาราง/ทะเบียนที่อ่าน | `module-registry`, `schemas.json` |
| `scope.data_write` | entity ที่เขียน | ต้องอยู่ใต้ boundary ของ node (graph §5) |
| `scope.spend` | `{kind, authorized_ref}` | `COST_BUDGETS.json` + `costGateRuntime` |
| `scope.external` | provider ที่จะเรียก | `PROVIDER_DIRECTORY.json`, `connectors` |
| `scope.forbidden` | สิ่งที่ห้ามแตะ | `must_not_do` ของ node ใน graph |

## 4. ฟิลด์การรัน + ความล้มเหลว
| field | ความหมาย |
|---|---|
| `plan.steps[]` | ลำดับงาน + จุดหยุดต่อขั้น (`executionPlanRuntime`) |
| `acceptance[]` | เงื่อนไขก่อนปิดงาน (`acceptanceContractRuntime`) เช่น `canonical_finance_matches_raw`, `document_snapshot_matches_issue`, `no_orphan_fk` |
| `cost` | `{kind: FREE\|PAID\|UNKNOWN_COST, estimate, currency, authorization_ref?}` |
| `approval` | `{required, kind: owner_passkey\|owner_decide\|gate_none, ref?}` |
| `retry` | `{policy: none\|transient\|manual, max_attempts, backoff, retryable_signals[]}` |
| `stop_conditions[]` | อ้าง lifecycle §4 (ข้อ 1–10) |
| `recovery` | `{mode: resume_checkpoint\|void_and_reissue\|manual_owner\|escalate_central}` |
| `checkpoint_ref` | `EXECUTION_CONTEXT.json` (checkpointId + hash) |

## 5. ฟิลด์ผลลัพธ์ + หลักฐาน
| field | ความหมาย | อ้างของจริง |
|---|---|---|
| `status` | สถานะ lifecycle | `executionRegistry` |
| `business_status` | สถานะธุรกิจ (ไม่สร้างใหม่) | `business_events.status`, `customer_orders.status`, `jobs.job_status`, `document_versions.status`, `receipt_documents.status`, `debt_events.event_type` |
| `entity_refs[]` | `{table, id}` ที่ถูกแตะ | 92 ตารางจริง |
| `evidence[]` | `{kind, ref, sha256?}` | `audit_logs`, `document_artifacts`, `VALIDATION_RESULTS.json` |
| `touched_files[]` | ไฟล์ที่แก้จริง (⊆ scope) | git |
| `cost_actual` | ต้นทุนจริง | `COST_LEDGER.json` (append-only ผ่าน `recordActualCost()`) |
| `report_to` | ปลายทางรายงาน | `FACTORY_CENTRAL_REGISTRY` (Rule 253) + `HANDOFF.json` |

## 6. Validation rules (สิ่งที่ต้องเป็นจริงเมื่อบังคับใช้)
1. `scope.data_write ⊆ boundary(data)` ของ node — เกิน → **block**
2. `cost.kind != FREE` โดยไม่มี `authorization_ref` → **block ที่ L3**
3. `approval.required=true` โดยไม่มี ref → **ค้าง PENDING_APPROVAL (L4)**
4. `cost_actual` เขียนได้เฉพาะ cost gate (`COST_LEDGER` append-only)
5. ทุก job ต้องมีหลักฐานอย่างน้อย 1 รายการใน `audit_logs` (หรือเทียบเท่า)
6. `touched_files ⊄ scope.files` → **violation ต้องรายงาน** (ห้ามเงียบ)
7. `job_type=business_workflow` และแตะเงิน → ต้องผ่าน `engines/canonical/*` (ห้ามเขียน DB ตรง)
8. `status=CLOSED` ได้เมื่อ `acceptance[]` ผ่านครบ + evidence ครบเท่านั้น
9. ห้ามมี secret ใน payload — ใช้ `credential_ref`
10. `plane=D_edge` ต้องมี transport ไป canonical (ข้อ 7) — **วันนี้ยังไม่ครบ = known gap** (BOM-002)

## 7. ตัวอย่าง job จริง 2 แบบ
```jsonc
// A) งานธุรกิจ: quotation จากคำขอ LINE จริง (S1) — plane C
{ "job_id":"<uuid>", "contract_version":"1.0", "job_type":"business_workflow", "plane":"C_business",
  "requested_by":{"kind":"staff","id":"admin"}, "priority":"P2", "idempotency_key":"quote:<business_event_id>",
  "scope":{"capabilities":["document.create","document.issue"],
           "data_read":["business_events","material_types","pit_materials","customer_sites"],
           "data_write":["standalone_documents","standalone_document_items","document_versions"],
           "forbidden":["ตั้งราคาเอง","แก้ stock","ลบเอกสาร"], "spend":{"kind":"FREE"}},
  "acceptance":["document_snapshot_matches_issue","no_orphan_fk","quotation_not_counted_as_revenue"],
  "cost":{"kind":"FREE"}, "approval":{"required":false,"kind":"gate_none"},
  "retry":{"policy":"manual","max_attempts":1}, "recovery":{"mode":"void_and_reissue"},
  "business_status":"business_events.status: ready_to_quote -> quoted" }

// B) งาน agent: ซ่อม drift (แบบเดียวกับที่ทำจริงในรอบนี้) — plane A
{ "job_id":"<uuid>", "contract_version":"1.0", "job_type":"agent_code", "plane":"A_agent",
  "requested_by":{"kind":"owner","id":"owner-console"}, "priority":"P1",
  "scope":{"files":["registry/module-registry.json","scripts/*.ts"], "capabilities":["architecture.registry_write"],
           "data_read":["registry/module-registry.json","registry/architecture-book.json"], "data_write":[],
           "external":["github"], "forbidden":["force-push","commit secret","แก้ตัวเลขการเงิน"]},
  "acceptance":["check_drift_ok","tsc_ok","imports_ok"],
  "cost":{"kind":"FREE"}, "approval":{"required":true,"kind":"owner_decide","ref":"owner-command/approve"},
  "retry":{"policy":"transient","max_attempts":2,"retryable_signals":["network","lock_busy"]},
  "recovery":{"mode":"resume_checkpoint"} }
```

## 8. ความต่างจากของเดิม (ทำไมต้องมี contract นี้ ทั้งที่มี EXECUTION_CONTRACT แล้ว)
| ประเด็น | `EXECUTION_CONTRACT.json` (เดิม) | `CANONICAL_JOB_CONTRACT` (ใหม่) |
|---|---|---|
| ระดับ | กฎวิธีปฏิบัติของ agent ทั้งระบบ | **สัญญาต่อ 1 งาน** (instance-level) |
| ขอบเขต | IDE/agent plane | ครอบ **ทุกระนาบ** รวมงานธุรกิจ/edge |
| Scope | กล่าวถึง execution_order/output_contract | ระบุ files/paths/capabilities/data/write/spend/forbidden ต่องาน |
| Cost | ไม่ได้อยู่ในไฟล์นี้ | ระบุ `cost.kind` + authorization ต่องาน (เชื่อมของเดิม) |
| Acceptance | กล่าวถึง output | ระบุ acceptance ที่ตรวจได้ต่องาน |
| ความสัมพันธ์ | เป็น "กฎหมายวิธีปฏิบัติ" | เป็น "ซองงาน" ที่อ้างกฎหมายนั้น |

**STOP** — รอ owner อนุมัติก่อนนำไปบังคับใช้/เขียนโค้ด validation (ข้อ 6)

