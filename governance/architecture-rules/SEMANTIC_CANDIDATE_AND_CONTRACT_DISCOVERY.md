# SEMANTIC CANDIDATE CLAIM + CONTRACT DISCOVERY (2026-09-01)

```
PHASE 1 = MINIMAL IMPLEMENTATION (ทำแล้ว)
PHASE 2 = EVIDENCE-ONLY DISCOVERY (ทำแล้ว) — ไม่ลงทะเบียน contract ใด
CANONICAL_CHANGED = NO · CONTRACTS_REGISTERED = 0
```

---

# PHASE 1 — หยุดคำกล่าวอ้างว่า "available"

## สิ่งที่พบก่อนแก้ — ต้องแก้ความเข้าใจของรอบก่อน

รอบก่อนผมรายงานว่า *"semantic-runner ปฏิบัติต่อ legacy inventory เป็น available_tools"*
ซึ่งจริงในระดับ **โค้ด** แต่ผมไม่ได้ตรวจว่า mode นั้นถูกเรียกจริงหรือไม่

ตรวจแล้วพบว่า:

```
OWNER_TOOL_REQUEST_V1     ผู้เรียก = 0   ปรากฏเฉพาะใน semantic-runner.py เอง
OWNER_MULTI_MEANING_V1    ผู้เรียก = owner-language-interpreter.mjs   ← เส้นที่รันจริง
OWNER_DISPLAY_RESPONSE_V1 ผู้เรียก = owner-response-renderer.mjs      ← เส้นที่รันจริง
```

และ `user_content` ใส่ catalog เข้าไป **เฉพาะ mode `OWNER_TOOL_REQUEST_V1`**

**คำกล่าวอ้างเท็จจึงเป็นกับดักที่ยังไม่ทำงาน (latent) ไม่ใช่ความเสียหายที่กำลังเกิด**
แต่จะทำงานทันทีที่มีใครเรียก mode นั้น

ผลข้างเคียงที่พบเพิ่ม: `interpretOwnerRequest()` ส่ง `catalog` ลง `input.json` ทุกครั้ง
แต่ mode ที่ใช้จริงไม่เคยหยิบไปใส่ prompt — **โมเดลในเส้นทางจริงไม่เคยเห็น catalog เลย**

## การแก้ — 2 บรรทัด

`control/owner-command-semantics/semantic-runner.py`

```diff
- "available_tools": catalog
+ "legacy_routing_candidates": catalog
```

```diff
- Choose only a capability_id and supported command present in available_tools.
+ Choose only a capability_id and supported command present in legacy_routing_candidates.
+ legacy_routing_candidates are candidate command/routing surfaces currently exposed by a
+ compatibility layer; membership does NOT prove runtime availability. Candidate presence
+ does not mean the capability is executable, does not mean it is runtime healthy, and does
+ not mean a worker is available. Classify and match the Owner intent only: a deterministic
+ runtime decides whether execution is allowed. Never claim that anything executed
+ successfully, and never infer health or availability from candidate membership.
```

กฎทั้ง 6 ข้อที่สั่งไว้ถูกใส่ครบในย่อหน้าเดียว **output contract ไม่ถูกแตะ** —
`Return exactly: {"intent_type", "selected_capability", "selected_tool", "arguments",
"intended_outcome", "ambiguity", "confidence"}` เหมือนเดิมทุกตัวอักษร

## PHASE 1 VERIFICATION

```
LEGACY_CANDIDATE_COUNT_BEFORE = 12
LEGACY_CANDIDATE_COUNT_AFTER  = 12
ROUTING_MEMBERSHIP_CHANGED = NO
ENDPOINT_MAPPING_CHANGED   = NO
POLICY_CHANGED             = NO
CANONICAL_CHANGED          = NO

grep "available_tools|available capabilit|currently available|ready to execute"
  ในทุก mode ของ semantic-runner.py = 0 ผลลัพธ์

ไฟล์ที่ห้ามแตะ: control/command-router/capability-registry.ts ไม่ปรากฏใน git status
runtimeInventory() ไม่ถูกแก้

regression:
  router.test.ts                          9 passed, 0 failed
  semantic-resolution.test.ts             ALL CASES PASSED
  output-classifier.test.ts               ALL CASES PASSED
  digitalocean-connector-routing.test.ts  ALL CHECKS PASSED
```

---

# HEALTH_STATUS — 13 literal

| บรรทัด | ค่า | classification |
|---|---|---|
| 18, 50, 75, 89, 100, 129, 150, 168, 179, 190, 211, 222 | `CONNECTED` ×12 | **STATIC_DECLARATION** |
| 39 | `NOT_CONNECTED` ×1 (file-intelligence) | **STATIC_DECLARATION** |

```
PROBE_BACKED = 0 / 13
RUNTIME_OBSERVED = 0 / 13
STATIC_DECLARATION = 13 / 13
```

ไม่มีการวัดใด ๆ ในไฟล์นั้น — เป็นค่าที่พิมพ์ไว้ล้วน

## literal เหล่านี้กลายเป็น "ความจริงเชิง runtime" ที่ไหน

```
transport/owner-command-http/server.ts:195   registry_status: capability.health_status
transport/owner-command-http/server.ts:200   health_status === "CONNECTED" ? "VERIFIED" : "BLOCKED"
```

ค่าคงที่ที่พิมพ์มือถูกแปลงเป็นคำว่า **`VERIFIED`** ในสิ่งที่ Owner เห็น

## ทำไมยังไม่ downgrade ในรอบนี้

จุดแปลงอยู่ใน `runtimeInventory()` ซึ่งงานนี้ **สั่งห้ามแก้อย่างชัดเจน**
การ downgrade เป็น `DECLARED / UNVERIFIED` จึงทำไม่ได้ภายในข้อจำกัดของรอบนี้

**รายงานเป็นรายการค้าง ไม่ลักไก่แก้**

## เจ้าของ probe ที่ต้องมีในอนาคต (ต่อรายการ)

| capability | probe ที่ควรใช้ | เจ้าของที่ควรเป็น |
|---|---|---|
| research-engine | `GET http://127.0.0.1:8787/api/research/health` | มีอยู่แล้วใน `runtimeInventory()` — ตัวเดียวที่วัดจริง |
| os-ui, os-login, dispatcher, agent-host, voice-bridge | ไม่มี endpoint ภายนอก — ต้องพิสูจน์ผ่าน worker/session state | `connections/agent-registry` |
| github, digitalocean | reachability + credential resolution | `connections/<provider>` + `credentials/registry` |
| execution, permission-reasoner | in-process — ไม่ควรมี health_status เลย | ไม่ต้องมี probe |
| file-intelligence, dna-os-circuit | LEGACY_ORPHAN — ยังไม่ทราบเจ้าของ | ยังไม่กำหนด |

`research-engine` เป็นตัวเดียวใน 12 ที่ `live_status` มาจากการวัดจริง
อีก 11 ตัวได้ `VERIFIED` จากค่าคงที่

---

# PHASE 2 — CONTRACT DISCOVERY (9 ตัว)

หลักฐานทั้งหมดมาจาก source/type/validator/test ที่มีอยู่ **ไม่มี contract ใดถูกแต่งขึ้น**

| # | capability | entrypoint (จริง) | INPUT | OUTPUT | CANDIDATE |
|---|---|---|---|---|---|
| 1 | github-source-executor | `handleGithubCommand(command: CommandEnvelope): Promise<GithubAdapterOutcome>` | `PROVEN_VALIDATOR` | `PROVEN_TYPE` + `PROVEN_BY_TEST` | **YES** |
| 2 | agent-gateway | `submitTask(intentText: string, memory: Omit<MemoryReference,…>, …)` | `PROVEN_TYPE` (บางส่วน) | **UNKNOWN** | **PARTIAL** |
| 3 | agent-host | `runAgentWorkOrder(workOrder: WorkOrder, origin, hostEnv): Promise<DnaOsAgentResult>` | `PROVEN_VALIDATOR` | `PROVEN_VALIDATOR` | **YES** |
| 4 | execution-run | `startExecution(request: ExecutionRequest, decision?): ExecutionResult` | `PROVEN_TYPE` | `PROVEN_TYPE` + `PROVEN_BY_TEST` | **YES** |
| 5 | execution-policy | `evaluateExecutionPermission(request: ExecutionPermissionRequest, context: ExecutionPolicyContext, nowIso?): ExecutionPermissionDecision` | `PROVEN_TYPE` | `PROVEN_TYPE` + `PROVEN_BY_TEST` | **YES** |
| 6 | digitalocean-adapter | `invokeDigitalOceanConnector: ConnectorInvoker = async (command: CommandEnvelope): Promise<ConnectorBoundaryOutcome>` | `PROVEN_TYPE` | `PROVEN_TYPE` + `PROVEN_BY_TEST` | **YES** |
| 7 | os-login | `requestOsLogin(request: OsLoginRequest): Promise<OsLoginOutcome>` | `PROVEN_VALIDATOR` | `PROVEN_TYPE` | **YES** |
| 8 | os-ui | `openOsUi(target: OsUiTarget): Promise<OsUiOutcome>` | `PROVEN_VALIDATOR` | `PROVEN_TYPE` + `PROVEN_BY_TEST` | **YES** |
| 9 | research-engine | `fetchResearchEngineLatestResult(options: FetchResearchEngineOptions = {}): Promise<ResearchEngineStepOutcome>` | `PROVEN_TYPE` | `PROVEN_TYPE` | **YES** |

## หลักฐานของ validator (ไม่ใช่แค่ TypeScript type)

```
connections/github/payload-validation.ts
  export type PayloadCheck<T> = { ok: true; value: T } | { ok: false; reason: string }
  export function checkCheckAccessPayload(raw: unknown): PayloadCheck<GithubCheckAccessPayload>
  export function checkReadStatusPayload(raw: unknown): PayloadCheck<GithubReadStatusPayload>
  -> ตรวจ runtime จาก unknown จริง ไม่ใช่ cast

connections/research-engine/payload-validation.ts   (มีไฟล์เดียวกัน)

control/agent-gateway/agent-host-dispatch.ts
  function validateRequestedActions(raw: unknown, workOrderId: string)
  fail("FAIL_CLOSED", ERROR_CODES.MALFORMED_RESULT, ...) เมื่อ output ไม่ตรง DNA_OS_AGENT_RESULT_V1
  -> RUNTIME_EVIDENCE: การรัน POST /command เมื่อ 2026-08-31 จบด้วย
     FAIL_CLOSED / MALFORMED_RESULT จริง = validator ทำงานจริงในการรันจริง

connections/os-login/adapter-contract.ts   parseOsLoginTarget
connections/os-ui/adapter-contract.ts      parseOsUiTarget
```

## ทำไม agent-gateway = PARTIAL

`submitTask` รับ **หลายพารามิเตอร์** (`intentText: string`, `memory: Omit<MemoryReference,
"task_id"|"created_at">`, และอื่น ๆ) ซึ่งอ่านได้จาก source แต่ **ชนิดของค่าที่คืน
สกัดจาก signature ไม่ได้** และ capability นี้ยังรองรับ **2 invocation surface**
(`route:dispatcher` + `route:voice-bridge`) ซึ่งอาจมี output contract ต่างกัน

การเดา output contract ให้ครบจะเป็นการแต่ง — จึงหยุดที่ `PARTIAL`
**ไม่เติมส่วนที่ขาด** ตามกฎ

## PERMISSION_REQUIREMENT (จาก legacy table ของจริง)

```
execution-run      execution-policy    ← ตัวเดียวใน 9 ที่ต้องผ่าน policy gate
อีก 8 ตัว          none                (แต่ละ adapter บังคับ scope ของตัวเองภายใน)
```

## SIDE_EFFECT / ERROR_OUTPUT

ทุกตัวมี error path เป็น **ส่วนหนึ่งของ output type** (discriminated union) ไม่ใช่ throw:
`PayloadCheck<T>` · `ConnectorBoundaryOutcome` (`ok/auth_required`) ·
`ExecutionPermissionDecision` (`ALLOW/DENY`) · `OsLoginOutcome` · `DnaOsAgentResult`
(`FAIL_CLOSED` + `ERROR_CODES`)

**นี่เป็นรูปแบบที่สม่ำเสมอทั้ง 9 ตัว** และเป็นหลักฐานว่า error contract มีอยู่จริง
ในระดับ type ไม่ใช่แค่ convention

---

# คอขวด 9 → 1 (ตัวเลขสมมติ)

```
CURRENT_EXECUTABLE          = 1     (ของจริง ไม่เปลี่ยน)

CONTRACT_CANDIDATE_COMPLETE = 8
CONTRACT_CANDIDATE_PARTIAL  = 1     (agent-gateway)
CONTRACT_UNKNOWN            = 0

PROJECTED_EXECUTABLE_IF_REGISTERED = 9     ← สมมติเท่านั้น
```

**ตัวเลข 9 นี้เป็นสมมติฐาน ไม่ใช่สถานะจริง** — ไม่มี contract ใดถูกลงทะเบียน
`EXECUTABLE` จริงยังคงเป็น **1**

และแม้ลงทะเบียนครบ `AVAILABLE_NOW` ก็จะยังเป็น **1 อย่างมาก** (เฉพาะ agent-host
ที่มี worker ผ่าน probe) เพราะ availability ขึ้นกับ worker state ไม่ใช่ contract

---

## สิ่งที่รอบนี้ไม่ได้ทำ

ไม่ลงทะเบียน contract · ไม่แก้ capability · ไม่แก้ execution binding ·
ไม่แตะสมาชิก 12 ตัว · ไม่ลบ legacy table · ไม่แตะ file-intelligence / dna-os-circuit ·
ไม่สร้าง relationship · ไม่แก้ repository/provider-project identity ·
ไม่แก้ canonical_target_id · ไม่ commit · ไม่ deploy ·
**ไม่ implement probe และไม่กุค่า health ใด ๆ**

---

# REGISTRATION RESULT (2026-09-01) — BLOCKED AT STEP 7

```
CONTRACTS_ATTEMPTED  = 8
CONTRACTS_REGISTERED = 0
CONTRACTS_REJECTED   = 0   (ไม่มีตัวใดตกเพราะ provenance)
BLOCKED_BY_MUTATION_PATH = 8
CANONICAL_CHANGED = NO
```

## ขั้น 1–6 ผ่านครบ 8/8

ตรวจผ่าน `createPersistentFileStore()` อ่านอย่างเดียว:

| capability | capability ยังมีอยู่ | execution binding | contract ปัจจุบัน |
|---|---|---|---|
| github-source-executor | PASS | `route:github` | in=0 out=0 |
| agent-host | PASS | `route:agent-host` + `CAPABILITY_TO_WORKER` | in=0 out=0 |
| execution-run | PASS | `route:execution` | in=0 out=0 |
| execution-policy | PASS | `route:permission-reasoner` | in=0 out=0 |
| digitalocean-adapter | PASS | `route:digitalocean` | in=0 out=0 |
| os-login | PASS | `route:os-login` | in=0 out=0 |
| os-ui | PASS | `route:os-ui` | in=0 out=0 |
| research-engine | PASS | `route:research-engine` | in=0 out=0 |

provenance ของทุก field ตรวจซ้ำได้จาก signature จริงของ entrypoint
(ดูตารางใน PHASE 2) — **ไม่มี field ใดที่ต้องเดา**

## ขั้น 7 — ทำไม่ได้ พิสูจน์ด้วยการเรียกจริง

`applyMutation` รองรับเพียง 4 ชนิด:

```
ADD_RELATIONSHIP · REMOVE_RELATIONSHIP · ADD_EVIDENCE · ADD_VERSION
```

`store-port.ts` มีเมธอดเขียนเพียง `addRelationship` · `removeRelationship` ·
`addEvidence` · `addVersion` · `writeApprovedCandidate` (ลงทะเบียนครั้งแรกเท่านั้น)
— **ไม่มีเมธอดใดแก้ `input_contract`/`output_contract` ของ capability ที่ลงทะเบียนแล้ว**

ทดสอบจริงกับ `os-login` (ไม่ได้อ่านโค้ดเอา):

```
mutation_type=UPDATE_CONTRACT      -> REJECTED  IDENTITY_MUTATION_FORBIDDEN
mutation_type=SET_INPUT_CONTRACT   -> REJECTED  IDENTITY_MUTATION_FORBIDDEN
mutation_type=ADD_CONTRACT         -> REJECTED  IDENTITY_MUTATION_FORBIDDEN

counts ก่อน/หลัง เท่ากันทุกตาราง — ไม่มีอะไรถูกเขียน
os-login contract หลังลอง: in=0 out=0
```

**สาเหตุที่แม่นยำ** — `validation.ts:39` ปฏิเสธเพราะ `mutation_type`
ไม่อยู่ใน `KNOWN_MUTATION_TYPES` **ไม่ใช่** เพราะ `input_contract` ถูกจัดเป็น
identity key (รายการ forbidden key คือ `canonical_name`/`resource_type`/`domain`/
`source_location`/`semantic_fingerprint`/`content_hash`/`owner` ซึ่งไม่มี contract อยู่)

> พูดให้ตรง: **ไม่ใช่ว่าระบบห้ามเขียน contract — แต่ระบบไม่มีทางให้เขียน**

`contract` ถูกเขียนได้ที่เดียวคือ `registry-writer.ts:133` ตอนลงทะเบียนครั้งแรก
จาก `candidate.input` / `candidate.output` และ `pipeline.ts:48` ระบุว่า
*"a DUPLICATE must never re-touch"* — เส้นทางลงทะเบียนซ้ำจึงไม่เขียนทับด้วย

## สถานะหลังรอบนี้ — คำนวณใหม่จาก canonical

```
REGISTERED    = 114
RESOLVABLE    = 107
EXECUTABLE    =   1     (ไม่เปลี่ยน)
AVAILABLE_NOW =   0     (ไม่เปลี่ยน — derive จาก worker/runtime state แยกต่างหาก)
```

## AGENT-GATEWAY

```
CONTRACT_STATUS = PARTIAL
MISSING         = OUTPUT CONTRACT
REASON          = มี 2 invocation surface (route:dispatcher, route:voice-bridge)
                  ที่อาจมี output ต่างกัน และ signature ของ submitTask
                  สกัด return type ไม่ได้จาก source ที่มี
```
ไม่ inference · ไม่ลงทะเบียน

## RUNTIME HEALTH — คงข้อค้นพบไว้ ไม่แก้

```
STATIC_DECLARATION_COUNT  = 13
PROBE_BACKED_HEALTH_COUNT = 0
```

`STATIC HEALTH DECLARATION != RUNTIME VERIFICATION`

`research-engine` เป็นตัวเดียวที่มี probe จริง
(`GET http://127.0.0.1:8787/api/research/health`) — **ไม่แก้ implementation ในรอบนี้**

รายงานฉบับนี้ไม่เรียก `CONNECTED` ว่า `VERIFIED` ที่ใดเลย เพราะไม่มี runtime evidence รองรับ

## SEMANTIC PATH — คงข้อค้นพบไว้ ไม่แก้

```
OWNER_MULTI_MEANING_V1                   = ACTIVE SEMANTIC PATH
CANONICAL_CATALOG_VISIBLE_TO_ACTIVE_MODEL = NO
OWNER_TOOL_REQUEST_V1                     = NO CALLER FOUND
```

## VERIFICATION

```
legacy candidate membership   ไม่เปลี่ยน (12)
routing                       ไม่เปลี่ยน
endpoint behavior             ไม่เปลี่ยน
permission behavior           ไม่เปลี่ยน
execution binding             ไม่เปลี่ยน
worker state                  ไม่เปลี่ยน
canonical                     ไม่เปลี่ยนแม้แต่แถวเดียว

regression:
  router.test.ts                          9 passed, 0 failed
  semantic-resolution.test.ts             ALL CASES PASSED
  digitalocean-connector-routing.test.ts  ALL CHECKS PASSED
  route-capability-binding.test.ts        16 passed, 0 failed
  registry-writer.test.ts                 ALL CASES PASSED
  core-pipe-template-invariants.test.ts   29 passed, 0 failed
```

## ทางเลือกสำหรับรอบหน้า (ยังไม่ทำ ต้องอนุมัติ)

| ทาง | สิ่งที่ต้องทำ | ความเสี่ยง |
|---|---|---|
| **A** | เพิ่ม mutation type `SET_CAPABILITY_CONTRACT` เข้า `KNOWN_MUTATION_TYPES` + เมธอด `setCapabilityContract` ใน store-port | ขยายประตูเขียน — ต้องออกแบบให้เขียนได้เฉพาะตอน contract ว่าง เพื่อไม่ให้แก้ contract ที่ประกาศแล้ว |
| **B** | ให้ contract เขียนได้เฉพาะตอนลงทะเบียนครั้งแรกต่อไป แล้วเก็บ contract ของ 8 ตัวไว้นอก canonical (เช่น projection layer) | ไม่แตะประตูเขียน แต่ contract จะไม่อยู่ใน canonical จริง |
| **C** | ไม่ทำอะไร คง EXECUTABLE = 1 | ไม่มีความเสี่ยง แต่คอขวดยังอยู่ |

ผมไม่เลือกให้ — ทั้งสามทางเปลี่ยนความหมายของ "capability identity" คนละแบบ

---

# DECISION (2026-09-01) — OPTION B APPROVED

```
DECISION = B — contract อยู่ที่ Catalog Projection layer
STATUS   = อนุมัติแล้ว ยังไม่ implement
```

## หลักฐานที่ทำให้ตัด A ออก

`control/event-pipeline/registration-contract.ts:123` — `fingerprintCandidate()`
คำนวณ `semantic` จาก `input` และ `output` ด้วย:

```ts
const normalized = { kind, owner, input: sorted(candidate.input), output: sorted(candidate.output),
                     side_effects, dependencies, behavior, domain, resource_type, ... };
const semantic = sha256(JSON.stringify({ ...normalized, evidence_refs: undefined }));
```

`semantic_fingerprint` ของทั้ง 8 ตัวถูกคำนวณตอนที่ `input: []` และ `output: []`

ถ้าเติม contract ลง canonical โดยไม่คำนวณ fingerprint ใหม่:

1. **แถวข้อมูลกับลายนิ้วมือขัดกัน** — fingerprint บอกว่าไม่มี contract แต่แถวบอกว่ามี
2. **Duplicate gate ทะลุ** — candidate ตัวเดิมที่ประกาศ contract แล้วจะได้ `semantic`
   hash คนละตัว → `findCapabilityBySemanticFingerprint` หาไม่เจอ →
   `DUPLICATE_SEMANTIC` ไม่ทำงาน → เกิด capability ซ้ำ

และคำนวณ fingerprint ใหม่ก็ไม่ได้ เพราะ `semantic_fingerprint` อยู่ในรายการ
forbidden key ของ `validation.ts` ตรง ๆ

**ความหมายที่ระบบกำลังบอก:** contract เป็นส่วนหนึ่งของ *"capability นี้คืออะไร"*
capability ที่ประกาศ contract แล้วกับที่ยังไม่ประกาศ เป็นคนละตัวตนในโมเดลนี้
ทางเข้าเดียวจึงเป็นตอนลงทะเบียนครั้งแรก — **นี่เป็นการออกแบบ ไม่ใช่ช่องโหว่**

## ผลของ B ที่ต้องยอมรับ

```
canonical.input_contract / output_contract ของ 8 ตัว  = ยังว่าง (ไม่ถูกแตะ)
semantic_fingerprint                                  = ยังตรงกับแถวของมัน
duplicate gate                                        = ยังทำงานถูกต้อง
EXECUTABLE ที่คำนวณจาก canonical ล้วน                  = ยังเป็น 1
EXECUTABLE ที่คำนวณจาก Catalog Projection              = 9 (เมื่อ projection ทำงาน)
```

ถ้ายึดหลัก "canonical เป็นความจริงชุดเดียว" อย่างเคร่งครัด B ขัดกับหลักนั้น
เจ้าของรับทราบและเลือก B โดยแลกกับการรักษา duplicate gate ไว้

## สิ่งที่ B ต้องมี (ยังไม่ทำ — รอ TASK)

1. Catalog Projection แบบ read-only ตามที่ออกแบบไว้ใน
   `CAPABILITY_CATALOG_PROJECTION_DESIGN.md` — คำนวณสด ไม่ persist
2. แหล่ง contract ของ projection ต้องเป็น **provenance ที่บันทึกไว้แล้ว** ใน
   PHASE 2 ของเอกสารนี้ (entrypoint signature + validator + test) ไม่ใช่ค่าที่เขียนใหม่
3. `agent-gateway` คง `PARTIAL` — ไม่เข้า projection ในฐานะ EXECUTABLE
4. ไม่แตะ `runtimeInventory()` · ไม่แตะ legacy table · ไม่แตะ canonical

**ยังไม่มีบรรทัดใดถูกเขียนสำหรับ B ในรอบนี้**
