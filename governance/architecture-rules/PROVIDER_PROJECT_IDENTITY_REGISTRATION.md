# PROVIDER PROJECT IDENTITY REGISTRATION (2026-09-01)

ดำเนินตามมติ **A / B / C** ที่อนุมัติแล้ว

```
A  PROVIDER_PROJECT ได้ identity owner ของตัวเอง → software/provider-project-registry/
B  ไม่ขยาย cross-system vocabulary → ใช้ authorized_by_connection_id เป็น reference
C  executor_capability_id → resolve-on-read, ConnectionRegistration เป็นเจ้าของ
```

---

## A — PROVIDER PROJECT REGISTRY

`software/provider-project-registry/` — **ทะเบียนตัวตนเท่านั้น**

ยืมกติกาที่รีโปนี้ใช้อยู่แล้วทุกข้อ ไม่ประดิษฐ์ใหม่: identity เป็นสตริงที่คำนวณซ้ำได้
และอ่านออก (ไม่ hash) · append-only JSONL · latest-per-id wins · ลงซ้ำ = REUSED

```
natural key = provider-project://<provider>/<identifiers เรียงคีย์แล้ว>
```

เรียงคีย์เพื่อให้ลำดับที่ผู้เรียกส่งมาไม่มีผลต่อตัวตน — พิสูจน์ด้วยเทสต์

### สิ่งที่ทะเบียนนี้ปฏิเสธโดยออกแบบ

| ห้ามเก็บ | เหตุผล |
|---|---|
| secret / token / credential pointer | credential มีทะเบียนของตัวเองแล้ว |
| สถานะที่เปลี่ยนได้ (connected/healthy/deploying) | เป็นของ state owner |
| deployment state, version ที่รันอยู่ | เป็นของ deployment/runtime |

ประตูปฏิเสธค่าที่มีรูปร่างเป็น secret ตั้งแต่ validation และเทสต์สแกนไฟล์ยืนยันว่า
ไม่มี field ชื่อ credential/token/secret/status/deploy อยู่ในข้อมูลจริง

### สถานะที่รองรับครบ 5

`REGISTERED` · `REUSED` · `DUPLICATE_EXACT` · `CONFLICT` · `UNRESOLVED`

`CONFLICT` = natural key ชนกันแต่ identifiers ต่างกัน → **หยุด ให้คนตัดสิน ไม่เดา**

การเทียบตัวตนเป็น string comparison ของ natural key ล้วน
**ไม่มี fuzzy ไม่มี similarity ไม่มีโมเดล** — AI ไม่มีสิทธิ์ตัดสินว่าสองตัวตนเท่ากัน

### ผลการลงทะเบียน

| provider | status | identity |
|---|---|---|
| **Railway** | `REGISTERED` | `provider-project://railway/environment_id=4d28eafa-9735-4405-a585-55ea354bafab,project=dna-os-infrastructure` |
| **Supabase** | `REGISTERED` | `provider-project://supabase/project_ref=xeytcavxejhyzxwevgto` |
| **DigitalOcean** | `UNRESOLVED` | — |

`verified_by` ของแต่ละแถวอ้างไฟล์จริงที่อ่านค่ามา ไม่ใช่คำบรรยาย:
Railway ← `connections/railway/router-invoker.ts (ENVIRONMENT_ID)` ·
Supabase ← `execution/run/process-registry.ts:123 (SUPABASE_PRODUCTION_PROJECT_REF)`

**DigitalOcean ไม่ถูกบันทึกเลยแม้แต่แถวเดียว** — `CORE_V2_BASE_URL` เป็น API host
ไม่ใช่ตัวตนของ project ไม่มีตัวระบุที่ผู้ให้บริการออกให้ในหลักฐานที่มี
ประกอบ natural key ไม่ได้ → `UNRESOLVED` ตามคำสั่ง

### ไม่มีเจ้าของชุดที่สอง

```
Provider Project Registry  = identity owner
canonical cross-system     = projection/reference (ยังไม่ผูก รอบนี้ไม่แตะ)
Connection Declaration     = connection metadata/reference
```

---

## B — AUTHORIZATION REFERENCE

เพิ่ม `authorized_by_connection_id?: string | null` ใน `ConnectionDeclaration`
แบบ **additive** (optional) — 6 declaration ที่ลงไปแล้วยังใช้ได้โดยไม่ต้องเขียนทับ

```
null / undefined = ช่องทางนี้ไม่ต้องมี authorization (เช่น MCP INBOUND local)
                   หรือยังไม่มี registration ที่พิสูจน์ได้
non-null         = connection_id ของ ConnectionRegistration ที่มีอยู่จริง
```

**Validation เป็น deterministic** — ถ้าใส่มา ต้อง `lookupConnection` เจอจริง
ไม่เจอ = `AUTHORIZATION_REFERENCE_NOT_FOUND` ไม่มีการเดา

**ห้ามคัดลอกสถานะวงจรอนุมัติ** (connecting/connected/error) เข้ามาไว้ที่นี่ —
registration แก้ไขได้ ส่วน declaration append-only สำเนาจะค้างเป็นค่าเก่าทันที

### vocabulary gap — บันทึกไว้ ไม่แก้

```
MODEL_RELATIONSHIP_GAP = YES (documented, not closed)
```

16 entity types ไม่มี `CONNECTION` และไม่มี `AUTHORIZATION` ·
27 relationship kinds ไม่มีตัวใดที่ปลายทั้งสองข้างเป็น connection record

`DECLARATION_AUTHORIZED_BY_REGISTRATION` จึงแสดงในกราฟไม่ได้ —
รอบนี้เก็บความสัมพันธ์ไว้เป็น field reference นอกกราฟตามมติ B
**ไม่เพิ่ม entity ไม่เพิ่ม kind**

---

## C — EXECUTOR OWNERSHIP (resolve-on-read)

`connections/connection-registry/executor-resolution.ts` — **อ่านอย่างเดียว
ไม่มีฟังก์ชันใดเขียนค่ากลับลง declaration**

```
resolveDeclarationExecutor(declaration) -> {
  effective_executor_capability_id
  executor_source: ConnectionRegistration | ConnectionDeclaration | NONE
  historical_declaration_incomplete
  reason
}
```

### พิสูจน์กับข้อมูลจริง

```
ConnectionRegistration (GitHub).executor_capability_id = capability-b4a67fea-…
ConnectionDeclaration  (GitHub).executor_capability_id = null   ← ไม่ถูกเขียนทับ

resolveDeclarationExecutor(declaration + authorized_by_connection_id)
  effective_executor_capability_id = capability-b4a67fea-f3a6-41b3-91c2-cbdb8223977e
  executor_source                  = ConnectionRegistration
```

การผูก reference ในเทสต์ทำ **ในหน่วยความจำเท่านั้น** — เทสต์ข้อสุดท้ายยืนยันว่า
declaration ในทะเบียนยังเป็น `null` เหมือนเดิมหลังทดสอบ

### HISTORICAL_DECLARATION_INCOMPLETE

declaration ของ GitHub ปัจจุบัน (ยังไม่มี reference) → `executor_source = NONE`
และถูกทำเครื่องหมาย `historical_declaration_incomplete = true`
เพราะเป็นช่องทาง OUTBOUND ที่ใช้ credential แต่ไม่มีทั้ง executor และ reference

**รายงาน ไม่เขียนทับ** ตามคำสั่ง — append-only record ไม่ถูกแก้

MCP ได้ `executor_source = ConnectionDeclaration` และ
`historical_declaration_incomplete = false` เพราะ INBOUND local ไม่ต้องมี
authorization ตาม semantics จริง — `null` ที่ถูกต้องถูกแยกออกจาก `null` ที่ขาดข้อมูล

---

## REPOSITORY WORK

### census classification (ไม่ลบ fixture)

marker สองตัวที่อิสระต่อกันและต้องตรงกัน:
1. `owner` ตรงรูปแบบที่ไฟล์เทสต์ในรีโปนี้เขียนเอง
   (`test-owner`, `debug-owner`, `repo-res-owner-*`, `canonical-flow-owner-*`)
2. `repository_root` ชี้ไป sandbox/tmp ไม่ใช่ checkout จริง

ตรวจกับข้อมูลจริง: **ตรงกัน 119/119 ขัดแย้ง 0** · marker ขัดกัน = `UNCLASSIFIED`

```
OPERATIONAL 3   TEST_FIXTURE 117   UNCLASSIFIED 0   total 120
```

### identity ที่ลงทะเบียน — verify ไม่ใช่ copy

ตัวตนถูก **อ่านจาก git จริง** แล้วจึงเทียบกับ descriptor ของ connection:

```
git remote get-url origin  -> https://github.com/t23598788-oss/-DNA-OS-INFRASTRUCTURE-.git
git rev-parse --abbrev-ref HEAD -> main
git rev-parse --show-toplevel   -> /Users/tam/Desktop/DNA-OS-INFRASTRUCTURE
ตรงกับ connection descriptor : YES  → จึงลงทะเบียนได้
```

สคริปต์จะ `exit 2` และไม่ลงทะเบียนถ้าไม่ตรง — ไม่มีการคัดลอกชื่อจาก descriptor

ใช้ `registerRepository` เดิม **ไม่สร้าง repository registry ใหม่**

```
repository://t23598788-oss/-DNA-OS-INFRASTRUCTURE-   world=CONTROL_PLANE  branch=main
```

### สะพาน — พิสูจน์แล้วว่ามีอยู่ ยังไม่ผูก

```
Repository Registry → repository_id → canonical resource → Connection Declaration
```

`software/registry-database/canonical-resource-resolution.ts` มี
`expected_repository_id`, `REPOSITORY_MISMATCH` และเรียก `getRepository()`
— **สะพานเดินสายไว้ครบแล้ว**

แต่ `resources.repository_id` ยังเป็น null **0/590** → สะพานพร้อมแต่ยังไม่มีการผูก
รายงานตามจริง ไม่เติม (`canonical_target_id` ของ declaration ก็ยัง null ตามคำสั่ง)

descriptor ของ GitHub declaration ตรงกับ identity ที่ลงทะเบียนทุก field
(`owner` / `repository` / `branch`) — พิสูจน์ว่าสองฝั่งพูดถึงสิ่งเดียวกัน

### แก้ที่ผมรายงานผิดรอบก่อน

`repository://t23598788-oss/---------------DNA-OS` **ไม่ใช่ข้อมูลเสีย** —
`source_authority` คือ `https://github.com/t23598788-oss/---------------DNA-OS.git`
และ `repository_root` คือ `/Users/tam/Desktop/dna-os-deadboard` เป็น repo จริง
ที่ชื่อแปลกเท่านั้น รอบก่อนผมตั้งข้อสงสัยผิด

---

## สิ่งที่ไม่ได้ทำในรอบนี้

ไม่ลบ fixture · ไม่เติม `canonical_target_id` · ไม่เขียนทับ declaration ใด ·
ไม่เพิ่ม entity/relationship kind ใน cross-system vocabulary ·
ไม่ผูก `resources.repository_id` · ไม่ลงทะเบียน DigitalOcean ·
ไม่แตะ n8n (`CONFIGURATION_DRIFT`, `DNA_OS_USES_5678 = UNKNOWN`)
