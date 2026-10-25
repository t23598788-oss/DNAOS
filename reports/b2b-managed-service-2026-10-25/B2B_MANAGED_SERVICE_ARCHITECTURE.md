# B2B — MANAGED SERVICE ARCHITECTURE
**วันที่:** 2026-10-25 · **สถานะ:** ข้อเสนอออกแบบ (ยังไม่มีการบันทึกการมอบอำนาจจริง ไม่มีโค้ด/สคีมาใหม่ในรอบนี้)

> **แยกประเภทหลักฐาน**
> 🟢 **PROVEN** = ค่าที่อ่านจาก Production จริง (มี ID/จำนวนกำกับ)
> 🔵 **PROPOSED** = สถาปัตยกรรม/คอลัมน์/flow ที่เสนอ ยังไม่ได้สร้าง

---

## 01 OBJECTIVE

ออกแบบความสัมพันธ์ B2B (เจ้าของกิจการ → ผู้รับบริหารจัดการ → DNA OS) บน **ตารางที่มีอยู่จริง** โดยแยกสิทธิ์ 4 บทบาทให้ชัด และไม่ให้ DNA OS กลายเป็นคู่สัญญาซื้อขายโดยอัตโนมัติ

---

## 02 SOURCE EVIDENCE — ความสัมพันธ์ที่มีอยู่จริงใน Production

### 2.1 Tenant / องค์กร
| ตาราง | แถวจริง | คอลัมน์ |
|---|---|---|
| `organizations` | **1** — `1f52520a-39fa-448f-8455-9ee4c72b00b0` "สำนักงานใหญ่" (created 2026-10-18 โดย `33a80907…`) | `id, name, created_at, created_by` |
| `org_members` | **2** | `organization_id, user_id, role (text), created_at` — **ไม่มี scope, ไม่มี granted_by, ไม่มี revoked_at** |
| `companies` | **86** (0 แถวมี `organization_id`) | `…, organization_id uuid` |
| `identity_memberships` | **2** | `membership_id, identity_id, account_id, world, role, granted_at, revoked_at` — **มี revocation จริง** |
| `identities` | **22** (มี `auth_user_id` จริง 3) | `identity_id, auth_user_id, email, …` |

org members จริง:
| org | user | org role | profile role | email |
|---|---|---|---|---|
| สำนักงานใหญ่ | `33a80907…` | `owner` | `super_admin` | t23598788@gmail.com |
| สำนักงานใหญ่ | `c8cf2d52…` | `admin` | `super_admin` | dnaos.tech@gmail.com |

→ **บทบาทใน org (owner/admin) เป็นข้อความอิสระ ไม่ผูกกับสิทธิ์ใด ๆ** และทั้งคู่เป็น `super_admin` ระดับระบบ

### 2.2 เจ้าของทรัพยากร
| ตาราง | ข้อเท็จจริง |
|---|---|
| `pit_profiles` | 77 บ่อที่ยังใช้งาน · `owner_type`: `LINE_OWNER` 75, `ADMIN_MANAGED` 2 · มี `user_id` 3 แถว แต่ **0 แถวที่ user_id มีจริงใน `auth.users`** |
| `companies` | ไม่มี FK ไป `pit_profiles` |
| `partners.pit_profile_id` | ตาราง `partners` **ว่าง 0 แถว** |
| `publication_records.organization_owner` | รูปแบบ `pit:<pit_profiles.id>` — ผูกเฉพาะรายการที่เผยแพร่ |

### 2.3 ตัวอย่างจริง: เฮียอุทัย (ใช้เป็นแบบจำลอง)
| ชั้น | ค่าจริง |
|---|---|
| กิจการ | `companies baf76c98-5e50-4a5f-b6f1-5527e2daa710` "เฮียอุทัย สานุสันต์" · type `CUSTOMER` · status `ACTIVE` · `organization_id NULL` · `is_individual false` |
| ช่องทางยืนยันตัวตน | `company_line_links baf76c98… ↔ Uc49b5932f69629aea670883d5cd07662` · `line_profiles.display_name = "เฮียอุทัย"`, role `supplier` · `connect_external_identities` provider `line`, company `baf76c98…`, role `supplier`, trust `verified`, source `backfill` |
| บัญชี login | **ไม่มี** — ไม่มีแถวใน `identities` ที่ผูก auth account |
| บ่อ/ราคาที่เป็นของเขา | **ไม่พบ** — ไม่มี `pit_profiles` ที่ contact/registered name ตรงกับเขา |

**สรุปจากข้อมูลจริง:** เฮียอุทัยยืนยันตัวตนได้ทาง LINE (verified) แต่ **ยังใช้ระบบเองไม่ได้** และไม่มีทรัพยากรที่ผูกกับเขาในสคีมาปัจจุบัน

---

## 03 ROLE MODEL ที่ต้องแยก (สถานะจริง vs เป้าหมาย)

| ความสามารถ | เจ้าของข้อมูล | ผู้แก้ราคา (B2B) | ผู้อนุมัติเผยแพร่ | ผู้ดูแลระบบ (DNA OS) |
|---|---|---|---|---|
| เพิ่ม/แก้ราคาในบ่อของตน | ✅ เป้าหมาย | ✅ ตาม scope | ❌ | ⚠️ เฉพาะกรณีมีเหตุ + มีหลักฐาน |
| อนุมัติ/ถอนเผยแพร่สาธารณะ | ✅ | ❌ | ✅ | ⚠️ เฉพาะตามคำสั่งเจ้าของ |
| เห็นราคา/ข้อมูลภายในบ่อ | ✅ | ✅ ตาม scope | ✅ | ⚠️ เท่าที่จำเป็นต่อการซ่อม |
| มอบหมาย/ถอดถอนผู้ดูแล | ✅ | ❌ | ❌ | ❌ |
| ตรวจประวัติการดำเนินงาน | ✅ | เห็นของตน | เห็นของตน | เห็นของระบบ |

**สถานะจริงวันนี้**
- `requireAuth(ADMIN_TIER)` ให้ `super_admin/admin/employee` เขียน **ทุกบ่อ** (`app/api/admin/pits/[pitId]/materials/route.ts:27`)
- `core/public-catalog/authority.ts:187–192` ให้ admin tier เผยแพร่ทรัพยากรใดก็ได้ (`ALLOWED_PLATFORM`)
- ไม่มีแนวคิด "เจ้าของบ่อ" ที่ตรวจสอบได้ (0/3) → **การแยก tenant ยังไม่มีผลจริง**
- ไม่มีที่เก็บ "ผู้ได้รับมอบหมาย" ที่ผูกกับทรัพยากร (org_members ไม่มี scope)

→ ขัดกับข้อกำหนด "ห้ามสมมติว่าแอดมินมีสิทธิ์แก้ข้อมูลของทุกองค์กรโดยอัตโนมัติ" — ต้องแก้เป็น **scoped grant** ก่อนเปิด B2B

---

## 04 สถาปัตยกรรมการมอบอำนาจ (ข้อเสนอ)

### 4.1 หลักการ
1. **เจ้าของคือรากของสิทธิ์** — สิทธิ์ทุกอย่างสืบจาก `pit_profiles.user_id → identities.auth_user_id`
2. **การมอบอำนาจเป็นข้อมูล ไม่ใช่ role ระดับระบบ** — เก็บเป็นแถว grant ที่มีขอบเขต + วันหมดอายุ + ผู้ให้ + ผู้ถอด
3. **แก้ราคา ≠ เผยแพร่** — สองสิทธิ์แยกกันเสมอ (ปัจจุบันแยกอยู่แล้วใน publication แต่ยังไม่มีการบังคับฝั่งราคา)
4. **ทุกการกระทำมีหลักฐาน** — ใช้ `audit_logs` / `publication_events` เดิม
5. **DNA OS เป็นผู้ให้เครื่องมือ** — ไม่ได้เป็นผู้ซื้อ/ผู้ขายวัสดุ และไม่ใช่คู่สัญญาแทนเจ้าของ

### 4.2 การจับคู่กับตารางเดิม

| ต้องการ | ใช้ของเดิม | ช่องว่าง | ข้อเสนอ (additive) |
|---|---|---|---|
| องค์กร/tenant | `organizations` | มี 1 แถว, ไม่มีใครใช้ | ใช้ต่อ ไม่สร้างใหม่ |
| สมาชิกองค์กร | `org_members` | ไม่มี scope/revoked_at | เพิ่ม `scope jsonb`, `revoked_at`, `granted_by` (migration เดียว) |
| บัญชี↔ตัวตน | `identities.auth_user_id` | เฮียอุทัยยังไม่มีบัญชี | ใช้ขั้นตอนสมัคร/ยืนยันตัวตนเดิม (magic link) — ไม่แก้ OTP |
| เจ้าของบ่อ | `pit_profiles.user_id` | 0/3 resolve ได้ | เติม user_id จาก identity ที่ยืนยันแล้ว (ต้องอนุมัติข้อมูล) |
| บ่อ→องค์กร | **ไม่มี** | ไม่มีคอลัมน์ org ใน pit_profiles | เพิ่ม `pit_profiles.organization_id` **หรือ** ตารางเชื่อม (เลือกอย่างเดียว) |
| มอบอำนาจ/ถอดถอน | `identity_memberships(granted_at, revoked_at)` | ไม่มี scope ระดับทรัพยากร | ใช้เป็น "บัญชีการมอบ" + อ้าง `org_members.scope` |
| สิทธิ์เผยแพร่ | `publication_records(organization_owner, allowed_public_fields, expires_at)` | ต้องมีผู้ให้สิทธิ์ที่ตรวจสอบได้ | เพิ่ม `authorized_by_user_id uuid` (อนุมัติ) |
| หลักฐาน | `audit_logs`, `publication_events` | audit ไม่มี trace/actor text | ตามเอกสาร Writer Integrity |

### 4.3 รูปแบบ Grant (ข้อเสนอ)
```
org_members
  organization_id  → organizations.id
  user_id          → identities.auth_user_id (บัญชีจริง)
  role             owner | b2b_operator | price_editor | publication_approver | viewer
  scope            { "pits": ["<pit_id>"], "actions": ["price.write"] }   ← jsonb ใหม่
  granted_by       uuid (ต้องเป็น owner ของ org)
  granted_at       timestamptz (มีอยู่)
  revoked_at       timestamptz (ใหม่)  ← ถอดสิทธิ์แบบเก็บประวัติ ไม่ลบแถว
```
การตรวจสิทธิ์ (ทุกครั้งที่เขียน): `identity → org_members (revoked_at IS NULL, ไม่หมดอายุ) → scope.pits ครอบ resource → role มี action นั้น`

---

## 05 กรณีใช้งาน 6 ข้อ (อิงเฮียอุทัย)

| # | ความต้องการ | สถานะจริง | ต้องมีอะไร |
|---|---|---|---|
| 1 | เจ้าของใช้ระบบเอง | ❌ ไม่มีบัญชีให้เฮียอุทัย | ผูก `identities.auth_user_id` + `pit_profiles.user_id` |
| 2 | มอบหมายทีม B2B ดูแลแทน | ❌ ไม่มีที่เก็บการมอบ | grant แบบ 4.3 + UI อนุมัติ (P1) |
| 3 | ผู้รับมอบหมายแก้ได้เฉพาะขอบเขต | ❌ writer ไม่ตรวจ scope | ตรวจ scope ใน writer เดิม (ไม่สร้างตัวใหม่) |
| 4 | แก้ราคา ≠ เผยแพร่ | ⚠️ แยกฝั่งเผยแพร่แล้ว แต่ราคาไม่มีสิทธิ์ของตัวเอง | action `price.write` vs `publication.approve` |
| 5 | เจ้าของตรวจประวัติ + ถอนสิทธิ์ | ⚠️ `audit_logs` มี แต่ไม่มีหน้าของเจ้าของ; `org_members` ไม่มี revoked_at | ใช้ `identity_memberships.revoked_at` + รายงานจาก `audit_logs` |
| 6 | DNA OS ดูแลเครื่องมือ ไม่เป็นคู่สัญญา | ✅ ในเชิงข้อมูล (ราคา/เอกสารเป็นของเจ้าของ) แต่ยังไม่มีข้อความสัญญาในระบบ | ระบุขอบเขตใน `publication_records.evidence` + หน้าเงื่อนไข |

---

## 06 ขอบเขตความรับผิดชอบ DNA OS

| DNA OS ทำ | DNA OS ไม่ทำ |
|---|---|
| ให้เครื่องมือบันทึก/เผยแพร่ และซ่อมระบบ | เป็นผู้ขาย/ผู้ซื้อวัสดุ หรือออกใบเสนอราคาแทนเจ้าของโดยอัตโนมัติ |
| เก็บหลักฐานการกระทำ (audit/events) | รับผิดชอบความถูกต้องของราคาที่เจ้าของ/ผู้รับมอบกรอก |
| บังคับสิทธิ์ตาม scope | ให้สิทธิ์ตัวเองข้ามเจ้าของโดยไม่มีการบันทึกเหตุผล |
| เปิด/ปิดการเผยแพร่ตามคำสั่งที่ตรวจสอบได้ | เผยแพร่ข้อมูลของพาร์ตเนอร์โดยไม่มี consent ที่ยืนยันได้ |

---

## 07 สิ่งที่ "ยังไม่ทำ" ในรอบนี้ (โดยเจตนา)

- ไม่มี migration ใหม่ (ทุกข้อใน 4.2 เป็นข้อเสนอ)
- ไม่บันทึก grant จริงของเฮียอุทัย
- ไม่แก้ writer ให้ตรวจ scope
- ไม่มี UI ใหม่
