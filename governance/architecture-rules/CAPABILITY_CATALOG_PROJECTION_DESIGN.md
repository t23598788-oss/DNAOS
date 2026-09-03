# CAPABILITY CATALOG PROJECTION — DESIGN (2026-09-01)

```
MODE = DESIGN + READ-ONLY VERIFICATION
ไม่แก้ runtimeInventory() · ไม่แก้ capability-registry.ts · ไม่ register
ไม่ลบ legacy · ไม่สร้าง binding · ไม่กุ contract · ไม่แก้ canonical · ไม่ deploy
PRODUCTION_CHANGE_MADE = NO
```

## ข้อค้นพบที่เปลี่ยนรูปงานทั้งหมด

**แนวคิด "command surface" ไม่ต้องสร้างใหม่ — มันมีอยู่แล้วและใช้งานอยู่แล้ว**

`capability-ef6ae97d` (agent-gateway) มี `CAPABILITY_TO_API` **2 เส้น**:
`route:dispatcher` และ `route:voice-bridge`

หนึ่ง capability มีหลาย invocation surface ได้อยู่แล้ว โดยไม่ต้องทำ identity ซ้ำ
**ไม่ต้องเพิ่ม entity ไม่ต้องเพิ่ม type ไม่ต้องแก้ schema**

---

## 1. สามสถานะของ Owner (deterministic)

```
KNOWN         = มีตัวตนใน canonical registry
EXECUTABLE    = KNOWN + execution binding + input_contract + output_contract
AVAILABLE_NOW = EXECUTABLE + worker/executor พร้อม + policy อนุญาต
                + dependency ที่ต้องใช้ healthy + evidence รองรับ ณ ขณะนั้น
```

**`AVAILABLE_NOW` ห้าม derive จากการลงทะเบียนเพียงอย่างเดียว** — ต้องอ่านจาก
worker-registrations (`safe_to_assign` && `IDLE` && `last_probe_evidence_id`)
ซึ่งเป็น state owner คนละตัวกับทะเบียน

---

## 2. ห้าฟิลด์ของตาราง legacy — เจ้าของจริงและปลายทาง

| FIELD | CURRENT_OWNER | ACTUAL_SEMANTICS | IDENTITY | ROUTING | POLICY | RUNTIME | TARGET_FUTURE_OWNER | CAN_BE_DERIVED | SOURCE_OF_TRUTH |
|---|---|---|---|---|---|---|---|---|---|
| `endpoint` | capability-registry.ts | บอกว่า router ต้องเดินเส้นไหน (`contract` / `connector` / `not_yet_built`) | NO | **YES** | NO | NO | Routing layer | **บางส่วน** — `CAPABILITY_TO_API` บอกได้ว่า *มี* route แต่ไม่บอก `kind` และ `entry` | โค้ดของ adapter เอง |
| `supported_commands` | capability-registry.ts | allowlist ของคำสั่งที่รับได้ต่อ surface | NO | YES | **YES** | NO | Policy + Routing | **NO** — canonical ไม่มีที่เก็บ | ตาราง legacy (ที่เดียว) |
| `match_keyword_sets` | capability-registry.ts | จับคำไทย/อังกฤษเพื่อเดา intent | NO | YES | NO | NO | **Compatibility (ควรตายเมื่อ semantic layer เชื่อถือได้)** | NO | ตาราง legacy (ที่เดียว) |
| `permission_requirement` | capability-registry.ts | ธงว่าต้องผ่าน execution-policy หรือไม่ | NO | NO | **YES** | NO | `permissions/execution-policy/` | NO | ตาราง legacy เป็นธง · การบังคับใช้จริงอยู่ที่ execution-policy |
| `health_status` | capability-registry.ts | **ค่าคงที่ที่พิมพ์มือ** ไม่ได้วัดจริง | NO | NO | NO | **YES (อ้างว่าใช่)** | Runtime Observation | **YES** — ควรมาจาก probe จริง | ปัจจุบัน: literal ในไฟล์ · ควรเป็น: probe |

**ยังไม่ย้ายฟิลด์ใดในรอบนี้**

ข้อสังเกตสำคัญสองข้อ:
- `health_status` เป็น **literal ที่พิมพ์ไว้ 13 จุด** — เป็น runtime claim ที่ไม่ได้วัด
  ซึ่งเป็นชนิดของข้อมูลที่อันตรายที่สุดใน catalog
- `permission_requirement` เป็นเพียง **ธง** การบังคับใช้จริงอยู่ที่
  `permissions/execution-policy/` (router.ts:81 ระบุเองว่า *"this module never
  resolves identity/membership/grants itself"*)

---

## 3. COMMAND SURFACE — ค้นของเดิมแล้วพบ

ค้นใน contracts/registries ที่มีอยู่ก่อนเสนอสิ่งใหม่:

| ผู้สมัคร | ผล |
|---|---|
| `ingress_metadata` (canonical field) | **ไม่ใช่** — ใช้เฉพาะ `capability_type=AI_INGRESS` |
| `contracts/command/route-group-capabilities.ts` | ไม่ใช่ — เป็น 10 กลุ่ม routing ของ event ไม่ใช่ surface ของ capability |
| `EndpointReference` (command-router/types.ts) | ใกล้ แต่ผูกกับตาราง legacy |
| **`CAPABILITY_TO_API` → `to_type: "API"` → `to_id: "route:<slug>"`** | **ใช่ — และใช้งานอยู่แล้ว** |

```
COMMAND_SURFACE_CONCEPT_FOUND = YES
แนวคิดคือ ROUTE (invocation surface) แสดงด้วย CAPABILITY_TO_API ที่มีอยู่แล้ว
```

หลักฐานว่ารองรับ many-to-one อยู่แล้ว:

```
capability-ef6ae97d (agent-gateway)  ->  route:dispatcher
                                     ->  route:voice-bridge
capability อื่นอีก 9 ตัว              ->  1 route ต่อตัว
capability ที่มีมากกว่า 1 route        =  1
```

`dispatcher` และ `voice-bridge` จึงเป็น **ROUTE / invocation surface สองเส้นของ
capability เดียว** ไม่ใช่ capability สองตัว ไม่ใช่ alias และไม่ใช่ adapter คนละตัว

สิ่งที่ยัง**ขาด**คือข้อมูลประกอบ surface (`supported_commands`, `endpoint.kind`)
ที่ยังอยู่ในตาราง legacy — ตัวความสัมพันธ์เองไม่ขาด

---

## 4. PROJECTION RECORD (ออกแบบ ไม่ persist)

```ts
// อ่านอย่างเดียว คำนวณสด ไม่มีไฟล์ ไม่มีตาราง ไม่มี cache
interface CapabilityCatalogProjection {
  capability_id: string;
  canonical_name: string;

  known: true;                       // อยู่ใน projection = KNOWN เสมอ

  executable: boolean;
  executable_reason: string;         // เช่น "NO_BINDING" | "NO_INPUT_CONTRACT" | "OK"

  available_now: boolean;
  availability_reason: string;       // เช่น "NO_WORKER" | "WORKER_BUSY" | "NO_PROBE_EVIDENCE" | "OK"

  input_contract_ref: string | null;   // อ้าง canonical ไม่คัดลอกเนื้อ
  output_contract_ref: string | null;

  execution_binding_ref: string | null;   // relationship_id ของ CAPABILITY_TO_API/WORKER

  invocation_surfaces: readonly {         // จาก CAPABILITY_TO_API ทุกเส้น
    route: string;                        // "route:dispatcher"
    endpoint_kind: string | null;         // จาก policy table จนกว่าจะย้าย
    supported_commands: readonly string[];// จาก policy table จนกว่าจะย้าย
  }[];

  policy_ref: string | null;              // permission_requirement จาก policy table

  runtime_evidence_id: string | null;     // หลักฐานล่าสุดที่พิสูจน์ availability
  registration_evidence_id: string | null;
}
```

**กฎ:** ทุก field เป็น **reference** ไม่ใช่สำเนา · projection ไม่ถูกบันทึกลงดิสก์ ·
คำนวณใหม่ทุกครั้งที่ถูกอ่าน · ไม่มีสถานะที่เก็บค้าง

---

## 5. OWNER QUESTION SEMANTICS

| คำถามของ Owner | query intent | ผลลัพธ์มาจาก |
|---|---|---|
| "ระบบมีความสามารถอะไรบ้าง" | `KNOWN` | canonical registry ทั้งหมด |
| "อะไรเรียกใช้ได้" | `EXECUTABLE` | projection filter |
| "ตอนนี้อะไรพร้อมทำงาน" | `AVAILABLE_NOW` | projection + runtime state |
| "ใช้ X ทำอะไรได้" | `CAPABILITY_DETAIL` | identity + contracts + invocation_surfaces + policy |

**ขอบเขตอำนาจของโมเดล**

```
โมเดลแปลภาษา Owner -> query intent (1 ใน 4)          ← อนุญาต
โมเดลตัดสินว่าอะไรอยู่ในผลลัพธ์                        ← ห้าม
```

สมาชิกภาพของผลลัพธ์ต้องมาจาก projection ที่เป็น deterministic เท่านั้น
โมเดลไม่มีสิทธิ์เพิ่มหรือตัดรายการ

---

## 6. SEMANTIC RUNNER SAFETY

```
MODEL_SELECTION_SOURCE    = /runtime/inventory (legacy 12) ส่งเข้าไปในชื่อ available_tools
SHOULD_USE_KNOWN          = NO
SHOULD_USE_EXECUTABLE     = NO  (ในสภาพปัจจุบัน)
SHOULD_USE_AVAILABLE_NOW  = NO  (ในสภาพปัจจุบัน)
```

**เหตุผล — และนี่คือข้อค้นพบที่สำคัญที่สุดของรอบนี้:**

ภายใต้นิยามที่อนุมัติ `EXECUTABLE = 1` และ `AVAILABLE_NOW = 0`

ถ้าเปลี่ยน `available_tools` ไปใช้ `EXECUTABLE` วันนี้ โมเดลจะเลือกได้จาก
**รายการเดียว** และถ้าใช้ `AVAILABLE_NOW` จะได้ **รายการว่าง** —
คำสั่งของ Owner ทุกคำสั่งจะตกเป็น `UNKNOWN` ทันที

> **สิ่งที่ปลอดภัยที่สุดในวันนี้คือ "ยังไม่เปลี่ยน" แต่ต้องแก้ prompt ให้เลิกอ้างว่า
> รายการที่ส่งไปคือ available_tools**

ตาราง 12 ที่ส่งไปในชื่อ `available_tools` มี `AVAILABLE_NOW` จริง **0 ตัว**
คำว่า "available" ในชื่อพารามิเตอร์จึงเป็นคำกล่าวอ้างที่ไม่มีหลักฐานรองรับ

```
SEMANTIC_RUNNER_CHANGE_REQUIRED = YES แต่ไม่ใช่การสลับแหล่งข้อมูล
  ขั้นที่ 1  เปลี่ยนชื่อ/ความหมายของพารามิเตอร์จาก available_tools
            เป็น catalog ที่ระบุสถานะต่อรายการ (ไม่โกหกโมเดล)
  ขั้นที่ 2  เติม binding + contract ให้ 9 capability ที่ใกล้ EXECUTABLE ที่สุด
  ขั้นที่ 3  จึงค่อยสลับให้เลือกจาก EXECUTABLE
```

---

## 7. COUNTS ตามนิยามที่อนุมัติ

```
KNOWN_COUNT         = 114
EXECUTABLE_COUNT    =   1     capability-f6e9d29b (owner-display-projection)
AVAILABLE_NOW_COUNT =   0
```

### blocker แบบไม่ซ้ำกัน

```
NO_BINDING            58
NO_INPUT_CONTRACT      0
NO_OUTPUT_CONTRACT     0
MULTIPLE_BLOCKERS     55
รวม blocked          113
```

### รายละเอียดของ MULTIPLE_BLOCKERS

```
no-binding + no-input + no-output   45
no-input + no-output (มี binding)     9   ← ใกล้ EXECUTABLE ที่สุด
no-binding + no-input                 1
```

### ★ 9 ตัวที่มี binding แล้ว ขาดเพียง contract

```
github-source-executor · agent-gateway · agent-host · execution-run ·
execution-policy · digitalocean-adapter · os-login · os-ui · research-engine
```

ทั้ง 9 ตัวคือ capability เดียวกับที่ตาราง legacy เปิดให้ Owner เห็น —
**ทุก capability ที่ Owner มองเห็นอยู่ทุกวันนี้ ไม่มีตัวไหนประกาศ contract เลย**

**การขาดความพร้อมใช้งาน ไม่ใช่การขาด capability** — 113 ตัวที่ไม่ผ่าน EXECUTABLE
ยังคงเป็น capability ที่ลงทะเบียนถูกต้องและมีตัวตนจริง

---

## 8. LEGACY 12 — แผนการเปลี่ยนบทบาท (ไม่ลบ)

| ผู้บริโภค | CURRENT_DEPENDENCY | FUTURE_SOURCE | MIGRATION_RISK | REQUIRED_VERIFICATION |
|---|---|---|---|---|
| `runtimeInventory()` | ทั้งตาราง (catalog + status) | Catalog Projection | **สูง** — เปลี่ยนสิ่งที่ Owner เห็น | จำนวนต่อสถานะก่อน/หลังต้องอธิบายได้ทุกตัว |
| `semantic-runner` | `available_tools` = ตารางทั้งก้อน | `EXECUTABLE` (หลังขั้นที่ 2) | **สูงมาก** — วันนี้จะเหลือ 1 ตัว | คำสั่งจริงของ Owner ต้องยัง resolve ได้ |
| `router` | `endpoint.kind`, `supported_commands`, `permission_requirement` | **คงไว้ที่ตาราง** (RETAINED_AS_POLICY) | ต่ำ ถ้าไม่แตะ | เส้นทางการเรียกทุกเส้นต้องยังเดินได้ |
| UI :5181 "RESOURCES" | `/runtime/inventory` | Catalog Projection (3 ช่องแยก) | กลาง | จอต้องแยก "รู้จัก/เรียกได้/พร้อม" ไม่ยุบ |
| `match_keyword_sets` | router intent fallback | ควรตายเมื่อ semantic layer เชื่อถือได้ | กลาง | ต้องพิสูจน์ว่า semantic layer แทนได้ก่อน |

```
LEGACY_TABLE_FUTURE_ROLE = RETAINED_AS_POLICY
```

ตารางหยุดเป็นเจ้าของ *ตัวตน/catalog* แต่ยังเป็นเจ้าของ *routing + policy*
canonical กลายเป็น source of truth ของตัวตน โดยตารางไม่ถูกลบแม้แต่แถวเดียว

**ลำดับที่ปลอดภัย:** เพิ่ม projection ขึ้นมาข้าง ๆ ก่อน → เทียบผลกับของเดิม →
ย้ายผู้บริโภคทีละราย → ตารางเหลือเฉพาะ routing/policy

---

## 9. LEGACY ORPHANS — ไม่แก้ในรอบนี้

```
file-intelligence = UNRESOLVED_IDENTITY
dna-os-circuit    = UNRESOLVED_IDENTITY
```

หลักฐานที่ต้องมีก่อนตัดสิน (ยังไม่เก็บในรอบนี้):

| ทางเลือก | หลักฐานที่ต้องใช้ |
|---|---|
| `REGISTER_EXISTING_CAPABILITY` | source ที่มีอยู่จริง + contract + evidence ว่าเคยทำงาน |
| `MAP_TO_EXISTING_CAPABILITY` | พิสูจน์ว่าโค้ดที่มันชี้ไปคือ capability ที่ลงทะเบียนแล้ว (content hash / source path) |
| `KEEP_AS_INVOCATION_SURFACE` | พบ capability เจ้าของ แล้วเพิ่มเป็น `CAPABILITY_TO_API` อีกเส้น |
| `REMOVE_LEGACY_ENTRY` | พิสูจน์ว่าไม่มีผู้เรียก และ `endpoint.kind = not_yet_built` มาตลอด |

หมายเหตุจากข้อมูลที่มี: `file-intelligence` มี `endpoint.kind = "not_yet_built"`
และ `health_status = NOT_CONNECTED` — ยังไม่พอสรุป ต้อง trace ผู้เรียกจริงก่อน

---

## UNKNOWN / ข้อจำกัด

- ยังไม่ได้ trace ว่า `endpoint.entry` ของแต่ละ capability ชี้ไปฟังก์ชันที่มีอยู่จริงหรือไม่
- 7 capability ที่ `source_location` ชี้ไฟล์ที่ไม่มีอยู่ ยังไม่ได้ trace รายตัว
- ยังไม่ทราบว่า `match_keyword_sets` ถูกใช้จริงบ่อยแค่ไหนใน production path
- `AVAILABLE_NOW` ต้องนิยาม "dependency healthy" ให้ชัดกว่านี้ก่อน implement

---

# IMPLEMENTATION RESULT (2026-09-01) — OPTION B

```
CANONICAL_CHANGED     = NO
PROJECTION_PERSISTED  = NO   (คำนวณสดทุกครั้ง ไม่มีไฟล์ผลลัพธ์ ไม่มี cache)
```

โมดูล: `software/capability-catalog-projection/`
(`types.ts` · `recorded-provenance.ts` · `projection.ts` · `contract.ts` · `tests/`)

## ตัวเลขที่คำนวณสดจากทะเบียนและ source จริง

```
registered              114
resolvable              107
canonical_executable      1     owner-display-projection
projected_executable      8
executable_union          9     (source-proven OR canonical-declared)
runtime_available         1     agent-host
projected_complete        8
projected_partial         1     agent-gateway
provenance_failures       0
```

### ★ แก้ตัวเลขที่ผมทำนายผิดไว้รอบก่อน

รอบก่อนผมบอกว่า `PROJECTED_EXECUTABLE_IF_REGISTERED = 9` — **ผิด**

`projected_executable` ที่คำนวณจริงได้ **8** เพราะ `owner-display-projection`
ประกาศ contract ไว้ใน canonical ตั้งแต่ลงทะเบียน จึงไม่มี (และไม่จำเป็นต้องมี)
source-proven record — มันเป็น `canonical_executable` อยู่แล้ว

เลข 9 คือ `executable_union` ซึ่งเป็นคนละคำถาม จึงแยกเป็นอีกฟิลด์
**ไม่ยุบรวม** ตามกฎ

## PROJECTED_EXECUTABLE ทั้ง 8 พร้อมระดับหลักฐาน

| capability | input | output |
|---|---|---|
| github-source-executor | `PROVEN_VALIDATOR` | `PROVEN_BY_TEST` |
| agent-host | `PROVEN_VALIDATOR` | `PROVEN_VALIDATOR` |
| execution-run | `PROVEN_TYPE` | `PROVEN_BY_TEST` |
| execution-policy | `PROVEN_TYPE` | `PROVEN_BY_TEST` |
| digitalocean-adapter | `PROVEN_TYPE` | `PROVEN_BY_TEST` |
| os-login | `PROVEN_VALIDATOR` | `PROVEN_TYPE` |
| os-ui | `PROVEN_VALIDATOR` | `PROVEN_BY_TEST` |
| research-engine | `PROVEN_TYPE` | `PROVEN_TYPE` |

## สามความจริงถูกแยกจริง — พิสูจน์ด้วยเทสต์

ตัวอย่าง `github-source-executor`:

```
canonical_contract_status  = EMPTY          ← ทะเบียนยังว่างจริง
canonical_input_contract   = []             ← ไม่ถูกยกระดับโดย projection
canonical_executable       = false
projected_executable       = true           ← มาจาก source-proven contract
```

**projection ไม่เคยเรียกสิ่งที่ตัวเองคำนวณว่าเป็น canonical contract**

## DOWNGRADE — ไม่มี SUCCESS ค้างจากอดีต

`checkProvenance()` ตรวจซ้ำทุกครั้งที่คำนวณ และ downgrade เมื่อ:

```
SOURCE_MISSING           ไฟล์ต้นทางหายไป
SYMBOL_MISSING           entrypoint ถูกลบ/เปลี่ยนชื่อ
TYPE_NOT_FOUND_IN_SOURCE ชื่อ type ที่บันทึกไว้ไม่อยู่ใน source แล้ว
TEST_MISSING             เทสต์ที่อ้างไว้หายไป
VALIDATOR_MISSING        ไฟล์ validator หายไป
```

ทั้งห้ากรณีถูกทดสอบจริงในเทสต์ (ฉีดค่าเสียเข้าไปแล้วต้องไม่ผ่าน)

## REGRESSION

```
canonical counts        capabilities 114 · resources 590 · relationships 193
                        evidence 1219 · versions 590        (ไม่เปลี่ยน)
capabilities.jsonl sha  6f57cf5a4149fda0                    (ไม่เปลี่ยน)
semantic_fingerprint    github 7ee8b93d… · agent-host c274cf1e… · agent-gateway 9082b735…
                        (ไม่เปลี่ยน — contract ยัง in=0 out=0 ทุกตัว)
worker-registrations    5 แถว                               (ไม่เปลี่ยน)

catalog-projection            27 passed, 0 failed   (ใหม่)
router                         9 passed, 0 failed
semantic-resolution            ALL PASSED
registry-writer                ALL PASSED
route-capability-binding      16 passed, 0 failed
core-pipe-template-invariants 29 passed, 0 failed
cross-system-relationship     26 passed, 0 failed
tsc errors                     0
```

---

# ข้อเสนอป้องกันการเกิดซ้ำ (DESIGN ONLY — ไม่แก้ pipeline ในงานนี้)

## ทำไมปัญหานี้เกิด

capability 8 ตัวถูกลงทะเบียนตอนที่ candidate ไม่ได้ประกาศ `input`/`output`
`fingerprintCandidate()` จึงคำนวณ `semantic` จาก `input: []` และ `output: []`
และเพราะ contract เป็นส่วนหนึ่งของ fingerprint การเติมทีหลังจึงทำไม่ได้
โดยไม่ทำลาย duplicate gate

**owner-display-projection ไม่เจอปัญหานี้ เพราะ candidate ของมันประกาศ
`input`/`output` ตั้งแต่แรก** — นั่นคือรูปแบบที่ถูกต้องอยู่แล้วในระบบ

## ข้อเสนอ: ADMISSION CHECK ก่อน FINGERPRINT

เพิ่ม gate หนึ่งจุดใน `runRegistrationPipeline` **ก่อน** `fingerprintCandidate()`
โดยไม่แตะ stage ใดที่มีอยู่:

```
ถ้า candidate ประกาศเจตนาว่าจะเป็น executable
   (มี relationships ที่เป็น CAPABILITY_TO_API/CAPABILITY_TO_WORKER
    หรือมีฟิลด์เจตนาที่เพิ่มใหม่ เช่น intended_executable: true)

แล้วขาดข้อใดข้อหนึ่งต่อไปนี้ -> REJECTED  EXECUTABLE_CONTRACT_REQUIRED
   input.length === 0
   output.length === 0
   ไม่มี execution binding
   evidence_refs ไม่มี provenance ของ contract
```

**คุณสมบัติสำคัญ:** เพราะ gate อยู่ **ก่อน** fingerprint ค่า `input`/`output`
ที่ประกาศจะเข้าไปอยู่ใน `semantic_fingerprint` โดยอัตโนมัติตามกฎเดิม
— ไม่ต้องแก้กฎ identity และไม่ต้อง retrofit ของเก่า

## สิ่งที่ข้อเสนอนี้จงใจไม่ทำ

- **ไม่ย้อนไปแก้ตัวตนเดิม** — 8 ตัวเก่ายังคง fingerprint เดิม ถูกต้องตามที่ลงทะเบียนไว้
- **ไม่บังคับ capability ที่ไม่ตั้งใจให้ executable** — capability เชิงโครงสร้าง
  หรือเชิงเอกสารยังลงทะเบียนได้โดยไม่มี contract
- **ไม่เปลี่ยน `KNOWN_MUTATION_TYPES`** — ประตูเขียนยังปิดเหมือนเดิม

## ผลถ้ารับข้อเสนอ

```
capability ใหม่ที่ตั้งใจให้ executable  ->  contract อยู่ใน canonical ตั้งแต่วันแรก
capability เก่า 8 ตัว                  ->  ยังอยู่ที่ projection ตามมติ B
ช่องว่างนี้                            ->  ไม่เกิดกับของใหม่อีก
```

**อนุมัติและ implement แล้ว 2026-09-01 — ดูหัวข้อถัดไป**


---

# OWNER DECISION RESULT (2026-09-01)

## 1. ADMISSION_CHECK — implement แล้ว

```
GATE_LOCATION = control/registration-pipeline/pipeline.ts
                stage 2b — ก่อน fingerprintCandidate() เสมอ
MODULE        = control/registration-pipeline/executable-admission.ts
REASON_CODE   = EXECUTABLE_CONTRACT_REQUIRED:<reasons>
```

เจตนา executable อ่านจากสิ่งที่ candidate **ประกาศเอง** สองทาง — ไม่อนุมานจากชื่อหรือ path:
`relationships` ที่มี `CAPABILITY_TO_API`/`CAPABILITY_TO_WORKER` **หรือ** `intended_executable: true`

เงื่อนไขที่ต้องครบ มิฉะนั้น REJECTED:
`MISSING_INPUT_CONTRACT` · `MISSING_OUTPUT_CONTRACT` ·
`MISSING_EXECUTION_BINDING` · `MISSING_CONTRACT_PROVENANCE`

**candidate ที่ไม่ประกาศเจตนา executable ได้ `applicable: false` และผ่านไปเหมือนเดิมทุกประการ**
— capability เชิงโครงสร้าง/เอกสารไม่ถูกแตะ

เพราะ gate อยู่ก่อน fingerprint ค่า `input`/`output` ที่ประกาศจะเข้าไปอยู่ใน
`semantic_fingerprint` ตามกฎเดิมโดยอัตโนมัติ **ไม่แก้กฎ identity ไม่แก้
`KNOWN_MUTATION_TYPES` ไม่ retrofit ของเก่า**

## 2. PROJECTION_CONSUMER = NOT_APPROVED_YET

ไม่มีผู้บริโภคใดถูกต่อ `/runtime/inventory` ยังอ่าน legacy 12 เหมือนเดิม
projection ยังคง READ-ONLY · NON-PERSISTED · NON-ROUTING · NON-PERMISSION · NON-CANONICAL

## 3. AGENT_GATEWAY — PARTIAL ถูกปิดด้วยหลักฐานจริง

ตรวจ source แล้วพบว่า output **พิสูจน์ได้ตรง ๆ ทั้งสอง surface** และเป็นคนละชนิดจริง:

```
route:dispatcher    control/agent-gateway/gateway.ts:573
                    submitTask(intentText, memory, clientId, adapters, workOrder?, routeContext?)
                      : Promise<Task>

route:voice-bridge  control/agent-gateway/voice-bridge.ts:143
                    setVoiceBridgeEnabled(enabled: boolean, approvedBy: string)
                      : EnabledState
```

**สาเหตุเดิมที่ระบุว่า "สกัด return type ไม่ได้" เป็นข้อผิดพลาดของการสกัดด้วย regex
ไม่ใช่การขาดหลักฐาน** — signature อยู่ใน source มาตลอด

ปัญหาจริงคือ **contract เป็นของ invocation surface ไม่ใช่ของ capability**
โมเดล provenance จึงถูกขยายให้เป็นราย surface (`RecordedContractCandidate.surface`)
และเพิ่มกฎ coverage: **capability จะ COMPLETE ได้ก็ต่อเมื่อทุก surface มี contract
ที่พิสูจน์ได้** — surface ที่ขาด contract ทำให้ทั้ง capability ตกเป็น PARTIAL
(`SURFACE_WITHOUT_CONTRACT`)

```
AGENT_GATEWAY_STATUS = COMPLETE (จาก PARTIAL)
```

## ตัวเลขหลังทั้งสามข้อ

```
registered                114
resolvable                107
canonical_executable        1
projected_executable        9   (จาก 8 — agent-gateway เข้ามา)
executable_union           10
runtime_available           1
projected_complete          9
projected_partial           0
provenance_failures         0
surfaces_without_contract   0
```

## REVERIFY

```
canonical identity        ไม่เปลี่ยน  capabilities.jsonl sha 6f57cf5a4149fda0
fingerprints              ไม่เปลี่ยน  agent-gateway 9082b735… · github 7ee8b93d…
                                      (contract ยัง in=0 out=0 ทุกตัว)
duplicate behavior        ไม่เปลี่ยน  registry-writer ALL PASSED
routing                   ไม่เปลี่ยน  router 9/9
permissions               ไม่เปลี่ยน
projection                ยัง non-persisted (พิสูจน์ด้วย sha ก่อน/หลังคำนวณ)
incomplete executable     REJECTED   EXECUTABLE_CONTRACT_REQUIRED ที่ stage VALIDATION
complete executable       ACCEPTED
provenance downgrade      fail-closed ครบ 5 กรณี

executable-admission            15 passed, 0 failed  (ใหม่)
catalog-projection              31 passed, 0 failed
registry-writer                 ALL PASSED
registration-contract           ALL PASSED
repository-resolution            6 passed, 0 failed
router                           9 passed, 0 failed
semantic-resolution             ALL PASSED
route-capability-binding        16 passed, 0 failed
core-pipe-template-invariants   29 passed, 0 failed
cross-system-relationship       26 passed, 0 failed
connection-declaration          23 passed, 0 failed
tsc errors                       0
```
