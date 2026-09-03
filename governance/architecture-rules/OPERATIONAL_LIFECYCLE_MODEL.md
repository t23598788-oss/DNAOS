# OPERATIONAL LIFECYCLE MODEL — design draft (2026-09-01)

```
STATUS = DESIGN ONLY
canonical ไม่ถูกแก้ · ไม่มี relationship จริงถูกสร้าง · ไม่มี schema ถูก migrate
```

เอกสารนี้ปิด Gap 5 กลุ่มที่พิสูจน์แล้วว่าขาด แล้วประกอบเข้ากับ
`CrossSystemRelationshipKind` 27 ตัวเดิมให้เป็น lifecycle เส้นเดียว

---

## 0. กฎข้อแรก — แยกกราฟสองใบ ห้ามปน

ปัญหาที่ทำให้ลูกศรชี้ไม่ถูก ไม่ใช่ข้อมูลไม่พอ แต่เป็นการเอากราฟสองชนิด
มาใส่ใบเดียวกัน

| | **Structural Graph** (มีอยู่แล้ว) | **Operational Flow Graph** (ที่ขาด) |
|---|---|---|
| ตอบคำถาม | "โครงสร้างที่ค้นพบ" | "งานไหลยังไง" |
| เกิดจาก | census สแกนโค้ด | **การประกาศ** โดยเจ้าของ capability |
| edge | `DEPENDENCY` 323, `CONTAINS` 142 | `FLOW_SENDS_TO`, `STORED_IN`, ... |
| ความจริง | A import B — จริงเสมอ | ต้องมี evidence ถึงจะจริง |
| เชื่อได้แค่ไหน | บอกความเป็นไปได้ | บอกสิ่งที่เกิดขึ้นจริง |

**กฎ**
1. census **ห้ามเขียน**ลงกราฟ Flow เด็ดขาด เครื่องสแกนเห็นแค่ `import`
   มันไม่มีทางรู้ว่า "ตรวจเสร็จแล้ว evidence ต้องไปเก็บที่ไหน"
   เพราะนั่นคือ**การตัดสินใจ** ไม่ใช่ข้อเท็จจริงในไฟล์
2. edge หนึ่งเส้นอยู่ได้กราฟเดียว ห้ามซ้ำสองใบ
3. Structural Graph **เก็บไว้ตามเดิม** DEPENDENCY/CONTAINS ยังมีประโยชน์
   สำหรับบอกโครงสร้างที่ค้นพบ แค่ต้องแยกใบออกมา

---

## 1. GAP 1 — Persistence

> ใคร PRODUCES → STORED_IN ที่ไหน → เรียกกลับด้วย ID/version อะไร

**Entity ใหม่**

| entity | คือ | ตัวอย่างจริง |
|---|---|---|
| `STORE` | ที่ที่ข้อมูลอยู่จริง | `canonical/evidence.jsonl`, postgres `evidence`, `audit/*.jsonl` |
| `RETRIEVAL_KEY` | คีย์ที่ใช้เรียกกลับ | `evidence_id`, `version_id`, `content_hash` |

**Edge ใหม่**

```
EXECUTION_PRODUCES_EVIDENCE   EXECUTION → EVIDENCE
EVIDENCE_STORED_IN            EVIDENCE  → STORE
STORE_ADDRESSED_BY            STORE     → RETRIEVAL_KEY
VERSION_STORED_IN             VERSION   → STORE
```

**ฟิลด์บังคับบน `EVIDENCE_STORED_IN`**

```
store_id           ที่เก็บ
retrieval_key      ฟิลด์ที่ใช้เรียกกลับ เช่น "evidence_id"
durability         DURABLE | EPHEMERAL | UNKNOWN
readable_by        รายชื่อ projection/capability ที่มีสิทธิ์อ่าน
```

`durability` สำคัญ — evidence ที่อยู่ใน memory อย่างเดียว **ห้ามนับเป็นหลักฐาน**

---

## 2. GAP 2 — UI / Projection

> resource ไหน → projection ไหน → UI surface ไหน → Owner เห็นอะไร

นี่คือกล่องที่เฮียบอกว่าต้องมี ตอนนี้ node type มีแค่
`CAPABILITY / DOMAIN / SERVICE / PROVIDER` — ไม่มีที่ให้ UI ยืน
:5177 :5178 :5181 :3000 เลยลอยอยู่

**Entity ใหม่**

| entity | คือ |
|---|---|
| `PROJECTION` | ตัวแปลงข้อมูลดิบ → รูปที่ Owner อ่านได้ (whitelist ไม่ใช่ serializer) |
| `UI_SURFACE` | หน้าจอจริงที่ Owner เปิด |

**Edge ใหม่**

```
PROJECTION_READS_STORE         PROJECTION → STORE
PROJECTION_READS_RESOURCE      PROJECTION → RESOURCE
UI_SURFACE_RENDERS_PROJECTION  UI_SURFACE → PROJECTION
UI_SURFACE_SERVED_BY_SERVICE   UI_SURFACE → SERVICE     ← ผูก :5181 เข้าระบบ
```

**กฎเหล็กของกลุ่มนี้**

> UI_SURFACE **ห้ามต่อตรงเข้า STORE** ต้องผ่าน PROJECTION เสมอ

เหตุผลมีหลักฐานจริง: เคสที่ Owner ถาม "มีเอเจนต์ใช้งานได้กี่ตัว" แล้วได้
"เจ้าของได้สังเกตเห็นความสามารถดังกล่าวแล้ว" — เกิดเพราะไม่มีใครรู้ว่า
projection ตัวไหนควรตอบคำถามนั้น เมื่อ edge นี้มีอยู่ คำถามจะ resolve
ไปที่ projection ที่ประกาศไว้ ไม่ใช่ให้โมเดลเดา

**ฟิลด์บังคับบน `UI_SURFACE`**

```
url              http://127.0.0.1:5181
served_by        service id
owner_visible    true | false
projection_ids   ต้องไม่ว่าง — surface ที่ไม่มี projection คือ surface ที่แสดงของมั่ว
```

---

## 3. GAP 3 — Recovery / Rollback

> อะไรย้อนได้ → ย้อนไป version/state ไหน → ใครสั่งได้ → evidence อะไรยืนยัน

**Edge ใหม่**

```
VERSION_SUPERSEDES_VERSION      VERSION    → VERSION      สายย้อนกลับ
DEPLOYMENT_ROLLBACK_TO_VERSION  DEPLOYMENT → VERSION
ROLLBACK_AUTHORIZED_BY          ROLLBACK   → IDENTITY/POLICY
ROLLBACK_PROVEN_BY              ROLLBACK   → EVIDENCE
```

**ฟิลด์บังคับ**

```
reversible          YES | NO | UNKNOWN
rollback_target     version_id ที่ย้อนไปได้จริง (ต้องมีอยู่จริงในทะเบียน)
authority_required  policy ที่ต้องผ่านก่อนสั่ง
```

**กฎ**: `reversible: UNKNOWN` ต้องถูกปฏิบัติเหมือน `NO`
ห้ามเดาว่าย้อนได้ — เดาผิดแล้วของหาย

---

## 4. GAP 4 — Replay / Idempotency

> operation ไหนเรียกซ้ำได้ → key อะไร → ซ้ำแล้ว reuse หรือ execute ใหม่

กลุ่มนี้มีของจริงในโค้ดแล้วจาก Pipe B แต่**ไม่มีในโมเดล**

**Edge ใหม่**

```
EXECUTION_REUSED_EXECUTION   EXECUTION → EXECUTION   ชี้ไปงานเดิมที่เอาผลมาใช้ซ้ำ
WORK_IDENTIFIED_BY_KEY       WORK      → RETRIEVAL_KEY
```

**ฟิลด์บังคับ**

```
idempotency_key   ต้อง explicit ห้าม derive จาก timestamp/ชื่อ/ความใกล้เคียง
replay_policy     REUSE | RE_EXECUTE | FORBIDDEN
freshly_observed  true | false     ← ผลที่ reuse มา ห้ามแสดงเป็นของสด
```

`freshly_observed` มาจากบั๊กจริงที่เจอตอน Pipe B: executor คืน evidence
ของคำสั่งก่อนหน้าเมื่อ operation หน้าตาเหมือนกัน แล้วเสนอเป็นการสังเกตใหม่

---

## 5. GAP 5 — Flow Contract  ★ ตัวที่ทำให้ลูกศรมีความหมาย

> SOURCE → ส่ง WHAT → ผ่าน CONTRACT → DESTINATION → คืน WHAT → evidence ไหนยืนยัน

**นี่คือหัวใจ** ลูกศรที่ไม่มี 6 ช่องนี้ครบ ไม่ใช่ลูกศร มันคือ**ข้อสันนิษฐาน**

**Entity ใหม่**: `FLOW_CONTRACT`

**Edge ใหม่**: `FLOW_SENDS_TO` — ฟิลด์บังคับทั้ง 6

```
from_id          ใคร
to_id            ไปไหน
sends            contract ref ของสิ่งที่ส่ง      เช่น DNA_OS_AGENT_INPUT_V1
returns          contract ref ของสิ่งที่ต้องได้คืน  เช่น DNA_OS_AGENT_RESULT_V1
proven_by        evidence_id ที่พิสูจน์ว่าเส้นนี้เคยไหลจริง
state            DECLARED | OBSERVED | PROVEN
```

**กฎสถานะ**

| state | แปลว่า | ใครให้ได้ |
|---|---|---|
| `DECLARED` | มีคนประกาศว่าควรไหลแบบนี้ ยังไม่เคยเห็นจริง | เจ้าของ capability |
| `OBSERVED` | เคยเห็นไหลจริงอย่างน้อยหนึ่งครั้ง | runtime observation |
| `PROVEN` | ไหลจริง + ของที่คืนตรง `returns` + มี evidence | gate เท่านั้น |

- census edge เป็นได้สูงสุดแค่ `DECLARED` ตลอดกาล
- `PROVEN` ต้องมี `proven_by` ที่ resolve ได้จริง ห้ามว่าง
- **ห้ามมี `FLOW_SENDS_TO` ที่ `sends` หรือ `returns` ว่าง** — เส้นที่ไม่รู้ว่า
  ส่งอะไร คือเส้นที่ทดสอบไม่ได้ และเป็นต้นตอของ fail-closed ที่หาสาเหตุไม่เจอ

---

## 6. ประกอบกับ 27 relationship เดิม

27 ตัวเดิมตอบ "โครงสร้างข้ามระบบ" ได้ดีอยู่แล้ว 5 กลุ่มใหม่ตอบ "การไหลและวงจรชีวิต"
ต่อกันตรงนี้:

```
   ── ของเดิม 27 ตัว ─────────────────────┐
   REPOSITORY_HAS_SOURCE_FILE             │
   RESOURCE_IMPLEMENTED_BY_SOURCE_FILE    │
   RESOURCE_HAS_VERSION                   ├──▶ VERSION ──┐
   REPOSITORY_DEPLOYS_TO_SERVICE          │              │
   SERVICE_HAS_DEPLOYMENT                 │              │
   DEPLOYMENT_RUNS_VERSION ───────────────┘              │
   RUNTIME_EXECUTES_RESOURCE                             │
   WORK_TARGETS_CAPABILITY ──▶ EXECUTION_OF_WORK ──▶ EXECUTION
                                                         │
   ── ใหม่ 5 กลุ่ม ──────────────────────────────────────┤
   EXECUTION_PRODUCES_EVIDENCE ──▶ EVIDENCE_STORED_IN ──▶ STORE
                                                         │
   PROJECTION_READS_STORE ◀──────────────────────────────┘
        │
        ▼
   UI_SURFACE_RENDERS_PROJECTION ──▶ UI_SURFACE ──▶ Owner
        
   VERSION_SUPERSEDES_VERSION      (ย้อนกลับ)
   EXECUTION_REUSED_EXECUTION      (เรียกซ้ำ)
   FLOW_SENDS_TO                   (คร่อมทุกเส้นข้างบน — ให้สัญญากับหลักฐาน)
```

`FLOW_SENDS_TO` ไม่ใช่ edge ชั้นเดียวกับตัวอื่น มันเป็น**ชั้นคร่อม**
ที่ติดสัญญาและหลักฐานให้กับเส้นที่มีอยู่

---

## 7. เดินตัวอย่างจริงหนึ่งเส้น — `agent-host`

ใช้ ID จริงจากทะเบียน ไม่ใช่ ID สมมติ นี่คือ capability เดียวที่พิสูจน์ end-to-end แล้ว

| # | คำถามของ Owner | คำตอบจากทะเบียนตอนนี้ | สถานะ |
|---|---|---|---|
| 1 | Source Code อยู่ไหน | `control/agent-host/` | ✓ |
| 2 | อยู่ Repository ไหน | `repository_id = null` **0/589** | ✗ |
| 3 | Resource/Capability ไหนใช้ | `resource-cea69029…` / `capability-84f9dc65…` | ✓ |
| 4 | Version/commit ไหน | `version 1.0.0`, `version_id 2f4be580…`, `hash 5b09a469…` | ✓ |
| | | `commit_sha = null` **0/589** | ✗ |
| 5 | ใครตรวจ | readiness probe 7 ข้อ ผ่านหมด โดย `codex:01a05876…` | ✓ |
| 6 | ผลตรวจเก็บที่ไหน | evidence 9 แถว — **แต่รู้เพราะเปิดไฟล์เอง ไม่มี edge บอก** | ✗ |
| 7 | ใครอ่านผล | ไม่มี edge | ✗ |
| 8 | ส่งไป deploy ที่ไหน | ไม่มี DEPLOYMENT node | ✗ |
| 9 | runtime ไหนใช้ version นั้น | คำศัพท์มี `RUNTIME_EXECUTES_RESOURCE` แต่ไม่มีแถวจริง | ✗ |
| 10 | ผล runtime เป็น evidence ไหน | `ev-1a2fce9f…` มีอยู่ แต่ไม่มี edge เชื่อมถึง | ✗ |
| 11 | projection ไหนอ่าน | ไม่มี entity | ✗ |
| 12 | UI Surface ไหนแสดง | ไม่มี entity | ✗ |
| 13 | พังแล้วย้อนอะไรได้ | ไม่มี | ✗ |
| 14 | รันซ้ำรู้ได้ไงว่างานเดิม | `idempotency_key` มีในโค้ด แต่ไม่มีในโมเดล | ✗ |

```
ตอบได้ตอนนี้      5 / 14
โมเดลนี้ปิดเพิ่ม   7 / 14   (ข้อ 6,7,10,11,12,13,14)
ต้องเก็บข้อมูลเพิ่ม 2 / 14   (ข้อ 2 repository_id, ข้อ 4 commit_sha)
```

**ข้อ 2 กับ 4 ปิดด้วยโมเดลไม่ได้** — ไม่ใช่เพราะขาดคำศัพท์ แต่เพราะ
**ข้อมูลไม่เคยถูกเก็บ** ต้องแก้ตอน registration ไม่ใช่ตอนวาดกราฟ
และ `commit_sha` ห้ามเติมย้อนหลังด้วย commit ปัจจุบัน ต้องคงสถานะ
`SOURCE_REVISION_UNRESOLVED` ไว้

### เส้นเดียวกันหลังใส่โมเดลครบ

```
control/agent-host/                          SOURCE_FILE
  └─ REPOSITORY_HAS_SOURCE_FILE ──▶ REPOSITORY  ← ข้อ 2 ต้องเก็บเพิ่ม
  └─ RESOURCE_IMPLEMENTED_BY_SOURCE_FILE ──▶ resource-cea69029
        └─ RESOURCE_HAS_VERSION ──▶ v1.0.0 / 2f4be580 (commit_sha ✗)
             └─ DEPLOYMENT_RUNS_VERSION ──▶ DEPLOYMENT ──▶ SERVICE
                  └─ RUNTIME_EXECUTES_RESOURCE ──▶ RUNTIME
                       └─ EXECUTION_OF_WORK ──▶ EXECUTION
                            ├─ EXECUTION_PRODUCES_EVIDENCE ──▶ ev-1a2fce9f
                            │    └─ EVIDENCE_STORED_IN ──▶ canonical/evidence.jsonl
                            │         └─ STORE_ADDRESSED_BY ──▶ evidence_id
                            ├─ EXECUTION_REUSED_EXECUTION ──▶ (งานเดิม ถ้า replay)
                            └─ VERSION_SUPERSEDES_VERSION ──▶ (เป้าย้อนกลับ)
                                 
   PROJECTION_READS_STORE ◀── canonical/evidence.jsonl
        └─ UI_SURFACE_RENDERS_PROJECTION ──▶ :5181  ──▶ Owner เห็น

   ทุกเส้นข้างบนถูกคร่อมด้วย FLOW_SENDS_TO { sends, returns, proven_by, state }
```

---

## 8. ทำไมถึงใช้เป็นแม่แบบกับระบบอื่นได้

โมเดลนี้ไม่ผูกกับผู้ให้บริการรายไหน ระบบภายนอกเข้ามาเป็น `PROVIDER_PROJECT`
+ `SERVICE` + `STORE` เท่านั้น

| ระบบ | เข้าโมเดลยังไง |
|---|---|
| GitHub | `REPOSITORY` + `PROVIDER_PROJECT` — ปิดข้อ 2 และ `commit_sha` ข้อ 4 |
| Railway | `PROVIDER_PROJECT_HAS_SERVICE` → `SERVICE_HAS_DEPLOYMENT` → `DEPLOYMENT_RUNS_VERSION` |
| Supabase / SQL | `DATABASE_PROJECT_HAS_OBJECT` + `STORE` |
| n8n | **`SERVICE` เท่านั้น ห้ามเป็น STORE และห้ามเป็น PROJECTION** |
| Browser/UI | `UI_SURFACE` + `PROJECTION` |

**ข้อบังคับสำหรับ n8n**: n8n เป็นสายพาน ไม่ใช่สมอง มันปรากฏในโมเดลได้แค่
เป็นตัวกลางของ `FLOW_SENDS_TO` เท่านั้น **ห้ามเป็นเจ้าของ evidence
ห้ามเป็นผู้ตัดสิน PASS** ผลตรวจต้องมาจากสถานีปลายทางที่มี capability จริง

---

## 9. สิ่งที่เอกสารนี้ยังไม่ทำ

- ไม่แตะ canonical แม้แต่แถวเดียว
- ไม่สร้าง relationship จริง
- ไม่ migrate schema
- ไม่ promote 9,701 temp relationship
- ไม่เติม `commit_sha` / `repository_id` ย้อนหลัง
- ยังไม่แยกกราฟบน :5181 จริง (ข้อ 0 เป็นข้อเสนอ)

ขั้นต่อไปที่เล็กที่สุดและพิสูจน์ได้: เลือก **agent-host เส้นเดียว**
ประกาศ edge ใหม่แบบ dry-run แล้วดูว่า 14 คำถามตอบได้กี่ข้อ
ถ้าเส้นเดียวยังไม่ครบ ห้ามขยายไปเส้นที่สอง
