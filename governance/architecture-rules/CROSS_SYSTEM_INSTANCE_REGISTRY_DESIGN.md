# CROSS-SYSTEM INSTANCE REGISTRY — DESIGN (2026-09-01)

```
MODE = DESIGN + DISCOVERY ONLY
ไม่ register instance · ไม่สร้าง entity type · ไม่สร้าง relationship
ไม่ migrate · ไม่แก้ Connection Declaration · ไม่เติม canonical_target_id
```

## ข้อสรุปนำ

**ไม่ต้องสร้าง instance store ใหม่** — ทะเบียนที่ต้องใช้ **มีอยู่ครบแล้วทุกตัว**
สิ่งที่ขาดคือ *สะพานเชื่อม identity* กับ *แถวข้อมูลของจริง* ไม่ใช่ที่เก็บ

และพบทะเบียนสำคัญที่รอบก่อนมองข้าม: **`software/repository-registry/`**
มี `buildRepositoryId(owner, repository)` ที่ deterministic และมี store จริง
พร้อมสะพานเข้า canonical (`resources.repository_id`) ที่ **เดินสายไว้แล้ว**

---

## 1. EXISTING REGISTRY OWNERSHIP

| | OWNS_WHAT | IDENTITY_KEY | MUTABILITY | WRITER | STORE | READ_PATH | DUPLICATE_GATE | EVIDENCE | CANONICAL_SOURCE |
|---|---|---|---|---|---|---|---|---|---|
| **Capability Registry** | ความสามารถของระบบ | `capability-<uuid>` + `semantic_fingerprint` | append-only | `registration-pipeline` | `canonical/capabilities.jsonl` (114) | `findCapability` / store-port | **YES** `DUPLICATE_EXACT`/`DUPLICATE_SEMANTIC` | `canonical/evidence.jsonl` | **YES** |
| **Resource Registry** | ไฟล์/โมดูลต้นทาง | `resource-<uuid>` + `content_hash` | append-only | เดียวกัน | `canonical/resources.jsonl` (590) | store-port | YES | มี | **YES** |
| **Runtime Service Registry** | บริการที่รันบนเครื่องนี้ | `ServiceId` (closed union 9) | **โค้ด ไม่ใช่ข้อมูล** | ประกาศใน `host-runtime.ts` | *ไม่มีไฟล์ — เป็น const* | `SERVICES` | ตัว union เอง | `OperationEvidence` | **YES (identity เท่านั้น)** |
| **Repository Registry** | repository จริง | `repository://<owner>/<repository>` | append-only | `registerRepository` | `software/repository-registry/data/repositories.jsonl` (119) | `getRepository` / `listRepositories` | **YES** (`inserted` flag) | git remote จริง | **YES** |
| **Connection Registration** | วงจรอนุมัติสิทธิ์ provider | `connection://<adapter>/<type>/<owner>/<repo>/<branch>` | **mutable** (`status`) | `provider-authorization/lifecycle.ts` **รายเดียว** | `connections.jsonl` (2) | `lookupConnection` | YES (idempotent) | keychain + device flow | YES (สำหรับ *สถานะอนุมัติ*) |
| **Connection Declaration** | สารบัญช่องทาง | `connection-declaration://…` | append-only | `declaration-registry.ts` | `connection-declarations.jsonl` (6) | `lookupConnectionDeclaration` | YES | `verification_method` | YES (สำหรับ *คำอธิบายช่องทาง*) |
| **API Credential Registry** | pointer ของ credential | `credential://<provider>/…` | append-only | `registerApiCredential` | `api-credential-references.jsonl` (134 → จริง 4) | `findApiCredential` | latest-wins | สถานะ ACTIVE | YES (pointer เท่านั้น) |
| **Database Credential Registry** | pointer ของ DB | `credential://postgres/<owner>/<host>/<port>/<db>/<role>` | append-only | `registerDatabaseCredential` | มี | มี | latest-wins | มี | YES |
| **Cross-system model** | คำศัพท์ 16 entity + 27 kind | — | — | **ไม่มี** | **ไม่มี** | **ไม่มี** | **ไม่มี** | — | **NO — vocabulary เท่านั้น** |
| **execution/deploy** | แผนการ deploy | — | — | *resolver ไม่ใช่ registry* | ไม่มี | `resolveDeployPlan` | — | — | NO |

**ข้อสังเกต:** ไม่มีทะเบียนใดเป็นเจ้าของ *provider project instance* — ช่องนี้ว่างจริง

---

## 2. INSTANCE IDENTITY RESOLUTION

| target | type | มติ | เหตุผลจากของจริง |
|---|---|---|---|
| **MCP** | `SERVICE` | **REUSE_EXISTING** | `ServiceId "dna-os-mcp"` มีอยู่ใน `runtime-control` พร้อม `launchd_label`, `port`, `health_path` — สร้างใหม่ = ทะเบียน service ชุดที่สอง |
| **GitHub** | `REPOSITORY` | **REUSE_REGISTRY + REGISTER_NEW_INSTANCE** | ทะเบียนถูกตัวแล้ว (`repository://owner/repository`) แต่ **`-DNA-OS-INFRASTRUCTURE-` ยังไม่มีในทะเบียน** |
| **Railway** | `PROVIDER_PROJECT` | **REGISTER_NEW_INSTANCE** | ไม่มีทะเบียนเจ้าของ ต้องตัดสินว่าใครเป็นเจ้าของก่อน (ดูข้อ 3) |
| **Supabase** | `PROVIDER_PROJECT` | **REGISTER_NEW_INSTANCE** | natural key ชัด (`project_ref`) |
| **n8n** | `SERVICE` | **REMAIN_UNKNOWN** | ยังตอบไม่ได้ว่า instance ไหนคือของจริง |
| **DigitalOcean** | `PROVIDER_PROJECT` | **REMAIN_UNKNOWN** | ไม่มี natural key และไม่มี credential |

### repository registry — สถานะจริง

```
119 unique repository_id
  117  test fixture  (test-/debug-/…-<timestamp>/canonical-flow-*)
    2  ของจริง:
         repository://t23598788-oss/---------------DNA-OS          world=BUSINESS_LINE_FINANCE
         repository://t23598788-oss/dna-os-control-workspace       world=PRODUCT_SURFACE
```

**ยังไม่มี `repository://t23598788-oss/-DNA-OS-INFRASTRUCTURE-`** ทั้งที่ connection ชี้ไปที่นั้น

⚠ `---------------DNA-OS` เป็นชื่อที่ผิดปกติ ควรตรวจว่ามาจาก git remote จริงหรือเป็นข้อมูลเสีย
— **รอบนี้ไม่แตะ** บันทึกไว้เป็นงานตรวจสอบ

⚠ fixture 117/119 = ปัญหาเดียวกับ credential registry (134 → จริง 4)
ต้องมีตัวจำแนกแบบเดียวกันก่อนนับ repository ใน census

### อีก 8 ServiceId ควรเป็น canonical identity source เดียวกันหรือไม่ — **ใช่**

`deadboard` · `lab-ui` · `research-api` · `compute-api` · `machine-observer` ·
`recovery-supervisor` · `control-workspace` · `joint-monitor`

ทุกตัวมี `launchd_label` + `port` + `health_path` ที่พิสูจน์ตัวตนได้จากเครื่องจริง
และ **ตรงกับ port ที่สำรวจพบ** (5181 control-workspace, 5178 …) — นี่คือชุด
identity ที่จะปิดข้อ 31 (UI Surface) ได้ โดยไม่ต้องสร้าง SERVICE ใหม่

---

## 3. IDENTITY BRIDGE — แยก IDENTITY OWNER ออกจาก STATE OWNER

```
                 IDENTITY OWNER                    STATE OWNER
MCP              runtime-control ServiceId         runtime-control (pid, health)
GitHub repo      repository-registry               provider-authorization (สถานะอนุมัติ)
Railway project  ★ ยังไม่มีเจ้าของ                  Railway API (ของจริงอยู่ฝั่งผู้ให้บริการ)
Supabase project ★ ยังไม่มีเจ้าของ                  Supabase (ฝั่งผู้ให้บริการ)
```

**กฎของสะพาน**

1. canonical **อ้างถึง** identity ที่ทะเบียนเจ้าของออกให้ ไม่ตั้ง id ใหม่ซ้อน
2. canonical **ห้ามเก็บ state ที่เปลี่ยนได้** — ไม่เก็บ pid, ไม่เก็บ health,
   ไม่เก็บ `status: connected` กราฟต้องไม่กลายเป็นเจ้าของสถานะ process
3. เก็บได้เฉพาะ **identity + ความสัมพันธ์ + หลักฐานว่าเคยเห็นเมื่อไร**
4. อ่าน state ต้องวิ่งไปหา state owner เสมอ ไม่ใช่อ่านสำเนาในกราฟ

**สะพานที่มีอยู่แล้วและยังไม่ได้ใช้:** `resources.repository_id` เชื่อมกับ
`getRepository()` ผ่าน `canonical-resource-resolution.ts` (มี `expected_repository_id`,
`REPOSITORY_MISMATCH`) — เดินสายไว้ครบแล้ว แต่ `repository_id` เป็น null 590/590

### สะพานที่ต้องออกแบบเพิ่ม (3 เส้น)

| สะพาน | จาก | ไป | สถานะ |
|---|---|---|---|
| repository | `repository://owner/repo` | `resources.repository_id` | **มีอยู่แล้ว ไม่ต้องสร้าง** |
| service | `ServiceId` | canonical SERVICE reference | ต้องออกแบบ (read-only reference) |
| provider project | *(ไม่มีเจ้าของ)* | canonical PROVIDER_PROJECT | **ต้องตัดสินเจ้าของก่อน** |

---

## 4. INSTANCE WRITER PIPELINE (ออกแบบ ยังไม่สร้าง)

```
Candidate
   ↓  natural key จากหลักฐานจริงเท่านั้น
Identity Resolution
   ↓  ถามทะเบียนเจ้าของก่อนเสมอ (repository-registry / runtime-control / …)
   ↓  พบ → REUSED (คืน id เดิม ไม่เขียนอะไร)
Duplicate Gate
   ↓  เทียบ natural key แบบตรงตัวอักษร — ไม่มี fuzzy ไม่มีโมเดล
Instance Writer
   ↓  append-only
Persistent Store
   ↓
Read Back  (ผ่าน port เดิม ไม่ใช่อ่านไฟล์ตรง)
   ↓
Evidence
```

**ผลลัพธ์ที่ต้องรองรับ**

| ผล | เงื่อนไข |
|---|---|
| `REGISTERED` | natural key ใหม่ หลักฐานครบ |
| `REUSED` | ทะเบียนเจ้าของมี identity นี้แล้ว → คืน id เดิม **ห้ามเขียนซ้ำ** |
| `DUPLICATE_EXACT` | natural key ตรงกันทุกตัวอักษร |
| `CONFLICT` | natural key เดียวกัน แต่ attribute สำคัญต่างกัน → **หยุด ให้เจ้าของตัดสิน** |
| `UNRESOLVED` | natural key ประกอบไม่ครบจากหลักฐาน (เช่น DigitalOcean) |

**กฎ:** การเทียบ identity ต้องเป็น string comparison ของ natural key ที่ประกอบ
ตามสูตรตายตัวเท่านั้น — **ห้ามใช้ AI ห้ามใช้ความคล้าย ห้ามใช้ timestamp proximity**
(สูตรที่ใช้ได้แล้ว: `buildRepositoryId`, `buildConnectionId`, `buildDeclarationId`)

---

## 5. GITHUB DUAL CONCEPT — ★ MODEL_RELATIONSHIP_GAP

ตรวจ 27 relationship kinds และ 16 entity types แล้ว:

**16 entity types ไม่มี `CONNECTION` และไม่มี `AUTHORIZATION`**
```
APPLICATION · REPOSITORY · SOURCE_FILE · BOUNDARY · RESOURCE · SERVICE ·
DEPLOYMENT · VERSION · PROVIDER_PROJECT · DATABASE_PROJECT · DATABASE_OBJECT ·
RUNTIME · PROCESS · WORK · EXECUTION · EVIDENCE
```

**27 relationship kinds ไม่มีตัวใดที่ปลายทั้งสองข้างเป็น connection record**

```
MODEL_RELATIONSHIP_GAP = YES
```

`DECLARATION_AUTHORIZED_BY_REGISTRATION` (Declaration 1 → Registration 0..1)
**แสดงในโมเดลปัจจุบันไม่ได้เลย** — ไม่ใช่แค่ขาด kind แต่ขาด entity type ทั้งสองฝั่ง

**รอบนี้ห้ามเพิ่ม kind** จึงรายงานไว้เป็นช่องว่างที่ต้องตัดสินรอบหน้า
ทางเลือกที่เห็น: เพิ่ม entity `CONNECTION` + kind หนึ่งตัว **หรือ** เก็บความสัมพันธ์นี้
ไว้นอก cross-system graph (เป็น field `authorized_by_connection_id` ใน declaration)
— ทางหลังไม่ต้องแตะ vocabulary เลย

---

## 6. GITHUB DIVERGENCE — `executor_capability_id`

```
FIELD_OWNER                          = connections/provider-authorization/lifecycle.ts
                                       (ผู้เรียก registerConnection/attachCredential รายเดียว)
AUTHORITATIVE_SOURCE                 = ConnectionRegistration
                                       (มีค่า capability-b4a67fea = github-source-executor
                                        ซึ่งมีอยู่จริงใน canonical status=REGISTERED)
DECLARATION_SHOULD_REFERENCE_OR_COPY = REFERENCE
RECONCILIATION_RULE                  = ดูข้างล่าง
```

**เหตุผลที่ต้อง REFERENCE ไม่ใช่ COPY:** ค่านี้มีเจ้าของที่ชัดเจนอยู่แล้ว และ
registration เป็น record ที่ **mutable** — สำเนาใน declaration ซึ่ง append-only
จะค้างเป็นค่าเก่าทันทีที่ registration เปลี่ยน กลายเป็นความจริงสองชุดที่ขัดกันเงียบ ๆ
ซึ่ง**เกิดขึ้นแล้วภายในวันเดียว** (`capability-b4a67fea` vs `null`)

**RECONCILIATION_RULE ที่เสนอ**

1. `ConnectionDeclaration.executor_capability_id` ควรถูกลดบทบาทเป็น
   *ค่าที่ resolve ตอนอ่าน* ไม่ใช่ค่าที่เก็บ
2. ถ้ามี registration คู่กัน → ใช้ค่าจาก registration เสมอ
3. ถ้าไม่มี registration (เช่น MCP ที่เป็น INBOUND local) → `null` อย่างถูกต้อง
   ไม่ใช่ "ยังไม่รู้"
4. ห้ามเขียนค่ากลับลง declaration เพื่อ "ให้ตรงกัน" — นั่นคือการสร้างสำเนาชุดที่สอง

`scope: ["WRITE_SOURCE"]` กับ `credential_scope: ["repo"]` **ไม่ใช่ความขัดแย้ง**
— อันแรกเป็นสิทธิ์ฝั่ง DNA OS อันหลังเป็น OAuth scope ฝั่ง GitHub คนละระบบพิกัด
แต่ควรตั้งชื่อให้ต่างกันชัดกว่านี้เพื่อไม่ให้อ่านสลับ

---

## 7. DOCUMENTATION RESOURCE ≠ OPERATIONAL ENTITY

resource เหล่านี้ **ห้ามใช้เป็น canonical operational target**:

```
https://railway.com                          ← หน้าเว็บผู้ให้บริการ
https://vercel.com/docs/rest-api             ← หน้าเอกสาร API
docs.digitalocean.com/… (21 แถว)             ← เอกสาร/SDK/หน้า pricing
github.com/digitalocean/godo, pydo, dots     ← client library
```

**เกณฑ์แยกแบบ deterministic ที่เสนอ:**

| | DOCUMENTATION RESOURCE | OPERATIONAL ENTITY INSTANCE |
|---|---|---|
| ตอบคำถาม | "อ่านเรื่องนี้ได้ที่ไหน" | "ระบบไปคุยกับอะไร" |
| identity | URL ของหน้าเอกสาร | natural key ของ instance |
| เปลี่ยนเมื่อ | ผู้ให้บริการแก้เอกสาร | ผู้ใช้สร้าง/ลบ project จริง |
| ทดสอบได้ไหม | ไม่ | ได้ — probe ได้ |
| ใช้เป็น target ของ connection | **ห้าม** | ใช่ |

ตัวชี้ขาด: **ถ้า probe ปลายทางนั้นไม่ได้ มันไม่ใช่ operational entity**

---

## สิ่งที่รอบนี้ไม่ได้ทำ

ไม่ register instance · ไม่สร้าง entity type · ไม่สร้าง relationship ·
ไม่ migrate · ไม่แก้ declaration ทั้ง 6 · ไม่เติม `canonical_target_id` ·
ไม่แตะ `---------------DNA-OS` ที่ดูผิดปกติ · ไม่แตะ fixture ใน repository registry
