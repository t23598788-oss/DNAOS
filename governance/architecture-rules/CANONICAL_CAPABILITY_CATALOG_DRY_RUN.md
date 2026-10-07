# CANONICAL CAPABILITY CATALOG — DRY RUN (2026-09-01)

```
MODE = READ-ONLY DESIGN + DETERMINISTIC COMPARISON
ไม่แก้ runtimeInventory() · ไม่แก้ capability-registry.ts · ไม่ register
ไม่แก้ canonical · ไม่ commit owner-projection · ไม่ backfill · ไม่ deploy
PRODUCTION_CHANGE_MADE = NO
```

## ข้อสรุปนำ — canonical **แทนตาราง 12 ตรง ๆ ไม่ได้**

ตาราง legacy ไม่ใช่ "catalog ที่ล้าสมัย" แต่เป็น **routing + policy table**
ที่ถือข้อมูลซึ่ง canonical **ไม่มีเลยสักฟิลด์**

```
field ในตาราง legacy        canonical มีไหม
─────────────────────────────────────────
capability_id               ✓ (คนละ namespace: string vs UUID)
contract                    ✓ โดยประมาณ (source_location)
endpoint                    ✗ ไม่มี
supported_commands          ✗ ไม่มี
match_keyword_sets          ✗ ไม่มี
permission_requirement      ✗ ไม่มี
health_status               ✗ ไม่มี
repo_id                     ✗ ไม่มี
```

ถ้าเปลี่ยนให้ `/runtime/inventory` อ่าน canonical ตรง ๆ **จะสูญเสีย 5 ฟิลด์**
ที่ router และ semantic layer ใช้จริง

---

## 1. COMPARE — จับคู่ผ่านความสัมพันธ์ที่ประกาศไว้ ไม่ใช่ชื่อ

การจับคู่ทำผ่าน `CAPABILITY_TO_API` → `route:<slug>` ที่ลงทะเบียนไว้ตอน Pipe 2
เท่านั้น **ไม่มี fuzzy matching**

```
LEGACY_TOTAL     = 12
CANONICAL_TOTAL  = 114
IN_BOTH          = 10   (legacy entries ที่มี canonical identity)
LEGACY_ONLY      = 2    LEGACY_ORPHAN
CANONICAL_ONLY   = 104
AMBIGUOUS        = 0
```

| legacy slug | canonical capability_id | canonical_name |
|---|---|---|
| permission-reasoner | capability-10878d16-… | execution-policy |
| research-engine | capability-ef1c94f4-… | research-engine |
| execution | capability-41201bc7-… | execution-run |
| github | capability-b4a67fea-… | github-source-executor |
| dispatcher | **capability-ef6ae97d-…** | agent-gateway |
| agent-host | capability-84f9dc65-… | agent-host |
| os-login | capability-37d56fb3-… | os-login |
| os-ui | capability-0de653bb-… | os-ui |
| voice-bridge | **capability-ef6ae97d-…** | agent-gateway |
| digitalocean | capability-72010057-… | digitalocean-adapter |

**LEGACY_ORPHAN** — ไม่มี canonical identity ที่ประกาศไว้:
`file-intelligence` · `dna-os-circuit`

### ★ การจับคู่ไม่ใช่ 1:1

`dispatcher` และ `voice-bridge` ชี้ไป canonical **ตัวเดียวกัน**
(`capability-ef6ae97d` = agent-gateway) — 10 legacy entries → **9 canonical
capability ที่ไม่ซ้ำ**

ตาราง legacy แยกสอง *command surface* บน capability เดียว ซึ่งเป็นข้อมูลที่
canonical ไม่มีโครงสร้างรองรับ (ไม่มี `supported_commands`)
**นี่เป็นเหตุผลเชิงโครงสร้าง ไม่ใช่แค่ข้อมูลขาด**

---

## 2. EXISTS ≠ AVAILABLE — นับแยกทุกมิติ

```
IDENTITY_REGISTERED   114 / 114
SOURCE_KNOWN          107 / 114   (7 ตัว source_location ชี้ไปไฟล์ที่ไม่มีอยู่)
INPUT_CONTRACT         59 / 114
OUTPUT_CONTRACT        60 / 114
EXECUTOR_BOUND         10 / 114
WORKER_AVAILABLE        1 / 114
RUNTIME_PROVEN         26 / 114
SAFE_TO_ASSIGN          1 / 114
```

---

## 3. OWNER CATALOG SEMANTICS — ★ SEMANTIC_GAP = YES

`/runtime/inventory` คืน `capability_id · registry_status · endpoint ·
supported_commands · live_status · evidence` — **ผสมสองความหมายในก้อนเดียว**
(`registry_status` = การลงทะเบียน, `live_status` = สภาพ runtime)

และผู้บริโภคสามรายอ่านมันคนละความหมาย:

| ผู้บริโภค | ตีความว่าอะไร | หลักฐาน |
|---|---|---|
| UI :5181 | **catalog** | `features/views.mjs:336` — "RESOURCES — จาก GET /runtime/inventory ของจริง" |
| semantic-runner (Qwen3) | **ของที่เรียกใช้ได้** | prompt: *"Choose only a capability_id and supported command present in `available_tools`"* |
| router | **routing table** | `endpoint.kind` ตัดสินเส้นทางการเรียก |

```
IS_IT_REGISTERED_CAPABILITY_CATALOG = บางส่วน (registry_status)
IS_IT_EXECUTABLE_CAPABILITY_CATALOG = บางส่วน (endpoint + supported_commands)
IS_IT_AVAILABLE_NOW_CATALOG         = บางส่วน (live_status)
IS_IT_MIXED_OR_AMBIGUOUS            = MIXED  -> SEMANTIC_GAP
```

**ผลกระทบจริงที่วัดได้:** prompt สั่งโมเดลว่า "เลือกได้เฉพาะจาก available_tools"
โมเดลจึงถือว่าทุกรายการในนั้น**เรียกใช้ได้** ทั้งที่ 12 รายการนั้นมี
`AVAILABLE_NOW` จริงเพียง **1** ตัว

---

## 4. DRY-RUN PROJECTIONS

```
PROJECTION_REGISTERED     = 114
PROJECTION_RESOLVABLE     = 107
PROJECTION_EXECUTABLE     =   1
PROJECTION_AVAILABLE_NOW  =   0
```

**EXECUTABLE ids:** `capability-f6e9d29b-…` (owner-display-projection)
**AVAILABLE_NOW ids:** ไม่มี

### เกณฑ์ที่ใช้ (deterministic)

```
REGISTERED    = status === "REGISTERED"
RESOLVABLE    = REGISTERED และ source_location ชี้ไปไฟล์ที่มีอยู่จริง
EXECUTABLE    = RESOLVABLE + execution binding + input_contract + output_contract
AVAILABLE_NOW = EXECUTABLE + worker ที่ safe_to_assign && IDLE && มี probe evidence
```

### ความไวของเกณฑ์ — ต้องรายงานคู่กัน

ถ้า `EXECUTABLE` **ไม่บังคับ contract** (นับเฉพาะ binding):

```
EXECUTABLE_BINDING_ONLY    = 10
AVAILABLE_NOW_BINDING_ONLY =  1   -> agent-host
```

ตัวเลข 1 vs 10 และ 0 vs 1 ต่างกันเพราะนิยาม ไม่ใช่เพราะข้อมูล
**เจ้าของต้องเป็นผู้ตัดสินว่า "เรียกใช้ได้" ต้องมี declared contract หรือไม่**

### อะไรบล็อกอะไร

```
ไม่มี execution binding เลย        104 / 114
มี binding แต่ไม่มี input_contract    9
มี binding + input แต่ไม่มี output    0
ครบทั้งสาม                            1
```

คอขวดคือ **execution binding (104 ตัว)** ไม่ใช่ contract

---

## 5. LEGACY 12 — บทบาทจริง

| slug | canonical | REG | RESOLV | EXEC | NOW | WHY_VISIBLE_TODAY |
|---|---|---|---|---|---|---|
| file-intelligence | ORPHAN | — | — | — | — | มี entry ในตาราง |
| permission-reasoner | capability-10878d16 | Y | Y | N | N | มี entry ในตาราง |
| research-engine | capability-ef1c94f4 | Y | Y | N | N | มี entry ในตาราง |
| execution | capability-41201bc7 | Y | Y | N | N | มี entry ในตาราง |
| github | capability-b4a67fea | Y | Y | N | N | มี entry ในตาราง |
| dna-os-circuit | ORPHAN | — | — | — | — | มี entry ในตาราง |
| dispatcher | capability-ef6ae97d | Y | Y | N | N | มี entry ในตาราง |
| agent-host | capability-84f9dc65 | Y | Y | N | N* | มี entry ในตาราง |
| os-login | capability-37d56fb3 | Y | Y | N | N | มี entry ในตาราง |
| os-ui | capability-0de653bb | Y | Y | N | N | มี entry ในตาราง |
| voice-bridge | capability-ef6ae97d | Y | Y | N | N | มี entry ในตาราง |
| digitalocean | capability-72010057 | Y | Y | N | N | มี entry ในตาราง |

\* agent-host = `AVAILABLE_NOW` ภายใต้นิยาม binding-only (มี worker + probe จริง)

**WHY_VISIBLE_TODAY เหมือนกันทั้ง 12 ตัว: มี entry ในตาราง — ไม่มีเงื่อนไขอื่นเลย**

```
LEGACY_TABLE_ROLE = MIXED
                    CATALOG + ROUTING_TABLE + POLICY_TABLE + ALLOWLIST + COMPATIBILITY_LAYER
```

- **ROUTING_TABLE** — `endpoint.kind` (contract/connector/not_yet_built) ตัดสินว่า
  router เดินเส้นไหน (`runConnectorStep` ฯลฯ)
- **POLICY_TABLE** — `permission_requirement` ต่อ capability
- **ALLOWLIST** — `supported_commands` จำกัดคำสั่งที่รับได้
- **COMPATIBILITY_LAYER** — `match_keyword_sets` (การจับคำภาษาไทย/อังกฤษ)
- **CATALOG** — สิ่งที่ Owner เห็น

**ห้ามลบทิ้งเฉย ๆ** — สี่บทบาทแรกไม่มีที่อยู่ใน canonical

---

## 6. MINIMUM REPLACEMENT DESIGN (ออกแบบ ไม่ implement)

```
Canonical Capability Registry        ← ตัวตน + สถานะการลงทะเบียน (114)
        ↓
Capability Catalog Projection        ← ★ ชั้นใหม่ที่ยังไม่มี
        ↓                              ประกอบ canonical + binding + policy
Runtime Resolution                   ← endpoint / supported_commands
        ↓
Worker / Binding State               ← worker-registrations, probe evidence
        ↓
Owner Inventory                      ← แยก 3 สถานะให้ Owner เห็นคนละช่อง
```

**การเปลี่ยนที่เล็กที่สุดที่ปลอดภัย** — ไม่ใช่ "ให้ inventory อ่าน canonical"
แต่คือ **เพิ่มชั้น projection** ที่:

1. เอา **ตัวตน + สถานะลงทะเบียน** จาก canonical (114)
2. เอา **endpoint / supported_commands / permission_requirement** จากตาราง legacy
   ต่อไป จนกว่าจะมีที่อยู่ใน canonical
3. เอา **availability** จาก binding + worker state + probe evidence
4. คืนออกมาเป็น **สามช่องแยกกัน** ไม่ยุบเป็น boolean เดียว

```
control/command-router/capability-registry.ts = RETAINED_AS_POLICY
```

**ไม่ใช่ REMOVED และยังไม่ใช่ DERIVED** — เพราะ 5 ฟิลด์ของมันไม่มีที่อยู่ใน canonical
จะกลายเป็น `DERIVED` ได้ต่อเมื่อ endpoint/supported_commands/permission_requirement
ถูกย้ายเข้า canonical ก่อน ซึ่งเป็นงานคนละรอบ

**คำเตือน:** ถ้าเปลี่ยนให้ Owner เห็น 114 รายการโดยไม่แยกสถานะ
ผลจะแย่ลงกว่าเดิม — semantic-runner ถูกสั่งให้เลือกจาก `available_tools`
มันจะเลือกจาก 114 ตัวที่ `AVAILABLE_NOW` จริงเพียง 0–1 ตัว
**การขยาย catalog โดยไม่แยกสถานะ = ขยายพื้นที่ให้เลือกผิด**

---

## 7. OWNER-PROJECTION LINEAGE (แยกเรื่อง ไม่ปนกับ catalog)

```
REGISTERED      = YES   capability-f6e9d29b-6236-4d63-9cd4-229a9c50ef48
GIT_TRACKED     = NO    git ls-files control/owner-projection/ = ว่าง
                        git status = "?? control/owner-projection/"
SOURCE_LINEAGE  = INCOMPLETE
```

เก็บเป็นรายการซ่อมแยกต่างหาก **ไม่ commit ในรอบนี้**

---

## UNKNOWN / ข้อจำกัดของ dry-run นี้

- `file-intelligence` และ `dna-os-circuit` = LEGACY_ORPHAN — ยังไม่ทราบว่าควรมี
  canonical identity หรือควรถูกถอด ต้องตรวจแยก
- 7 capability ที่ `SOURCE_KNOWN = NO` (source_location ชี้ไฟล์ที่ไม่มี) ยังไม่ได้ trace รายตัว
- ตัวเลข EXECUTABLE/AVAILABLE_NOW ขึ้นกับนิยามที่เจ้าของยังไม่ได้ตัดสิน
