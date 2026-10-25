# ROLE ACCESS & 7-SYSTEM AUDIT — 2026-10-19

> **UPDATE (ภายหลังในวันเดียวกัน):** audit นี้เป็น snapshot ก่อนลงมือ — role/screen wiring ถูก implement แล้วใน `docs/ROLE_WIRING_2026-10-19.md` (owner/seller/buyer/transporter) โดยยังไม่ deploy. ข้อความด้านล่างที่ว่า “ยังไม่มี UI/ยังเป็น shell” ถูกแทนที่ด้วยงานรอบนั้นแล้ว.

โหมด: **อ่านเท่านั้น (READ-ONLY)** — ไม่แก้โค้ด ไม่ commit/push/deploy ไม่เขียนข้อมูล production
อ้างอิงโค้ดที่รันจริง: production deployment ล่าสุด `2026-10-18T18:40:30Z` ซึ่งเกิดหลัง commit `14139082` (18:32:30Z) 8 นาที และมี endpoint `/api/workspace/org-context` ที่เพิ่งเข้ามาในชุด tenant จริง → อนุมานว่า production รันโค้ดชุดเดียวกับ HEAD (deployment metadata ไม่มี commit hash ให้ยืนยันตรง ๆ)

หลักฐานที่ใช้:
- โค้ดใน working tree ที่ `14139082` (branch `gxkg`)
- Production HTTP จริง (`dna-os-deadboard-production.up.railway.app`)
- Production Supabase `xeytcavxejhyzxwevgto` — GET/HEAD อย่างเดียว (service-role อ่าน census, anon อ่าน RLS)
- `supabase migration list --linked` (production)
- SQL ภายใต้ role `authenticated` + JWT ของ owner จริง (read-only, rollback): `org_members` → **42P17**, `organizations` → **42P17**, `companies` ที่มองเห็น = **0**
- Offline/LIVE suites: `tenant-api:test` 13/13, `tenant-core:test` PASS, `matching:boundary` STATIC 41/41 · SYNTHETIC 26/26 · LIVE 19/19

> หมายเหตุเรื่องคำว่า “7 ระบบ”: รีโปนี้ไม่มีทะเบียนกลางที่เรียกชื่อว่า “7 ระบบ” โดยตรง
> ชุดเดียวที่โค้ดรันจริงมี 7 กลุ่มคือ launcher ของ Workspace (`public/material-workspace/business-tools.json` v1)
> จึงใช้ชุดนั้นเป็นตารางหลัก และมี crosswalk 7 ระบบตามเส้นธุรกิจใน §2 เพื่อไม่ให้ตีความคลาด

---

## 1. สรุปผู้บริหาร

1. **โค้ดส่วนใหญ่ “เขียนเสร็จ” แล้ว แต่การใช้งานจริงยังไม่เปิดให้คนนอกทีม admin** — portal ของผู้ซื้อ/ผู้ขายถูกลงทะเบียนใน `registry/portals.json` ว่า `shell` (ยังไม่มี business logic/เนื้อหาจริง)
2. **Production กำลังบล็อกอยู่ที่ฐานข้อมูล ไม่ใช่ที่ UI**: พิสูจน์แล้วด้วย SQL ภายใต้ role `authenticated` ของ owner — `org_members`/`organizations` ตอบ `42P17 infinite recursion` เพราะ migration fix `20261019000001` ยังไม่ถูก apply → middleware อ่าน membership ไม่ได้ → tenant gate ตอบ `403 ORG_NOT_MEMBER` แบบ fail-closed ให้ทุก business API ที่อยู่ใน gate
3. **ลงทะเบียนแล้วไม่ได้ membership ขององค์กร**: `registerNational()` สร้าง `profiles` + `companies` แต่ไม่สร้าง `org_members` (และ `company_members` ยังไม่มีตารางจริง) → ผู้ขายที่สมัครใหม่ยังไม่มีสิทธิ์ในข้อมูลธุรกิจของตัวเอง
4. **ผู้ขนส่งยังไม่มีอยู่ในโมเดลสิทธิ์**: POST `/api/public/register` ปฏิเสธ `registrant_profile:"transporter"` (400) — มีเพียง `service_provider` ซึ่งถูก map เป็น `partner` และไม่มีหน้าจองานขนส่ง
5. **สิ่งที่ใช้งานออนไลน์ได้จริงวันนี้คือ “ทะเบียนสาธารณะ”**: `/pub` 200, `/api/public/resources?action=public` 200, การจับคู่/Publication ผ่าน LIVE 19/19 — เป็นความสามารถเดียวที่ผู้ซื้อ/ผู้ขายทั่วไปใช้ได้โดยไม่ต้องมี org

---

## 2. 7 ระบบ — เขียนเสร็จ / ออนไลน์ / พร้อมใช้

### 2.1 ตารางหลัก (7 กลุ่มที่ผู้ใช้เห็นใน Workspace launcher)

| # | ระบบ | เขียนเสร็จ | ออนไลน์ (deploy) | ใช้งานได้จริงโดยใคร | ข้อจำกัดที่พิสูจน์แล้ว |
|---|---|---|---|---|---|
| 01 | ธุรกิจ (แหล่ง·งาน·คู่ค้า·การเงิน·ลูกหนี้·เอกสาร) | ✅ หน้า + API ครบ | ✅ route `/admin/*` ตอบ (401 เมื่อไม่ login) | admin tier เท่านั้น | ทุก API ที่อยู่ใน tenant gate ถูกบล็อกด้วย RLS recursion; ข้อมูลจริงมี (pits 96, jobs 18, partners 86, invoices 30, receipts 495) |
| 02 | LINE / Social | ✅ LINE OA + webhook v2 ในโค้ด | ⚠️ บางส่วน — ข้อมูลจริง 937 `line_events`, 199 `business_events` | admin tier | ไม่มี test channel; Facebook/Instagram/TikTok เป็นเพียงลิงก์ภายนอก ไม่ใช่ integration |
| 03 | Email | ❌ ไม่มี integration | ❌ | — | Gmail/Outlook ใน launcher เป็น `external` link เท่านั้น |
| 04 | Documents | ✅ canonical writer + version + viewer | ✅ `/admin/documents` | admin tier | `20261019000002/3` ยังไม่ apply → ไม่มี `issuer_company_id`/`organization_id`; writer ข้ามการ stamp; buyer ไม่มีสิทธิ์อ่านเอกสาร |
| 05 | Banking | ⚠️ receipt queue + bank sync ในโค้ด | ⚠️ ข้อมูลจริง receipts 495 (confirmed 3 / ai_read 492), bank tx 115 (ยังไม่ match) | admin tier | ยังไม่มี live proof ของการกระทบยอด; ช่องทางธนาคารเป็นงาน manual/email |
| 06 | Company Profile | ⚠️ หน้า settings + companies | ⚠️ ข้อมูลจริง 86 companies | admin tier | `company_members` ไม่มีใน DB; companies ที่ผูก org = **0/86** |
| 07 | External Tools | ❌ | ❌ | — | Google Maps เป็นลิงก์ ไม่ได้เชื่อม API/คีย์ |

**อ่านตาราง:** “เขียนเสร็จ” = มีหน้า/route/service จริง · “ออนไลน์” = deploy แล้วและ endpoint ตอบ · “พร้อมใช้” = คนroleนั้นเปิดแล้วทำงานได้จริงโดยไม่ติดสิทธิ์/ข้อมูล

### 2.2 Crosswalk — 7 ระบบตามเส้นธุรกิจ (กรณีคุณหมายถึงชุดนี้)

| ระบบ | สถานะ | หลักฐาน |
|---|---|---|
| 1. ลงทะเบียน/ยืนยันตัวตน | 🟡 เขียนเสร็จ + ออนไลน์ | `/pub/register` 200; POST invalid profile 400; สร้าง user/profile จริง |
| 2. ค้นหา/จับคู่/เผยแพร่ | 🟢 ออนไลน์ | `/pub` 200; public resources 200; matching LIVE 19/19 |
| 3. เสนอราคา/สั่งซื้อ | 🟡 engine มี แต่ไม่มี self-service | `engines/quote-price.ts`; `/api/admin/quotation-queue`; buyer ไม่มีทางขอราคา |
| 4. งานขนส่ง | 🟡 admin เท่านั้น | jobs 18; ไม่มี role/หน้าจอของผู้ขนส่ง |
| 5. เอกสาร | 🟡 canonical พร้อม แต่ ownership ยังไม่ apply | `document-write.ts`; `20261019000002` PENDING |
| 6. การเงิน/หนี้ | 🟡 ข้อมูลจริง แต่ admin เท่านั้น | receipts 495; bank tx 115 unmatched; tenant gate |
| 7. LINE/AI/แจ้งเตือน | 🟡 LINE มีข้อมูลจริง, AI ผ่าน login admin | 937 line_events; `/api/chat` = `requireAuth(ADMIN_TIER)` |

---

## 3. ลงทะเบียนและเข้าสู่ระบบ — ผู้ใช้แต่ละประเภทได้สิทธิ์ถูกต้องหรือไม่

### 3.1 เส้นทางจริง

```
/pub/register
  → POST /api/public/register
  → engines/public-registry/service.ts#registerNational()
      • Supabase Admin generateLink(type:"signup")  (คืน action_link, ไม่ส่งอีเมลจริง)
      • upsert profiles { id, email, role }
      • ถ้าเป็น company: insert companies (organization_id = NULL)
      • พยายาม insert company_members (ตารางยังไม่มีจริง → error ถูกกลืน)
  → ผู้ใช้กด action_link → /login (OTP/password/OAuth)
  → /app → resolveDestination(role)
      • super_admin/admin/employee → /workspace
      • partner → /partner
      • customer → /user
```

### 3.2 Mapping ที่โค้ดทำจริง

| ตัวเลือกตอนสมัคร | AppRole ที่ได้ | Org membership | Company membership | หน้าปลายทาง |
|---|---|---|---|---|
| `buyer` | `customer` | ❌ ไม่สร้าง | ❌ | `/user` (shell) |
| `labor` | `customer` | ❌ | ❌ | `/user` (shell) |
| `resource_owner` | `partner` | ❌ | ❌ (ตารางไม่มี) | `/partner` (shell) |
| `service_provider` | `partner` | ❌ | ❌ | `/partner` (shell) |
| `transporter` | — | — | — | **ไม่มีในระบบ (400)** |

### 3.3 ข้อสรุปเรื่องสิทธิ์

- **ระดับ AppRole ถูกต้องตามที่ลงทะเบียน** (buyer→customer, seller→partner) และ login อ่าน role จาก `profiles` จริง ไม่ได้ให้ provider กำหนดสิทธิ์
- **แต่สิทธิ์ที่ได้ “ไม่พอต่อการใช้งาน”**: role `partner`/`customer` ไม่มี `capability_access` รายการใดเลย (ทั้ง 14 tool เป็น admin tier) และไม่มี org membership
- **ข้อมูลจริงใน production ยังเป็นระบบSingle-tenant**: `profiles` 3 แถว (super_admin 2, customer 1), `organizations` 1 แถว (“สำนักงานใหญ่”), `org_members` 2 แถว (owner, admin), ไม่มี partner จริงแม้แต่คนเดียว
- **companies ไม่ถูกผูกองค์กรเลย**: `organization_id IS NOT NULL` = **0 จาก 86** → ถึงแก้ RLS แล้ว ข้อมูลธุรกิจก็ยังไม่ถูก scope ให้ใคร

---

## 4. การเชื่อมสิทธิ์กับหน้าจอ — 4 persona

| Persona | หน้าปลายทาง | Guard | เปิดได้จริงหรือไม่ | ปัญหา |
|---|---|---|---|---|
| **ผู้ซื้อ (buyer/customer)** | `/user` | `requireAuthPage("/user", [super_admin,admin,customer])` | เปิดได้ แต่หน้าเป็นรายการสถานะ capability จาก `registry/existence.json` ไม่ใช่ portal ซื้อของ | ไม่มีหน้าค้นหาสินค้า/ขอราคา/ออกคำสั่งซื้อ/ดูเอกสารของตัวเอง; `/pub` ค้นหาได้แต่ไม่มีปุ่มขอราคา; API `add_demand` บังคับเจ้าของบ่อ |
| **ผู้ขาย/เจ้าของทรัพยากร (partner)** | `/partner` | `requireAuthPage("/partner", [super_admin,admin,partner])` | เปิดได้ แต่หน้าเป็น `businessCoverage` การ์ด 2 โดเมน (relationship/purchase) | ไม่มี UI จัดการบ่อ/วัสดุ/ราคาของตัวเอง; API `/api/public/resources?action=mine` มีแต่ไม่มีหน้าเรียก; `/workspace` เปิดได้ทาง URL แต่ chat/tools เป็น admin tier |
| **เจ้าของกิจการ/admin** | `/workspace` | `getAuthedUser()` เท่านั้น (ไม่กรอง role ในหน้านี้) | เปิดได้; org selector ทำงาน (อ่านด้วย service role) | ทุก business API ถูก tenant gate ปฏิเสธเพราะ RLS recursion; companies ไม่ถูก map → ข้อมูลไม่ถูก scope |
| **ผู้ขนส่ง (transporter)** | — | — | **ไม่มี route/role/หน้า** | สมัครไม่ได้ (400); `service_provider` ถูกยุบเป็น partner; `/admin/jobs` เป็น admin tier; `/api/public/assets` พังเพราะคอลัมน์ยังไม่ถูก apply |

### 4.1 หน้าจอที่ “มีอยู่แต่ไม่ใช่ของผู้ใช้ประเภทนั้น”

- `/business` = CEO Dashboard (นับ modules/layers) ไม่ใช่หน้าธุรกิจของผู้ขาย
- `/partner` = การ์ดจาก registry ไม่ใช่เครื่องมือคู่ค้า
- `/user` = ตารางสถานะ capability ไม่ใช่ portal ผู้ซื้อ
- `/workspace` = shell แชต/launcher ที่ชี้ไป `/admin/*` ทั้งหมด — server guard กันได้ แต่ผู้ใช้ partner/customer ที่เปิด URL นี้จะเห็นเมนูที่กดแล้วโดนปฏิเสธ

---

## 5. ปัญหาแยกประเภท (ตามที่สั่ง: ห้ามแก้โค้ดที่ไม่เกี่ยวข้อง)

### A. ปัญหาสิทธิ์ / Authority (Permission)

| ID | ปัญหา | หลักฐาน | ต้องตัดสินอะไร |
|---|---|---|---|
| P1 | partner/customer ไม่มี capability ใด ๆ ใน `capability_access` | `registry/permissions.json` — ทั้ง 14 tool เป็น admin tier | จะเปิด tool ใดให้ role ไหน (แก้ registry ไม่ใช่ component) |
| P2 | launcher แสดงเมนู `/admin/*` ให้ทุกคนที่ login | `business-tools.json` + `/workspace` ไม่กรอง role | ต้องกรองเมนูตาม role หรือแยก launcher ของ partner/customer |
| P3 | buyer request quote ถูกบังคับให้เป็นเจ้าของบ่อ | `addMyDemandRequest()` → `assertPitOwnership()` | buyer ควรขอราคาจากแหล่งของคนอื่นได้ — เป็น logic/authority ที่ผิด |
| P4 | ไม่มี role ผู้ขนส่ง | POST register 400; `route_access` ไม่มี transport | ต้องตัดสินว่าจะเพิ่ม role หรือใช้ partner + ผูกงาน |
| P5 | company role (owner/manager/member) ไม่เชื่อมกับ AppRole | `company_members` แยกจาก `profiles.role` | ต้องมี mapping ที่ตรวจได้จริงก่อนเปิดใช้ |

### B. ปัญหาการตั้งค่า / ฐานข้อมูล / deployment (Configuration)

| ID | ปัญหา | หลักฐาน | ผลกระทบ |
|---|---|---|---|
| C1 | **RLS recursion บน `org_members`/`organizations`** | anon GET → `42P17`; SQL role `authenticated` + JWT owner → `42P17` ทั้งสองตาราง; migration `20261019000001` = PENDING | middleware อ่าน membership ไม่ได้ → business API ทุกตัวที่อยู่ใน tenant gate ตอบ 403 |
| C2 | `company_members` ไม่มีตาราง | PostgREST `PGRST205`; `20261016000003` = PENDING | สมัครบริษัทแล้วไม่มีเจ้าของ; `/api/public/company` ใช้ไม่ได้ |
| C3 | stock/asset ownership ยังไม่ apply | `20261016000001/2` = PENDING; `equipment_assets.owner_user_id` → `42703`; `pit_materials.stock_quantity` → `42703`; `company_member_invites` → `PGRST205` | `/api/public/assets`, `inventory`, `record_stock_movement` จะ error |
| C4 | document ownership ยังไม่ apply | `20261019000002/3` = PENDING; `invoices.issuer_company_id` → `42703` | ไม่มี seller/buyer document scope; writer ข้าม stamp |
| C5 | companies ไม่ผูก org | 0/86 mapped | tenant scope ไม่มีข้อมูลให้อ่าน |
| C6 | deploy ไม่ผูก git | deployment ล่าสุดไม่มี commit metadata; `origin/main` = `84d8c7f` (12 ต.ค.) แต่ production มี endpoint ชุด 19 ต.ค.; manifest 18 ต.ค. ระบุว่า deploy ผ่าน CLI `railway up` | ตรวจย้อนกลับไม่ได้ว่า deploy มาจาก revision ใด — rollback/lineage เสี่ยง |
| C7 | staging ยังไม่มี prerequisite + ไม่มี backup | `docs/STAGING_VERIFICATION_2026-10-19.md` | ทดสอบ release ก่อน production ไม่ได้ |

### C. ข้อผิดพลาดของโค้ดจริง (Code bug)

| ID | ปัญหา | หลักฐาน | หมายเหตุ |
|---|---|---|---|
| B1 | `registerNational()` กลืน error ของ `company_members` | `.insert(...)` ไม่ตรวจ error | ทำให้สมัคร “สำเร็จ” แต่ไม่มีความสัมพันธ์ |
| B2 | บริษัทที่มีอยู่แล้วไม่ถูกผูกสมาชิก | membership block อยู่ในสาขา “สร้างใหม่” เท่านั้น | existing company → ไม่มี owner |
| B3 | ไม่มีการสร้าง `org_members` ตอนสมัคร | ไม่มีโค้ดส่วนนี้ | seller ใหม่เข้า workspace ไม่ได้ |
| B4 | `/api/public/company` คืน HTTP 200 พร้อม `ok:false` | route `NextResponse.json(await listMyMemberships())` | ดูเหมือนสำเร็จแต่ empty — วินิจฉัยยาก |
| B5 | asset/inventory code assume คอลัมน์ที่ยังไม่มี | `owner_user_id`/`stock_quantity` → `42703` (ยืนยันบน production) | ควร degrade/fail ชัดเจน ไม่ใช่ 500 |
| B6 | `/workspace` ไม่มี role guard และไม่บล็อกเมื่อไม่มี org | `app/workspace/page.tsx` แค่ `getAuthedUser()` | UX/safety gap ไม่ใช่ช่องโหว่ข้อมูล (API ยังกัน) |

---

## 6. สิ่งที่ยังไม่ทำในรอบนี้ / ข้อจำกัด

- ไม่ได้ login ผ่าน browser ด้วยบัญชี Owner (ไม่มีรหัส/ไม่สร้างบัญชีใหม่) — แต่พิสูจน์ RLS ด้วย SQL ภายใต้ role `authenticated` + JWT ของ owner จริงแล้ว (read-only, rollback) และโค้ด middleware อ่าน `org_members` ผ่าน session client เดียวกัน
- ไม่ได้ apply migration ใด ๆ, ไม่ได้แก้ RLS, ไม่ได้สร้าง org/membership, ไม่ได้ commit/push/deploy
- ไม่ได้ทดสอบ LINE E2E (ไม่มี test channel) และไม่ได้ส่งข้อความจริง
- ตัวเลข census เป็น snapshot ณ วันตรวจ (receipts 495, bank tx 115, business_events 199 ฯลฯ)

---

## 7. ลำดับถัดไปที่ควรตัดสิน (ไม่ใช่การเขียนโค้ดเพิ่ม)

1. **ปลดบล็อก production ก่อน**: ขออนุมัติ backup + apply `20261019000001` (RLS recursion fix) แล้วทดสอบด้วย session Owner จริง → คาดว่า business API กลับมา 200
2. **ผูกคนกับองค์กร**: สร้าง/ผูก `org_members` ให้ผู้ใช้จริง และตัดสินใจ map `companies.organization_id` (0/86) — ไม่มีสองข้อนี้ ระบบยังเป็น single-tenant อยู่
3. **ตัดสินโมเดลผู้ขาย/ผู้ขนส่ง**: partner ควรมี org+company membership หรือไม่; transporter เป็น role ใหม่หรือ partner ที่ผูก job — แล้วจึงเปิด migration `20261016000003` / `20261019000002-3`
4. **เปิด UI ที่มี API อยู่แล้ว**: หน้าจัดการบ่อ/วัสดุ/ราคา/สต็อก/รถของผู้ขาย และหน้าขอราคาของผู้ซื้อ (หลังแก้ P3)
5. **หยุดเพิ่มความสามารถใหม่** จนกว่า 1–2 จะผ่าน — เป้าหมายคือ “คนแต่ละประเภทเข้าใช้ของที่มีอยู่ได้” ไม่ใช่โค้ดมากขึ้น

---

### ภาคผนวก — คำสั่งที่ใช้ตรวจ (ไม่มีความลับ)

```bash
# deployment / runtime
railway status
railway deployment list --json
curl -o /dev/null -w '%{http_code}' https://dna-os-deadboard-production.up.railway.app/login   # 200
curl -o /dev/null -w '%{http_code}' .../api/workspace/org-context                              # 401
# DB schema state
supabase migration list --linked
# RLS proof (anon key)
GET /rest/v1/org_members?select=*&limit=1   → 42P17
GET /rest/v1/company_members?select=*&limit=1 → PGRST205
GET /rest/v1/invoices?select=issuer_company_id&limit=1 → 42703
# RLS proof as authenticated owner (read-only, rollback)
supabase db query --linked "begin; set local role authenticated; set local request.jwt.claims = '{\"sub\":\"<owner-uuid>\"}'; select count(*) from public.org_members; rollback;"
# suites
npm run tenant-api:test        # 13/13
npm run tenant-core:test       # PASS
npm run matching:boundary      # 41/41 · 26/26 · 19/19
```
