# PRODUCTION RUNTIME MANIFEST — MULTI-TENANT (STEP 1–3)

**หลักฐานทุกบรรทัดมาจาก Process / Endpoint / Deployment จริง ณ 2026-10-18T05:0x UTC — ไม่ได้สรุปจากไฟล์ซอร์ส**

---

## 1. RUNTIME INVENTORY (ของจริงที่รันอยู่)

| ชั้น | หลักฐาน | สถานะจริง |
|---|---|---|
| **Railway** | `railway status` → Project `DNA-OS-INFRASTRUCTURE` (`ffe589bf-58fb-4e3e-8969-4a75915fda1a`) · env `production` · service `dna-os-deadboard` | RUNNING |
| Deployment ล่าสุด | `railway deployment list --json` → id `dbd8eab9-3388-468f-889b-a6e297139dbc` · status SUCCESS · createdAt `2026-10-17T18:01:02Z` · imageDigest `sha256:841b54ab…023dfe` · builder RAILPACK · replicas 1 (iad) | SUCCESS |
| วิธี deploy | deployment meta: `cliCaller: agent_unknown:apple_terminal:freebuff` → deploy จาก **CLI (`railway up`) ไม่ใช่ GitHub auto-deploy** | ยืนยันจาก meta |
| **Domain** | `dnaos.dev` (custom, ACTIVE→8080) · `dna-os-deadboard-production.up.railway.app` (service, ACTIVE) | ACTIVE |
| **Live endpoints** | `/login` → **200** · `/` → **307** · `/workspace` → **307** (ต้อง login) · `/api/admin/pits` → **401** · `/api/chat` → **405** (GET ไม่รับ) · `/api/workspace/org-context` → **404** (ยังไม่มีใน production) | ยืนยันด้วย HTTP จริง |
| ⚠️ `dnaos.dev` TLS | `curl https://dnaos.dev/` → **000** + ข้อความ TLS error (IP 69.46.46.102) แต่ `NEXT_PUBLIC_APP_URL=https://dnaos.dev` ใน env ของ production | **ต้องแก้ DNS/ใบรับรอง** |
| **Supabase** | project `xeytcavxejhyzxwevgto.supabase.co` · `companies` อ่านได้ 86 แถว | CONNECTED |
| Supabase schema (tenant) | `organizations` → **404 PGRST205** · `org_members` → **404 PGRST205** · `companies.organization_id` → **42703 ไม่มีคอลัมน์** · `bank_statement_transactions.organization_id` → ไม่มี · RPC `tenant_has_membership` → ไม่พบ | **ยังไม่ apply V1–V3** |
| **MCP Server** | process `node …/DNA-OS-INFRASTRUCTURE/connections/dna-os-mcp/server.ts --stdio` (pid 50627) บน **เครื่อง Mac เครื่องนี้** · เรียกผ่านเครื่องมือ DNA OS ได้จริง (ระบบตอบ schema/tool จริง) | RUNNING (local, stdio) |
| **AI Runtime** | `mlx_lm.server` (pid 3258) → `127.0.0.1:8140` ฟังอยู่ · model `mlx-community/Qwen3-4B-Instruct-2507-4bit` · `ollama serve` → `127.0.0.1:11434` (models: `qwen3:8b`, `qwen2.5-coder:1.5b`) | RUNNING (Mac) |
| Production AI gateway config | env `AI_GATEWAY_OLLAMA_URL = http://127.0.0.1:8080/api/internal/ai/ollama-relay` (relay ภายในของแอปบน Railway) | ตั้งไว้แล้ว |
| **Mac Worker (AI relay)** | `node local-runtime/dna-ai-relay-worker.mjs` หลายตัวรันอยู่ (pid 21152, 31357, 91266, 12454) ใน `~/Desktop/ระบบธุรกิจ/dna-os-maincheck` | RUNNING |
| Mac worker อื่น | `cline --cline-hub-daemon --cwd /tmp/dnaos-cline-worker` (pid 72477) | RUNNING |
| **Local services บน Mac** | `:8790` (owner/surface) · `:8791` (owner-runtime client target) · `:8793` · `:18789` · postgres 5432 · ollama 11434 · mlx 8140 | LISTENING |
| **DNA OS control layer** | `get_deployment_target_status` → `targets: []`, `PRODUCTION_ENVIRONMENT: NOT_WIRED`, `REMOTE_PRODUCTION_READY: false` · `get_real_production_lineage` → `NOT_AVAILABLE` · `get_remote_deployment` → `NOT_AVAILABLE` | **ยังไม่บันทึก production binding** (Railway คือความจริง ไม่ใช่ registry) |
| GitHub | `t23598788-oss/-DNA-OS-INFRASTRUCTURE-` (PRIVATE, default `main`, pushedAt 2026-10-16T13:00Z) + remote `github` = `---------------DNA-OS.git` ใน working tree นี้ | READONLY ที่ตรวจได้ |

## 2. PRODUCTION PACKAGE — READY / BLOCKED

### READY (มี runtime รองรับ + ทดสอบผ่านแล้ว)
| ความสามารถ | ซอร์ส | รันด้วย | ทรัพยากร | Endpoint | Health check |
|---|---|---|---|---|---|
| Multi-tenant data model V1–V3 | `supabase/migrations/2026101800000{1,2,3}_*.sql` | `psql -f` (หรือ Supabase migration) | Postgres (prod project) | — (schema) | `npm run tenant-matrix:test` · `npm run tenant-migration:test` |
| Tenant API gate | `core/auth/tenantApiPolicy.ts` + `middleware.ts` | Next runtime (มีอยู่แล้ว) | Edge/Node middleware ของแอป | ทุก `/api/admin/<business>` | `npm run tenant-api:test` (13 checks) |
| Org context (server + cookie) | `core/auth/orgContext.ts` · `app/api/workspace/org-context/route.ts` | Next runtime | cookie `dna_org_context` | `GET/POST /api/workspace/org-context` (วันนี้ 404 = ยังไม่ deploy) | `npm run tenant-core:test` |
| Workspace org UI | `app/workspace/OrgContext*.tsx` · `WorkspaceFrame.tsx` · `DNAOSChatEngine.tsx` | Next runtime | React (เดิม) | `/workspace` | `npm run tenant-workspace-ui:test` (browser 8 checks) |
| E2E (manual tool + AI command) | `scripts/tenant-e2e-synthetic-test.ts` | `npm run tenant-e2e:test` | local Postgres + Playwright | — | 23/23 |
| Rollback plan | `supabase/rollback/2026101800000{1,2,3}_*_rollback.sql` | `psql -f` ย้อนลำดับ | Postgres | — | `npm run tenant-migration:test` (M3–M5) |
| แผน deploy ฉบับเต็ม | `docs/TENANT_MULTITENANT_PRODUCTION_PLAN.md` | — | — | — | — |

### BLOCKED
| ความสามารถ | เหตุผลจากหลักฐานจริง | ต้องมีอะไรก่อน |
|---|---|---|
| **Deploy โค้ดที่มี tenant gate ขึ้น production** | production ยังไม่มี `org_members` → middleware อ่าน membership ไม่ได้ → `decideTenantApi` คืน **403 ORG_NOT_MEMBER (fail-closed)** ให้ **ทุก business API** ที่ผู้ใช้ login อยู่ (`/api/admin/pits`, `/documents`, `/finance`, `/partners`, …) | ต้อง apply V1–V3 → สร้าง organizations + org_members (Owner) → Owner เลือกองค์กรใน cookie ก่อน deploy โค้ด |
| **Migration V1–V3 บน production** | ยังไม่ apply (หลักฐาน PGRST205/42703) · `companies` 86 แถวยังไม่ map org · V2 ทำ `companies` policy เป็น member-only-when-mapped | ต้อง backup + ตัดสินใจลำดับ (แนะนำ apply ก่อน deploy โค้ด) · รายงานตรง: ถ้ามีการอ่าน companies ด้วย JWT ตรง ๆ จาก client จะเห็น 0 แถว — ตรวจแล้วว่าแอปอ่าน business tables ผ่าน service-role (**66 route files** ใช้ `supabaseAdmin()`), client อ่านตรงเฉพาะ `dev_loop_*` → ผลกระทบจำกัด |
| **HTTP/PostgREST integration test บน production** | ไม่มี Docker/Supabase local stack บนเครื่องนี้ | Docker หรือ Supabase CLI stack |
| **Live authenticated test (STEP 4 ข้อ 1–10)** | ต้องมี session ของ Owner (I cannot login ด้วยรหัสของ Owner และห้ามสร้างผู้ใช้/รหัสใหม่) | Owner login แล้วให้ session cookie สำหรับ read-only tests **หรือ** Owner รันเองตาม checklist |
| **`dnaos.dev` (domain ที่ตั้งใน NEXT_PUBLIC_APP_URL)** | TLS handshake ล้ม (curl 000) ขณะที่ *.up.railway.app ใช้ได้ | แก้ DNS/ใบรับรองของ dnaos.dev |
| **DNA OS production registry binding** | `targets: []`, `NOT_WIRED` — DNA OS ไม่รู้จัก production | ต้องมี Owner grant/registration (ตามนโยบาย DNA OS เอง) |
| **`npm run mcp-worker:test`** | ต้องมี `registry/worker-tool-registry.json` ซึ่งไม่มีใน repo (git history ไม่เคยมี) | สร้าง/กู้ไฟล์ registry ตัวนั้น |

## 3. ลำดับที่ปลอดภัย (เสนอ)
1. `npm run backup` (snapshot Supabase ก่อนแตะ schema)
2. apply V1 → V2 → V3 บน production (additive, SELECT-only policies)
3. สร้าง 1 organization ของ Owner + org_members (Owner เป็น admin/owner) — ไม่ seed บริษัท/ข้อมูลธุรกิจ
4. (ทางเลือก) map `companies.organization_id` เท่าที่ Owner ยืนยัน
5. commit งาน (ให้ deploy ผูกกับ revision จริง ตาม `project/docs/rollback-policy.md`) แล้ว `railway up`
6. ตรวจ deployment id ใหม่ + image digest + `/login` 200 + `/api/workspace/org-context` 401 (ไม่ใช่ 404) + business API หลัง Owner เลือกองค์กร
7. ถ้าผิดปกติ → ถอยโค้ด (promote/GitHub) และถอย SQL ตาม `supabase/rollback/*`
