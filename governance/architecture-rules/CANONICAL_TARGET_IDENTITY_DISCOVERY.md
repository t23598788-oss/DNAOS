# CANONICAL TARGET IDENTITY — DISCOVERY (2026-09-01)

```
MODE = READ-ONLY DISCOVERY / DESIGN
ไม่สร้าง entity · ไม่แก้ schema · ไม่ register · ไม่ migrate
ไม่แก้ Connection Declaration · ไม่เติม canonical_target_id
```

## ข้อสรุปที่สำคัญที่สุด

**ไม่ต้องสร้าง entity type ใหม่เลยแม้แต่ตัวเดียว**

`software/registry-database/cross-system-types.ts` ประกาศ 16 entity types ไว้แล้ว
ซึ่งครอบคลุม target ทั้ง 6 ครบ: `REPOSITORY` · `PROVIDER_PROJECT` · `SERVICE` ·
`DATABASE_PROJECT` · `RUNTIME` · `PROCESS`

สิ่งที่ขาดคือ **instance ไม่ใช่ type**

และต้องแยกให้ชัดอีกชั้น — cross-system model **ไม่มี writer ไม่มี store ไม่มีไฟล์ข้อมูล**
มันถูก import โดยตัวเองกับไฟล์เทสต์ของตัวเองเท่านั้น จึงเป็น *คำศัพท์ที่ประกาศไว้*
ยังไม่ใช่ *ทะเบียนที่ใช้งาน*

## ตารางต่อระบบ

| | **GitHub** | **Railway** | **Supabase** | **n8n** | **DigitalOcean** | **MCP** |
|---|---|---|---|---|---|---|
| TARGET_REAL_WORLD_OBJECT | repository `t23598788-oss/-DNA-OS-INFRASTRUCTURE-` | Railway project + environment production | Supabase project `xeytcavxejhyzxwevgto` | n8n instance (host) | DigitalOcean API v2 (ไม่ระบุ account/project) | MCP server ของ DNA OS เอง |
| TARGET_CURRENT_DESCRIPTOR | owner/repository/branch | project + environment_id | project_ref | host | api_host + api_version | host/port/path |
| EXISTING_CANONICAL_ENTITY_FOUND | **NO** | **NO** | **NO** | **NO** | **NO** | **NO** |
| EXISTING_ENTITY_TYPE | — | — | — | — | — | — |
| EXISTING_ENTITY_ID | — | — | — | — | — | — |
| EXISTING_MODEL_SUPPORTS_TYPE | **YES** `REPOSITORY` | **YES** `PROVIDER_PROJECT` | **YES** `PROVIDER_PROJECT` | **YES** `SERVICE` | **YES** `PROVIDER_PROJECT` | **YES** `SERVICE` |
| REQUIRED_IDENTITY_TYPE | `REPOSITORY` | `PROVIDER_PROJECT` | `PROVIDER_PROJECT` | `SERVICE` | `PROVIDER_PROJECT` | `SERVICE` |
| IDENTITY_NATURAL_KEY | `provider + owner + repository` (branch เป็น attribute ของ VERSION ไม่ใช่ identity) | `provider + project + environment_id` | `provider + project_ref` | `provider + host` | **ยังไม่มี** | `service_id` (มีอยู่แล้ว) |
| IDENTITY_OWNER | `connections/connection-registry/git-discovery.ts` | `connections/railway/router-invoker.ts` | `execution/run/process-registry.ts` | `connections/n8n/outbound-webhook.ts` | — | `control/runtime-control/` |
| SOURCE_OF_TRUTH | `git remote -v` ของ repo จริง | constant `ENVIRONMENT_ID` + Railway GraphQL | `SUPABASE_PRODUCTION_PROJECT_REF` | constant `N8N_BASE_URL` | `CORE_V2_BASE_URL` + `providers/digitalocean/definition/provider.json` | LaunchAgent plist + `SERVICES` |
| EVIDENCE | connections.jsonl 2 แถว · credential ACTIVE · probe 403 | credential ACTIVE · probe 400 · capability-41d17cbe | credential ACTIVE · capability-501c546f | credential ACTIVE · probe **000** · drift record | probe 403 · **credential 0 แถว** | launchctl job รันอยู่ · probe 406 · `ServiceId "dna-os-mcp"` |
| DUPLICATE_RISK | **HIGH** — มี 2 representation แล้ว | LOW | LOW | MEDIUM — สอง instance คู่แข่ง | LOW | **HIGH** — ถ้าสร้าง SERVICE ใหม่จะซ้ำกับ `ServiceId` ที่มีอยู่ |
| **RECOMMENDATION** | `REGISTER_INSTANCE` | `REGISTER_INSTANCE` | `REGISTER_INSTANCE` | **`UNKNOWN`** | **`UNKNOWN`** | **`REUSE`** |

## เหตุผลของ RECOMMENDATION ที่ไม่ใช่ REGISTER_INSTANCE

### MCP = REUSE (ห้ามสร้าง SERVICE ใหม่)

`control/runtime-control/types.ts` มี `ServiceId` เป็น closed union 9 ค่า และ
`host-runtime.ts` มี `SERVICES` ที่เป็น **instance จริงพร้อม `launchd_label`,
`plist_path`, `port`, `health_path`, `health_expect_status`** — `dna-os-mcp`
อยู่ในนั้นแล้ว

```
MODEL_SUPPORT       = YES  (ทั้ง cross-system SERVICE และ runtime-control ServiceDefinition)
INSTANCE_REGISTERED = YES ใน runtime-control · NO ใน canonical
```

การสร้าง SERVICE entity ใหม่ให้ MCP จะเป็นการทำ **ทะเบียน service ชุดที่สอง**
ซึ่งเป็นสิ่งที่กฎห้ามไว้ตรง ๆ สิ่งที่ควรทำคือให้ canonical **อ้างถึง**
`service_id` ที่มีอยู่ ไม่ใช่ตั้ง id ใหม่

บริการภายในอีก 8 ตัว (`deadboard`, `lab-ui`, `research-api`, `compute-api`,
`machine-observer`, `recovery-supervisor`, `control-workspace`, `joint-monitor`)
อยู่ในสถานะเดียวกัน — เกี่ยวโดยตรงกับข้อ 31 (UI Surface) ที่ยังค้าง

### n8n = UNKNOWN

model รองรับ `SERVICE` และมี natural key ได้ แต่ **ยังตอบไม่ได้ว่า instance ไหนคือของจริง**
declared host ตอบ 000 · observed :5678 พิสูจน์ไม่ได้ว่า DNA OS ใช้
การลง instance ตอนนี้ = เลือกข้างโดยไม่มีหลักฐาน

### DigitalOcean = UNKNOWN

**ไม่มี natural key** — ไม่มี account id / project id / team id ปรากฏในโค้ดเลย
มีแต่ `api_host` + `api_version` ซึ่งเป็นคุณสมบัติของ *API* ไม่ใช่ตัวตนของ *project*
และ credential ลงทะเบียน 0 แถว

resource 21 แถวที่ `owner_id = digitalocean` **เป็นหน้าเอกสารทั้งหมด**
(`docs.digitalocean.com`, `github.com/digitalocean/godo`, หน้า pricing) —
เป็น *เอกสารอ้างอิงเกี่ยวกับผู้ให้บริการ* ไม่ใช่ *project ที่ connection ชี้ไป*
เหมือนกับ resource `https://railway.com` และ `https://vercel.com/docs/rest-api`

**คำเตือน:** resource เหล่านี้ดูเผิน ๆ เหมือน "มี entity แล้ว" — ถ้าเอามาใช้เป็น
`canonical_target_id` จะเป็นการผูก connection เข้ากับหน้าเอกสาร ไม่ใช่กับระบบจริง

## สิ่งที่ตรวจแล้วพบว่า **ไม่ใช่** entity ที่ใช้ได้

| สิ่งที่ดูเหมือนใช้ได้ | ความจริง |
|---|---|
| `resources.owner_id` เช่น `t23598788-oss`, `DNA-OS-INFRASTRUCTURE`, `repository-discovery-inventory` | เป็นป้ายข้อความอิสระที่ไม่สม่ำเสมอ ไฟล์ใน repo เดียวกันมี owner_id ต่างกัน — **ไม่ใช่ REPOSITORY entity** |
| `resources.repository_id` | null 0/590 ทั้งไฟล์ |
| resource `https://railway.com` | หน้าเว็บผู้ให้บริการ ไม่ใช่ project instance |
| resource ของ digitalocean 21 แถว | หน้าเอกสาร/SDK ทั้งหมด |
| `resource_type` | มีแค่ `"capability"` และ `"resource"` — ไม่มีชนิดที่บอกว่าเป็น repository/service/project |

---

# GITHUB DUAL-REPRESENTATION REVIEW

## เปรียบเทียบราย field

| field | `ConnectionRegistration` | `ConnectionDeclaration` |
|---|---|---|
| identity | `connection://github/<type>/<owner>/<repo>/<branch>` | `connection-declaration://github/<type>/<direction>/<descriptor>` |
| target | `GithubRepositoryTarget` (GitHub เท่านั้น) | `target_descriptor` generic + `canonical_target_id` |
| credential | `credential_ref` pointer | `credential_ref` pointer + `credential_scope` |
| executor | `executor_capability_id` = **`capability-b4a67fea` (github-source-executor)** | **`null`** |
| scope | `scope: ["WRITE_SOURCE"]` | `credential_scope: ["repo"]` |
| contract | — | `input_contract` / `output_contract` |
| state | `status: disconnected\|connecting\|connected\|error` — **สถานะการเชื่อมต่อจริง แก้ไขได้** | `state: DECLARED\|OBSERVED\|PROVEN\|CONFIGURATION_DRIFT` — **ระดับความรู้ append-only** |
| evidence | — | `verification_method` / `verification_evidence_id` |
| direction | — | `direction` |
| account | `account_id` (ใครเป็นผู้ authorize) | — |
| protocol/endpoint | — | มี |

## semantic responsibility จริง — จาก source

`connections/provider-authorization/lifecycle.ts` ประกาศตัวเองว่าเป็น
**"the ONE owner of external-provider authorization lifecycle"** และเป็นผู้เรียก
`registerConnection` · `updateConnectionStatus` · `attachCredential` **เพียงรายเดียว**

หน้าที่ของมันคือ *"turns Owner approves in their browser into a Keychain-backed
credential_ref attached to a real ConnectionRegistration"*

และข้อมูลจริงยืนยัน — 2 แถวใน `connections.jsonl` คือ transition เดียวกัน
`connecting` → `connected` ของ connection_id เดียว

```
ConnectionRegistration = บันทึกวงจรการอนุมัติสิทธิ์ (authorization lifecycle)
                         mutable · มี account_id · ตอบว่า "ตอนนี้ต่อติดหรือยัง"

ConnectionDeclaration  = สารบัญช่องทางที่มีอยู่ (channel catalogue)
                         append-only · มี protocol/endpoint/contract/direction
                         ตอบว่า "ช่องทางนี้คืออะไร และเรารู้แน่แค่ไหน"
```

## DECISION = **C** — เป็นคนละ concept จริง ต้องมีความสัมพันธ์ที่ประกาศชัด

ไม่ใช่ A เพราะ Declaration ไม่มี `account_id` และไม่มีวงจร `connecting → connected`
จึงเป็น canonical แทน Registration ไม่ได้ — จะทำให้ provider-authorization
เสียเจ้าของวงจรอนุมัติไป

ไม่ใช่ B เพราะ Registration ผูกกับ `GithubRepositoryTarget` และมี ConnectionType
เดียว จึงขยายไปครอบ Railway/Supabase/MCP ไม่ได้ — ซึ่งเป็น CONTRACT MODEL GAP
เดิมที่ทำให้ต้องมี Declaration ตั้งแต่แรก

**ความสัมพันธ์ที่ควรประกาศ:** `DECLARATION_AUTHORIZED_BY_REGISTRATION`
(declaration หนึ่ง ↔ registration ศูนย์หรือหนึ่ง) — declaration ที่ไม่ต้องขออนุมัติ
เช่น MCP (INBOUND, local) จะไม่มี registration คู่ ซึ่งถูกต้องตามความจริง

## ★ ความไม่ตรงกันที่พบแล้วในวันนี้ — ต้องรายงาน

GitHub มีสอง record ที่ **ขัดกันอยู่แล้ว**:

```
ConnectionRegistration.executor_capability_id = capability-b4a67fea (github-source-executor)
ConnectionDeclaration.executor_capability_id  = null
ConnectionRegistration.scope                  = ["WRITE_SOURCE"]
ConnectionDeclaration.credential_scope        = ["repo"]
```

`null` ในฝั่ง declaration เป็นความผิดพลาดของรอบ Phase C — ตอนสร้าง declaration
ผมอ่านจาก capability registry อย่างเดียว ไม่ได้อ่าน registration ที่มีค่านั้นอยู่แล้ว
**รอบนี้ห้ามแก้ตามคำสั่ง** จึงรายงานไว้เป็นงานของรอบถัดไป

ส่วน `["WRITE_SOURCE"]` กับ `["repo"]` ไม่ใช่ความขัดแย้ง — อันแรกคือ scope
เชิงสิทธิ์ของ DNA OS อันหลังคือ OAuth scope ของ GitHub คนละระบบพิกัด
แต่การเก็บสองอย่างในชื่อคล้ายกันโดยไม่มีคำอธิบายคือความเสี่ยงที่จะอ่านสลับ

---

## OUTPUT

```
TARGETS_TOTAL                      = 6
EXISTING_CANONICAL_INSTANCES       = 0
MODEL_SUPPORTED_BUT_INSTANCE_MISSING = 6   (ทุกตัว — type มีครบ instance ไม่มีเลย)
MODEL_TYPE_MISSING                 = 0
UNKNOWN                            = 2     (n8n = instance ไหนคือของจริง, DigitalOcean = ไม่มี natural key)

REUSABLE_ENTITY_TYPES        = REPOSITORY · PROVIDER_PROJECT · SERVICE
                               (+ DATABASE_PROJECT ว่างอยู่ ยังไม่มี connection ที่ต้องใช้)
NEW_ENTITY_TYPES_REQUIRED    = 0

REUSABLE_EXISTING_INSTANCES  = control/runtime-control SERVICES (9 service รวม dna-os-mcp)

GITHUB_REPRESENTATION_DECISION = C
MIGRATION_REQUIRED_LATER       = NO   (ทั้งสอง record คงอยู่ เพิ่มความสัมพันธ์ ไม่ย้ายข้อมูล)
DATA_LOSS_RISK                 = NONE
DIVERGENCE_RISK                = YES  (พบแล้ว 1 จุด: executor_capability_id ไม่ตรงกัน)
```

## สิ่งที่รอบนี้ไม่ได้ทำ

ไม่สร้าง entity · ไม่แก้ schema · ไม่ register · ไม่ migrate ·
ไม่แก้ declaration ทั้ง 6 · ไม่เติม `canonical_target_id` แม้แต่ตัวเดียว
