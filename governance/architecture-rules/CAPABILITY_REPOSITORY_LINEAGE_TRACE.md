# CAPABILITY / REPOSITORY LINEAGE TRACE (2026-09-01)

```
MODE = READ-ONLY DIAGNOSIS
ไม่แก้ ไม่ backfill ไม่ register ไม่ผูก relationship ไม่แตะ source
หลักฐานทั้งหมดมาจาก registry / source / version / evidence / git / read-back จริง
ไม่ใช้รายงานรอบก่อนเป็นหลักฐานต้นทาง
```

## บทสรุปที่พิสูจน์ได้

**สาเหตุที่ capability มองไม่เห็น ไม่ใช่เรื่อง repository**

```
capability ใน canonical                = 114
capability ที่ Core/Owner มองเห็น       = 12
มองไม่เห็น                             = 102
repository_id ปรากฏใน visibility path  = 0 ครั้ง
```

---

## 1. VISIBILITY — วัดจากของจริง

`GET http://127.0.0.1:8791/runtime/inventory` คืน **12 รายการ** และใช้ **string id**
(`file-intelligence`, `agent-host`, …) ไม่ใช่ canonical UUID

```
file-intelligence · permission-reasoner · research-engine · execution · github ·
dna-os-circuit · dispatcher · agent-host · os-login · os-ui · voice-bridge · digitalocean
```

`transport/owner-command-http/server.ts:187 runtimeInventory()` เรียก
`listCapabilities()` จาก `control/command-router/capability-registry.ts`
— **ตารางที่พิมพ์มือ 12 รายการ** ไม่ใช่ canonical registry

หลักฐานที่ endpoint นี้ยอมรับเอง: ทุกรายการที่มันคืนออกมามี evidence เป็น
`registry:control/command-router/capability-registry.ts#<capability_id>`

---

## 2. TRACE — 3 CAPABILITY

### A. railway-connector — มีอยู่ แต่มองไม่เห็น

```
CAPABILITY_ID              capability-41d17cbe-fcea-4ca7-b911-a4f49bb5d63a
RESOURCE_ID                resource-ae559ab3-f55e-4113-bb36-25c77affb207
CURRENT_VISIBILITY         INVISIBLE
VISIBILITY_EVIDENCE        ไม่อยู่ใน 12 รายการของ /runtime/inventory
                           grep "capability_id: \"railway" ใน capability-registry.ts = 0

SOURCE_FILE                connections/railway/router-invoker.ts
SOURCE_FILE_EXISTS         YES
VERSION_ID                 03ecdfbb-bdc8-433d-94b3-e074b5a7456b   version=1
CONTENT_HASH               407c22d0c1159a9257b753df…
COMMIT_SHA                 null
REGISTRATION_EVIDENCE_ID   06a58dc2-3900-4407-81fb-bce2ba680592   (evidence 4 แถว)
REGISTRATION_TIME          2026-08-22T18:53:50.262Z
REGISTRATION_EVENT         2026-08-22T18:53:50.267Z  REGISTERED
                           candidate-a9858f05-1bd0-4dcd-a2c0-3afd1f7bd08a

ORIGINAL_REPOSITORY        UNKNOWN
ORIGINAL_REPOSITORY_EVIDENCE  ไม่มี — registration_events schema ไม่มี field repository
                           (event_id, created_at, candidate_id, decision,
                            duplicate_result, evidence_ref) และ evidence 4 แถว
                           ไม่มีแถวใดอ้าง repository/git

CURRENT_REPOSITORY         t23598788-oss/-DNA-OS-INFRASTRUCTURE-
CURRENT_REPOSITORY_EVIDENCE  git log --diff-filter=A -> commit c87ae65e
                           2026-08-24T16:21:05+07:00
                           ★ ไฟล์เข้า git **หลัง** วันลงทะเบียน 2 วัน

REPOSITORY_REGISTRY_ID     repository://t23598788-oss/-DNA-OS-INFRASTRUCTURE- (มี แต่ไม่ผูก)
RESOURCE_REPOSITORY_ID     null
EXPECTED_REPOSITORY_ID     ไม่ถูกส่งเข้ามาเลย (ไม่มีผู้เรียกใด query แบบ repository-bound)
REPOSITORY_MATCH           UNRESOLVED

CLASSIFICATION             CAPABILITY_EXISTS_BUT_LOOKUP_FILTERED
```

หลักฐานเสริมของ runtime binding: `control/connector-execution-boundary/registry.ts`
ลงทะเบียน `railway: invokeRailwayConnector` โดยใช้ **capability_id เป็น key**
แต่ไม่มี entry ชื่อ `railway` ใน `capability-registry.ts` → `runConnectorStep`
เรียกถึงไม่ได้ (`CAPABILITY_EXISTS_BUT_NO_RUNTIME_BINDING` เป็นอาการร่วม)

### B. agent-host — มองเห็นได้จริง (กลุ่มควบคุม)

```
CAPABILITY_ID              capability-84f9dc65-4427-478d-8103-c42032ef4d46
RESOURCE_ID                resource-cea69029-6d83-4be1-820c-786b09d3c1b9
CURRENT_VISIBILITY         VISIBLE
VISIBILITY_EVIDENCE        อยู่ใน 12 รายการ + capability-registry.ts มี entry "agent-host"

SOURCE_FILE                control/agent-host/          SOURCE_FILE_EXISTS  YES
VERSION_ID                 2f4be580-c1f1-4b20-b5b8-c95a011c13c8   version=1.0.0
CONTENT_HASH               5b09a469443f27a19ef9b65f…    COMMIT_SHA  null
REGISTRATION_EVIDENCE_ID   19512e32-932d-406d-a9fb-1c762185354c   (evidence 9 แถว)
REGISTRATION_TIME          2026-08-22T07:12:01.357Z

ORIGINAL_REPOSITORY        UNKNOWN   (เหตุผลเดียวกับ A)
CURRENT_REPOSITORY         t23598788-oss/-DNA-OS-INFRASTRUCTURE-  (commit c87ae65e)
RESOURCE_REPOSITORY_ID     null
REPOSITORY_MATCH           UNRESOLVED

CLASSIFICATION             CAPABILITY_EXISTS_VISIBLE
```

★ **ตัวชี้ขาดของทั้งรายงาน:** agent-host มี `repository_id = null` เหมือน A
และมี `commit_sha = null` เหมือน A แต่ **มองเห็นได้** ต่างกันที่จุดเดียว —
มี entry อยู่ในตาราง 12 รายการ

นอกจากนี้ตัวตนที่มองเห็นคือสตริง `"agent-host"` ส่วนตัวตน canonical คือ
`capability-84f9dc65-…` — เป็นคนละ id namespace ที่บังเอิญหมายถึงของเดียวกัน

### C. owner-display-projection — source/version/evidence ครบ แต่มองไม่เห็น

```
CAPABILITY_ID              capability-f6e9d29b-6236-4d63-9cd4-229a9c50ef48
RESOURCE_ID                resource-101fb318-3e80-4763-911e-fdc6b46bded0
CURRENT_VISIBILITY         INVISIBLE
VISIBILITY_EVIDENCE        ไม่อยู่ใน 12 รายการ

SOURCE_FILE                control/owner-projection/ (display-payload.ts, display-payload.test.ts)
SOURCE_FILE_EXISTS         YES
VERSION_ID                 219d3db4-4283-4d01-adce-f942a6c96393   version=1.0.0
CONTENT_HASH               f7e34d2f576529343c7d72b0…    COMMIT_SHA  null
REGISTRATION_EVIDENCE_ID   a08acabf-ac0b-4439-a4a1-f5820d5642d0   (evidence 9 แถว)
REGISTRATION_TIME          2026-08-31T19:06:38.146Z
REGISTRATION_EVENT         2026-08-31T19:06:38.156Z  REGISTERED
                           candidate-owner-display-projection-v1

ORIGINAL_REPOSITORY        UNKNOWN
CURRENT_REPOSITORY         UNKNOWN
CURRENT_REPOSITORY_EVIDENCE  ★ `git ls-files control/owner-projection/` = ว่าง
                           `git status --porcelain` = `?? control/owner-projection/`
                           **ยังไม่เคยถูก commit เข้า git เลย**

RESOURCE_REPOSITORY_ID     null
REPOSITORY_MATCH           UNRESOLVED

CLASSIFICATION             CAPABILITY_EXISTS_BUT_LOOKUP_FILTERED
                           (+ CAPABILITY_EXISTS_VERSION_LINEAGE_MISSING — ไม่มี git lineage เลย)
```

---

## 3. ORIGINAL REPOSITORY — พิสูจน์ไม่ได้ทั้ง 3 ตัว

หลักฐานที่ตรวจแล้ว **ไม่มี**:

| แหล่ง | ผล |
|---|---|
| `registration_events.jsonl` (1,618 แถว) | schema ไม่มี field repository เลย — grep "repository" ใน event ของทั้ง 3 = 0 |
| `evidence.jsonl` | evidence ของทั้ง 3 (4+9+9 แถว) ไม่มีแถวใดอ้าง repository/git/github.com |
| `versions.jsonl` | `commit_sha = null` ทั้ง 590 แถว |
| `resources.jsonl` | `repository_id = null` ทั้ง 590 แถว |

**ลำดับเวลาที่ตัดสิน:** railway และ agent-host ถูกลงทะเบียน **2026-08-22**
แต่ไฟล์เข้า git ครั้งแรกที่ commit `c87ae65e` **2026-08-24** ("Real remote migration
prep: sync full DNA OS Infrastructure source to GitHub", 1,369 ไฟล์)

ตอนลงทะเบียน ไฟล์เหล่านั้นยังไม่อยู่ใน git — จึงไม่มี repository identity ให้บันทึก
`ORIGINAL_REPOSITORY = UNKNOWN` **ไม่ใช่การเดา แต่คือสิ่งที่หลักฐานบอก**

---

## 4. REPOSITORY REGISTRY

```
REPOSITORY_ID          repository://t23598788-oss/-DNA-OS-INFRASTRUCTURE-
OWNER / REPOSITORY     t23598788-oss / -DNA-OS-INFRASTRUCTURE-
NATURAL_KEY            provider owner + repository (buildRepositoryId)
REGISTERED             YES (2026-09-01 รอบก่อน)
CLASSIFICATION         OPERATIONAL
CLASSIFICATION_EVIDENCE  owner ไม่ตรงรูปแบบ fixture + repository_root
                       = /Users/tam/Desktop/DNA-OS-INFRASTRUCTURE (ไม่ใช่ sandbox)
DUPLICATE_CANDIDATES   ไม่มี — ไม่มี repository อื่นที่ owner/repository ซ้ำ
```

**เกี่ยวข้องกับ 3 capability จริงหรือไม่ — ยังไม่มีความเชื่อมโยงที่บันทึกไว้**
resource ทั้ง 3 มี `repository_id = null` ความสัมพันธ์จึงยังไม่ถูกประกาศ
สิ่งที่ตรงกันคือ **path บนดิสก์** ซึ่งไม่ใช่หลักฐานความเป็นเจ้าของตามกฎข้อ 3

repo ต้นฉบับที่ capability ถูก register ครั้งแรก = **UNKNOWN** (ดูข้อ 3)

---

## 5. CANONICAL BRIDGE

```
BRIDGE_IMPLEMENTED             YES
BRIDGE_RUNTIME_REACHABLE       YES
BRIDGE_USED_DURING_REGISTRATION YES  ← stage ทำงานทุกครั้ง
REPOSITORY_ID_WRITER           software/registry-database/registry-writer.ts:133
REPOSITORY_ID_READ_PATH        software/registry-database/canonical-resource-resolution.ts:79-89
REPOSITORY_ID_POPULATED_COUNT  0
REPOSITORY_ID_NULL_COUNT       590
```

**สะพานไม่ได้พัง — มันทำงานอยู่ และผลลัพธ์ null คือพฤติกรรมที่ออกแบบไว้**

`control/registration-pipeline/pipeline.ts` มี stage 5 REPOSITORY RESOLUTION →
`repository-resolution.ts` ซึ่งอ่าน `candidate.requested_owner` /
`candidate.requested_repository` เป็น **CLAIM** แล้ว resolve กับ repository-registry

```
ไม่มี claim        -> { status: "NOT_APPLICABLE", repository_id: null }   ← ถูกต้องตามดีไซน์
claim ไม่ครบ       -> REJECTED  INCOMPLETE_REPOSITORY_CLAIM
claim หา repo ไม่เจอ -> UNRESOLVED REPOSITORY_NOT_FOUND
repo ไม่ ACTIVE     -> REJECTED  REPOSITORY_NOT_ACTIVE:<status>
```

ไฟล์นั้นเขียนไว้เองว่า *"resolving to repository_id: null exactly as … a legitimate
NOT_APPLICABLE"* และ *"repository_id is never silently null after a claim was actually made"*

**เหตุที่ null 590/590: candidate ไม่เคยประกาศ claim**
— candidate ใน `software/capability-registrar/candidates/` ตั้ง `requested_owner`
เพียง **2 จาก 10** ไฟล์

`expected_repository_id` เป็น **พารามิเตอร์ของ query** ไม่ใช่ค่าที่เก็บ —
ผู้เรียกต้องส่งเข้ามาเอง และ `REPOSITORY_MISMATCH` เกิดเมื่อ
`resource.repository_id !== query.expected_repository_id` เท่านั้น
ปัจจุบัน **ไม่มีผู้เรียกใดใน visibility path ส่งค่านี้**

---

## 6. VISIBILITY EXECUTION PATH

```
OWNER REQUEST (เบราว์เซอร์ :5181)
  → POST /api/core/request                    ../dna-os-control-workspace/server/server.mjs:181
  → GET  :8791/runtime/inventory               ← ★ CATALOG GATE อยู่ตรงนี้
        runtimeInventory()  server.ts:187
        listCapabilities()  control/command-router/capability-registry.ts   [12 รายการ]
  → interpretOwnerRequest(text, catalog)       semantic-runner.py (Qwen3)
  → POST :8791/owner/intent                    structured-intent.ts
        canonicalStore.listCapabilities()      [114 รายการ — ใช้เฉพาะ branch นี้]
  → POST :8791/owner/display-payload
  → renderOwnerResponse (Qwen3)
```

**จำนวนครั้งที่แต่ละไฟล์อ้าง `repository_id`:**

```
transport/owner-command-http/server.ts              0
control/owner-command/structured-intent.ts          0
control/command-router/capability-registry.ts       0
control/command-router/router.ts                    0
control/owner-command-semantics/semantic-runner.py  0
```

```
VISIBILITY_DEPENDS_ON_REPOSITORY_ID = NO
```

**gate ตัวจริง:** การเป็นสมาชิกของ `CAPABILITY_REGISTRY` ใน
`control/command-router/capability-registry.ts` — ตารางค่าคงที่ที่พิมพ์มือ
capability ที่ไม่มี entry ในตารางนี้จะไม่ปรากฏใน catalog ที่ Owner เห็น
ไม่ว่า canonical จะมีข้อมูลครบแค่ไหน

gate รอง: `health_status` ในตารางเดียวกัน ใช้กำหนด `live_status` VERIFIED/BLOCKED

---

## 7. FAILURE MODE MATRIX

| capability | classification | หลักฐาน |
|---|---|---|
| railway-connector | `CAPABILITY_EXISTS_BUT_LOOKUP_FILTERED` | อยู่ใน canonical, ไม่อยู่ใน 12-table (grep = 0) |
| | (+ `NO_RUNTIME_BINDING`) | invoker registry มี key `railway` แต่ไม่มี capability entry ให้เรียกถึง |
| agent-host | `CAPABILITY_EXISTS_VISIBLE` | อยู่ทั้งสองที่ · `repository_id` null เหมือนกัน แต่มองเห็น |
| owner-display-projection | `CAPABILITY_EXISTS_BUT_LOOKUP_FILTERED` | ไม่อยู่ใน 12-table |
| | (+ `VERSION_LINEAGE_MISSING`) | `git ls-files` = ว่าง · untracked ทั้งโฟลเดอร์ |

**ไม่มีตัวใดเป็น** `CAPABILITY_MISSING` · `REPOSITORY_MISMATCH` ·
`SOURCE_MOVED` · `DUPLICATED_ACROSS_REPOSITORIES`

---

## 8. DUPLICATE RISK

```
CROSS_REPOSITORY_DUPLICATE_FOUND = NO
DUPLICATE_CAPABILITY_IDS         = ไม่มี
DUPLICATE_RESOURCE_IDS           = ไม่มี
SAME_CONTENT_HASH                = 1 กลุ่มเท่านั้น
                                   b615d38bcb3de203… ×2 ที่ control/agent-production-ingress/
                                   → source_location เดียวกัน ไม่ใช่ข้าม repository
SAME_SOURCE_LINEAGE              = content_hash ของทั้ง 3 ตัวปรากฏตัวละ 1 ครั้ง
EVIDENCE                         = สแกน content_hash ทั้ง 590 resource
```

ไม่ได้ใช้ชื่อ capability ที่เหมือนกันเป็นเกณฑ์ duplicate ตามที่กำหนด

---

## 9. ROOT CAUSE

```
ROOT_CAUSE = LOOKUP_LOGIC_GAP
WOULD_REPOSITORY_BACKFILL_FIX_VISIBILITY = NO
```

**เหตุผลที่ตอบ NO ไม่ใช่ NOT_PROVEN:**

1. visibility path ทั้งเส้น อ้าง `repository_id` **0 ครั้ง** (วัดทุกไฟล์ในเส้นทาง)
2. `agent-host` มี `repository_id = null` และ `commit_sha = null` เหมือน
   railway-connector ทุกประการ **แต่มองเห็นได้** — ตัวแปรที่ต่างคือการมี entry
   ในตาราง 12 รายการเท่านั้น นี่คือ controlled comparison ที่ตัดสินได้
3. ต่อให้เติม `repository_id` ครบ 590 แถว `runtimeInventory()` ก็ยังคืน 12 รายการเท่าเดิม
   เพราะมันไม่เคยอ่าน canonical

`REPOSITORY_IDENTITY_GAP` และ `SOURCE_LINEAGE_GAP` **มีอยู่จริง** (repository_id
null 590/590, commit_sha null 590/590, ORIGINAL_REPOSITORY UNKNOWN ทั้ง 3)
แต่เป็นคนละปัญหากับ visibility — สองอย่างนี้กระทบ *การพิสูจน์ที่มา*
ไม่กระทบ *การมองเห็น*

---

## 10. RECOMMENDATION (ไม่ implement ในรอบนี้)

| ลำดับ | เรื่อง | เหตุผล |
|---|---|---|
| 1 | ให้ catalog ที่ Owner เห็น อ่านจาก canonical แทนตาราง 12 รายการ | เป็นสาเหตุเดียวที่พิสูจน์ได้ของ visibility |
| 2 | ให้ candidate ประกาศ `requested_owner`/`requested_repository` | สะพาน repository ทำงานอยู่แล้ว รอแค่ claim (2/10 เท่านั้นที่ตั้ง) |
| 3 | ตรวจว่า `control/owner-projection/` ควร commit เข้า git หรือไม่ | ตอนนี้ registered แต่ untracked — ไม่มี lineage เลย |
| 4 | `commit_sha` คง `SOURCE_REVISION_UNRESOLVED` | ห้ามเติมย้อนหลัง registration เกิดก่อน commit จริง |

**ไม่มีข้อใดถูกลงมือทำในรอบนี้**

---

## UNKNOWN ทั้งหมด

```
ORIGINAL_REPOSITORY (ทั้ง 3 ตัว)      UNKNOWN — schema ไม่เคยบันทึก + registration ก่อน git
CURRENT_REPOSITORY (owner-projection) UNKNOWN — untracked
COMMIT_SHA (ทั้ง 590 แถว)             null    — SOURCE_REVISION_UNRESOLVED
RESOURCE_REPOSITORY_ID (ทั้ง 590 แถว) null    — ไม่มี claim จึง NOT_APPLICABLE
EXPECTED_REPOSITORY_ID                ไม่มีผู้เรียกใดส่งค่านี้
```
