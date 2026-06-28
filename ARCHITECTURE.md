# DNA OS Architecture Guide

## V1-V6 Layer Structure

ระบบแบ่งเป็น 6 layer ทำงานเรียงกัน ห้ามข้ามลำดับ:

| Layer | โฟลเดอร์ | หน้าที่ |
|-------|----------|---------|
| V1 - Input | `lib/v1-input/` | รับ event จาก webhook/API แปลงเป็น structured event |
| V2 - Rules | `lib/v2-rules/` | ตรวจ business rule (จาก DB) ว่า event ถูกต้องไหม |
| V3 - Engines | `lib/v3-engines/` | คำนวณ business logic (หนี้, ดอกเบี้ย, สถานะ) |
| V4 - AI | `lib/v4-ai/` | แปลผลลัพธ์เป็น command สำหรับ execution |
| V5 - Presenter | `lib/v5-presenter/` | จัด format ข้อมูลสำหรับแสดงผล (document, UI) |
| V6 - Executor | `lib/v6-executor/` | เขียน DB, เรียก external service, ส่ง LINE |

## กฎการ Import (บังคับโดย ESLint)

- **V1-V5 ห้าม import `@supabase/supabase-js`** -- เฉพาะ V6 และ `lib/supabase/` เท่านั้น
- **V5 ห้าม import จาก V3** -- Presenter รับข้อมูลผ่าน parameter เท่านั้น
- **V4 ห้าม import `lib/runtime/engine`** -- AI ไม่ register command เอง
- **UI (components/, app/) ห้าม import จาก V1** -- ต้องผ่าน API route
- **ห้ามสร้าง type ซ้ำ** -- Command/CommandResult/RuntimeCommand ต้องมาจาก `lib/shared/types.ts`

## แหล่งข้อมูลหลัก (Source of Truth)

| สิ่งที่ต้องการ | ที่อยู่ | ห้าม |
|---------------|--------|------|
| Type definitions | `lib/shared/types.ts` | สร้าง type ซ้ำที่อื่น |
| Config/Policy | DB ผ่าน config-loader | Hardcode ค่าใน source code |
| DB Access | `lib/supabase/` + `lib/v6-executor/` | Import supabase ใน layer อื่น |
| Drivers | `lib/v6-executor/drivers/` | สร้าง `lib/drivers/` แยก |
| Core Engine | `lib/v6-executor/core/` | สร้าง `lib/core/` แยก |

## Path Aliases (tsconfig)

```
@/types/*    --> lib/shared/*
@/drivers/*  --> lib/v6-executor/drivers/*
@/core/*     --> lib/v6-executor/core/*
@/*          --> ./*  (เดิม)
```

## วิธีเพิ่ม Feature ใหม่

1. เพิ่ม business rule ใน DB (ไม่ใช่ hardcode ใน code)
2. สร้าง engine ใน `lib/v3-engines/` สำหรับ logic
3. ลงทะเบียนใน registry (`lib/v6-executor/core/registry.ts`)
4. สร้าง driver ใน `lib/v6-executor/drivers/` ถ้าต้องเชื่อมระบบนอก
5. อัพเดท presenter ใน `lib/v5-presenter/` ถ้าต้องแสดงผล

## วิธีรัน Guard Check

```bash
# ตรวจก่อน commit
bash scripts/pre-commit-check.sh

# ตรวจ ESLint layer rules
npm run lint

# ตรวจ TypeScript types
npm run type-check
```

## กฎเหล็ก

- ห้าม mock/fake data ใน v3-engines (Rule 94)
- ห้าม hardcode Supabase URL -- ใช้ env var เสมอ
- ทุกหน้า render ข้อมูลจาก DB เท่านั้น (Production Mode)
- Document template มีแบบเดียว เปลี่ยนแค่ `document_type`
