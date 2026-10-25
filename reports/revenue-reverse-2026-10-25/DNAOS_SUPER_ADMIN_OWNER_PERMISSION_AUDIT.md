# DNA OS — SUPER ADMIN / OWNER / DEVELOPER PERMISSION AUDIT
**วันที่ตรวจ:** 2026-10-25 · **Snapshot LIVE:** `2026-10-24T22:36Z` · **Runtime ตรวจซ้ำ:** 2026-10-25
**โครงการ:** `xeytcavxejhyzxwevgto` (DNA OS Production, Seoul)
**โหมด:** READ-ONLY — ไม่ลบ/ปิดบัญชี · ไม่เปลี่ยน Role/Permission · ไม่แก้ RLS · ไม่แก้ Source/Database · ไม่สร้าง Migration · ไม่หมุน Secret · ไม่ Commit/Push/Deploy · ไม่ทดลองยกระดับสิทธิ์
**หลักการที่ใช้ตัดสิน:** DNA OS = ผู้ให้บริการโครงสร้างพื้นฐาน/ความสามารถประมวลผล · ข้อมูลธุรกิจเป็นทรัพย์สินของเจ้าของข้อมูล · สิทธิ์แก้ Source Code มาจาก GitHub/เครื่องมือพัฒนา/infra ไม่ใช่จากการล็อกอิน Workspace

> **ป้ายหลักฐานที่ใช้ตลอดรายงาน**
> `[LIVE]` = อ่านจาก Production ณ snapshot (PostgREST/GoTrue/CLI/HTTP)
> `[STATIC]` = อ่านจาก Source Code / Migration ในเครื่อง (ยังไม่ยืนยันว่า migration ถูก apply — ดู §2.4)
> `[RUNTIME]` = ยืนยันสถานะ host จริงด้วย HTTP/CLI

---

## 01 OBJECTIVE

| # | งาน | ผลลัพธ์ |
|---|---|---|
| 1 | ทำไม 3 บัญชีได้ role `super_admin` / `super_admin` / `customer` | §1.2, §10.1 |
| 2 | ไล่เส้นทาง Owner / Super Admin / Developer ทั้งระบบ | §2, §3 |
| 3 | ตรวจการปนกันของสิทธิ์พัฒนากับสิทธิ์ผู้ใช้ | §5 |
| 4 | Dependency analysis ก่อนเสนอการแก้ไข | §7, §8, §9 |
| 5 | ตรวจการป้องกันข้อมูลระหว่างองค์กร | §4, §6 |
| 6 | แยกสิทธิ์ภายนอก (GitHub/Vercel/Supabase/LINE/AI) ออกจาก role ภายใน | §6.2 |
| 7 | รายงาน + คำตอบ 7 ข้อ | ทั้งไฟล์ |

---

## 02 SOURCE EVIDENCE

### 2.1 LIVE — หลักฐานจาก Production (อ่านเท่านั้น)

เครื่องมือ: `scripts/permission-audit-readonly-probe.mjs` → `reports/revenue-reverse-2026-10-25/permission-audit-live-2026-10-25.json`
(get/HEAD เท่านั้น · service-role key อ่านจาก CLI ในหน่วยความจำ · บัญชีแสดงเป็น `acct_xxxxxxxx` · ไม่มีอีเมล/secret ในผลลัพธ์)

| หลักฐาน | ค่า |
|---|---|
| `auth.users` | **3** (email provider, confirmed ทั้งหมด) |
| `profiles` | **3** — ตรงกัน 1:1, ไม่มี orphan |
| ตารางจริงใน Production | **118** |
| `authority_grants` | **ไม่มีตารางนี้** |
| `org_members` คอลัมน์จริง | `organization_id, user_id, role, created_at` |
| `organizations` | **1** แถว (สร้าง 2026-10-18T05:17:21Z โดย `acct_39cbd71c`) |
| `org_members` | **2** แถว: `acct_39cbd71c` = `owner`, `acct_2d06e2d6` = `admin` (เพิ่มวินาทีเดียวกัน) |
| `identity_memberships` | **2** แถว: `acct_eed24c45`=`super_admin` (world `business`), `acct_f810279c`=`platform_owner` (world `infrastructure`) |
| `admin_session` | **ไม่มีตารางนี้** |
| `audit_logs` แถวที่เกี่ยวกับ role/profile | **2** (ทั้งคู่เป็น `pit_profile` ไม่ใช่ role) |
| `ADMIN_LOGIN` audit | **11 แถว · attributed 0** |
| `owner_auth_audit_log` | **0 แถว** |
| `api_tokens` | **4** (active 3, scope `read`, โดเมนอีเมลเดียว, ใช้ล่าสุด 2026-08-04T13:48Z) |
| `connectors` | **6**: `supabase-management-api` connected · `line` connected · `openclaw-pinto` connected · `github-dna-os-infrastructure` **disconnected** · `gmail` error · `google-ai-studio` error · `created_by_admin_id` = **null ทั้ง 6** |
| `workspace_locks` | **20** — holder เป็นชื่อ agent/session (`claude-hcg-p2`, `session-A-actor`, `owner-account`) **ไม่ใช่ account id** |
| `dev_loop_sessions` | **2** — owner = `codex-real-integration-test` (string ทดสอบ) |
| anon key HEAD | `profiles/companies/audit_logs/api_tokens/connectors/workspace_locks/dev_loop_sessions` = **200 `*/0`** · `org_members`/`organizations` = **500** |
| เว็บ Production | **HTTP 402 `DEPLOYMENT_DISABLED`** (Vercel) — ตรวจในรอบก่อนหน้า |

### 2.2 STATIC — ไฟล์ที่ใช้ตัดสิน

`registry/permissions.json` · `core/auth/session.ts:30` · `core/auth/requireAuth.ts:24` · `core/auth/requireAuthPage.ts:16` · `middleware.ts:17,29,105` · `app/admin/layout.tsx:61` · `app/admin/ide/page.tsx:13` · `app/api/admin/users/route.ts:34` · `app/api/admin/users/[id]/role/route.ts:18,35` · `core/authority/resolve.ts:118-166` · `engines/authority/load.ts:46` · `engines/canonical/audit.ts:78` · `services/supabase/queries.ts:16,19` · `app/api/admin/ide/file/route.ts:36,109` · `app/api/admin/ide/_lib/fsSecurity.ts:23,63` · `app/api/admin/ide/_lib/executionRegistry.ts:137-432,557` · `app/api/admin/workspace/route.ts:13-21,75` · `app/api/admin/backup/route.ts:4-22` · `app/api/admin/storage-intelligence/route.ts:22-28` · `engines/storage/engine.ts:34,266` · `app/api/admin/devices/commands/route.ts:23,48` · `app/api/admin/devices/_lib/deviceCommands.ts:19` · `core/policy/scope.ts:106` · `supabase/migrations/20260708000001_profiles_roles.sql:34-66` · `supabase/migrations/20260927000001_identity_email_federation.sql:38-58` · `supabase/migrations/20261024000001_public_signup_never_bootstrap_super_admin.sql` · `supabase/migrations/20260727000003_owner_surface_and_partner_payable.sql:11`

### 2.3 RUNTIME — สถานะที่ยืนยันด้วยเครื่องมือภายนอก

| คำสั่ง | ผล |
|---|---|
| `npx supabase migration list` | `20260708000001` **applied** · `20260927000001` **NOT applied** · `20261024000001` **NOT applied** · Production มี 6 migration ที่ไม่มีในเครื่อง |
| `npx supabase functions list` | 21 ACTIVE |
| `curl -I https://dna-os-deadboard.vercel.app` | **402 DEPLOYMENT_DISABLED** |

### 2.4 ข้อจำกัดที่ต้องยอมรับก่อนอ่านผล

1. **เว็บแอปไม่ได้รันอยู่** → เส้นทาง HTTP ทั้งหมดในรายงานนี้เป็น `[STATIC]` (มีโค้ดจริง) ไม่ใช่ `[LIVE]` (ถูกเรียกจริง) — ห้ามตีความว่า "ถูกใช้แล้ว"
2. **ไม่มี session ของแต่ละบัญชี** (ไม่มีรหัสผ่าน, การปลอม JWT ผิดข้อห้าม) → สิทธิ์รายบัญชี = CONFIGURED/STATIC + หลักฐาน DB; การทดสอบยิง API ด้วยตัวผู้ใช้ = NOT VERIFIED
3. **อ่าน policy RLS จาก Production โดยตรงไม่ได้** (ไม่มี pg_catalog ผ่าน REST, ไม่มี DB password) → ใช้ anon-key probe เป็นหลักฐานทางอ้อม + migration ใน repo
4. `20260927000001`/`20261024000001` ไม่ถูก apply → **trigger ที่รันจริงคือเวอร์ชัน 2026-07-08** (§1.2)

---

## 03 RESULT — สรุปผลรวม

| # | หัวข้อ | ผล | หลักฐาน |
|---|---|---|---|
| R1 | บัญชี 3 รายมีจริงและ role ตรงกับ DB | **PASS** | `[LIVE]` profiles/auth |
| R2 | role ถูกกำหนดโดย trigger + API ที่ตรวจสิทธิ์ | **PASS (มีโค้ด) / FAIL (ไม่มี audit)** | `[STATIC]` + `[LIVE]` audit 0 แถว |
| R3 | `super_admin` ให้สิทธิ์ข้ามองค์กรผ่าน authority engine | **PASS — ปฏิเสธโดยเจตนา** (`ROLE_IS_NOT_AUTHORITY`) | `resolve.ts:160` |
| R4 | องค์กร (`org_members.role=owner/admin`) มีผลต่อสิทธิ์จริง | **FAIL — ไม่มีผลเลย** (loader อ่านคอลัมน์ผิด + ไม่มีโค้ดอ่าน `organizations`/`identity_memberships`) | `engines/authority/load.ts:46` + grep 0 readers |
| R5 | Super Admin แก้ Source Code ผ่าน DNA OS ได้ | **RISK — ทำได้จริงในโค้ด** (`/api/admin/ide/file` PUT ที่ ADMIN_TIER) แต่ **ยังไม่ถึงขั้นใช้ได้จริง** เพราะเว็บปิด | `ide/file/route.ts:109` |
| R6 | Super Admin รันคำสั่งบนเครื่องได้ | **RISK — จำกัดชุดคำสั่ง** (allowlist 16 คำสั่ง ไม่มี shell อิสระ) | `executionRegistry.ts` |
| R7 | Super Admin ลบไฟล์บน host ได้ | **RISK** (`move_safe_to_trash` = SUPER_ADMIN_ONLY, ทำงานบน homedir ของเครื่องที่รันแอป) | `storage-intelligence/route.ts:28`, `engine.ts:34` |
| R8 | Super Admin export ข้อมูลทุกองค์กรได้ | **RISK** (`/api/admin/backup` 10 ตาราง ไม่มี org filter ไม่มี audit) | `backup/route.ts:4-22` |
| R9 | มี SQL/RPC execution ผ่าน UI | **PASS — ไม่มี** (grep `.rpc(`/`execute_sql` ใน `app/api` = 0) | `[STATIC]` |
| R10 | บัญชี customer เข้าถึงข้อมูลธุรกิจได้ | **PASS — ไม่ได้** (role ไม่อยู่ใน admin_tier, ไม่มี org, หน้า `/user` static) | `[STATIC]`+`[LIVE]` |
| R11 | บทบาท `developer` ใน DNA OS | **PASS — ไม่มี role นี้** (มีแต่ actor label ของ agent ใน log) | grep |
| R12 | การแยกข้อมูลระหว่างองค์กรในระดับ API | **FAIL — ไม่มีแนวคิด org ใน API เลย** (0/267 admin routes อ้าง `organization_id`) | grep |
| R13 | RLS กัน anonymous | **PASS** (`*/0` 7 ตาราง) / **RISK** (`org_members`,`organizations` = **500**) | `[LIVE]` |

---

## §1 ตารางสิทธิ์จริงของผู้ใช้ทั้ง 3 บัญชี

### 1.1 ตารางสรุป

| หัวข้อ | A `acct_39cbd71c` | B `acct_2d06e2d6` | C `acct_8de1e3b9` |
|---|---|---|---|
| 1. รหัส (masked) | `acct_39cbd71c` | `acct_2d06e2d6` | `acct_8de1e3b9` |
| 2. บทบาท | `super_admin` | `super_admin` | `customer` |
| 3. องค์กร | org#1 — **owner** (เพิ่ม 2026-10-18T05:17Z) | org#1 — **admin** (วินาทีเดียวกัน) | **ไม่มี** |
| 4. ผู้กำหนดบทบาท | **ไม่ทราบ** (ไม่มี audit) — ถูกเปลี่ยนหลังสร้าง 4 วัน | **trigger** `handle_new_user` (profile แรกของระบบ) | **trigger** (profiles ไม่ว่าง → `customer`) |
| 5. จุดเริ่มต้นในโค้ด | `PATCH /api/admin/users/[id]/role` หรือ SQL ตรง = NOT VERIFIED | `20260708000001_profiles_roles.sql:59` (`existing_count = 0 → super_admin`) | `…:61` (else → `customer`) |
| 6. หน้าจอ | `/admin/**` ทั้งหมด (267 API + ทุกหน้า) | เหมือน A | `/user` เท่านั้น |
| 7. อ่าน/สร้าง/แก้/ลบข้อมูล | ทำได้ทุกองค์กร (service-role 77 routes) | เหมือน A | ไม่ได้ |
| 8. AI / API | AI tools ทั้งหมด + ออก API token | เหมือน A | ไม่มี (`/api/explain` เท่านั้น) |
| 9. ข้ามองค์กร | **ได้** (ไม่มี org filter ใน API) | **ได้** | ไม่ได้ |
| 10. ประวัติพิสูจน์ได้ | 2 audit (`pit_profile` 2026-10-14) · 1 AI task · ล็อกอิน 2026-10-24T18:23Z | **0 audit** · 265 AI coding tasks · ล็อกอิน 2026-10-19T13:19Z | **0 ทุกอย่าง** · ล็อกอิน 2026-10-18T15:43Z |

### 1.2 ทำไมได้ role นี้ — ไล่ตามเวลาจริง `[LIVE]`

| เวลา (UTC) | เหตุการณ์ | หลักฐาน |
|---|---|---|
| 2026-07-08T16:51:40Z | **B สมัครเป็นคนแรกของระบบ** → trigger เห็น `profiles` ว่าง → `super_admin` | `profiles.created_at = updated_at` (ไม่เคยถูกแก้) |
| 2026-07-08T17:12:23Z | **A สมัครตามมา 21 นาที** → ตาม trigger ต้องได้ `customer` | `profiles.created_at` |
| 2026-07-13T20:53:17Z | **A ถูกเลื่อนเป็น `super_admin`** (updated_at ≠ created_at) — เส้นทางเดียวในโค้ดคือ `PATCH /api/admin/users/[id]/role` (SUPER_ADMIN_ONLY) หรือ SQL ตรง | `[LIVE]` `role_changed_after_creation: true` |
| 2026-10-15T10:04:19Z | **C สมัคร** (โดเมน `example.com` = โดเมนสงวนสำหรับทดสอบ) | `profiles.role = customer` |
| 2026-10-18T05:17:21Z | **A สร้าง org#1** แล้วเพิ่ม A=owner, B=admin ในวินาทีเดียวกัน | `organizations.created_by`, `org_members.created_at` |

**สรุปสาเหตุ:**
- **B = bootstrap** (profile แรก) — ไม่ใช่การตัดสินใจของใคร เป็นพฤติกรรมของ trigger ที่ยัง apply อยู่
- **A = ได้รับการเลื่อนสิทธิ์** ใน 5 วันแรก — **ผู้กระทำพิสูจน์ไม่ได้** เพราะไม่มี audit ของการเปลี่ยน role (ดู §3.3)
- **C = ค่าเริ่มต้นของทุก signup** — ไม่มีสิทธิ์อะไรเลย

**ข้อบกพร่องสำคัญที่พบระหว่างไล่:** `[LIVE]` มี super_admin **2 คน** แต่ UI/route นิยาม "Owner" = super_admin ที่ `created_at` เก่าสุด = **B** (`/api/admin/users/route.ts:34`) ขณะที่ `org_members.role` บอกว่า **A** เป็น owner → **นิยาม "owner" สองแบบขัดกัน** และตัวที่ใช้จริงคือแบบแรก (B) ซึ่งไม่ตรงกับเจตนาขององค์กร

---

## §2 แผนที่ Source Code ที่ตรวจ `owner` / `super_admin`

รูปแบบ: **FILE:LINE → ROLE CHECK → AUTHORITY → PERMITTED ACTION → TARGET RESOURCE**

| # | FILE:LINE | ROLE CHECK | AUTHORITY | PERMITTED ACTION | TARGET | ระดับ |
|---|---|---|---|---|---|---|
| 1 | `middleware.ts:17,29,105` | login เท่านั้น (ไม่ดู role) | session cookie | gate `/admin,/business,/user,/partner` + `/api/admin,…` | ทุกหน้า/ทุก API ที่ขึ้นต้นด้วย prefix | B (ธุรกิจ) |
| 2 | `core/auth/requireAuth.ts:24` | `allowedRoles.includes(user.role)` | `registry/permissions.json` role_tiers | 401/403 หรือผ่าน | API route ที่เรียกใช้ | B |
| 3 | `core/auth/requireAuthPage.ts:16` | เหมือน #2 (redirect) | เดียวกัน | redirect `/login?error=forbidden` | Server Component layout/page | B |
| 4 | `app/admin/layout.tsx:61` | `ADMIN_TIER` | registry | เรนเดอร์ `/admin/**` | ทุกหน้า admin | B |
| 5 | `app/admin/ide/page.tsx:13` | `ADMIN_TIER` | registry | **เปิด IDE (source tree/editor/terminal)** | repo ของแอป | **C** |
| 6 | `app/api/admin/ide/file/route.ts:36` (GET), `:109` (PUT) | `ADMIN_TIER` | registry เท่านั้น | **อ่าน/เขียนไฟล์ Source Code จริง** | `WORKSPACE_ROOT = process.cwd()` | **C** |
| 7 | `app/api/admin/ide/tree/route.ts:23` | `ADMIN_TIER` | registry | เดินดูไฟล์ทั้ง repo | repo | **C** |
| 8 | `app/api/admin/ide/execution/run/route.ts:47` | `ADMIN_TIER` | registry + `executionRegistry` allowlist | รัน process จริง (16 คำสั่งปิด) | เครื่องที่รันแอป | **C** |
| 9 | `app/api/admin/workspace/route.ts:19-20` | `SUPER_ADMIN_ONLY` | registry | approve/execute **file migration** (ย้ายไฟล์ + trash — **ไม่ใช่ SQL**) | workspace files | **C** |
| 10 | `app/api/admin/storage-intelligence/route.ts:28` | `SUPER_ADMIN_ONLY` | registry | `move_safe_to_trash` **ย้ายไฟล์จริงบน homedir** | `/Users/*/.npm`, `.cache`, `.ollama` ฯลฯ | **C** |
| 11 | `app/api/admin/backup/route.ts:20,63` | `SUPER_ADMIN_ONLY` | registry | **export 10 ตารางธุรกิจทั้งหมด ทุกองค์กร** | companies/invoices/orders/debt | **C** |
| 12 | `app/api/admin/users/route.ts:34` | `SUPER_ADMIN_ONLY` | registry | อ่านผู้ใช้ทุกคน + คำนวณ `is_owner` | `profiles` | B |
| 13 | `app/api/admin/users/[id]/role/route.ts:35` | `SUPER_ADMIN_ONLY` + **earliest super_admin เท่านั้น** สำหรับการให้ `super_admin` | registry + data rule | เปลี่ยน role ใครก็ได้ (ยกเว้น mint super_admin) | `profiles.role` | **C (ไม่มี audit)** |
| 14 | `core/authority/resolve.ts:118-166` | **ไม่ใช้ role** | ownership + delegation + org | อนุมัติเฉพาะ owner ของ resource หรือ grant | price/site/authority | **A (ถูกต้อง)** |
| 15 | `engines/authority/load.ts:46` | — | — | อ่าน org ของ actor — **คอลัมน์ผิด (`profile_id` ไม่มีจริง)** | `org_members` | **FAIL** |
| 16 | `supabase/migrations/20260708000001…:59` | `existing_count = 0` | trigger | ให้ `super_admin` กับ profile แรก | `auth.users` insert | **C (bootstrap)** |
| 17 | `supabase/migrations/20260727000003…:11` | — | data fix | ตั้ง `line_profiles.role='owner'` ให้ LINE id ของเจ้าของ | LINE surface | A/B (ไม่ใช่ authz) |

### 2.1 มีเส้นทางใดที่ "เห็นคำว่า super_admin แล้วได้สิทธิ์ข้ามองค์กรทันที" หรือไม่

**คำตอบ: ไม่มีใน authority engine; มีในชั้น API แบบไม่เกี่ยวกับ role เลย**

- `resolveAuthority()` **ปฏิเสธ** role เป็นแหล่งอำนาจเสมอ — `resolve.ts:160` คืน `ROLE_IS_NOT_AUTHORITY` และ `PLATFORM_ACTIONS = []` (ว่าง) → `[STATIC]` **PASS**
- แต่ API 267 เส้นทางใช้ `requireAuth(ADMIN_TIER)` แล้วเรียก `supabaseAdmin()` (service role, ข้าม RLS) โดย**ไม่มี org filter** → สิทธิ์ข้ามองค์กรมาจาก **tier ไม่ใช่ role** และไม่ได้มาจากการเห็นคำว่า `super_admin`
- หลักฐานเชิงตัวเลข `[STATIC]`: `app/api/admin` 267 routes · ใช้ service-role client **77** · อ้าง `company_id` **26** · อ้าง `organization_id` **0**

### 2.2 "owner" ในระบบนี้มี 4 ความหมายที่ต่างกันโดยสิ้นเชิง

| ความหมาย | ที่เก็บ | ใช้ตัดสินสิทธิ์หรือไม่ | หลักฐาน |
|---|---|---|---|
| เจ้าขององค์กร | `org_members.role='owner'` | **ไม่** (loader อ่านคอลัมน์ผิด; ไม่มีโค้ดอ่าน `organizations`) | `[LIVE]` + `[STATIC]` |
| เจ้าของ LINE surface | `line_profiles.role='owner'` | ไม่ — ใช้แค่เส้นทางแจ้งเตือน | `alertRuntime.ts:105`, cron route |
| platform_owner (identity world) | `identity_memberships.role` | **ไม่** — ไม่มีโค้ดอ่านตารางนี้เลย | grep = 0 readers |
| "Owner" ที่ UI แสดง | คำนวณสด = super_admin เก่าสุด | ใช้เฉพาะด่าน "ใครให้ super_admin ได้" | `users/route.ts:34`, `role/route.ts:39` |

---

## §3 แผนที่ API และเครื่องมือที่บัญชีเหล่านี้เข้าถึงได้

### 3.1 ภาพรวมตาม tier `[STATIC]`

| Tier | จำนวน route ใน `app/api` | ตัวอย่าง |
|---|---|---|
| `ADMIN_TIER` (super_admin, admin, employee) | **274 ไฟล์** | `/api/admin/**` (267), `/api/document`, `/api/action` |
| `SUPER_ADMIN_ONLY` | **13** | `users`, `users/[id]/role`, `backup`, `storage-intelligence`, `workspace`, ide security 7 ตัว |
| `ANY_AUTHENTICATED` | 4 | `/api/explain` (customer เข้าได้) |
| `ai_service` (X-DNA-Token) | 1 | `/api/v1/query` |

`[STATIC]`: `/api/admin/ide/**` มี **166 route** และ **ทั้งหมดเป็น ADMIN_TIER** (มี 8 ตัวที่ภายในบังคับ SUPER_ADMIN_ONLY สำหรับ security console)

### 3.2 ตารางเครื่องมือที่แต่ละบัญชีแตะได้

| เครื่องมือ | A | B | C | หลักฐาน |
|---|---|---|---|---|
| Business Workspace (เอกสาร/ใบแจ้งหนี้/หนี้/งาน/สินค้า) | ✅ | ✅ | ❌ | `permissions.json` capability_access |
| Users & Role management | ✅ | ✅ | ❌ | `SUPER_ADMIN_ONLY` |
| Backup export ทุกองค์กร | ✅ | ✅ | ❌ | `backup/route.ts` |
| Storage scan / classify / inspect_docker | ✅ | ✅ | ❌ | ADMIN_TIER |
| Storage move_safe_to_trash (ลบไฟล์ host) | ✅ | ✅ | ❌ | SUPER_ADMIN_ONLY |
| **Source Code editor (อ่าน/เขียน)** | ✅ | ✅ | ❌ | `ide/file` ADMIN_TIER |
| **Terminal (16 คำสั่งปิด)** | ✅ | ✅ | ❌ | `execution/run` ADMIN_TIER |
| Connector management (LINE/Supabase/GitHub/Gmail/Google) | ✅ | ✅ | ❌ | ADMIN_TIER, credential ถูก redact |
| Device command (`managed.run`) | ✅ | ✅ | ❌ | ADMIN_TIER + `scoped_grants` |
| AI agents / AI coding | ✅ | ✅ | ❌ | `ai_tasks` 265 ของ B |
| ออก API token (scope `read`, ใช้ข้ามระบบได้) | ✅ | ✅ | ❌ | `api-tokens.ts:47` |
| `/api/explain` | ✅ | ✅ | ✅ | `ANY_AUTHENTICATED` |

### 3.3 หลักฐานว่า "การให้สิทธิ์" ไม่ถูกบันทึก

- `PATCH /api/admin/users/[id]/role` → เขียน `profiles` แล้ว `return { ok: true }` — **ไม่มี `audit_logs` write** `[STATIC]` (ทั้งไฟล์ 65 บรรทัด ไม่มีการเรียก audit)
- `[LIVE]` query audit ที่เกี่ยวกับ role/profile → ได้ **2 แถว** ซึ่งเป็น `pit_profile` ไม่ใช่ role
- `[LIVE]` `owner_auth_audit_log` = **0** · `admin_session` = **ไม่มีตาราง**
- `[LIVE]` `ADMIN_LOGIN` = 11 แถว **actor เป็น null ทั้งหมด**

→ การเลื่อน A เป็น `super_admin` เมื่อ 2026-07-13 **ไม่มีร่องรอยผู้กระทำในระบบ** = NOT VERIFIED

---

## §4 ตารางเส้นทางที่อาจเข้าถึงข้อมูลข้ามองค์กร

| # | เส้นทาง | กลไก | กรอง org? | ข้อมูลที่ออกได้ | สถานะ |
|---|---|---|---|---|---|
| X1 | `GET /api/admin/transactions` | service-role + ADMIN_TIER | **ไม่** (เพิ่ม `partner_id` ได้ถ้าต้องการ) | คำสั่งซื้อ/บริษัท/เบอร์โทร ของ **ทุกบริษัท** (86) | **RISK** `[STATIC]` `transactions/route.ts:19-27` |
| X2 | `GET /api/admin/backup` | service-role + SUPER_ADMIN_ONLY | **ไม่** | 10 ตาราง ทุกบริษัท (สูงสุด 50,000 แถว/ตาราง) | **RISK** |
| X3 | `POST /api/v1/query` | X-DNA-Token → ต้องเป็น admin-tier email | **ไม่** | read commands ของ dispatcher (debt/partner ฯลฯ) | **RISK** `query/route.ts:80` |
| X4 | `/api/admin/documents`, `/invoices`, `/debt`, `/pits` ฯลฯ | ADMIN_TIER + service role | **ไม่** | เอกสาร/ยอดหนี้/ราคา ของทุกองค์กร | **RISK** |
| X5 | `GET /api/admin/ide/file` (GET) | ADMIN_TIER | n/a | **Source Code** (ไม่ใช่ข้อมูลลูกค้า) | **RISK (คนละชั้น)** |
| X6 | `POST /api/admin/ide/execution/run` | ADMIN_TIER + allowlist | n/a | ผลลัพธ์คำสั่ง (git status/diff, test output) | **RISK** |
| X7 | `/api/admin/connectors/[id]/test` | ADMIN_TIER | n/a | เรียก provider ด้วย credential ที่เก็บไว้ (ไม่คืน secret) | **RISK ต่ำ** `[STATIC]` redact |
| X8 | RLS ตรง (anon) | Postgres policy | n/a | **0 แถว** 7 ตาราง | **PASS** `[LIVE]` |
| X9 | RLS ตรง (customer session) | policy `profiles_select_own` | n/a | เห็นเฉพาะ profile ตัวเอง | **NOT VERIFIED** (ไม่มี session) |
| X10 | `org_members` / `organizations` ผ่าน anon | error | n/a | **HTTP 500** = query ล้ม (ไม่รั่ว แต่เป็น error ที่ควรแก้) | **RISK ต่ำ** `[LIVE]` |

**สรุป §5 ของคำสั่ง:** การซ่อนเมนูใน UI **ไม่ใช่**กลไกป้องกัน — backend บังคับด้วย `requireAuth(tier)` จริง (ดี) แต่ **ไม่มีการบังคับระดับองค์กรเลย** เพราะระบบยังไม่มีแนวคิด organization ในชั้น API (0/267 routes)

---

## §5 จุดที่เชื่อมสิทธิ์ผู้ใช้กับเครื่องมือพัฒนา (A / B / C)

| ประเภท | รายการ | หลักฐาน | ผลประเมิน |
|---|---|---|---|
| **A — เครื่องมือพัฒนาภายนอก ที่ไม่เกี่ยวกับบัญชี DNA OS** | GitHub repo (PAT อยู่นอกระบบ; connector `github-dna-os-infrastructure` **disconnected**), Vercel account (module `vercel-binding.ts` มี `VERCEL_TOKEN` แต่ **ไม่มี route ไหนเรียกใช้** — grep เจอแค่ `railway-binding.ts`), Supabase CLI/Management, Cline/AI coding บน Mac, IDE local, Terminal local | `[LIVE]` connectors · `[STATIC]` grep | **PASS — แยกออกจาก role ผู้ใช้** |
| **B — ความสามารถบริหารธุรกิจที่อนุญาต** | documents, invoices, debt, jobs, pits, people, accounting, reports, LINE ops | `permissions.json` capability_access | **PASS** |
| **C — เสี่ยง: สิทธิ์ผู้ใช้ → เครื่องมือพัฒนา/โครงสร้างพื้นฐาน/DB** | C1 `ide/file` PUT (เขียน Source Code, ADMIN_TIER) · C2 `ide/execution/run` (รัน npm scripts, ADMIN_TIER) · C3 `ide/tree` + `ide/search` (อ่านทั้ง repo) · C4 `backup` (export ทุกองค์กร) · C5 `storage move_safe_to_trash` (ลบไฟล์ host) · C6 `workspace approve/execute_migration` (ย้ายไฟล์) · C7 `devices/commands` (`managed.run` ไปยังอุปกรณ์) · C8 connector `supabase-management-api` **connected** (control-plane token ถูกใช้ได้จาก ADMIN_TIER) | `[STATIC]` §2 #5-11 · `[LIVE]` connectors | **RISK** |

**ทำไม C1–C3 ถือว่ารุนแรงเชิงโครงสร้าง (แต่ยังไม่เกิดจริง):**
1. `ADMIN_TIER` รวม `employee` → พนักงานทั่วไปแตะ Source Code ได้
2. ไฟล์ที่เขียนได้ถูกจำกัดเฉพาะ `process.cwd()` และกัน `.env/.pem/.key/credential/secret` + `.git/node_modules` (`fsSecurity.ts:63`) — **กัน secret ได้ดี** แต่ **ไม่ได้กัน source code**
3. endpoint เดียวที่มีคือ `PUT` ซึ่ง **แก้ไฟล์ที่มีอยู่เท่านั้น (ไม่สร้างไฟล์ใหม่)** แต่เมื่อแก้ไฟล์ test/source ที่มีอยู่ได้ + รัน `npm test/build` ได้ → ตัวแอปจะรันโค้ดที่เพิ่งแก้ในฐานะ process ของเซิร์ฟเวอร์ (chain นี้ **ไม่ถูกบล็อกด้วย allowlist** เพราะ `npm` อยู่ใน allowlist) — เป็น **design risk** ไม่ใช่ช่องโหว่ที่ถูกใช้แล้ว
4. **ยังไม่เกิดจริง** เพราะ (ก) เว็บปิด 402 (ข) บน Vercel filesystem ไม่คงอยู่ถาวร → surface นี้มีผลจริงเฉพาะเมื่อรันบนเครื่องที่มี persistent workspace (เช่น Mac ของเจ้าของ หรือ self-host)

**สิ่งที่พิสูจน์ได้ว่า "ไม่มี":**
- ไม่มี route รัน SQL/RPC (`grep .rpc(|execute_sql|run_sql` ใน `app/api` = 0)
- ไม่มี shell อิสระ (allowlist 16 คำสั่ง: pwd, ls, git status/diff, typecheck, npm test/build/lint/governance/registry.sync)
- ไม่มี route คืนค่า secret (connector test คืน `redactConnector`)
- `execute_migration` **ไม่ใช่** DB migration — เป็นการย้ายไฟล์ใน workspace (`trashPath` เป็นผลลัพธ์)
- deployment plan **ไม่ deploy จริง** (`deploymentRuntime.ts:3-8` ระบุชัดว่าไม่เรียก Vercel/Supabase/Git)

---

## §6 จุดที่ใช้ Service Role หรือสิทธิ์ฐานข้อมูลระดับสูง

| # | จุด | ระดับสิทธิ์ | ตรวจอะไรก่อน | ความเสี่ยง |
|---|---|---|---|---|
| S1 | `services/supabase/queries.ts:16` `supabaseAdmin()` | **service_role** (ข้าม RLS) | ไม่มี (เป็น client) | ผู้เรียกต้องตรวจเอง |
| S2 | `queries.ts:19` fallback → `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon (RLS บังคับ) | — | **RISK: silent downgrade** — ถ้า service key หาย ระบบจะไม่ error แต่คืนข้อมูลว่าง/ไม่ครบ |
| S3 | 77/267 admin routes | service_role | `requireAuth(ADMIN_TIER)` | ข้าม RLS + ไม่มี org filter |
| S4 | `services/supabase/api-tokens.ts` `serviceClient()` | service_role | throw ถ้าไม่มี key (ดี) | ใช้ใน `/api/v1/query` |
| S5 | `app/api/admin/ide/_lib/*Runtime.ts` (buildRuntime, providerRegistryRuntime, costGate…) | service_role | ADMIN_TIER ที่ route | IDE layer อ่าน/เขียนตารางระบบ |
| S6 | Edge functions (21 ตัว) | service_role ภายใน Supabase | — | ไม่ผ่าน `requireAuth` ของ Next (อยู่คนละ runtime) |
| S7 | `move_safe_to_trash` | **สิทธิ์ระดับ OS** (`fs.rename` บน homedir) | SUPER_ADMIN_ONLY | ลบไฟล์ host ได้ (เฉพาะที่ classify เป็น SAFE) |

---

## §7 ผลกระทบหากยกเลิก `super_admin` ออกจาก Business Workspace

| ระบบ | ผลกระทบ | ระดับ |
|---|---|---|
| ล็อกอิน | `workspace_landing.super_admin = /admin/relationships` หาย → ต้องมี destination ใหม่ | **สูง** |
| `middleware.ts` / `route_access` | `/admin` อนุญาต `["super_admin","admin","employee"]` — ตัด super_admin ไม่กระทบถ้ามี admin/employee | ต่ำ |
| `admin_tier` | ถอน super_admin ออกจาก tier → **ทั้ง 274 route ของ A/B พังทันที** (ไม่มี admin/employee จริงในระบบ) | **สูงสุด** |
| RBAC/users | `/api/admin/users`, `users/[id]/role` = SUPER_ADMIN_ONLY → **ไม่มีใครจัดการ role ได้อีก** | **สูงสุด** |
| การให้ super_admin คนใหม่ | ด่าน "earliest super_admin" จะไม่มีอยู่ → ต้องมีกลไกใหม่ | สูง |
| Backup / Storage trash / IDE security | 8+5 route SUPER_ADMIN_ONLY ไม่มีผู้ใช้ที่ผ่านเงื่อนไข | สูง |
| องค์กร/สมาชิก | `org_members` ไม่ถูกอ่านอยู่แล้ว → **ตัดหรือไม่ตัดก็ไม่มีผล** (แต่ควรแก้ให้มีผล) | ปานกลาง |
| AI / Connector / Jobs / Cron | ไม่ผูกกับ super_admin — ผูกกับ admin-tier หรือ service role → ไม่กระทบ | ต่ำ |
| DB | enum `app_role` ยังมีค่า `super_admin`; trigger ยังสร้างให้ profile แรก → ต้องมี migration ถ้าจะถอนจริง | สูง |

**สรุป:** การ "ตัด super_admin ออกจาก Business Workspace" ทำได้ก็ต่อเมื่อ **(1)** มี `admin`/`employee` จริงอย่างน้อย 1 คน **(2)** ย้าย 13 route SUPER_ADMIN_ONLY ไปยังกลไกอื่น (เช่น owner-identity + passkey ที่ตอนนี้มี 0 credential) **(3)** แก้ trigger bootstrap พร้อมกัน — มิฉะนั้นระบบจะไม่เหลือใครจัดการสิทธิ์ได้เลย

---

## §8 `owner` ที่เป็นเจ้าขององค์กรจริง — ยังจำเป็นหรือไม่

| คำถาม | คำตอบ | หลักฐาน |
|---|---|---|
| `org_members.role='owner'` ถูกใช้ตัดสินสิทธิ์หรือยัง | **ยังไม่ถูกใช้เลย** | `[STATIC]` loader อ่าน `profile_id` (ไม่มีจริง) → error → `[]` |
| `organizations` ถูกอ่านที่ไหน | **ไม่มีที่ไหน** | grep = 0 readers |
| `owner` ยังจำเป็นต่อธุรกิจหรือไม่ | **จำเป็นในเชิงแนวคิด** (เจ้าของข้อมูลต้องเป็นผู้ให้สิทธิ์) แต่ **Implementation ยังไม่เกิด** | `resolve.ts` ใช้ `resource.ownerProfileId` (ownership ระดับ resource) ซึ่งทำงานได้โดยไม่ต้องมี role `owner` |
| ต้องมี role `owner` ใน `app_role` ไหม | **ไม่ต้อง** — `app_role` ไม่มี `owner` อยู่แล้ว; owner เป็นเรื่องของ membership/resource | `20260708000001…:12-19` |

**ข้อสรุป §8:** สิ่งที่ธุรกิจต้องการคือ **ownership ของ resource + membership ขององค์กร** (ที่มีโครงอยู่ใน DB แล้วแต่ยังไม่ต่อสาย) ไม่ใช่ role ระดับระบบชื่อ `owner`

---

## §9 รายการที่ต้องปรับในรอบถัดไป (ยังไม่แก้ตามคำสั่ง) + ระดับความเสี่ยง

| # | จุดที่ต้องปรับ | ตำแหน่ง | ความเสี่ยง | เหตุผล |
|---|---|---|---|---|
| F1 | ให้ `actor_user_id` ถูกเขียนจริง | `engines/canonical/audit.ts:78` | **สูง** | 4,839/4,848 audit ผูกบัญชีไม่ได้ |
| F2 | แก้คอลัมน์ org loader (`profile_id` → `user_id`) | `engines/authority/load.ts:46` | **สูง** | ทำให้ org membership มีผลจริง + เป็นเงื่อนไขของ multi-tenant |
| F3 | บันทึก audit ทุกครั้งที่เปลี่ยน role | `app/api/admin/users/[id]/role/route.ts` | **สูง** | การให้ super_admin วันนี้ไม่มีร่องรอย |
| F4 | ย้าย `/api/admin/ide/**` (166 routes) ออกจาก ADMIN_TIER → tier เฉพาะเจ้าของ/infra | `app/api/admin/ide/**` | **สูง** | Source Code ถูกแก้ได้ด้วย role ธุรกิจ |
| F5 | บังคับ org filter ใน admin routes ที่ใช้ service role | 77 routes (เช่น `transactions/route.ts`) | **สูง** | ข้ามองค์กรได้โดยไม่มี org concept |
| F6 | ปิด/แก้ bootstrap trigger (ใช้เวอร์ชัน 20261024000001) | `20260708000001…:59` | **สูง** | public `/register` + profiles ว่าง = ผู้สมัครคนแรกเป็น super_admin |
| F7 | เลิก silent fallback เป็น anon key | `services/supabase/queries.ts:19` | ปานกลาง | ข้อมูลหายเงียบเมื่อ key ไม่ครบ |
| F8 | เพิ่ม audit ให้ export/backup | `app/api/admin/backup/route.ts` | ปานกลาง | export ทุกองค์กรไม่มีร่องรอย |
| F9 | ทบทวน `move_safe_to_trash` (ควรเป็น infra operator ไม่ใช่ role ธุรกิจ) | `storage-intelligence/route.ts:28` | ปานกลาง | ลบไฟล์ host |
| F10 | ทบทวน connector `supabase-management-api` (connected) | `[LIVE]` connectors | **สูง** | control-plane token ถูกใช้ได้จาก ADMIN_TIER |
| F11 | แก้ anon error 500 ของ `org_members`/`organizations` | RLS/policy | ต่ำ | error state ที่ควรเรียบร้อย |
| F12 | รวมนิยาม "owner" ให้เหลือหนึ่งเดียว | `users/route.ts:34` vs `org_members` | ปานกลาง | UI ชี้ owner ผิดคน (B แทน A) |

---

## §10 คำตอบ 7 ข้อ

**1. ทำไม 3 บัญชีได้ role ตามที่ปรากฏ?**
> **B** ได้ `super_admin` เพราะเป็น profile แรกของระบบและ trigger `handle_new_user` (migration `20260708000001`, ยัง apply อยู่) ให้ `super_admin` เมื่อ `profiles` ว่าง — `created_at = updated_at` ยืนยันว่าไม่เคยถูกแก้ · **A** สมัครตามมา 21 นาที (ควรได้ `customer`) แต่ `updated_at = 2026-07-13T20:53:17Z` ≠ `created_at` → ถูก**เลื่อนสิทธิ์**ผ่าน `PATCH /api/admin/users/[id]/role` หรือ SQL ตรง และ**ไม่มี audit** จึงระบุผู้กระทำไม่ได้ · **C** เป็น signup ปกติหลัง profiles ไม่ว่าง → `customer` (โดเมน `example.com` = บัญชีทดสอบ)

**2. Super Admin ทั้ง 2 บัญชีทำอะไรได้จริงภายใน DNA OS?**
> เข้าถึงได้ **274 ไฟล์ใน `app/api`** ที่ใช้ ADMIN_TIER (267 เป็น admin routes) + **13 route** SUPER_ADMIN_ONLY: จัดการผู้ใช้/role, export ข้อมูลทุกองค์กร, สแกน/ลบไฟล์ host, approve/execute file migration, อ่าน/เขียน Source Code, รันคำสั่ง 16 ตัว, จัดการ connector (LINE/Supabase/GitHub) และออก API token — **ในทางเทคนิคทำได้ทั้งหมด แต่หลักฐานการใช้งานจริงมีน้อยมาก**: A มี 2 audit + 1 AI task, B มี 0 audit + 265 AI coding tasks, และเว็บแอปปิดอยู่ (402) จึงยังไม่มีอะไรถูกใช้ผ่าน UI ในรอบนี้

**3. สิทธิ์เหล่านั้นเกี่ยวกับการแก้ Source Code จริงหรือไม่?**
> **ใช่ — มีเส้นทางจริงในโค้ด** `GET/PUT /api/admin/ide/file` (ADMIN_TIER) เขียนไฟล์ใต้ `process.cwd()` ได้จริง + `ide/tree`/`ide/search` อ่านทั้ง repo + `execution/run` รัน `npm` scripts ได้ · **แต่**: (ก) กัน `.env/.pem/.key/credential/secret` และ `.git/node_modules` (ข) ไม่มี shell อิสระ (ค) **ยังไม่เคยเกิดขึ้นจริง** เพราะเว็บถูกปิด และบน Vercel filesystem ไม่คงอยู่ — เสี่ยงจริงเฉพาะ runtime ที่มี persistent workspace · สรุป: **สิทธิ์นี้ไม่ควรมาจาก role ธุรกิจ** ตามหลักการของผู้ว่าจ้าง

**4. มีเส้นทางใดเปิดให้เข้าถึงฐานข้อมูลหรือโครงสร้างพื้นฐานเกินความจำเป็น?**
> **มี 4 จุด:** (1) **77/267 admin routes** ใช้ service role ข้าม RLS โดยไม่มี org filter → เห็นข้อมูลทุกบริษัท (2) `/api/admin/backup` export 10 ตารางทุกองค์กรโดยไม่มี audit (3) `/api/v1/query` ใช้ token อ่านข้อมูลข้ามระบบ (4) connector **`supabase-management-api` connected** = control-plane token ที่ ADMIN_TIER เรียกใช้ได้ · ส่วนที่ **ไม่เกิน**: ไม่มี SQL/RPC execution, ไม่มี shell อิสระ, deployment plan ไม่ deploy จริง, ไม่มี route คืน secret

**5. หากตัดบทบาท Super Admin ออกจาก Business Workspace จะกระทบอะไร?**
> กระทบหนัก 3 ชั้น: **ชั้น login/destination** (`workspace_landing`), **ชั้น route** (274 route ถ้าถอนออกจาก admin_tier จะไม่เหลือใครผ่านได้ เพราะไม่มี admin/employee จริง), **ชั้นจัดการสิทธิ์** (13 route SUPER_ADMIN_ONLY โดยเฉพาะ `users`/`role` — จะไม่มีใครให้สิทธิ์ใครได้อีก) · สิ่งที่ไม่กระทบ: AI, connector, jobs, cron, ข้อมูลธุรกิจเดิม (เพราะผูกกับ tier/service role ไม่ใช่ชื่อ role)

**6. บทบาทใดจำเป็นสำหรับเจ้าขององค์กรและการบริหารข้อมูลธุรกิจ?**
> สิ่งที่จำเป็นจริงคือ **(ก) ownership ของ resource** (มีอยู่แล้วใน `resolve.ts` ผ่าน `resource.ownerProfileId`) และ **(ข) organization membership** (`org_members.role = owner/admin`) — ซึ่งมีข้อมูลจริงใน DB แล้ว (org#1: A=owner, B=admin) แต่ **ยังไม่ถูกอ่านโดยโค้ดเลย** · role ระดับระบบที่พอสำหรับบริหารธุรกิจคือ `admin`/`employee` · **ไม่จำเป็นต้องมี role ชื่อ `owner`** และไม่ควรใช้ `super_admin` เป็นบทบาทประจำวันของธุรกิจ

**7. ต้องแยกสิทธิ์พัฒนาออกจากสิทธิ์ผู้ใช้ตรงจุดใด โดยไม่กระทบข้อมูลเดิม?**
> แยกที่ **ชั้น route ไม่ใช่ชั้นข้อมูล** — 5 จุด: (1) `/api/admin/ide/**` ทั้ง 166 routes ออกจาก ADMIN_TIER ไปเป็น surface เฉพาะเจ้าของ/infra (2) `storage move_safe_to_trash` + `workspace execute_migration` → infra operator (3) `backup` export → เพิ่ม audit + จำกัด infra (4) connector `supabase-management-api` → ไม่ให้ ADMIN_TIER เรียก (5) `execution/run` → ต้องมี second factor / owner confirmation ต่อคำสั่ง · ทั้ง 5 จุด **ไม่แตะข้อมูลเดิม** เพราะเป็นการเปลี่ยน guard ไม่ใช่ schema; ข้อมูลธุรกิจ (documents/invoices/debt) ยังใช้ `admin`/`employee` ตามเดิม

---

## §11 ข้อจำกัดของรายงานนี้

1. **ไม่มีการทดลองยกระดับสิทธิ์หรือยิง API ด้วย session จริง** — สิทธิ์ทั้งหมดเป็น CONFIGURED (code+DB) ไม่ใช่ OBSERVED
2. **เว็บ Production ปิด (402)** → ทุกเส้นทาง HTTP เป็น STATIC; ไม่มีอะไรถูกใช้จริงในรอบนี้
3. **อ่าน RLS policy บน Production โดยตรงไม่ได้** → ใช้ anon probe (`*/0`) + migration ใน repo; policy ที่อาจถูกสร้างตรงบน Production (drift 6 migrations) = NOT VERIFIED
4. **ไม่มี DB password/psql** → ไม่สามารถตรวจ `pg_policies`, `pg_proc`, trigger body ที่รันจริง; ใช้ `migration list` เป็นหลักฐานว่าตัวไหน apply
5. **ไม่มี audit ของ role change** → ผู้เลื่อนสิทธิ์ A = NOT VERIFIED (ไม่ใช่การเดา)
6. ตัวเลข audit/lock/scan เพิ่มขึ้นตลอดเวลา — ตัวเลขในรายงานคือ snapshot `2026-10-24T22:36Z`

---

## ภาคผนวก — Evidence Index

| หลักฐาน | ที่อยู่ |
|---|---|
| LIVE permission snapshot | `reports/revenue-reverse-2026-10-25/permission-audit-live-2026-10-25.json` |
| สคริปต์ที่ใช้ | `scripts/permission-audit-readonly-probe.mjs` (GET/HEAD เท่านั้น) |
| Runtime/host | `npx supabase migration list` · `functions list` · `curl -I https://dna-os-deadboard.vercel.app` |
| ก่อนหน้า (ต้นทุน/บัญชี) | `DNAOS_CURRENT_OPERATING_COST_AND_USER_USAGE_AUDIT.md` |

**จบรายงาน — READ-ONLY เท่านั้น ไม่ได้แก้ไขระบบใด ๆ และหยุดรอคำสั่งรอบถัดไปจากเจ้าของ**
