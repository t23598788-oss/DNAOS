# DNA OS — AUTHORITY SEPARATION EXECUTION PLAN (LOCKED ORDER)
**วันที่:** 2026-10-25 · **สถานะ:** แผนอย่างเดียว — **ยังไม่มีการแก้โค้ด/DB/RLS/Role ใด ๆ**
**อ้างอิง:** `DNAOS_AUTHORITY_SEPARATION_PRODUCTION_GATE.md` (ผลตรวจ) · `DNAOS_SUPER_ADMIN_OWNER_PERMISSION_AUDIT.md` · `DNAOS_CURRENT_OPERATING_COST_AND_USER_USAGE_AUDIT.md`
**ลำดับที่ยึด:** ตามที่เจ้าของกำหนด 6 ข้อ (ไม่สลับ) — ทุกเฟสมีจุดหยุดรออนุมัติและเกณฑ์ถอยกลับ

---

## หลักที่ใช้ตลอดแผน

| หลัก | ผลต่อการลงมือ |
|---|---|
| org ต้องพิสูจน์จาก session ไม่ใช่จาก client | Step 1 ต้องมี anti-spoof test ก่อนถือว่าผ่าน |
| การปิดสิทธิ์ต้องเกิดที่ Backend (route ไม่มีอยู่/build fail) | Step 2 ห้ามใช้ flag เป็นเส้นแบ่งความปลอดภัย |
| ไม่ย้าย/ลบข้อมูลผู้ใช้ | ทุกเฟสเป็น code/guard/endpoint — **zero data migration** |
| ไม่แตะ Canonical Path (เอกสาร/เงิน/ภาษี) | guard อยู่ที่ **route boundary** ไม่ใช่ใน `engines/canonical/*` |
| ไม่สร้างระบบสิทธิ์ที่ 3 | ต่อยอด `registry/permissions.json` + `core/authority/resolve.ts` |
| ทุกเฟสต้องปิดกลับได้ | feature flag ต่อความสามารถ + revert ไฟล์เดียว/เฟสเดียว |
| `super_admin` ไม่ใช่สิทธิ์ถาวร | ถ้าจำเป็นต้องคงไว้ระหว่างเปลี่ยนผ่าน → จำกัดการใช้งานชั่วคราว และ**ถอดออกจากเส้นทางอ่านข้อมูลทุกองค์กรตั้งแต่เฟส 3** (ดู STEP 5 ฉบับแก้ไข) |
| การปฏิเสธต้องเกิดที่ Backend จริง | ไม่ใช้การซ่อนเมนู/ตัวแปรปิดหน้าจอเป็นเส้นแบ่งความปลอดภัย — ต้องพิสูจน์ด้วยการเรียก API ตรงแล้วถูกปฏิเสธ |

---

## STEP 1 — แก้การระบุสมาชิกองค์กรและขอบเขตข้อมูลให้ถูกต้อง

**เป้าหมาย (ขยายตามคำสั่งเจ้าของ):** ไม่ใช่แค่เปลี่ยนชื่อคอลัมน์ — ต้องพิสูจน์ว่า **องค์กรที่ผูกอยู่นั้นผูกกับบัญชีที่ยืนยันตัวตนจริง และผู้เรียกเลือกองค์กรอื่นเพื่อข้ามสิทธิ์ไม่ได้**

### 1.1 หลักการที่ต้องบังคับ (design constraint)

| # | กติกา | ผลที่ต้องเกิด |
|---|---|---|
| C1 | **org ต้องมาจาก session + DB เท่านั้น** — ห้ามรับ `organization_id`/`company_id` จาก body/query/header ในฐานะ "แหล่งอำนาจ" | คำขอที่มี org ของคนอื่นใน payload ต้องไม่ทำให้สิทธิ์กว้างขึ้น |
| C2 | ตัวตนที่ใช้ผูก org ต้องเป็น **auth.users.id → profiles.id (canonical)** ไม่ใช่ LINE id / ไม่ใช่ identity-layer id / ไม่ใช่ label | loader ต้องรับ profileId ที่มาจาก session เท่านั้น |
| C3 | **email ห้ามให้ org authority** — `core/identity/identity.ts:79-90` มี email-fallback อยู่ ต้องให้ fallback นี้ **ไม่มี** org scope (หรือปิด fallback สำหรับ org โดยสิ้นเชิง) | อีเมลเดียวกัน ≠ สิทธิ์เท่ากัน |
| C4 | org ของ **resource** ต้องอ่านจาก DB (เช่น `customer_company_id` ของเอกสาร/ไฟล์) ไม่ใช่จาก client | ต่อให้ส่ง resource id ของ org อื่นมา ก็ต้องถูกปฏิเสธจาก org จริงของ resource |
| C5 | ตัดสินด้วย **intersection** (org ของ session ∩ org ของ resource) และ **fail-closed** เมื่อข้อมูลไม่ครบ/กำกวม | ไม่มี org / membership หาย / resource ไม่ระบุ org → deny |
| C6 | membership ที่ถูกเพิกถอนต้องมีผลทันที (ไม่ cache ข้าม request) | ถอดสิทธิ์แล้วคำขอถัดไปต้องถูกปฏิเสธ |

### 1.2 งานที่ต้องทำ

| รายการ | รายละเอียด |
|---|---|
| 1a | `engines/authority/load.ts:46` — `eq("profile_id")` → `eq("user_id")` และ**ตัด `.is("deleted_at", null)`** (คอลัมน์ไม่มีจริง; คอลัมน์จริงคือ `organization_id, user_id, role, created_at`) |
| 1b | เพิ่มตัว resolves org context จาก session เท่านั้น (profileId จาก `getAuthedUser` → `org_members`) และส่งต่อให้ route ใช้ ไม่ให้ route query `org_members` เองคนละแบบ |
| 1c | จำกัด email-fallback (C3): ถ้า resolve มาทาง email → `organizationIds = []` และห้ามใช้เป็นฐานของ org authority |
| 1d | helper ตรวจ resource→org จาก DB + intersection (C4/C5) — ยัง**ไม่**บังคับใช้ทุก route (นั่นคือ Step 3) แต่ต้องมีพร้อมเทสต์ |
| 1e | ไม่แตะ schema/ข้อมูล: `org_members` 2 แถวเดิม (A=owner, B=admin) ถูกใช้ตามจริง |
| สิ่งที่ **ไม่** แตะ | `profiles` · `organizations` · `org_members` data · `engines/canonical/*` |

### 1.3 เทสต์โต้แย้ง (ต้องมีก่อนไป Step 3)

| # | กรณีทดสอบ | ผลที่ต้องได้ |
|---|---|---|
| T1 | A (member Org-A) ขอ org context | ได้ Org-A 1 รายการ |
| T2 | C (ไม่มี membership) ขอ org context | `[]` และทุก org-scoped action ถูกปฏิเสธ |
| T3 | **ยัด `organization_id` ของ Org-B ใน body/query/header** | ไม่มีผลต่อ org ที่ได้ (ยังเป็น Org-A) และถ้าไปขอ resource ของ Org-B → 403 |
| T4 | ขอ resource id ของ Org-B (โดยไม่ส่ง org มาเลย) | ตรวจ org ของ resource จาก DB → 403 |
| T5 | บัญชีที่ resolve ทาง email-fallback | org = `[]` (ไม่มีสิทธิ์องค์กร) |
| T6 | เพิกถอน membership แล้วยิงซ้ำในวินาทีถัดมา | 403 (ไม่ใช้ cache) |
| T7 | role-only (`super_admin`) ไม่มี membership | **ไม่มี org authority** (`ROLE_IS_NOT_AUTHORITY`) |
| T8 | ยิงด้วย anon key | 0 แถว / ถูกปฏิเสธ |

| รายการ | รายละเอียด |
|---|---|
| เกณฑ์ผ่าน | T1–T8 ผ่านครบ; ไม่มี query เปลี่ยนผลลัพธ์ธุรกิจ; A/B เห็น org#1, C เห็น `[]` |
| ถอยกลับ | revert ไฟล์ loader/helper (อ่านเท่านั้น ไม่มีข้อมูลเปลี่ยน) |
| ความเสี่ยง | ปานกลาง — ถ้าเข้มเกิน (fail-closed) ผู้ใช้ที่ membership ยังไม่ถูกสร้างจะเห็นข้อมูลว่าง; ต้องยืนยัน membership ของ A/B ก่อนเปิดใช้ |

> เหตุที่ต้องเป็นข้อ 1: Step 3 ทั้งขั้นพึ่ง org context ตัวนี้ และถ้า org ยัง "เลือกได้จาก client" การบังคับใช้ใน Step 3 จะไม่มีค่าอะไร

---

## STEP 2 — ตัดเครื่องมือพัฒนา / ฐานข้อมูลดิบ / การควบคุมโครงสร้างพื้นฐาน ออกจาก Business Workspace

**เป้าหมาย (แก้ตามคำสั่งเจ้าของ):** การปฏิเสธต้องเกิดที่ **Backend จริง** — เรียก API ตรงด้วย session ธุรกิจต้องเข้าถึงไม่ได้ **ไม่ใช่ซ่อนเมนูหรือใช้ตัวแปรปิดหน้าจอ**

### 2.1 หลักการ

| # | กติกา | เหตุผล |
|---|---|---|
| D1 | **route ต้องไม่มีอยู่ใน production build** (404 by absence) | flag/env ตั้งผิดครั้งเดียว = เปิดช่อง; route ที่ไม่มีอยู่ปลอมไม่ได้ด้วย header/cookie ใด ๆ |
| D2 | ตัวแปร env ใช้ได้เฉพาะเป็น **kill-switch ชั่วคราวระหว่างพัฒนา** ไม่ใช่เส้นแบ่งความปลอดภัย | ต้องมี build-time assertion เสริม |
| D3 | build ต้อง **fail** ถ้าตรวจพบ route ต้องห้ามในชุดที่ deploy | กันการกลับมาโดยไม่ตั้งใจ (`scripts/deploy-gate.ts` รันใน `prebuild` อยู่แล้ว) |
| D4 | สิ่งที่ต้องรันจริง (backup dump, สแกนดิสก์ host) ให้เป็น **CLI/สคริปต์บนเครื่องผู้ดูแล** ไม่ใช่ HTTP endpoint | ลดพื้นที่โจมตีถาวร ไม่ใช่แค่ปิดชั่วคราว |

### 2.2 ตารางสิ่งที่ต้องปิด + วิธีปิดเชิงโครงสร้าง

| กลุ่ม | เส้นทางวันนี้ | วิธีปิดแบบ Backend จริง | ที่ไปแทน | หลักฐานว่ายิงตรงไม่ได้ |
|---|---|---|---|---|
| Source Code | `/api/admin/ide/file` (GET/PUT), `ide/tree`, `ide/search`, `/admin/ide` | **ถอด route ออกจากแอป production** (ย้ายไป dev-only build / ลบจาก `app/api`) | GitHub + เครื่องพัฒนา | `curl` ด้วย session ธุรกิจ → **404** (ไม่มี handler) |
| Command execution | `/api/admin/ide/execution/**`, `workspace` (`approve_migration_plan`,`execute_migration`) | ถอด route + ถอดเมนู | Terminal/CI ในเครื่องพัฒนา | 404 |
| ฐานข้อมูลดิบ/export | `/api/admin/backup` | ถอด route; ทำ backup เป็น **CLI** (`pg_dump`/script) | สคริปต์ผู้ดูแล | 404 |
| ควบคุม host/infra | `/api/admin/storage-intelligence` (`move_safe_to_trash`, `inspect_docker`) | ถอด route; สแกน/ทำความสะอาดเป็น CLI | สคริปต์ผู้ดูแล | 404 |
| Connector ระดับ control-plane | connector `supabase-management-api` (สถานะ connected) | disable ที่ data + ถอดออกจาก surface ธุรกิจ | Supabase CLI/dashboard | connector ไม่ถูกเรียกจาก session ธุรกิจ |
| Device control | `/api/admin/devices/commands` | ค่าเริ่มต้น **ถอดออกจาก build** จนมี use case ธุรกิจที่อนุมัติ | – | 404 |

### 2.3 เทสต์ที่ต้องผ่าน

| # | กรณี | ผลที่ต้องได้ |
|---|---|---|
| S1 | session ธุรกิจยิงทุก path ในตาราง ข้างบน (GET/POST/PUT ตรง) | **404** ทุกเส้น (ไม่ใช่ 200/401/403) |
| S2 | session super_admin ยิงเส้นเดียวกัน | **404** เช่นกัน (ไม่มีข้อยกเว้นตาม role) |
| S3 | เรียกด้วย API token (`X-DNA-Token`) | 404 |
| S4 | route manifest ที่ build ออกมา | ไม่มี path ต้องห้ามอยู่เลย (snapshot test) |
| S5 | งานธุรกิจเดิม (documents/invoices/debt/jobs/pits) | 200 ตามปกติ |
| S6 | build พยายามใส่ route ต้องห้ามกลับ | **build fail** ที่ `deploy-gate` |

| รายการ | รายละเอียด |
|---|---|
| ต้องไม่กระทบ | 267 admin routes ฝั่งธุรกิจ, canonical documents/invoices/debt, LINE/Connect |
| ถอยกลับ | `git revert` ไฟล์ route ที่ถูกถอด (ไม่ใช่สลับ flag) — และถ้าต้องใช้ระหว่างพัฒนา ให้รันเฉพาะ dev/loopback build ที่ไม่ใช่ production |
| ความเสี่ยง | ปานกลาง — ต้องยืนยันว่ามี backup นอกแอป (`pg_dump`/infra) และสคริปต์สแกนดิสก์ก่อนถอด `backup`/`storage-intelligence` |

---

## STEP 3 — บังคับทุกการเข้าถึงข้อมูลผ่าน Business API ที่ตรวจสิทธิ์ตามองค์กร

**เป้าหมาย:** คำขอเดียว = ต้องรู้ว่า "actor เป็นสมาชิก org ไหน" และตอบเฉพาะข้อมูล org นั้น

| รายการ | รายละเอียด |
|---|---|
| จุดที่แตะ | 77 admin routes ที่ใช้ `supabaseAdmin()` (เริ่มจาก **read** ก่อน): transactions, documents, invoices, debt, receipts, relationships/upload, pits, jobs, people |
| กลไก | helper กลาง 1 ตัว (เช่น `requireOrgAccess(auth, companyId)`) อ่าน `org_members` (ผ่าน loader จาก Step 1) → 403 ถ้าไม่ใช่สมาชิก; list ต้อง `.eq("customer_company_id", orgIds)`; write ต้องตรวจ org ของ target **ก่อน** เรียก canonical engine |
| **ไม่มีข้อยกเว้นตาม role** | `super_admin`/`admin` ไม่มีทางลัด: ถ้าไม่ใช่สมาชิก org นั้น → 403 เหมือนคนอื่น (ทำให้ `super_admin` ไม่สามารถอ่านข้อมูลทุกองค์กรได้ตั้งแต่ขั้นนี้) |
| **org มาจาก session/resource เท่านั้น** | ห้ามใช้ `organization_id`/`company_id` ที่ client ส่งมาเป็นแหล่งอำนาจ — ใช้เพื่อ "ระบุ resource" แล้วตรวจ org จริงของ resource จาก DB (ตาม C1/C4 ใน Step 1) |
| สิ่งที่ไม่แตะ | `engines/canonical/*` (document/transaction/expense/audit) — ไม่เปลี่ยน Writer ไม่เปลี่ยน Finance Path |
| Storage | ออก signed URL ได้หลังตรวจ org ของ path/entity เท่านั้น |
| AI/Token | `/api/v1/query` + `api_tokens` ต้องผูก org (เพิ่มคอลัมน์ภายหลัง; ระหว่างนี้ปิด read command ที่ข้าม org) |
| Audit | ทุกครั้งที่ถูกปฏิเสธ → เขียน evidence (ต้องมี Step 1 + audit writer ที่ส่ง `actor_user_id` ได้) |
| เทสต์ | (ก) A อ่าน Org-A = 200 (ข) A อ่าน Org-B = 403/404 ทุก entity (ค) A เขียนเข้า Org-B = 403 (ง) log ยืนยันว่าไม่มีการ query ถึง Org-B |
| เกณฑ์ผ่าน | G4, G5, G6, G7 ผ่านบน staging |
| ถอยกลับ | flag `ORG_SCOPE_ENFORCE` (read-only → enforce) |
| ความเสี่ยง | **สูง** — ถ้าใส่ filter ผิด เอกสาร/ยอดเงินจะหายจากหน้าจอ (ไม่ใช่ข้อมูลเสีย) ต้องมี regression ก่อน/หลัง |

> หมายเหตุสำคัญ: `engines/canonical/audit.ts:78` ยังเขียน `actor_user_id: null` — ควรแก้ในเฟสนี้ด้วย มิฉะนั้น "ตรวจสิทธิ์ตามองค์กรทุกครั้ง" จะไม่มีหลักฐานว่าใครทำ

---

## STEP 4 — หน้าจอ Owner เห็นเฉพาะข้อมูลสรุปของแพลตฟอร์ม

**เป้าหมาย:** Platform Owner ดูสุขภาพ/ต้นทุน/ปริมาณได้ โดยไม่เห็นข้อมูลผู้ใช้

| รายการ | รายละเอียด |
|---|---|
| แหล่งข้อมูลที่ใช้ได้ (มีจริงแล้ว) | `profiles` (count by role) · `companies` (count) · `worker_usage_events` (tokens/latency) · `subscription_services` + `supabase_billing_events` (ต้นทุน) · `audit_logs` (count) · 21 edge functions status |
| endpoint ใหม่ | aggregate-only: `/api/platform/metrics` (count/sum เท่านั้น, k≥5, ไม่ join ชื่อ/เบอร์/อีเมล/ไฟล์) |
| ข้อห้ามใน endpoint | ห้ามคืน row-level, ห้ามรับ `company_id`, ห้าม export, ห้ามเปิดตารางดิบ |
| UI | หน้า `/admin/operations` (มีอยู่) แสดงเฉพาะ metrics; ลิงก์ไปหน้าข้อมูลธุรกิจถูกถอดออกจาก platform role |
| เทสต์ | (ก) เรียก metrics ได้ (ข) เรียก `/api/admin/companies` ด้วย platform role → 403 (ค) payload ไม่มี PII (ตรวจ schema) |
| เกณฑ์ผ่าน | G3 + G11 |
| ถอยกลับ | ปิด route |
| ความเสี่ยง | ต่ำ — อ่านอย่างเดียว; เสี่ยงคือ aggregate หลุด PII ถ้า join ผิด (ห้าม join) |

---

## STEP 5 — ปรับบทบาทบัญชีทั้งสามโดยรักษาข้อมูลเดิม

**หลักที่แก้ตามคำสั่งเจ้าของ:** `super_admin` **ไม่ใช่สิทธิ์ถาวร** — ถ้าจำเป็นต้องคงไว้ระหว่างเปลี่ยนผ่าน ต้อง (ก) จำกัดการใช้งานชั่วคราว (ข) **ถูกถอดออกจากเส้นทางอ่านข้อมูลทุกองค์กรตั้งแต่ Step 3** โดยไม่รอ Step 5

### 5.1 สถานะเป้าหมาย

| บัญชี | วันนี้ (LIVE) | เป้าหมาย | ข้อมูลที่กระทบ |
|---|---|---|---|
| B `acct_2d06e2d6` | `super_admin` (earliest) + org admin | **ช่วงเปลี่ยนผ่าน:** คง `super_admin` แบบ **จำกัด** = เห็นเฉพาะ aggregate (Step 4) + ให้สิทธิ์ role ได้ · **ห้ามอ่านข้อมูลธุรกิจทุกองค์กร** (ถูกบังคับด้วย Step 3) · **เป้าหมายสุดท้าย:** ถอด `super_admin` ออกเมื่อมีกลไกทดแทน (platform role + owner identity) | 0 |
| A `acct_39cbd71c` | `super_admin` + org owner | **ลดเป็น `admin`** + คง `org_members.role='owner'` (เห็นเฉพาะ Org-A) | 0 (role เปลี่ยนเท่านั้น เอกสาร/ยอด/ไฟล์เดิมไม่ถูกแตะ) |
| C `acct_8de1e3b9` | `customer` (ทดสอบ, ไม่มี org) | **คงเดิม** (ห้ามปิดบัญชี) | 0 |

### 5.2 เงื่อนไขสิ้นสุดช่วงเปลี่ยนผ่าน (Transitional → ถอดทิ้ง)

| เงื่อนไข | ผ่านเมื่อ |
|---|---|
| E1 | Step 3 บังคับใช้จริง: `super_admin` ที่ไม่ใช่สมาชิก org **อ่านข้อมูล org นั้นไม่ได้** (ทดสอบยืนยัน) |
| E2 | Step 4 aggregate surface ทำงาน (Platform Owner เห็นภาพรวมได้โดยไม่ต้องมีสิทธิ์ดิบ) |
| E3 | มีเส้นทางให้สิทธิ์ทดแทน (`role` assignment) ที่ไม่ต้องพึ่ง "earliest super_admin" — เช่น owner identity/passkey หรือ platform role เฉพาะ |
| E4 | audit ของการเปลี่ยน role ทำงานครบ (ก่อน Step 5) |

> เมื่อ E1–E4 ครบ → ถอด `super_admin` ออกจากบัญชีผู้ใช้ทั้งหมด (เหลือ platform role ที่อ่านได้เฉพาะ aggregate) — **ไม่ใช่การลบบทบาทก่อนมี dependency ครบ**

| เงื่อนไขก่อนทำ Step 5 | เหตุผล |
|---|---|
| ต้องมี audit ของการเปลี่ยน role ก่อน | วันนี้ `PATCH /api/admin/users/[id]/role` ไม่เขียน audit — ถ้าเปลี่ยนก่อนจะย้อนรอยไม่ได้ |
| ต้องมี Step 3 + 4 ผ่านก่อน | ถ้าลด A ก่อนมี org scope/aggregate → A จะเห็นข้อมูลน้อยลงหรือมากเกินโดยไม่ตั้งใจ |
| ระหว่างเปลี่ยนผ่านต้องเหลือผู้ให้สิทธิ์ได้ 1 บัญชี | `role` route ต้องเป็น earliest super_admin และ `owner_passkey_credentials` = 0 แถว (LIVE) |
| สำรอง `profiles` + `org_members` | ตารางเดียวที่เปลี่ยน (ไม่ใช่ข้อมูลลูกค้า) |

**เทสต์:** A ล็อกอิน → เห็น Org-A ตาม org owner · B ล็อกอิน → เห็นเฉพาะ metrics · C ล็อกอิน → `/user` เหมือนเดิม · ย้อน role กลับได้ 1 คำสั่ง

---

## STEP 6 — ทดสอบการป้องกันข้อมูลข้ามองค์กรก่อนขึ้น Production

**ชุดทดสอบที่ต้องรัน (ไม่ใช่แค่ G-series):** T1–T8 (org context / spoofing จาก Step 1) · S1–S6 (route หายจริงจาก build จาก Step 2) · G1–G12 (ด้านล่าง) — และต้องรัน **ซ้ำหลัง Step 3 และหลัง Step 5** ไม่ใช่ครั้งเดียวตอนท้าย

| กลุ่มทดสอบ | ต้องผ่าน |
|---|---|
| G1–G2 | ล็อกอินองค์กรตัวเองได้; บัญชีอีเมลบริษัทไม่ได้สิทธิ์อ่านผู้อื่นอัตโนมัติ |
| G3 | Platform Owner เห็นเฉพาะสรุป (ไม่มี PII) |
| G4–G5 | A อ่าน/แก้ของ B ไม่ได้; owner-A อ่าน Org-B ไม่ได้ (อ่าน+เขียน ทุก entity) |
| G6 | AI/Connector ไม่ข้าม org |
| G7 | service-role route ตรวจสิทธิ์ก่อนแตะ DB (พิสูจน์จาก log ว่าไม่มีการ query) |
| G8 | Business Workspace ไม่มีทาง Source/Exec/Deploy (ยิงตรงก็ปิด) |
| G9 | Canonical path เดิม: ออกเอกสาร/รับชำระ/ใบกำกับ ทำงานเหมือนก่อนแก้ |
| G10 | Login/API/DB/Storage/AI ผ่านทั้งกรณีอนุญาตและปฏิเสธ |
| G11 | dashboard/รายงานไม่มี PII |
| G12 | ซ้อม rollback แล้วข้อมูลครบ 100% |

| เงื่อนไข | รายละเอียด |
|---|---|
| สภาพแวดล้อม | **staging** `zjhgysugbmyyciatmltv` (0 functions) + ข้อมูลสังเคราะห์ Org-A/Org-B, User-A/User-B |
| ห้าม | ใช้ข้อมูลจริงของผู้ใช้ทดสอบ, เปิดอ่านเอกสารจริง |
| ลำดับขึ้น Production | ปิด flag ทั้งหมด → เปิดทีละขั้น (Step 2 → 3 → 4 → 5) โดยเฝ้า error/403 rate → เปิดเต็มเมื่อ G1–G12 ผ่าน |
| Rollback | flag off ทันทีที่ G1/G4/G5/G9 FAIL บน Production; ไม่มีการย้ายข้อมูลจึงไม่มีข้อมูลหาย |

---

## Dependency ที่ยืนยันแล้ว (ห้ามสลับ)

```
STEP1 (org context: session-derived + anti-spoof + email-fallback ไม่มี org)
   │
   ├──▶ STEP3 (บังคับ org ทุก route; super_admin ไม่มีข้อยกเว้น)
   │         │
   │         └──▶ STEP5 (ลด role; super_admin เหลือ aggregate เท่านั้น → ถอดเมื่อ E1-E4 ครบ)
   │
   └──▶ audit actor (ต้องเสร็จก่อน STEP5)

STEP2 (ถอด route ออกจาก production build + build gate) ── อิสระจาก 1
   └── ต้องเสร็จก่อนเปิด Production และก่อน STEP5 (ไม่ให้ dev path ถูกใช้ต่อ)

STEP4 (aggregate) ──▶ STEP5 (platform owner ยังเห็นภาพรวมหลังไม่มีสิทธิ์ดิบ)

STEP6 (T1-T8 + S1-S6 + G1-G12) ── รันหลัง STEP3 และซ้ำหลัง STEP5
```

**ข้อทักท้วงเชิงวิศวกรรมต่อลำดับเดิม (ไม่เปลี่ยนลำดับ แค่เพิ่ม gate):** การทดสอบข้ามองค์กรต้องรัน **หลังจาก Step 3 และอีกครั้งหลัง Step 5** ไม่ใช่รอถึง Step 6 ครั้งเดียว — มิฉะนั้นจะพบ regression ช้าเกินไป

---

## สิ่งที่ยังไม่ทำในรอบนี้

- ไม่แก้ `engines/authority/load.ts` · ไม่ปิด route · ไม่แตะ role · ไม่สร้าง endpoint · ไม่สร้าง migration
- ต้องได้รับคำสั่งชัดว่า **"อนุมัติเริ่ม STEP 1"** ก่อนลงมือ
