# DNA OS — AUTHORITY SEPARATION & PRODUCTION SECURITY GATE
**วันที่:** 2026-10-25 · **Snapshot LIVE:** `2026-10-24T22:36Z` · **ตรวจ Runtime ซ้ำ:** 2026-10-25
**โครงการ Production:** `xeytcavxejhyzxwevgto` (Seoul) · **Staging:** `zjhgysugbmyyciatmltv` (Singapore, 0 functions)
**โหมด:** READ-ONLY DESIGN & SECURITY AUDIT — ไม่แก้ Source/DB/RLS/Role/Credential · ไม่สร้าง Migration · ไม่ Deploy/Commit/Push · ไม่สร้างระบบสิทธิ์คู่ขนาน · ไม่แตะ Canonical Path

> **ป้ายกำกับหลักฐาน (ใช้ตลอดรายงาน)**
> `S` = STATIC (พิสูจน์จาก Source Code ในเครื่อง, ยังไม่ยืนยันว่า migration apply)
> `L` = LIVE VERIFIED (อ่านจาก Production ณ snapshot)
> `R` = RUNTIME VERIFIED (HTTP/CLI ต่อ host จริง)
> `P` = PROPOSAL (ข้อเสนอออกแบบใหม่ — ยังไม่มีในระบบ)
> `NV` = NOT VERIFIED (ตรวจไม่ได้ด้วยข้อจำกัดที่ระบุ)

---

## 01 OBJECTIVE

เตรียมแยกอำนาจ 3 ประเภทออกจากกันอย่างถาวร: **Development Authority**, **Platform Administration**, **Tenant Data Authority** — โดยตรวจเส้นทางสิทธิ์เดิมทั้งหมดก่อน และ **ไม่ถือว่า Owner/Super Admin อ่านข้อมูลทุกองค์กรได้โดยอัตโนมัติ**

ผลลัพธ์รอบนี้ใช้สำหรับ (ก) วางแผนปรับสิทธิ์ (ข) กำหนดเกณฑ์ทดสอบก่อนขึ้น Production — **ยังไม่ลงมือแก้**

---

## 02 SOURCE EVIDENCE (สรุปวิธีและหลักฐาน)

| ประเภท | แหล่ง |
|---|---|
| `L` | `scripts/permission-audit-readonly-probe.mjs` → `permission-audit-live-2026-10-25.json` · `operating-cost-readonly-probe` · `revenue-production-readonly-census` |
| `S` | `registry/permissions.json` · `core/auth/*` · `middleware.ts` · `core/authority/resolve.ts` · `engines/authority/load.ts` · `app/api/admin/**` · `supabase/migrations/**` |
| `R` | `npx supabase projects/functions/migration list` · `curl -I https://dna-os-deadboard.vercel.app` |
| `NV` | `pg_policies`/trigger body บน Production (ไม่มี DB password) · session ของแต่ละบัญชี (ห้ามปลอม JWT) · storage.objects policy |

**ข้อเท็จจริง Runtime ที่ส่งผลต่อสถาปัตยกรรม:** เว็บแอป Production **ปิดอยู่** (`R`: HTTP 402 `DEPLOYMENT_DISABLED`) → เส้นทาง HTTP ทั้งหมดเป็น `S` (มีโค้ดจริง ยังไม่ถูกเรียกใช้) ส่วน Supabase (DB + 21 Edge Functions) ทำงานจริง `R`

---

## 03 RESULT — PASS / FAIL / BLOCKED / NOT VERIFIED (สรุปก่อนลงรายละเอียด)

| # | ข้อ | ผล |
|---|---|---|
| 1 | Authentication ผ่าน Supabase Auth + session cookie ทุก request | **PASS** `S` |
| 2 | Role ถูกอ่านจาก DB ทุก request (ไม่ฝังใน JWT) | **PASS** `S` — `core/auth/session.ts:30-70` |
| 3 | Role guard (401/403) ทำงานที่ API ทุกเส้น | **PASS (โค้ด)** `S` |
| 4 | ขอบเขตองค์กรถูกบังคับในชั้น API | **FAIL** — 0/267 admin routes อ้าง `organization_id` `S` |
| 5 | Organization membership มีผลต่อสิทธิ์ | **FAIL** — loader อ่าน `profile_id` แต่ DB มี `user_id` `S`+`L` |
| 6 | RLS ป้องกันข้อมูลระหว่างผู้ใช้ที่ล็อกอิน | **BLOCKED/NV** — 66 policies บน 10 ตาราง จาก 118 ตาราง; ข้อมูลส่วนใหญ่ไหลผ่าน service role |
| 7 | Anonymous อ่านข้อมูลไม่ได้ | **PASS** `L` (`*/0` 7 ตาราง) |
| 8 | Business role แยกจาก Development tool | **FAIL** — 166 IDE routes อยู่ที่ `ADMIN_TIER` `S` |
| 9 | Platform Owner เห็นข้อมูลสรุปโดยไม่เห็นข้อมูลผู้ใช้ | **FAIL** — ไม่มีเส้นทาง aggregate-only; มีแต่ route อ่านดิบ `S` |
| 10 | Role assignment มี audit | **FAIL** — ไม่มี audit write ในเส้นทางเปลี่ยน role `S`+`L` |
| 11 | Bootstrap super_admin ถูกปิด | **FAIL** — migration hardening ยังไม่ apply `R` |
| 12 | การออกเอกสาร/เงินยังผ่าน Canonical Path เดียว | **PASS** `S` (canonical engines + RPC) |

---

# 1. CURRENT AUTHORITY MAP

## 1.1 ห้าชั้นของอำนาจในระบบปัจจุบัน

| ชั้น | กลไก | ไฟล์ | ตัดสินอะไร | ตรวจ org? |
|---|---|---|---|---|
| L1 | Session gate | `middleware.ts:17,29,105` | ล็อกอินหรือยัง (ไม่ดู role) | ไม่ |
| L2 | Global role guard | `core/auth/requireAuth.ts:24`, `requireAuthPage.ts:16` | `role ∈ tier` จาก `registry/permissions.json` | ไม่ |
| L3 | Route handler | 267 admin routes | เรียก `supabaseAdmin()` (service role) อ่าน/เขียนตรง | **ไม่** |
| L4 | Canonical engine | `engines/canonical/*` (document/transaction/expense/audit) | ตรวจ business invariant (ยอด/ภาษี/สถานะ) — **ไม่ตรวจผู้ใช้ว่าเป็นเจ้าของข้อมูลหรือไม่** | ไม่ |
| L5 | Machine identity | `services/supabase/api-tokens.ts:47` + `app/api/v1/query/route.ts:80` · connector vault · LINE signature (`line-webhook-v2/index.ts:67`) | token scope `read` + email ต้องเป็น admin-tier | ไม่ |

**ผลรวม:** อำนาจในระบบวันนี้ = **"global role + service role"** ไม่มีชั้นใดที่รู้จัก "องค์กรของผู้ร้องขอ" เลย

## 1.2 เส้นทางที่ตรวจสอบย้อนกลับได้ (ACCOUNT → SESSION → ROLE → POLICY → API → DATA)

```
[A] acct_39cbd71c ── Supabase Auth cookie ──▶ profiles.role = super_admin
     └─▶ requireAuth(SUPER_ADMIN_ONLY | ADMIN_TIER)  [ผ่านทุกเส้น]
          ├─▶ 267 /api/admin/**  ──▶ supabaseAdmin() (service_role, bypass RLS)
          │        └─▶ DATA: ทุกบริษัท (86) · ทุกเอกสาร · ทุกสลิป · ทุก debt
          ├─▶ 166 /api/admin/ide/** ──▶ SOURCE CODE (PUT edit) + npm exec
          └─▶ 13 SUPER_ADMIN_ONLY ──▶ users/role · backup · trash · workspace migrate

[B] acct_2d06e2d6 ── เหมือน A ทุกชั้น (super_admin) ──▶ เหมือน A
     └─ (org_members.role = admin — ไม่ถูกอ่านโดยโค้ด)

[C] acct_8de1e3b9 ── Supabase Auth cookie ──▶ profiles.role = customer
     └─▶ /user (static, existence.json) · /api/explain
          └─▶ DATA: ไม่มีเส้นทางไปยังข้อมูลธุรกิจ (ไม่มี org, role ไม่อยู่ใน admin_tier)

[ai_service] api_tokens (4) ── X-DNA-Token ──▶ /api/v1/query
     └─▶ getApiTokenCallerRole(email) ต้องเป็น admin-tier ──▶ dispatcher read commands
          └─▶ DATA: ข้ามระบบ/ข้ามบริษัท (ไม่มี org)

[LINE] line_user_id ── x-line-signature (HMAC) ──▶ line-webhook-v2 (service role)
     └─▶ company_line_links / connect_external_identities (trust_level + permissions JSON)
          └─▶ DATA: เฉพาะ company ที่ผูก LINE id นั้น (มีขอบเขตจริง — ดีที่สุดในระบบ)
```

## 1.3 เส้นทาง Development (ACCOUNT → ROLE → DEV TOOL → SOURCE/RUNTIME/INFRA)

```
[A/B] super_admin (หรือ employee ในอนาคต) ── ADMIN_TIER ──▶ /api/admin/ide/file (PUT)
        └─▶ fs.writeFile ใต้ WORKSPACE_ROOT (process.cwd()) ──▶ SOURCE CODE
      ──▶ /api/admin/ide/execution/run ──▶ allowlist 16 คำสั่ง (pwd, ls, git status/diff,
              typecheck, npm test/build/lint/governance/registry.sync) ──▶ RUNTIME ของเซิร์ฟเวอร์
      ──▶ /api/admin/storage-intelligence (move_safe_to_trash = SUPER_ADMIN_ONLY)
              ──▶ ไฟล์บน homedir ของเครื่องที่รันแอป (INFRA STRUCTURE ของ host)
      ──▶ /api/admin/connectors/* (ADMIN_TIER) ──▶ ใช้ credential ที่เก็บใน vault
              (มี connector `supabase-management-api` = control-plane token, สถานะ connected)
```

---

# 2. ACCOUNT IDENTITY MATRIX

## 2.1 สามบัญชี (LIVE)

| มิติ | A `acct_39cbd71c` | B `acct_2d06e2d6` | C `acct_8de1e3b9` |
|---|---|---|---|
| auth.users | มี (confirmed, email) | มี | มี |
| profiles.role | `super_admin` | `super_admin` | `customer` |
| องค์กร (`org_members`) | org#1 **owner** | org#1 **admin** | — |
| ที่มาของ role | ถูกเปลี่ยน 2026-07-13 (ไม่มี audit) | **trigger bootstrap** (profile แรก) | ค่าเริ่มต้น signup |
| Session / JWT | Supabase session cookie; claim `role=authenticated`; **role จริงไม่ได้อยู่ใน JWT** อ่านจาก `profiles` ทุก request | เหมือน A | เหมือน A |
| API | 274 ไฟล์ / 267 admin routes | เหมือน A | `/api/explain` |
| ข้อมูล | ทุกองค์กร (86 บริษัท) | ทุกองค์กร | ไม่มี |
| AI / Connector | ทั้งหมด + ออก token | ทั้งหมด + AI coding 265 tasks | ไม่มี |
| Dev tools | IDE/exec/trash/backup/connector | เหมือน A | ไม่มี |
| จุดยกระดับสิทธิ์ | 2026-07-13 (role) + 2026-10-18 (org owner) | 2026-07-08 (bootstrap) | ไม่มี |
| ข้อมูลติดต่อ/ตัวตน | โดเมน gmail | โดเมน gmail | โดเมน `example.com` (สงวนสำหรับทดสอบ) |

## 2.2 Namespace ของ "ตัวตน" ที่แยกจากกันโดยสิ้นเชิง (LIVE)

| Namespace | จำนวน | ใช้ตัดสินสิทธิ์ | หมายเหตุ |
|---|---|---|---|
| `auth.users` / `profiles` | 3 / 3 | **ใช่** (role) | canonical identity |
| `org_members` | 2 | **ไม่** (loader พัง) | A=owner, B=admin |
| `organizations` | 1 | **ไม่** (0 readers) | สร้างโดย A 2026-10-18 |
| `identity_memberships` | 2 | **ไม่** (0 readers) | `super_admin` (world business) / `platform_owner` (world infrastructure) — **ไม่ใช่ 3 บัญชีนี้** |
| `connect_external_identities` | 12 | ใช่ (LINE path) | trust: verified 8 / unverified 3 / null 1 |
| `line_profiles` | 11 | ไม่ (ใช้ alert routing) | มี `role='owner'` 1 แถว (data fix 2026-07-27) |
| `api_tokens` | 4 (active 3) | ใช่ (machine) | scope `read`, โดเมนเดียว, ใช้ล่าสุด 2026-08-04 |
| `workspace_locks` | 20 | ไม่ | holder เป็น label (`claude-hcg-p2`, `session-A-actor`, `owner-account`) — **ไม่ใช่ account id** |
| `dev_loop_sessions` | 2 | ไม่ | owner = `codex-real-integration-test` |
| `audit_logs.actor_user_id` | 9 จาก 4,848 | ใช่ (ถ้ามี) | 0.19% coverage |

**ข้อสรุป §2:** ระบบมี "ตัวตน" 6 ชั้นที่ไม่ตรงกัน และมีเพียงชั้น `profiles.role` กับ `api_tokens` เท่านั้นที่มีผลจริง — **การตรงกันของอีเมลไม่เคยถูกใช้เป็นเกณฑ์ให้สิทธิ์ภายใน DNA OS** (ยกเว้น email-fallback ของ identity layer ที่ map ไป *โปรไฟล์เดียวกัน* ไม่ได้ให้ role ใหม่) `S` `core/identity/identity.ts:79-90`

## 2.3 Trigger / Migration ที่กำหนด role

| Migration | สถานะ apply | พฤติกรรม |
|---|---|---|
| `20260708000001_profiles_roles.sql:34-66` | **APPLIED** `R` | profile แรก → `super_admin`; ที่เหลือ → `customer`; **ไม่มี guard อีเมลซ้ำ** |
| `20260927000001_identity_email_federation.sql:38-58` | **NOT APPLIED** `R` | เพิ่ม guard "อีเมลเดิม = คงโปรไฟล์เดิม" + bootstrap ยังอยู่ |
| `20261024000001_public_signup_never_bootstrap_super_admin.sql` | **NOT APPLIED** `R` | ตัด bootstrap ทิ้งทั้งหมด (ทุก signup = customer) |

→ **Runtime วันนี้ยังใช้เวอร์ชัน 2026-07-08** = ถ้า `profiles` ว่างเมื่อใด ผู้สมัครรายแรกจาก `/register` สาธารณะจะได้ `super_admin` ทันที (**RISK**)

---

# 3. ROLE AND PERMISSION MATRIX

## 3.1 บทบาทที่มีจริง (6 ค่าใน enum `app_role`)

| Role | จำนวนบัญชีจริง | หน้าจอ | ข้อมูล | AI | Connector | Dev tools | หมายเหตุ |
|---|---|---|---|---|---|---|---|
| `super_admin` | **2** | `/admin/**` ทั้งหมด | **ทุกองค์กร (ไม่จำกัด)** | ✅ | ✅ | ✅ | ไม่มี org scope |
| `admin` | **0** | `/admin/**` | ทุกองค์กร | ✅ | ✅ | ✅ | แตกต่างจาก super_admin เฉพาะ 13 route |
| `employee` | **0** | `/admin/**` | ทุกองค์กร | ✅ | ✅ | ✅ | **อันตรายเชิงโครงสร้าง** ถ้ามีคนถูกตั้ง |
| `partner` | 0 | `/partner`,`/business` | (ไม่มีข้อมูล) | — | — | — | ยังไม่มีผู้ใช้ |
| `customer` | **1** (C) | `/user` (static) | ไม่มี | ❌ | ❌ | ❌ | ปลอดภัยตามดีไซน์ |
| `ai_service` | 0 (ใช้ token ไม่ใช่ profile) | — | อ่านตาม `scope` | ✅ (read) | — | — | token 4 ใบ |

## 3.2 สิ่งที่ role หนึ่ง "ได้มาโดยอัตโนมัติ" (จุดสำคัญของผู้ว่าจ้าง)

| ถาม | คำตอบ | หลักฐาน |
|---|---|---|
| super_admin อ่านข้อมูลทุกองค์กรโดยอัตโนมัติหรือไม่ | **ใช่ — โดยพฤตินัย** (ไม่ใช่โดย `resolveAuthority` แต่โดย service role + ไม่มี org filter) | `S` 77/267 routes · `L` ข้อมูล 86 บริษัท |
| super_admin แก้ Source Code ได้หรือไม่ | **ได้ (ในโค้ด)** ผ่าน `ide/file` PUT | `S` |
| role `developer` มีหรือไม่ | **ไม่มี** — มีแต่ label ของ agent ใน log | `S` |
| `owner` มีผลต่อสิทธิ์หรือไม่ | **ไม่มี** (ทั้ง org_members / line_profiles / identity) | `S`+`L` |
| มีระบบสิทธิ์คู่ขนานหรือไม่ | **มีอยู่แล้ว 2 ชุด**: `permissions.json` (route tier) กับ `core/authority/resolve.ts` (resource ownership) — **ไม่ควรสร้างชุดที่ 3** | `S` |

---

# 4. SOURCE CODE / API ACCESS MAP

| # | SOURCE FILE:LINE | ผู้มีสิทธิ์ | ปลายทาง | วิธีตรวจ | service role | ตรวจ org | ข้ามองค์กร | เขียนได้ | สถานะ |
|---|---|---|---|---|---|---|---|---|---|
| A1 | `middleware.ts:17,29` | ทุกคน | ทุกหน้า/API ที่ขึ้นต้น prefix | session เท่านั้น | – | ❌ | – | – | `S` |
| A2 | `core/auth/requireAuth.ts:24` | ตาม `allowedRoles` | route | `role ∈ tier` | – | ❌ | – | – | `S` |
| A3 | `core/auth/requireAuthPage.ts:16` | ตาม role | page/layout | เหมือน A2 | – | ❌ | – | – | `S` |
| A4 | `app/api/admin/transactions/route.ts:19-27` | ADMIN_TIER | `customer_orders` + `companies` | tier | **ใช่** | ❌ | **ใช่** | ✅ | `S` |
| A5 | `app/api/admin/documents/route.ts` | ADMIN_TIER | `documents`/`document_versions` | tier | **ใช่** | ❌ | **ใช่** | ✅ | `S` |
| A6 | `app/api/admin/backup/route.ts:20,63` | SUPER_ADMIN | 10 ตารางทุกบริษัท | tier | **ใช่** | ❌ | **ใช่** | export | `S` |
| A7 | `app/api/admin/upload/route.ts:68,99` | ADMIN_TIER | bucket `attachments` (signed URL 5 นาที / remove) | tier | **ใช่** | ❌ | **ใช่** (ถ้ารู้ path) | ✅ | `S` |
| A8 | `app/api/admin/relationships/[relationshipId]/route.ts:52,109,289` | ADMIN_TIER | signed URL ของ media ใดก็ได้ | tier | **ใช่** | ❌ | **ใช่** | – | `S` |
| A9 | `app/api/admin/ide/file/route.ts:36,109` | ADMIN_TIER | Source Code (`WORKSPACE_ROOT`) | tier | – | ❌ | n/a | **✅ แก้ไฟล์** | `S` |
| A10 | `app/api/admin/ide/tree/route.ts:23` | ADMIN_TIER | ทั้ง repo | tier | – | ❌ | n/a | – | `S` |
| A11 | `app/api/admin/ide/execution/run/route.ts:47` | ADMIN_TIER | process (16 คำสั่งปิด) | tier + allowlist + `isCommandDenied` | – | ❌ | n/a | รัน | `S` |
| A12 | `app/api/admin/workspace/route.ts:19-20` | SUPER_ADMIN | ไฟล์ workspace (ย้าย+trash) | tier | – | ❌ | n/a | ✅ | `S` |
| A13 | `app/api/admin/storage-intelligence/route.ts:28` | SUPER_ADMIN | homedir ของ host | tier | – | ❌ | n/a | **ลบไฟล์ host** | `S` |
| A14 | `app/api/admin/users/[id]/role/route.ts:35` | SUPER_ADMIN + earliest | `profiles.role` | tier + data rule | **ใช่** | ❌ | – | ✅ (ไม่มี audit) | `S` |
| A15 | `app/api/v1/query/route.ts:80` | token (email admin-tier) | ทุกตารางผ่าน dispatcher | token + email role | **ใช่** | ❌ | **ใช่** | read เท่านั้น | `S` |
| A16 | `engines/canonical/document-write.ts:154,246` | ผู้เรียก (route) | `document_canonical` + RPC | **ไม่มี authz ภายใน** | **ใช่** | ❌ | **ใช่** | ✅ | `S` |
| A17 | `engines/canonical/audit.ts:78` | ผู้เรียก | `audit_logs` | – | **ใช่** | ❌ | – | ✅ (`actor_user_id: null`!) | `S` |
| A18 | `core/authority/resolve.ts:118-166` | actor context | price/site/authority | ownership + grant + org match | – | ✅ (ถ้ามี org) | ❌ | ตาม grant | `S` |
| A19 | `engines/authority/load.ts:46` | – | `org_members` | **คอลัมน์ผิด** → `[]` | **ใช่** | พยายาม | – | – | `S`+`L` |
| A20 | `supabase/functions/line-webhook-v2/index.ts:67` | LINE (HMAC) | company ที่ผูก LINE id | signature + `company_line_links` | **ใช่** | ✅ (company) | ❌ | ✅ | `S`+`R` |
| A21 | `supabase/functions/_shared/connect-price.ts:40` | Edge function → เว็บ | `/api/internal/connect/*` | shared secret | – | – | – | ✅ | `S` (แต่ปลายทาง 402 `R`) |
| A22 | `services/supabase/api-tokens.ts:47` | token | `api_tokens` | token string | **ใช่** | ❌ | – | – | `S` |

---

# 5. CROSS-TENANT EXPOSURE MATRIX

| # | ช่องทาง | ใครเอาเปรียบได้ | ข้อมูลที่ออก | พิสูจน์ได้แค่ไหน | สถานะ |
|---|---|---|---|---|---|
| X1 | Admin list APIs (A4/A5) | super_admin, admin, employee | เอกสาร/คำสั่งซื้อ/บริษัท ของ 86 บริษัท | อ่านโค้ด + จำนวน route (26 อ้าง company_id, 0 อ้าง organization_id) | **FAIL** |
| X2 | Backup export (A6) | super_admin | 10 ตาราง ทุกบริษัท (≤50k แถว/ตาราง) | อ่านโค้ด | **FAIL** |
| X3 | Signed URL ของ attachment (A7/A8) | ADMIN_TIER | ไฟล์/รูปของผู้ใช้อื่น (ถ้ารู้ path) | อ่านโค้ด — ไม่ได้เปิดไฟล์จริง | **FAIL (เชิงเส้นทาง)** |
| X4 | Canonical write จาก route (A16) | ADMIN_TIER | เขียนเอกสารเข้าบริษัทใดก็ได้ | อ่านโค้ด | **FAIL** |
| X5 | Machine token (A15) | ผู้ถือ token | อ่านข้ามระบบ | อ่านโค้ด + `L` 4 token | **FAIL** |
| X6 | Aggregate/รายงาน | – | **ยังไม่มีเส้นทาง aggregate** | grep | N/A (จะกลายเป็น FAIL ถ้าทำไม่ถูก) |
| X7 | RLS ตรง (anon) | – | 0 แถว | `L` 7 ตาราง | **PASS** |
| X8 | RLS ตรง (customer) | – | profile ตัวเอง | ตรวจไม่ได้ (ไม่มี session) | **NV** |
| X9 | RLS ระดับตาราง (authenticated) | – | 108/118 ตารางไม่มี policy ใน repo | 66 policies / 10 ตาราง | **NV → BLOCKED** |
| X10 | LINE ingress | ผู้ไม่มีสิทธิ์ภายนอก | – | HMAC + company link | **PASS** |
| X11 | IDE/Dev (A9-A13) | ADMIN_TIER | Source Code / host FS / infra | อ่านโค้ด | **FAIL (แยกอำนาจ)** |
| X12 | Connector `supabase-management-api` | ADMIN_TIER | ใช้ control-plane credential ของ Supabase | `L` connected | **FAIL** |

**หมายเหตุวิธีพิสูจน์:** ไม่มีการเปิดอ่านข้อมูลจริงของผู้ใช้เพื่อทดสอบ — ทุกข้อ X1-X5 พิสูจน์จาก **โค้ด (ไม่มี org filter)** + **โครงสร้าง DB (0 organization_id ใน 267 routes)**; การทดสอบจริงต้องทำบน **staging ด้วยข้อมูลสังเคราะห์** ตาม §10

---

# 6. DEVELOPMENT ACCESS SEPARATION

## 6.1 การจัดประเภทตามคำสั่ง §03 (A/B/C)

| ประเภท | รายการ | สถานะ |
|---|---|---|
| **A. เครื่องมือพัฒนาภายนอก** (ไม่เกี่ยวกับบัญชี DNA OS) | GitHub repo/PAT (connector `github-dna-os-infrastructure` **disconnected** `L`) · Vercel account (`vercel-binding.ts` อ่าน `VERCEL_TOKEN` แต่ **ไม่มี route เรียก** `S`) · Supabase CLI/Management (นอกแอป) · Cline/AI coding บน Mac · Terminal local | **PASS — แยกอยู่แล้ว** |
| **B. ความสามารถบริหารธุรกิจ** | documents, invoices, debt, jobs, pits, people, accounting, reports | **PASS** |
| **C. จุดที่สิทธิ์ผู้ใช้เชื่อมกับเครื่องมือพัฒนา** | C1 `ide/file` PUT (แก้ Source) · C2 `ide/execution/run` (รัน npm) · C3 `ide/tree`+`search` · C4 `backup` · C5 `move_safe_to_trash` · C6 `workspace approve/execute` · C7 `devices/commands` (`managed.run`) · C8 connector Supabase Management API | **FAIL — ต้องแยก** |

## 6.2 ทำไม C1-C3 รุนแรงเชิงโครงสร้าง (แต่ยังไม่เกิดจริง)

1. `ADMIN_TIER` รวม `employee` → พนักงานทั่วไปแตะ Source Code ได้
2. กัน secret ได้ดี (`.env/.pem/.key/credential/secret`, `.git/node_modules` — `fsSecurity.ts:63`) แต่ **ไม่ได้กัน source**
3. `PUT` แก้ไฟล์ที่มีอยู่ + `npm test/build` อยู่ใน allowlist → แก้ไฟล์ test แล้วรัน = โค้ดใหม่รันบนเซิร์ฟเวอร์ (**design chain** ไม่ใช่ช่องโหว่ที่ถูกใช้)
4. **ยังไม่เกิด** เพราะเว็บปิด (402) และ Vercel FS ไม่คงอยู่ → surface นี้จริงเฉพาะ runtime ที่มี persistent workspace

## 6.3 สิ่งที่พิสูจน์ได้ว่า "ไม่มี" (ลดความกังวล)

ไม่มี SQL/RPC execution route · ไม่มี shell อิสระ (16 คำสั่งปิด) · deployment plan ไม่ deploy จริง (`deploymentRuntime.ts:3-8`) · connector test คืน `redactConnector` · device command มีชุดปิด `managed.run` + `scoped_grants`

---

# 7. TARGET AUTHORITY DESIGN (PROPOSAL)

> หลักการ: **ไม่สร้างระบบสิทธิ์ที่ 3** — ต่อยอดจาก 2 ชุดที่มีอยู่: (ก) `registry/permissions.json` = "ใครเข้า route ไหนได้" (ข) `core/authority/resolve.ts` + `engines/authority/load.ts` = "ใครทำอะไรกับ resource ของใครได้" · สิ่งที่เพิ่มคือ **organization scope ที่บังคับใช้จริง** และ **การแยก principal ของงานพัฒนา**

## 7.1 ห้าตัวตนเป้าหมาย

| ตัวตน | เก็บที่ไหน | ได้อะไร | ไม่ได้อะไร |
|---|---|---|---|
| **A. ผู้ใช้ส่วนบุคคล** (`customer`) | `profiles.role=customer` | ข้อมูลของตัวเอง, เอกสาร/ไฟล์ที่ตนมีสิทธิ์ | ข้อมูลองค์กรอื่น, source, infra |
| **B. ผู้ใช้องค์กร** (`org_owner`/`org_admin`/`org_staff` → ใช้ `org_members.role`) | `profiles.role=admin|employee` + `org_members` | ข้อมูล **ในองค์กรของตน** ตามบทบาท | องค์กรอื่น, source, infra |
| **C. Platform Owner / Viewer** | ใหม่: `platform_viewer` (หรือ reuse `super_admin` แบบจำกัดมาก) | **aggregate only**: จำนวนผู้ใช้, ปริมาณประมวลผล, ต้นทุน, สถานะ API/AI/Server/Storage, กราฟ/รายงานที่อนุญาต | ข้อมูลรายคน/เอกสาร, ตารางดิบ, source, deploy |
| **D. Development Authority** | **principal ภายนอก DNA OS**: GitHub + dev tool + infra credential (ไม่ใช่ session ของแอป) | repo, CI, infra ตามที่ได้อนุญาต | ข้อมูลธุรกิจผู้ใช้โดยอัตโนมัติ (ต้องมี test data แยก) |
| **E. System Service Identity** | `api_tokens` (scope) + Edge function service role | งานที่ระบุชัด (ประมวลผล LINE/webhook) | อ่านทุกองค์กรโดยปริยาย; ต้องมี audit ทุกครั้ง |

## 7.2 TARGET AUTHORITY MATRIX

| ความสามารถ | A ส่วนบุคคล | B องค์กร | C Platform | D Dev | E Service |
|---|---|---|---|---|---|
| อ่านข้อมูลธุรกิจของตัวเอง | ✅ | ✅ | ❌ | ❌ | ตามงาน |
| อ่านข้อมูลองค์กรอื่น | ❌ | ❌ | ❌ | ❌ | ❌ |
| สร้าง/แก้เอกสารในองค์กร | เฉพาะของตน | ✅ ตามบทบาท | ❌ | ❌ | ตามงาน |
| จัดการสมาชิกองค์กร | ❌ | เฉพาะ owner | ❌ | ❌ | ❌ |
| ดูจำนวนผู้ใช้/ประเภท (aggregate) | ❌ | เฉพาะองค์กรตน | ✅ | ❌ | ❌ |
| ดูต้นทุน/ปริมาณประมวลผล | ❌ | เฉพาะองค์กรตน | ✅ | ❌ | ❌ |
| เปิดตาราง DB ดิบ | ❌ | ❌ | ❌ | ❌ | ❌ |
| อ่าน/แก้ Source Code | ❌ | ❌ | ❌ | ✅ (นอกแอป) | ❌ |
| Execute command | ❌ | ❌ | ❌ | ✅ (นอกแอป/CI) | ❌ |
| จัดการ Deployment | ❌ | ❌ | ❌ | ✅ (CI/CD ที่อนุญาต) | ❌ |
| ใช้ AI/Connector | ✅ ตามบริการ | ✅ ตามองค์กร | ดูสถานะเท่านั้น | ทดสอบกับ test data | ✅ ตาม scope+org |

## 7.3 กติกาการตัดสิน (ใช้ `resolveAuthority` เดิม)

| กติกา | ความหมาย | สถานะ |
|---|---|---|
| R-A | role ไม่ใช่อำนาจ (ต้องมี ownership หรือ grant) | **มีแล้ว** `resolve.ts:160` |
| R-B | ถ้า resource มี `organizationId` → grant ต้องมี org เดียวกันและ actor ต้องเป็นสมาชิก | **มีแล้ว** `resolve.ts:148-152` |
| R-C | **ทุก admin API ต้องมี org scope** (ดูจาก path/body → ตรวจ membership → ใส่ `.eq(company_id)`) | **ต้องเพิ่ม** (P) |
| R-D | service role ใช้ได้เฉพาะหลังผ่าน R-C และต้องเขียน audit ทุกครั้ง | **ต้องเพิ่ม** (P) |
| R-E | aggregate endpoint ต้องคืนเฉพาะ count/sum ที่ไม่ระบุตัวตนได้ (ขั้นต่ำ k=5) และห้าม join ข้อมูลส่วนบุคคล | **ต้องเพิ่ม** (P) |
| R-F | dev surface (IDE/exec/trash/backup) **ไม่ผูกกับ role ของผู้ใช้** — ใช้ principal แยก + network boundary | **ต้องเพิ่ม** (P) |

---

# 8. IMPACT ANALYSIS (CURRENT → TARGET)

| พื้นที่ | เส้นทางปัจจุบัน | ความเสี่ยง | เป้าหมาย | Dependency | สิ่งที่ต้อง migrate |
|---|---|---|---|---|---|
| Login / Session | `session.ts` อ่าน role จาก DB ทุก request | ต่ำ (เปลี่ยน role มีผลทันทีโดยไม่ต้อง re-login) | คงเดิม + เพิ่ม org context ใน loader | `profiles`, `org_members` | แก้ loader คอลัมน์ (ไม่แตะข้อมูล) |
| Landing | `workspace_landing` ผูกกับ key ของ role | ถ้าลบ role ต้องมี key ใหม่ | เพิ่ม mapping โดยไม่ลบของเดิม | `permissions.json` | แก้ registry (data-only) |
| ผูกบัญชีกับองค์กร | ไม่มี API สร้าง/แก้ `org_members` (0 writers) | สมาชิกใหม่ต้องแก้ DB มือ | เพิ่ม org-scoped membership API | `org_members` | เพิ่ม route ใหม่ (หลัง gate ผ่าน) |
| เอกสาร/ไฟล์ | `document-write.ts` ไม่ตรวจ org | **ข้ามองค์กร** | route ตรวจ org ก่อนเรียก canonical | canonical engines | ห่อ guard ที่ route (ไม่แตะ engine) |
| AI Gateway | `/api/v1/query` ใช้ email role | token อ่านข้ามระบบ | token ผูก org + scope | `api_tokens` | เพิ่ม `organization_id` ใน token (เพิ่มคอลัมน์) |
| Connect Gateway | LINE path มี company scope อยู่แล้ว | ต่ำ | คงเดิม + audit actor | edge functions | เพิ่ม audit (ไม่แตะ flow) |
| LINE OA | signature ตรวจแล้ว | ต่ำ | คงเดิม | – | – |
| Canonical APIs | ทำงานถูกต้องทางธุรกิจ | ถ้าใส่ guard ผิดจะทำให้ออกเอกสารไม่ได้ | เพิ่ม guard **ก่อน** engine | – | ต้องมี regression test ก่อน/หลัง |
| บัญชี/ธุรกรรม | canonical + RPC | สูงถ้าแตะ | **ห้ามแก้ path** | – | 0 (ห้ามแตะ) |
| Background Jobs | `jobs` + cron functions ใช้ service role | ไม่มี org | คงเดิม (ระบบ) แต่เพิ่ม audit | edge functions | ไม่ต้องย้ายข้อมูล |
| Production Runtime | Vercel ปิดอยู่ | – | เปิดหลังผ่าน gate เท่านั้น | – | – |
| Existing Data | 86 companies / 495 receipts | ห้ามย้ายข้าม tenant | **ไม่ย้ายข้อมูล** | – | 0 (zero data migration) |
| Storage | bucket เดียว private + signed URL | ข้ามองค์กรถ้ารู้ path | path ต้องมี org prefix + ตรวจก่อน sign | `attachments` | **ไม่ย้ายไฟล์**; ตรวจสิทธิ์ตอนออก signed URL |
| สมาชิกองค์กร | ไม่มี UI | – | org owner จัดการได้ | `org_members` | เพิ่ม UI/API ภายหลัง |

**ยืนยันข้อห้าม:** ไม่มี Writer ใหม่ · ไม่แตะ Canonical Finance Path · ไม่ย้ายข้อมูลข้าม Tenant · ไม่ลบ role ใดก่อน dependency ครบ

---

# 9. DEPENDENCY AND MIGRATION ORDER

| เฟส | งาน | ต้องผ่านก่อน | ผลต่อข้อมูล | ย้อนกลับได้ |
|---|---|---|---|---|
| **P0** | ตรวจ/ยืนยันสภาพจริงซ้ำ (migration drift, trigger version, policy) | – | ไม่มี | – |
| **P1** | แก้ `engines/authority/load.ts` (`profile_id`→`user_id`) + unit test | P0 | **อ่านเท่านั้น** | revert ไฟล์เดียว |
| **P2** | เพิ่ม org scope ใน admin routes (read-only ก่อน) + audit ทุกครั้ง | P1 | อ่านเท่านั้น | feature-flag ปิดกลับ |
| **P3** | เพิ่ม audit ใน role assignment + backup + export | P1 | เขียน audit เพิ่ม | ปิด flag |
| **P4** | ปิด Dev surface จาก Business Workspace (IDE/exec/trash/backup) → ย้ายไป principal แยก | P2 | ไม่มี | เปิด route เดิมกลับได้ |
| **P5** | Platform aggregate endpoints (count/sum, k≥5) | P2 | อ่านเท่านั้น | ปิด route |
| **P6** | เปลี่ยน role ของ 3 บัญชี (A/B) + org membership ให้ตรงเป้า | P2,P3,P4 | **ไม่แตะข้อมูลธุรกิจ** | revert role ใน 1 คำสั่ง (มี audit แล้ว) |
| **P7** | เปิด Production + gate test §10 ครบ | ทั้งหมด | – | rollback plan §11 |

**หลักการลำดับ:** *อ่าน → จำกัด → บันทึกหลักฐาน → แยก dev → aggregate → เปลี่ยน role → เปิด* (เปลี่ยน role เป็นขั้นสุดท้ายก่อนเปิด เพราะกระทบทุกRouteพร้อมกัน)

---

# 10. PRODUCTION SECURITY TEST PLAN

> ทดสอบบน **staging** (`zjhgysugbmyyciatmltv`, 0 functions) ด้วย **ข้อมูลสังเคราะห์ 2 องค์กร (Org-A, Org-B) + 2 ผู้ใช้ (User-A, User-B)** — **ห้ามใช้ข้อมูลจริง** ตามข้อห้าม

## 10.1 Gate 12 ข้อ → วิธีทดสอบ + เกณฑ์ผ่าน

| # | เกณฑ์ | วิธีทดสอบ (positive) | วิธีทดสอบ (negative) | ผ่านเมื่อ |
|---|---|---|---|---|
| G1 | เจ้าของล็อกอินเป็นผู้ใช้ขององค์กรตัวเองได้ | login A → GET `/api/admin/documents` | – | 200 + เห็นเฉพาะ Org-A |
| G2 | อีเมลบริษัท DNA OS ไม่ได้สิทธิ์อ่านผู้อื่นอัตโนมัติ | login บัญชี ops → GET list | ยิงข้าม org id | 403 หรือผลว่าง (ไม่ใช่ 200 + ข้อมูล Org-B) |
| G3 | Platform Owner เห็นเฉพาะข้อมูลสรุป | GET `/api/platform/metrics` | ขอ row-level (`/api/admin/companies`) | เห็นเฉพาะ count/sum, ไม่มีชื่อ/เบอร์/เอกสาร |
| G4 | User A อ่าน/แก้ข้อมูล User B ไม่ได้ | A อ่านของ A (200) | A อ่าน/แก้ resource ของ B | 403/404 ทั้งอ่านและเขียน |
| G5 | Org owner A อ่าน Org B ไม่ได้ | owner-A อ่าน Org-A | owner-A อ่าน Org-B (ทุก entity) | 403/404 ทุกกรณี |
| G6 | AI/Connector ไม่ข้ามองค์กร | token ของ Org-A query | token Org-A ขอข้อมูล Org-B | ผลว่าง/403 + audit |
| G7 | Service role ตรวจสิทธิ์ก่อนอ่าน/เขียน | ปกติ 200 | เรียก route ด้วย role ต่ำ | 403 ก่อนถึง DB (พิสูจน์จาก log ว่าไม่มีการ query) |
| G8 | Business Workspace ไม่มีทางแก้ Source/Exec/Deploy | หน้า admin ใช้งานธุรกิจได้ | เรียก `/api/admin/ide/*`, `execution/run`, `backup` | 404/403 ทุกเส้น |
| G9 | Canonical Path เดิมยังทำงาน | ออกเอกสาร/รับชำระ/ออกใบกำกับ (staging) | – | ผลเหมือนก่อนแก้ (regression suite) |
| G10 | Login/API/DB/Storage/AI ผ่านทั้งบวกและลบ | ตาม G1-G8 | ตาม G1-G8 | ครบทุกชั้น |
| G11 | ไม่มี PII ในกราฟ/รายงาน/สถิติ | เปิดทุก dashboard | ตรวจ payload | ไม่มีชื่อ/เบอร์/อีเมล/เลขบัญชี/ไฟล์ |
| G12 | Rollback ไม่ทำข้อมูลหาย | ซ้อม rollback บน staging | – | ข้อมูลครบ 100% หลัง rollback |

## 10.2 Test data ที่ต้องสร้าง (staging เท่านั้น — ยังไม่สร้างในรอบนี้)

Org-A, Org-B (แยกขาด) · User-A (member Org-A), User-B (member Org-B) · owner-A, owner-B · platform-viewer · service token ผูก Org-A · เอกสาร 2 ใบ (org ละใบ) · ไฟล์แนบ 2 ไฟล์ · debt 2 รายการ

## 10.3 หลักฐานที่ต้องเก็บต่อ test

`request_id` + `actor_user_id` (ต้องไม่ null) + `organization_id` + ผล 200/403 + หลักฐานว่า **ไม่มีการ query ข้าม org** (log/shape เท่านั้น ไม่เก็บเนื้อข้อมูล)

---

# 11. ROLLBACK PLAN

| ระดับ | มาตรการ | เงื่อนไข |
|---|---|---|
| R0 | **ไม่มีการย้าย/ลบข้อมูล** ในทุกเฟส → rollback = revert โค้ด/flag | ตลอดโครงการ |
| R1 | Feature flag ต่อ capability (`ORG_SCOPE_ENFORCE`, `DEV_SURFACE_OFF`, `PLATFORM_AGG_ONLY`) | เปิด/ปิดได้โดยไม่ deploy |
| R2 | Role เปลี่ยนแบบ additive + audit → ย้อนกลับได้ด้วย PATCH เดียว (หลัง P3 มี audit) | ถ้า login พัง |
| R3 | DB เปลี่ยนเฉพาะ **เพิ่มคอลัมน์/ตาราง** (ไม่ drop/rename) | ถ้าต้องถอย |
| R4 | Backup ก่อนเปลี่ยน: `pg_dump` เฉพาะ schema + export `profiles`/`org_members` (ไม่ใช่ข้อมูลลูกค้า) | ก่อน P6 |
| R5 | เกณฑ์ตัดสินถอย: G1/G4/G5/G9 ข้อใด FAIL บน Production → ปิด flag ทันที | ทันที |

---

# 12. PASS / FAIL / BLOCKED / NOT VERIFIED REPORT

## 12.1 สรุปตามเกณฑ์ 12 ข้อ (สถานะปัจจุบัน ก่อนแก้)

| Gate | สถานะวันนี้ | เหตุผล |
|---|---|---|
| G1 ล็อกอินองค์กรตัวเอง | **NOT VERIFIED** | ไม่มี org scope ใน API; ไม่มี UI/API membership |
| G2 อีเมลบริษัทไม่อ่านผู้อื่นอัตโนมัติ | **FAIL** | ทุก admin-tier เห็นทุกองค์กร |
| G3 Platform Owner เห็นแต่สรุป | **FAIL** | ไม่มี aggregate endpoint; มีแต่ route ดิบ |
| G4 A อ่าน/แก้ของ B ไม่ได้ | **FAIL** | canonical write รับ `customer_company_id` จาก body |
| G5 Org owner A อ่าน Org B ไม่ได้ | **FAIL** | 0/267 routes ตรวจ `organization_id` |
| G6 AI/Connector ไม่ข้ามองค์กร | **FAIL** | token ผูก email ไม่ผูก org |
| G7 Service role ตรวจสิทธิ์ก่อน | **FAIL** | ตรวจแค่ tier ที่ route |
| G8 Business Workspace ไม่มี dev path | **FAIL** | 166 IDE routes ที่ ADMIN_TIER |
| G9 Canonical path เดิมทำงาน | **PASS** | `S` — ยังไม่มีการแก้ |
| G10 ทดสอบบวกลบครบทุกชั้น | **BLOCKED** | ต้องมี test data + staging run |
| G11 ไม่มี PII ในกราฟ/รายงาน | **NOT VERIFIED** | ยังไม่มี aggregate surface ให้ตรวจ |
| G12 Rollback ไม่ทำข้อมูลหาย | **PASS (แผน)** | ไม่มีการย้ายข้อมูลในแผน |

## 12.2 ผลลัพธ์รวม

**BLOCK Production Release** สำหรับความสามารถที่แตะข้อมูลข้ามองค์กร (G2,G4,G5,G6,G7) และสำหรับ Dev surface ใน Business Workspace (G8) จนกว่าจะผ่าน §10 บน staging

---

# FINAL DECISION REQUIRED — คำตอบตรง ๆ

### 1) เส้นทางสิทธิ์เดิมส่วนใดต้องปิด
**ปิดจาก Business Workspace ทันทีเมื่อพร้อม (P4):** `/api/admin/ide/**` ทั้ง 166 routes · `/api/admin/backup` · `/api/admin/storage-intelligence` (`move_safe_to_trash`, `inspect_docker`) · `/api/admin/workspace` (`approve/execute_migration`) · connector `supabase-management-api` (ให้ ADMIN_TIER ใช้)
เหตุผล: เป็นเส้นทาง **C** ที่เชื่อม role ธุรกิจกับ Source Code / host FS / infra credential โดยตรง

### 2) เส้นทางใดต้องคงไว้
- Canonical business path ทั้งหมด (documents/invoices/debt/jobs/pits/people) — **ห้ามแตะ**
- LINE/Connect ingress (มี company scope + HMAC อยู่แล้ว)
- `/api/explain` (ANY_AUTHENTICATED) และหน้า `/user`
- Role guard L2 (`requireAuth`) และ `resolveAuthority` — ใช้ต่อ ไม่สร้างใหม่

### 3) เส้นทางใดต้องปรับให้จำกัดตามองค์กร
ทุก admin data route ที่ใช้ service role (77 routes) → เพิ่ม org scope (อ่านก่อน แล้วค่อยบังคับเขียน) · signed URL ของ storage → ตรวจ org ก่อนออก URL · `/api/v1/query` → token ต้องผูก org · AI/Connector → scope ตาม org

### 4) บัญชีทั้ง 3 ต้องเปลี่ยนบทบาทอย่างไรโดยไม่สูญเสียข้อมูล
| บัญชี | วันนี้ | เป้าหมาย (P6) | ข้อมูลที่สูญหาย |
|---|---|---|---|
| **B `acct_2d06e2d6`** | super_admin + org admin | **คง `super_admin` เป็น "Platform Owner" ชั่วคราว** (เป็น earliest → เป็นผู้ให้สิทธิ์รายเดียว) + เพิ่มข้อจำกัด: เห็นเฉพาะ aggregate | **0** (ไม่แตะข้อมูล) |
| **A `acct_39cbd71c`** | super_admin + org owner | **ลดเป็น `admin`** + คง `org_members.role='owner'` | **0** (role เปลี่ยน ไม่กระทบข้อมูล/เอกสารที่มีอยู่) |
| **C `acct_8de1e3b9`** | customer (ทดสอบ) | **คงเดิม** (ห้ามปิดบัญชีตามข้อห้าม) — เจ้าของตัดสินภายหลังว่าจะลบหรือไม่ | 0 |
> ถ้าเจ้าของยืนยันว่า **A คือตัวจริง**: สลับก่อน — ให้ B (`super_admin` คนแรก) เลื่อน A เป็น `super_admin` แล้วจึงลด B เป็น `admin` (ทำได้ผ่าน route ที่มีอยู่ + audit หลัง P3)

### 5) จะตัดสิทธิ์พัฒนาออกจาก Business Workspace อย่างไร
4 ขั้น: (1) ปิด route ทั้ง 5 กลุ่มด้วย flag `DEV_SURFACE_OFF` (2) ย้าย principal → GitHub/CI + dev machine (มีอยู่แล้วนอกระบบ) (3) ถ้าจำเป็นต้องมีในระบบจริง ให้เปิดเฉพาะ **loopback + dev build** (มี precedent: `isLocalReviewRequest`) (4) เก็บ `ADMIN_TIER` ไว้เฉพาะงานธุรกิจ — **ไม่แตะข้อมูลหรือ canonical path**

### 6) จะให้ Platform Owner เห็นภาพรวมโดยไม่เห็นข้อมูลผู้ใช้ได้อย่างไร
สร้าง **aggregate-only surface** ใหม่ (P5) ที่อ่านจากตารางที่มีอยู่แล้ว: จำนวนผู้ใช้ตาม role/org, จำนวนเอกสาร/ธุรกรรม (count), `worker_usage_events` (tokens/latency), `subscription_services` + `supabase_billing_events` (ต้นทุน), สถานะ API/AI/storage — **คืนเฉพาะ count/sum/percent, k≥5, ไม่มี join ไปหาชื่อ/เบอร์/อีเมล/ไฟล์** และ **ห้ามมี endpoint เปิดตารางดิบให้ platform role** (ตารางดิบเป็นของ dev principal เท่านั้น)

### 7) ทดสอบและนำขึ้น Production อย่างปลอดภัยด้วยลำดับใด
`P0 ตรวจสภาพ → P1 แก้ org loader → P2 org scope (อ่าน) → P3 audit → P4 ปิด dev surface → P5 aggregate → P6 เปลี่ยน role → P7 เปิด Production หลังผ่าน G1-G12 บน staging ด้วยข้อมูลสังเคราะห์` — ทุกเฟสมี flag + rollback ตาม §11 และ **ห้ามข้าม P1 เพราะ org scope ทั้งหมดพึ่ง loader ตัวนี้**

---

## ภาคผนวก A — Evidence Index

| หลักฐาน | ที่อยู่ | ใช้ใน |
|---|---|---|
| LIVE permission snapshot | `reports/revenue-reverse-2026-10-25/permission-audit-live-2026-10-25.json` | §2, §3, §5 |
| LIVE cost/usage/attribution | `operating-cost-probe-2026-10-25.json`, `account-cost-attribution-2026-10-25.json` | §5, §7.2 |
| Production census | `production-census-2026-10-25.json` | §5 |
| รายงานก่อนหน้า | `DNAOS_SUPER_ADMIN_OWNER_PERMISSION_AUDIT.md`, `DNAOS_CURRENT_OPERATING_COST_AND_USER_USAGE_AUDIT.md` | ทั้งไฟล์ |
| สคริปต์ตรวจ | `scripts/permission-audit-readonly-probe.mjs` (GET/HEAD) | §2 |

## ภาคผนวก B — Data Provenance ของตัวเลขสำคัญ

| ตัวเลข | ที่มา | ประเภท |
|---|---|---|
| 3 บัญชี / 2 super_admin / 1 customer | GoTrue admin + `profiles` | `L` |
| 118 ตาราง / 66 policies / 10 ตารางมี policy / 77 RLS enable | OpenAPI + grep migrations | `L`+`S` |
| 267 admin routes / 77 service-role / 26 อ้าง company_id / 0 organization_id | grep | `S` |
| 166 IDE routes / 13 SUPER_ADMIN_ONLY / 274 ADMIN_TIER | grep | `S` |
| bootstrap trigger apply / hardening ไม่ apply | `supabase migration list` | `R` |
| เว็บ 402 / 21 functions ACTIVE / staging 0 functions | curl + CLI | `R` |
| audit 9/4,848 · role change 0 แถว | PostgREST | `L` |

**จบรายงาน — READ-ONLY DESIGN & SECURITY AUDIT ONLY · ไม่มีการแก้ไขใด ๆ · หยุดรอคำสั่งเจ้าของก่อนเริ่มปรับเส้นทางสิทธิ์จริง**
