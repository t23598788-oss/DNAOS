# Public Catalog — Production Change Window (2026-10-24/25 UTC)

หลักฐานทั้งหมดของรอบเปลี่ยนแปลงนี้อยู่ใน [`evidence-chain.json`](./evidence-chain.json)
เอกสารนี้สรุปสิ่งที่ทำ ที่วัดได้ และข้อจำกัดที่ยังมีอยู่

## 1. Migration ที่ติดตั้ง — ตรวจก่อนติดตั้ง

**ไฟล์:** `supabase/migrations/20261024000002_public_publication_registry.sql`

| การตรวจ | ผล |
|---|---|
| คำสั่งในไฟล์ | `create table` ×2, `create index` ×3, `alter table … enable rls` ×2, `revoke` ×2 |
| `drop` / `truncate` / `delete` / `alter` ตารางเดิม | **0** |
| ชื่อชนใน DB จริง (relation/index/constraint/function) | **0 / 0 / 0 / 0** |
| ซ้อมใน transaction + `ROLLBACK` | สร้างได้ครบ, RLS เปิด, anon/authenticated อ่านไม่ได้, service_role อ่าน/เขียนได้, **ตารางเดิมเปลี่ยน 0 ตาราง**, ย้อนกลับแล้วตารางหายจริง |
| หลัง apply จริง | `publication_records` + `publication_events` ว่าง, anon อ่านไม่ได้, service_role อ่านได้, แถวเดิม 41/96/3 เท่าเดิม |

**ขอบเขตที่ติดตั้ง:** เฉพาะไฟล์นี้ไฟล์เดียว
**ไม่ติดตั้ง:** `20261024000001_public_signup_never_bootstrap_super_admin.sql` และ migration ค้างอื่นทั้งหมด

## 2. รายการทดสอบ + ผู้มีอำนาจ

| รายการ | ค่า |
|---|---|
| แถวราคา | `pit_materials 3c9f332b…` — ดินถม **50 บาท** |
| เจ้าของ (องค์กร) | บ่อ `36e4b0c9…` "เมฆบ่อดิน _ DNA OS" → `pit:36e4b0c9…` |
| ตัวตนผู้ประกอบการ | `pit_profiles.user_id = 5004cf38…` → **ไม่มีใน auth.users** จึงยืนยันตัวตนไม่ได้ |
| ผู้มีอำนาจอนุมัติ | `super_admin` ตาม `registry/permissions.json` → `t23598788@gmail.com`, `dnaos.tech@gmail.com` |
| `authorized_by` ที่บันทึก | `owner:change-order-2026-10-25` (คำสั่งงานนี้) |
| `verified_by` | `null` — ไม่มีการอ้างว่ามนุษย์ตรวจราคาแล้ว |

## 3. เส้นทาง Writer เดิม → DB → Public Reader → เว็บไซต์

Writer ที่ใช้คือของเดิม: `POST /api/admin/pits/:pitId/materials` (ไม่ใช่ writer ใหม่)
เว็บที่ทดสอบคือหน้าเว็บจริง (`/api/public/products`, `/products/[slug]`) ที่รันด้วย DB จริง

| ขั้น | เวลา (UTC) | ผล |
|---|---|---|
| เผยแพร่ 50 | 18:12:38 | `/api/public/products` → 1 รายการ ราคา 50 · หน้า detail แสดง 50.00 / ดินถม / เมฆบ่อดิน _ DNA OS / "ยังไม่ได้รับการยืนยันราคา" |
| เปลี่ยน 50 → 55 ผ่าน writer เดิม | 18:13:39.683 | **API เห็นใน 0.5 วินาที · หน้า detail เห็นใน 1.1 วินาที** |
| คืนค่า 55 → 50 ผ่าน writer เดิม | 18:13:42.295 | **หน้า detail เห็นใน 0.5 วินาที · API เห็นใน 59.4 วินาที** (ชนเพดาน cache 60 วินาทีของ reader) |

ราคาปัจจุบันกลับเป็น **50** แล้ว (`updated_at 18:13:42.902Z`)

## 4. Evidence Chain

- **สิทธิ์เผยแพร่:** `publication_records.id = 59bc4af2-091c-475e-99cc-90e2ac130af0` (`evidence` เก็บราคาตอนเผยแพร่ = 50)
- **เหตุการณ์:** `publication_events.id = 961197be-4515-4fef-ab67-021017214094` (`null → published`, actor = คำสั่งงานนี้, `backfilled: true`)
- **ต้นทาง:** `pit_materials.id = 3c9f332b…` (ราคา 50, `updated_at 18:13:42.902Z`)

## 5. ข้อจำกัดที่ยังจริงอยู่

1. writer ราคาเดิมไม่มีตาราง audit — ร่องรอยการเปลี่ยนราคาคือ `pit_materials.updated_at` + เอกสารชุดนี้
2. event ของรอบ publish เติมย้อนหลังและระบุ `backfilled: true` (สคริปต์รอบนั้นยังไม่เขียน event; แก้ให้เขียนแล้ว)
3. ทดสอบบน `next dev` local ที่ชี้ DB จริง — **production ยังไม่มี route `/products/*`** (404) จนกว่าจะ deploy
4. ยังไม่มี operator writer เพราะไม่มีตัวตนผู้ประกอบการที่ยืนยันได้ (0/3 ของ `pit_profiles.user_id` ที่มีอยู่ resolves กับ auth.users)

## คำสั่งที่ใช้

```bash
# ซ้อม (ไม่เขียนจริง)
supabase db query --linked -f /tmp/rehearsal2.sql   # BEGIN … ROLLBACK

# ติดตั้งเฉพาะไฟล์ที่อนุมัติ
supabase db query --linked -f /tmp/apply-publication-registry.sql  # BEGIN … COMMIT

# เผยแพร่ 1 รายการ + อ่านกลับผ่าน reader จริง
npx tsx scripts/public-catalog-publish-e2e.ts --apply \
  --id 3c9f332b-cede-4ec5-8a2a-34e579a9907b \
  --authorized-by "owner:change-order-2026-10-25"
```
