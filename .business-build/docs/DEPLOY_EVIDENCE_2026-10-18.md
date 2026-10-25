# PRODUCTION DEPLOY EVIDENCE — 2026-10-18 (MULTI-TENANT)

**สรุป: DB migration + โค้ด tenant ขึ้น production แล้ว และตรวจกับ runtime จริงแล้ว**
ส่วนที่ยัง **ไม่ผ่านการทดสอบ runtime จริง** คือขั้นที่ต้องมี session ของ Owner (login จริง) — ระบุไว้ชัดในหัวข้อ REMAINING_BLOCKERS

---

## DEPLOY_SHA
| รายการ | ค่า |
|---|---|
| git commit (งาน tenant) | `a73ca0c68220d14e9e1d64304d603fa1932187f8` (30 files, +4329/-1115) |
| git branch | `gxkg` (ยังไม่ push — ไม่มีคำสั่งให้ push) |
| Railway project / env / service | `DNA-OS-INFRASTRUCTURE` (`ffe589bf-58fb-4e3e-8969-4a75915fda1a`) / `production` / `dna-os-deadboard` |
| deployment id (ใหม่) | `b1444ece-a36c-4867-bd15-13d639a88eb9` |
| สถานะ / เวลา | **SUCCESS** · createdAt `2026-10-18T05:18:51Z` (poll จนถึง SUCCESS 05:23:29Z) |
| image digest | `sha256:04b3185e5ea6ae8355b6a689065dfefd80bd1dc966a44cd284da3fb1ef5f3c5e` |
| deployment ก่อนหน้า (rollback target) | `dbd8eab9-3388-468f-889b-a6e297139dbc` · digest `sha256:841b54ab9bb06426a22502a42f09f43d7b0f9a66746d53a8d65643b998023dfe` |
| cliCaller | `agent_unknown:apple_terminal` (deploy ผ่าน CLI `railway up` = เส้นทางเดิมของระบบนี้) |
| healthcheckPath ที่ตั้งบน Railway | `null` (ไม่มี health check กำหนดไว้ — ตรวจด้วย HTTP เองด้านล่าง) |

## DEPLOYED_COMPONENTS
1. **Migrations V1–V3** — apply บน production สำเร็จ (จำกัดขอบเขตเฉพาะ 3 ไฟล์)
   - วิธี: ย้าย migration ที่ค้าง 28 ไฟล์ของงานอื่นออกชั่วคราว → `supabase db push --dry-run` ยืนยันว่าเหลือ **3 ไฟล์ tenant เท่านั้น** → `supabase db push` (exit 0) → ย้ายไฟล์กลับครบ 143 ไฟล์
   - ตรวจหลัง apply: `organizations` 200 · `org_members` 200 · `companies.organization_id` 200 · คอลัมน์ `organization_id` ครบ 6 ตาราง V3 · RPC `tenant_has_membership` 200 (`false`)
   - **ข้อมูลเดิมไม่ถูกแก้/ไม่หาย** (เทียบ pre-change export): companies 86 · bank_notifications 1,122 · storage_evidence 71 · file_snapshots 42
2. **โค้ด tenant** — `/api/workspace/org-context` เปลี่ยนจาก **404 → 401** = โค้ดใหม่รันจริงบน production
3. **Bootstrap องค์กร** (จำเป็นก่อน deploy โค้ด ไม่งั้น business API จะ 403 ทุกตัว)
   - organization: `1f52520a-39fa-448f-8455-9ee4c72b00b0` ชื่อ **"สำนักงานใหญ่"** (ชื่อกลาง ๆ เปลี่ยนได้ด้วย `update organizations set name=… where id=…`)
   - memberships: `t23598788@gmail.com` = **owner** · `dnaos.tech@gmail.com` = **admin** (idempotent upsert; ลบ/เพิ่มได้)
   - ยังไม่ map บริษัทใดเข้า org (`companies.organization_id` = null ทั้งหมด = fail-closed ตามดีไซน์)

## LIVE_ENDPOINT_RESULTS (HTTP จริง · ไม่มี session)
| path | before deploy | after deploy | ความหมาย |
|---|---|---|---|
| `/login` | 200 (0.29s) | **200 (0.49s)** | แอปขึ้นปกติ |
| `/workspace` | 307 | **307** | ต้อง login (ตามเดิม) |
| `/api/workspace/org-context` | 404 | **401 (1.41s)** | โค้ด tenant ทำงานจริง |
| `/api/admin/pits` | 401 | **401 (0.45s)** | business API ยังต้อง session |
| `/api/admin/documents` | 401 | **401 (0.64s)** | เหมือนกัน |
| `/api/chat` (GET) | 405 | **405 (0.46s)** | method contract เดิม |
| `dnaos.dev` | 000 (TLS error) | **000 (TLS error)** | ยังต้องแก้ DNS/ใบรับรอง — blocker เดิม |

## MCP_RUNTIME_RESULTS
- MCP server: `connections/dna-os-mcp/server.ts --stdio` รันบน **Mac เครื่องนี้** (pid 50627) — เรียกใช้ได้จริงในเซสชันนี้ (identity/health/railway/ownership tools ตอบ schema จริง)
- DNA OS registry เองยังรายงาน `REMOTE_PRODUCTION_READY: false` · `PRODUCTION_ENVIRONMENT: NOT_WIRED` · `targets: []` → **DNA OS ยังไม่รู้จัก production binding** (ความจริงอยู่ที่ Railway CLI)
- `get_railway_deploy_capability_status`: `adapter_present: true`, `GENERIC_GRAPHQL_EXPOSED: false`, **`owner_enabled: false`** ⇒ deploy ครั้งนี้ทำผ่าน Railway CLI ตรง (เส้นทางเดิม) ไม่ได้ผ่าน DNA OS mutation

## FINANCE_READ_RESULTS / DOCUMENT_RESULTS
- **DB layer (ทำได้แล้ว)**: service-role อ่านข้อมูลธุรกิจได้ปกติ (companies 86 แถว 200); RLS **fail-closed จริงบน production** — anon key อ่าน `companies/invoices/debt_events/bank_notifications/storage_evidence/transactions/file_snapshots` ได้ **`[]` ทุกตาราง**
- **HTTP + session จริง (ยังไม่ได้)**: เปิด workspace, เรียกเครื่องมือ MCP, เปิดเอกสาร PDF, เรียกการเงิน ต้อง login ด้วยบัญชี Owner → **BLOCKED** (ไม่มี session และห้ามสร้างผู้ใช้/รหัสใหม่)

## AI_RUNTIME_LOCATION
- **Mac (เครื่องนี้)**: MLX `127.0.0.1:8140` (Qwen3-4B-Instruct-2507-4bit) · Ollama `127.0.0.1:11434` (qwen3:8b, qwen2.5-coder:1.5b) · `local-runtime/dna-ai-relay-worker.mjs` ×4 รันอยู่ · cline hub daemon pid 72477
- **Production** ตั้ง `AI_GATEWAY_OLLAMA_URL` ชี้ `http://127.0.0.1:8080/api/internal/ai/ollama-relay` (relay ภายในของแอป) → งาน AI ของ production ต้องผ่าน relay ไป Mac
- **Timeout ที่ยังไม่ทดสอบจริง**: ต้องยิงคำสั่ง AI ผ่าน session ผู้ใช้ (BLOCKED)

## ROLLBACK (พร้อมใช้)
- โค้ด: redeploy `dbd8eab9-3388-468f-889b-a6e297139dbc` (Railway → Promotions/Deployments) หรือ `git revert a73ca0c…` แล้ว `railway up`
- DB: `supabase/rollback/20261018000003…` → `…02…` → `…01…` (ทดสอบ 9/9 บน DB แยกแล้ว)
- ข้อมูลพื้นฐาน: `backups/2026-10-18_0506` + `backups/2026-10-18T05-10-51_tenant_prechange` (7 ตาราง)

## REMAINING_BLOCKERS
1. **Live authenticated test (STEP 4 ข้อ 1–10)** — ต้องมี session ของ Owner (ผม login แทนไม่ได้)
2. `dnaos.dev` TLS ล้ม (curl 000) ขณะที่ `NEXT_PUBLIC_APP_URL=https://dnaos.dev`
3. business API จะตอบ **403** จนกว่า Owner จะ **เลือกองค์กร** ครั้งแรกใน workspace (cookie `dna_org_context`) — พฤติกรรมที่ออกแบบไว้
4. ไม่มี health check path บน Railway
5. DNA OS ยังไม่บันทึก production binding (`NOT_WIRED`)
6. Rule 100 (บันทึก known_mistakes): ยังไม่ได้บันทึก — ต้องทำผ่านเครื่องมือ/ล็อกของ Rule 116 (ห้ามแก้ `registry/*.json` ตรง ๆ) · รายการที่ต้องบันทึก: `mcp-worker:test` ต้องมี `registry/worker-tool-registry.json` ที่ไม่มีใน repo · `scripts/backup.ts` ยังอ้าง 5 ตารางที่ไม่มีใน production · `supabase db push` ไม่สามารถเลือกเฉพาะ migration ได้ · deploy ครั้งก่อน (01:01) มาจาก working tree ที่ยังไม่ commit

## OWNER_TEST_URL
- ใช้งาน: **https://dna-os-deadboard-production.up.railway.app/login** (ใช้ได้ตอนนี้)
- ตรวจเร็ว ๆ (ไม่ต้อง login): `/api/workspace/org-context` = 401 · `/api/admin/pits` = 401
- หลัง login ครั้งแรก: เลือก **"สำนักงานใหญ่"** ที่มุมขวาบนของ workspace → business API จะกลับมาใช้งานได้
