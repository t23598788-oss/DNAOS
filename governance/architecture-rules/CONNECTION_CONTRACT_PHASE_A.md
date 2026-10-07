# CONNECTION CONTRACT — PHASE A (design / dry-run, 2026-09-01)

```
STATUS = DESIGN ONLY — ยังไม่แก้ contract ยังไม่ลงทะเบียน connection ใด
```

## 1. Dry-run matrix — จากของจริงเท่านั้น

| | **GitHub** | **Railway** | **Supabase** | **n8n** | **DigitalOcean** | **MCP** |
|---|---|---|---|---|---|---|
| CURRENT_IMPLEMENTATION | `connections/github/github-adapter.ts` + `adapter-config.ts` | `connections/railway/router-invoker.ts` | `credentials/supabase-edge-secret/installer.ts` | `connections/n8n/outbound-webhook.ts` | `connections/digitalocean/digitalocean-read-api.ts` | `connections/dna-os-mcp/server.ts` |
| PROPOSED_CONNECTION_TYPE | `SOURCE_AUTHORITY` (เดิม) | `DEPLOYMENT_PLATFORM` | `SECRET_PROVISIONING` | `WORKFLOW_CONTROL` | `INFRASTRUCTURE_PROVIDER` | `TOOL_INGRESS` |
| SOURCE | dna-os-infrastructure | dna-os-infrastructure | dna-os-infrastructure | dna-os-infrastructure | dna-os-infrastructure | *(inbound — ดูข้อ 4)* |
| TARGET (descriptor จริง) | `owner=t23598788-oss repo=-DNA-OS-INFRASTRUCTURE- branch=main` | `project=dna-os-infrastructure env=4d28eafa-9735-4405-a585-55ea354bafab` | `project_ref=xeytcavxejhyzxwevgto` | `host=n8n.srv1740014.hstgr.cloud` | *(ไม่มี project/account ระบุ)* | `127.0.0.1:8793/mcp` |
| PROTOCOL | HTTPS REST | HTTPS GraphQL | **LOCAL_CLI** (`execFile` closed argv) | HTTPS webhook | HTTPS REST | HTTP JSON-RPC + stdio |
| ENDPOINT | `https://api.github.com` | `https://backboard.railway.com/graphql/v2` | `supabase secrets set --project-ref …` | `…/webhook/<path>` | `https://api.digitalocean.com/v2` | `POST /mcp` |
| EXECUTOR_CAPABILITY | *(ยังไม่ผูก)* | `capability-41d17cbe` | `capability-501c546f` | `capability-19fb83ac` | `capability-72010057` | `capability-05b9e2ba` |
| CREDENTIAL_POINTER | `credential://github/t23598788-oss/-DNA-OS-INFRASTRUCTURE-/source-authority` | `credential://railway/dna-os-infrastructure/production/project-token` | `credential://supabase/xeytcavxejhyzxwevgto/PROVIDER_ALERT_EMAIL_READ_SECRET` | `credential://macos-keychain/dna-os/n8n-api-key` | **ไม่มี (0 แถว)** | ไม่ต้องใช้ (local) |
| CREDENTIAL_SCOPE | `["repo"]` | `["READ_PROJECT_STATUS"]` | `["INVOKE_EDGE_FUNCTION"]` | `["workflow.read","workflow.write"]` | — | — |
| INPUT_CONTRACT | *(ยังไม่ประกาศ)* | `["CommandEnvelope"]` | `["secret name จาก allowlist","requester identity"]` | `["workflow_id?","workflow_definition"]` | `[]` **ว่าง** | `[]` **ว่าง** |
| OUTPUT_CONTRACT | *(ยังไม่ประกาศ)* | `["ConnectorBoundaryOutcome"]` | `["installEdgeFunctionSecret","verifySupabaseSecretPresent"]` | `["workflow_list","workflow_detail","created_workflow_id"]` | `[]` **ว่าง** | `[]` **ว่าง** |
| VERIFICATION | probe 403 | probe 400 | *(ยังไม่ probe)* | declared **000** / observed **200** | probe 403 | probe **406** |
| STATE | `OBSERVED` | `OBSERVED` | `DECLARED` | **`CONFIGURATION_DRIFT`** | `OBSERVED` | `OBSERVED` |
| FIELDS_STILL_UNKNOWN | executor_capability, in/out contract | canonical target entity | health_probe, verification_evidence | ทุก field ของ target จริง | credential, in/out contract, target | direction, in/out contract |

## 2. ทำไม ConnectionType ถึงเป็นชื่อเหล่านี้ — derive จาก semantics ไม่ใช่ชื่อ provider

| type | มาจากหลักฐานอะไร |
|---|---|
| `SOURCE_AUTHORITY` | เดิม — มีสิทธิ์เขียน source (`scope: WRITE_SOURCE`) |
| `DEPLOYMENT_PLATFORM` | Railway ถือ `ENVIRONMENT_ID` ของ production และ scope คือ `READ_PROJECT_STATUS` — คือแพลตฟอร์มที่รัน deployment **ไม่ตั้งชื่อ `DEPLOYMENT_CONTROL` เพราะสิทธิ์จริงคืออ่านอย่างเดียว การตั้งชื่อว่า CONTROL จะพูดเกินหลักฐาน** |
| `SECRET_PROVISIONING` | Supabase capability คือ "เขียน Edge Function secret" — **ไม่เคย query ตารางเลย** จึงไม่ใช่ `DATABASE_ACCESS` การเรียกชื่อว่า DATABASE จะผิดความจริง |
| `WORKFLOW_CONTROL` | n8n capability คือ create/read/update workflow |
| `INFRASTRUCTURE_PROVIDER` | DigitalOcean อ่าน account/regions/sizes/droplets/billing = คลังทรัพยากรของผู้ให้บริการ |
| `TOOL_INGRESS` | MCP **ไม่ใช่ขาออก** — DNA OS เป็นผู้ให้บริการ tool แก่ Agent ดูข้อ 4 |

ไม่มี type ใดตั้งตามชื่อ provider · `DATABASE_ACCESS` และ `OBSERVABILITY` ในรายการ candidate
**ไม่ถูกใช้** เพราะไม่พบ connection จริงที่มี semantics นั้น

## 3. ★ BLOCKER ที่ต้องตัดสินก่อน implement

กฎข้อ 3 สั่งว่า target ต้องอ้าง **entity ที่ canonical model รองรับจริง** ห้ามสร้างจาก display name

ตรวจ canonical แล้วพบว่า:

```
resource_type ที่มีอยู่จริง = { "capability": 122, "resource": 468 }
repository_id ที่ไม่ใช่ null = 0 / 590
```

**ไม่มี entity ชนิด PROVIDER_PROJECT / SERVICE / REPOSITORY / DATABASE_PROJECT อยู่เลยแม้แต่ตัวเดียว**

แปลว่า `target_id` ที่ชี้ไป canonical entity **เขียนไม่ได้ในวันนี้** — ไม่ใช่เพราะ schema
แต่เพราะ**ตัว entity ยังไม่มีให้ชี้**

ทางเลือกที่เหลือมีสามทาง และทั้งสามต้องให้เจ้าของตัดสิน:

| ทาง | ผล | ความเสี่ยง |
|---|---|---|
| **A.** ใช้ target descriptor แบบเดิม + `canonical_target_id: null` พร้อม `target_resolution: UNRESOLVED` | ลงทะเบียนได้ทันที ตรงกับ precedent ของ GitHub row เดิม | canonical ยังไม่รู้จัก target ข้อ 29/31 ยังปิดไม่ได้ |
| **B.** ลงทะเบียน PROVIDER_PROJECT / SERVICE เป็น resource ใน canonical ก่อน แล้วค่อยชี้ | ได้ lineage จริง | เป็นการขยาย resource model ซึ่งเกินขอบรอบนี้ |
| **C.** หยุด รอ Priority ถัดไป | ไม่มีอะไรผิด | connection ยังลงทะเบียนไม่ได้ |

ผมเสนอ **ทาง A** — เพราะเป็นรูปเดียวกับที่ GitHub row ใช้อยู่แล้ว (target เป็น descriptor
ไม่ใช่ FK) จึง additive จริง และบันทึกความไม่รู้ไว้ตรง ๆ ด้วย `target_resolution: UNRESOLVED`
แทนที่จะกุ id ขึ้นมา

## 4. ข้อค้นพบที่ทำให้ schema ต้องมี `direction`

MCP **ไม่ใช่ connection ขาออก** — `connections/dna-os-mcp/server.ts` คือเซิร์ฟเวอร์ที่
DNA OS *เปิดให้* Agent เรียกเข้ามา (`POST /mcp`, LaunchAgent `com.dnaos.dna-os-mcp`,
probe 406 = ตอบจริงแต่ต้องการ Accept header เฉพาะ)

ถ้า schema ไม่มี `direction` ทั้งหกตัวจะถูกเข้าใจว่าเป็นขาออกเหมือนกันหมด ซึ่งผิด
จึงต้องมี `direction: OUTBOUND | INBOUND`

## 5. Schema ที่เสนอ — ครอบคลุมทั้ง 6 โดยไม่ special-case provider

```ts
type ConnectionType =
  | "SOURCE_AUTHORITY" | "DEPLOYMENT_PLATFORM" | "SECRET_PROVISIONING"
  | "WORKFLOW_CONTROL" | "INFRASTRUCTURE_PROVIDER" | "TOOL_INGRESS";

type ConnectionProtocol =
  | "HTTPS_REST" | "HTTPS_GRAPHQL" | "HTTPS_WEBHOOK" | "HTTP_JSONRPC"
  | "LOCAL_CLI" | "STDIO";

type ConnectionState = "DECLARED" | "OBSERVED" | "PROVEN" | "CONFIGURATION_DRIFT";

interface ConnectionDeclaration {
  connection_id: string;
  connection_type: ConnectionType;
  direction: "OUTBOUND" | "INBOUND";
  source_id: string;
  provider_id: string;
  target_descriptor: Readonly<Record<string, string>>;   // ของจริงที่โค้ดใช้
  canonical_target_id: string | null;                    // null = ยังไม่มี entity ให้ชี้
  target_resolution: "RESOLVED" | "UNRESOLVED";
  protocol: ConnectionProtocol;
  endpoint: string;
  execution_boundary: string;
  executor_capability_id: string | null;
  credential_ref: CredentialReference | null;            // pointer เท่านั้น (ของเดิม)
  credential_scope: readonly string[];
  input_contract: readonly string[];
  output_contract: readonly string[];
  configuration_source: string;
  health_probe: string | null;
  verification_method: string | null;
  verification_evidence_id: string | null;
  state: ConnectionState;
}
```

**ทดสอบว่าต้อง special-case ไหม** — ใส่ทั้ง 6 ตัวลง schema เดียวนี้แล้ว
ไม่มีตัวใดต้องการฟิลด์เฉพาะของ provider ตัวเอง ความต่างทั้งหมดตกอยู่ใน
`connection_type` / `protocol` / `target_descriptor` ซึ่งเป็น field ปกติ
→ **PASS เกณฑ์ "ห้าม special-case provider"**

`ConnectionRegistration` เดิมไม่ถูกแตะ — `ConnectionDeclaration` เป็นชนิดใหม่คนละตัว
GitHub row เดิม 2 แถวอ่าน/เขียนได้เหมือนเดิมโดยไม่ต้อง migrate

## 6. สิ่งที่รอบนี้ยังไม่ทำ

ยังไม่แก้ contract · ยังไม่ลงทะเบียน connection · ยังไม่แตะ Evidence Store /
UI Surface / deployment lineage / commit_sha / Projection behavior

`n8n` คงสถานะ `CONFIGURATION_DRIFT`, `DNA_OS_USES_5678 = UNKNOWN` ตามคำสั่ง
