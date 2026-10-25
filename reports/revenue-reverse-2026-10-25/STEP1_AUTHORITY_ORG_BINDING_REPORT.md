# STEP 1 — AUTHORITY ORG BINDING (IMPLEMENTATION REPORT)
**วันที่:** 2026-10-25 · **โหมด:** IMPLEMENT STEP 1 ONLY (ไม่ Deploy / ไม่ Commit / ไม่ Push / ไม่มี Migration / ไม่แตะข้อมูล Production)
**BASE_SHA:** `d7fbb05b2512389f384d7642fb52830d3d193fb2` (branch `gh-main`)
**สถานะไฟล์ก่อนเริ่ม (ต้องไม่ทับงานเดิม):** `core/authority/` และ `engines/authority/` เป็นไฟล์ใหม่ที่ยัง untracked (WAVE 2/3) · `engines/canonical/*`, `app/api/admin/pits/route.ts`, `app/api/admin/pits/[pitId]/materials/route.ts`, `app/api/v1/query/route.ts` มีการแก้ค้างจากรอบก่อนอยู่แล้ว · `core/auth/session.ts` สะอาด (ไม่มี diff)

---

## 01 OBJECTIVE

| งาน | เกณฑ์ผ่าน |
|---|---|
| A — แก้ Authority Loader | อ่าน `org_members.user_id` ตาม schema จริง · ไม่มี `deleted_at` · error/ไม่มีแถว → ปฏิเสธ |
| B — ผูกสิทธิ์กับตัวตนที่ยืนยันแล้ว | `session → auth.users.id → profiles.id → org_members.user_id → organization_id` · บัญชีไม่ยืนยัน/ไม่มี membership → ไม่มีสิทธิ์องค์กร · อีเมลตรงกันไม่ให้สิทธิ์ |
| C — กันการปลอมขอบเขต | body/query/header ไม่ใช่หลักฐาน · target org ต้องอยู่ใน membership · resource ใช้ org จาก DB · กำกวม → ปฏิเสธ |
| D — รักษาระบบเดิม | ไม่แตะ Canonical Writer / เอกสาร / LINE / Connect / business API · ไม่เปลี่ยน role/ข้อมูล 3 บัญชี |

---

## 02 SOURCE EVIDENCE

### 2.1 Schema ที่ยืนยันจาก Production (READ-ONLY, ก่อนแก้)

| ตาราง | คอลัมน์จริง (ยืนยันจาก PostgREST OpenAPI) |
|---|---|
| `org_members` | `organization_id, user_id, role, created_at` — **ไม่มี** `profile_id`, **ไม่มี** `deleted_at` |
| `organizations` | `id, name, created_at, created_by` |
| `companies` | `id, …, organization_id` |
| `customer_sites` | `id, customer_company_id, …` |
| `customer_orders` | `id, customer_company_id, …` |
| `pit_profiles` | `id, user_id, owner_type, …` — **ไม่มี**คอลัมน์องค์กร |

### 2.2 หลักฐานว่า query เดิมผิดจริง (ยิง Production จริง)

| Query | ผล |
|---|---|
| `org_members?select=organization_id&user_id=eq.<auth id A>` | **200** → `[{"organization_id":"1f52520a-39fa-448f-8455-9ee4c72b00b0"}]` |
| `org_members?…&user_id=eq.<auth id B>` | **200** → org เดียวกัน |
| `org_members?…&user_id=eq.<auth id C>` | **200** → `[]` |
| `org_members?…&profile_id=eq.<id>` (ของเดิม) | **HTTP 400** |
| `org_members?…&deleted_at=is.null` (ของเดิม) | **HTTP 400** |

→ ยืนยันว่าเดิม loader **error ทุกครั้ง** แล้วกลืนเป็น `[]` (silently inert) และหลังแก้ได้ org ของ A/B จริง

### 2.3 ไฟล์ที่แก้ (4 ไฟล์)

| ไฟล์ | การเปลี่ยนแปลง | ขนาด |
|---|---|---|
| `engines/authority/load.ts` | แก้ loader + เพิ่มการผูกกับ session ที่ยืนยันแล้ว + helper กันการปลอม org | 129 → 305 บรรทัด |
| `core/auth/session.ts` | เพิ่ม `resolvedBy` + `emailConfirmed` ใน `AuthedUser` และเติมค่าจาก GoTrue | +16 บรรทัด |
| `app/api/admin/pits/[pitId]/materials/route.ts` | ส่ง `sessionAccountId/resolvedBy/emailConfirmed` เข้า loader (ผู้เรียก authority รายเดียวในระบบ) | +10 บรรทัด (ไฟล์นี้มี diff ค้างจากรอบก่อนอยู่แล้ว) |
| `scripts/authority-step1-org-binding.test.ts` | ชุดทดสอบใหม่ 40 เคส (offline, ไม่มี DB/network) | ไฟล์ใหม่ |

**Diff สรุปเชิงพฤติกรรม**

1. `loadOrganizationMembership(accountId)` — อ่าน `org_members` ด้วย `.eq("user_id", accountId)` ไม่มี `.is("deleted_at")`; dedupe; คืน `{ organizations, error }`; ทุก error/รูปทรงผิด → `[]`
2. `loadOrganizationIds()` — wrapper เดิม (backward compatible) ใช้ตัวเดียวกัน
3. `loadAuthorityContext()` — รับ `sessionAccountId`, `resolvedBy`, `emailConfirmed`; ให้ org scope **เฉพาะ** เมื่อ `profileId === sessionAccountId` **และ** `resolvedBy === "id"` **และ** `emailConfirmed === true`; กรณีอื่นคืน `organizationIds: []` พร้อม reason (`SESSION_ACCOUNT_REQUIRED` / `SESSION_ACCOUNT_MISMATCH` / `EMAIL_FALLBACK_IS_NOT_AUTHORITY` / `EMAIL_NOT_CONFIRMED` / `MEMBERSHIP_LOOKUP_FAILED`)
4. `assertRequestedOrganizationAllowed(actor, requested)` — ค่าที่ขอ (จาก body/query/header) เป็นได้แค่ "คำกล่าวอ้าง" ต้องอยู่ใน `actor.organizationIds`; ว่าง = ไม่ใช่ wildcard
5. `loadResourceOrganizationId(kind, id, db)` — org ของ resource มาจาก DB ผ่าน allow-list (company → `companies.organization_id`; site/order → `customer_company_id` → `companies.organization_id`); `pit` ไม่มีคอลัมน์ org → คืน `null` (deny) ไม่เดา
6. `core/authority/resolve.ts` — **ไม่แก้แม้แต่บรรทัดเดียว** (ยัง `ROLE_IS_NOT_AUTHORITY`, `PLATFORM_ACTIONS = []`)

### 2.4 ผลทดสอบจริง

| ชุดทดสอบ | ผล | หมายเหตุ |
|---|---|---|
| `scripts/authority-step1-org-binding.test.ts` (ใหม่) | **40/40 PASS** | A1–A7, B1–B7, C1–C15, D1–D6, E1–E5 |
| `scripts/authority-resolver.test.ts` | **24/24 PASS** | regression |
| `scripts/authority-scope-and-concurrency.test.ts` | **40/40 PASS** | regression (loader ยัง fail-closed) |
| `scripts/material-price-authority.test.ts` | **45/45 PASS** | regression (price path ไม่เปลี่ยน) |
| `scripts/auth-access-test.ts` | **23/23 PASS** | session ยังเป็นเส้นเดียว |
| `scripts/identity-layer-test.ts` | **13/13 PASS** | identity layer ไม่เปลี่ยน |
| `scripts/auth-single-flow-test.ts` | **13 PASS / 1 FAIL** | **FAIL ที่มีอยู่ก่อนแล้ว** — assertion "มีหน้าเดียวที่เสนอ OAuth" พบ provider buttons ทั้ง `/login` และ `/register` (ไฟล์สองนี้ถูกแก้ก่อนรอบนี้; STEP 1 ไม่ได้แตะ) |
| `npx tsc --noEmit` | **0 error** | ทั้งโปรเจกต์ |

### 2.5 หลักฐานการผูก Session กับองค์กร

| หลักฐาน | ค่า |
|---|---|
| `core/auth/session.ts` | `resolvedBy: ctx.canonical.resolvedBy` และ `emailConfirmed: Boolean(user.email_confirmed_at ?? user.confirmed_at)` |
| Live (Production) | A → org `1f52520a-…` · B → org เดียวกัน · C → `[]` |
| Live org rows | `organizations` 1 · `org_members` 2 (A=owner, B=admin) |
| ผลทดสอบ | B1 (ได้ org), B3 (email fallback ไม่ได้), B4 (profile ≠ account ไม่ได้), B5 (email ยังไม่ยืนยันไม่ได้), B6 (ผู้เรียกที่ไม่ส่งข้อมูล session ไม่ได้สิทธิ์โดยการละเว้น) |

### 2.6 ผลทดสอบป้องกันการปลอมสิทธิ์

| การโจมตี | ผล |
|---|---|
| ส่ง `organization_id` ของ Org-B ทาง **Body** | deny `ORGANIZATION_NOT_MEMBER` (C1) |
| ทาง **Query string** | deny (C2) |
| ทาง **Header** | deny (C3) |
| ระบุ resource ของ Org-B (ไม่ส่ง org) | org ของ resource อ่านจาก DB = Org-B → deny (C7–C9) |
| ใช้อีเมลตรงกัน | org = `[]` (B3) |
| ถอน membership แล้วยิงซ้ำ | `[]` ทันที ไม่มี cache (D1) |
| `super_admin` ที่ไม่ใช่สมาชิก | org = `[]`; resolver deny `ROLE_IS_NOT_AUTHORITY` (D2–D3) |
| DB error / ตารางหาย | `[]` + reason (A3, B7, C14) |

---

## 03 RESULT — PASS / FAIL / BLOCKED / NOT VERIFIED

| หัวข้อ | ผล |
|---|---|
| A. Loader ใช้ `user_id` และไม่มี `deleted_at` | **PASS** (A5–A7 + live 200 vs 400) |
| B. org scope ผูกกับ session ที่ยืนยันแล้วเท่านั้น | **PASS** (B1–B7) |
| C. กันการปลอม org จาก body/query/header | **PASS** (C1–C3, C15) |
| C. resource ใช้ org จาก DB | **PASS** (C7–C14) |
| D. ไม่แตะ Canonical Writer / business API | **PASS** (เฉพาะ 1 call site ที่จำเป็น + รายงานแล้ว) |
| D. ไม่เปลี่ยน role/ข้อมูล 3 บัญชี | **PASS** (ไม่มี write ใด ๆ ต่อ Production) |
| resolver ยังไม่ใช้ role เป็นอำนาจ | **PASS** (D3–D6, ไฟล์ไม่ถูกแก้) |
| typecheck + regression | **PASS** (tsc 0 error, 172/172 เคสใน 6 ชุด; ยกเว้น 1 FAIL ที่มีมาก่อน) |

### 3.1 สิ่งที่ยังไม่ได้แก้ — ต้องรอ STEP 2–3 (ห้ามตีความว่าป้องกันครบแล้ว)

| # | ยังค้าง | ผลกระทบ |
|---|---|---|
| 1 | **Business API ยังไม่กรอง org** (267 admin routes, 77 ใช้ service role) | การอ่านข้ามองค์กรยังทำได้ผ่าน API เดิม — STEP 3 |
| 2 | **Dev surface ยังเข้าถึงได้** (`/api/admin/ide/**`, `backup`, `storage-intelligence`, `workspace`, `devices`) | STEP 2 |
| 3 | `super_admin` ยังผ่าน `ADMIN_TIER` ของ API ได้ | resolver ปฏิเสธเฉพาะเส้น authority — ยังไม่ใช่การปิด API |
| 4 | `audit_logs.actor_user_id` ยังเป็น `null` (`engines/canonical/audit.ts:78`) | เหตุผลการปฏิเสธยังผูกบัญชีไม่ได้ |
| 5 | `authority_grants` ไม่มีใน Production | delegation ยังไม่พร้อม (คืน `[]` ตามเดิม) |
| 6 | `admin_session` ไม่มีตาราง · role change ไม่มี audit | STEP 5 ต้องรอ |
| 7 | **`companies.organization_id` = null ทั้ง 86 แถว** (LIVE) | resource → org จะได้ `null` ⇒ deny ทุกกรณี จนกว่าจะผูกบริษัทกับองค์กร (งาน data/STEP 3 — **ไม่ใช่การแก้โค้ดใน STEP 1**) |
| 8 | `pit_profiles` ไม่มีคอลัมน์องค์กร | pit ใช้ได้เฉพาะเส้น ownership |

### 3.2 ข้อจำกัดของหลักฐาน

- ทดสอบด้วย DB double (offline) ตามแบบเดิมของ repo — **ไม่ได้**รัน HTTP กับ Production เพราะเว็บ Production ปิด (`402`) และห้ามแตะข้อมูลจริง
- Live ที่ทำได้คือ **อ่าน** schema + query รูปแบบเดียวกับที่ loader จะยิง (ผล 200/400 ตามข้อ 2.2) — ไม่มีการอ่านเนื้อหาข้อมูลผู้ใช้
- ยังไม่ได้ทดสอบด้วย session จริงของแต่ละบัญชี (ไม่มีรหัสผ่าน; ห้ามปลอม JWT)

### 3.3 ไฟล์/คำสั่งที่ไม่ได้ทำ (ตามข้อห้าม)

ไม่มี Migration · ไม่มี `supabase db push` · ไม่มี `git commit/push` · ไม่มี deploy · ไม่แก้ role/ข้อมูล 3 บัญชี · ไม่แก้ Canonical Writer · ไม่สร้าง Authority Engine ใหม่

**STEP 1 = PASS ตามเกณฑ์ · หยุดรอคำสั่ง STEP 2**
