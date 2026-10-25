# ROLE → SCREEN WIRING — 2026-10-19

โหมด: **implement ใน working tree** — ยังไม่ commit / push / deploy / เขียน production DB
เป้าหมาย: ใช้ระบบสิทธิ์เดิมให้ทำงาน แยกบทบาท และเชื่อมความสามารถที่มีอยู่แล้วเข้ากับหน้าจอของแต่ละประเภท
(ไม่สร้างระบบธุรกิจ/ตาราง/role ใหม่)

---

## 1. เจ้าของระบบ (owner / admin tier)

| สิ่งที่ทำ | ไฟล์ | เหตุผล |
|---|---|---|
| อ่าน membership ของ session ด้วย server client ที่ scope เฉพาะ `user.id` | `middleware.ts` | policy `org_members` ยัง recursive (`42P17`) เพราะ `20261019000001` ยังไม่ apply — ถ้าใช้ session client ทุก business API จะโดน `403 ORG_NOT_MEMBER` แม้เป็น owner |
| ปิด `/workspace` ให้ admin tier | `app/workspace/page.tsx` + `registry/permissions.json#route_access` | workspace เป็น operator surface ที่เปิด `/admin/*`; partner/customer ไม่ควรเข้ามา |
| เพิ่ม `/workspace` ใน route_access | `registry/permissions.json` | ให้ registry เป็นแหล่งสิทธิ์เดียว ไม่ hardcode ในหน้า |

**ผล:** tenant gate ของ owner อ่าน membership ได้แล้ว และ business API ที่อยู่ใน gate ไม่ถูกปฏิเสธจาก RLS อีก
**ยังค้าง:** `/api/admin/finance-summary` และ POST `/api/admin/documents` ต้องใช้ `resolveVerifiedScope` ซึ่งยังคืน `ORG_UNMAPPED` เพราะ `companies.organization_id` ผูกไว้ **0/86** — ต้องให้ owner map บริษัทของตัวเองเข้ากับองค์กรก่อน (เป็น data decision ไม่ใช่ code)

---

## 2. ผู้ขาย / เจ้าของทรัพยากร (`partner`)

| สิ่งที่ทำ | ไฟล์ |
|---|---|
| หน้า `/partner` จริง: เพิ่มแหล่ง, เพิ่มวัสดุ/ราคา, แก้ราคา, เปิด/ปิดรับลูกค้า | `app/partner/page.tsx`, `app/partner/_lib/PartnerPortal.tsx` |
| ใช้ API เดิมทั้งหมด (`/api/public/resources`) — ownership gate `pit_profiles.user_id === caller` ไม่ถูกแก้ | `app/api/public/resources/route.ts` |
| คืน `material_type_id` ใน `listMyResources` เพื่อให้แก้ราคาได้ | `engines/public-registry/service.ts` |
| เพิ่ม `action=materials` (id/name สาธารณะ) สำหรับ dropdown | `app/api/public/resources/route.ts`, `engines/public-registry/service.ts` |
| เปลี่ยน portal status จาก `shell` → `official` | `registry/portals.json` |

**ผล:** partner ที่สมัครเองสามารถจัดการแหล่ง/วัสดุ/ราคาของตัวเองได้ทันทีหลัง login (ไม่ต้องมี org)
**ยังค้าง:** `company_members` / asset ownership / stock ยังไม่ apply (`20261016000001–3`) — หน้านี้ไม่แตะส่วนนั้น

---

## 3. ผู้ซื้อ (`customer`)

| สิ่งที่ทำ | ไฟล์ |
|---|---|
| หน้า `/user` จริง: ค้นหาทะเบียนสาธารณะ + ขอราคา + เปิดแผนที่ | `app/user/page.tsx`, `app/user/_lib/BuyerPortal.tsx` |
| เพิ่ม `site_id` + `material_type_id` ในผลทะเบียนสาธารณะ (ไม่เปิด private fields) | `engines/public-registry/service.ts` |
| แก้ `addMyDemandRequest` ให้ผู้ซื้อขอราคาแหล่งของคนอื่นได้ — ตรวจแค่ว่าแหล่งมีจริง/เปิดอยู่/วัสดุมีจริง | `engines/public-registry/service.ts` |
| เปลี่ยน portal status `shell` → `official` | `registry/portals.json` |

**ผล:** buyer เห็นราคาจริงจากผู้ขาย และส่งคำขอราคาไปที่ `pit_price_requests` ได้
**ยังค้าง:** การตอบกลับอัตโนมัติยังพึ่ง LINE ของผู้ขาย (`supplier-quote-reply`) — ถ้าผู้ขายไม่มี LINE จะไม่มีการแจ้งเตือน และยังไม่มีหน้าสำหรับผู้ขายดู demand ใน portal

---

## 4. ผู้ขนส่ง (`partner` + `driver_profiles`)

| สิ่งที่ทำ | ไฟล์ |
|---|---|
| หน้า `/transporter`: สร้าง/แก้โปรไฟล์คนขับ + ดูงานที่ถูกมอบหมาย | `app/transporter/layout.tsx`, `app/transporter/page.tsx`, `app/transporter/_lib/TransporterPortal.tsx` |
| API self-service บนตารางเดิม: `driver_profiles` + `jobs.assigned_person_id` + `vehicle_types` | `app/api/public/transporter/route.ts` |
| route_access `/transporter` (admin tier + partner) | `registry/permissions.json` |
| nav “ขนส่ง” + icon Truck | `core/navigation/resolveNavItems.ts`, `components/workspace/WorkspaceShell.tsx` |
| middleware คุ้มครองหน้า `/transporter` | `middleware.ts` |
| ตัวเลือกสมัคร `transporter` (map เป็น partner เดิม) | `app/pub/register/page.tsx`, `app/api/public/register/route.ts`, `engines/public-registry/service.ts` |

**ผล:** ผู้ขนส่งสมัครได้ ตั้งโปรไฟล์ของตัวเอง และเห็นเฉพาะงานที่ `assigned_person_id` ตรงกับโปรไฟล์นั้น
**ไม่มี AppRole ใหม่ และไม่มีตารางใหม่** — ใช้ `partner` + `driver_profiles.user_id` เป็นความสัมพันธ์ที่ตรวจได้
**ยังค้าง:** ยังไม่มีหน้าจอ/API ฝั่ง admin สำหรับตั้ง `jobs.assigned_person_id` (คอลัมน์มีอยู่ แต่ไม่มี writer) — จึงต้องเพิ่มขั้นตอน assign ก่อนงานจะปรากฏ

---

## 5. การตรวจที่รัน

| Check | ผล |
|---|---|
| `npm run type-check` | ✅ EXIT 0 |
| `npx eslint` ไฟล์ที่แก้ทั้งหมด | ✅ EXIT 0 |
| `npx next build` | ✅ EXIT 0 (มี route `/partner`, `/user`, `/transporter`, `/api/public/transporter`) |
| `npm run tenant-api:test` | ✅ 13/13 |
| `npm run matching:boundary` | ✅ STATIC 41/41 · SYNTHETIC 26/26 · LIVE 19/19 |
| dev server `/api/public/resources?action=materials` | ✅ 200 (8 วัสดุ) |
| dev server `/api/public/resources?action=public` | ✅ 200, entry มี `site_id` + `material_type_id` |
| dev server `/api/public/transporter` (ไม่ login) | ✅ 401 |
| dev server `/partner`, `/user`, `/transporter` (ไม่ login) | ✅ 307 → /login |
| register profile validation | ✅ `transporter` ผ่าน validation, `alien` ถูกปฏิเสธ |

**ไม่ได้รัน:** authenticated end-to-end (ไม่มีรหัส owner/ผู้ใช้ทดสอบ และไม่สร้างบัญชี/เขียน production), LINE E2E

---

## 6. ยังต้องตัดสิน/ทำก่อน production

1. **Apply `20261019000001` (RLS recursion fix)** — workaround ใน middleware ทำให้ owner ใช้ได้ก่อน แต่ policy ยังเสียสำหรับ session query อื่น
2. **Map `companies.organization_id`** เฉพาะบริษัทของ owner (0/86) — ปลดล็อก finance/documents write
3. **Admin assignment writer** สำหรับ `jobs.assigned_person_id` — ไม่เช่นนั้น transporter จะเห็นแต่ list ว่าง
4. Apply `20261016000001–3` + `20261019000002–3` เมื่อ owner อนุมัติ (company_members/assets/stock/document ownership)
5. Deploy โค้ดชุดนี้ (ยังไม่ deploy) แล้วทดสอบด้วย session จริงของ owner/partner/customer/transporter
