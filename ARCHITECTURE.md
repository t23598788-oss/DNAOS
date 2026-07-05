# DNA OS Architecture Guide

## Layer Structure

ระบบแบ่งเป็น layer ทำงานเรียงกัน ห้ามข้ามลำดับ:

| Layer | โฟลเดอร์ | หน้าที่ |
|-------|----------|---------|
| Cognitive | `lib/cognitive/` | Pipeline กลาง: Intent → Plan → Execute → Reflect |
| V2 - Rules | `lib/v2-rules/` | ตรวจ business rule + **Command Dispatcher บังคับใช้กฎ** |
| V3 - Engines | `lib/v3-engines/` | คำนวณ business logic (หนี้, ดอกเบี้ย, สถานะ) |
| V4 - AI | `lib/v4-ai/` | แปลผลลัพธ์เป็น command สำหรับ execution |
| V5 - Presenter | `lib/v5-presenter/` | จัด format ข้อมูลสำหรับแสดงผล (document, UI) |
| V6 - Executor | `lib/v6-executor/` | เขียน DB, เรียก external service, ส่ง LINE |
| Middleware | `lib/middleware/` | Auth + Sanitize |
| macOS | `lib/macos/` | Native macOS Drivers (Swift — AX, Keyboard, Mouse) |

## Command Dispatcher — ผู้บังคับใช้กฎ

ทุก command ต้องผ่าน `lib/v2-rules/dispatcher.ts` ก่อนเข้าถึงข้อมูล:

```
User → Cognitive Pipeline → Planner → Executor
                                         ↓
                              ┌── dispatcher.ts ──┐
                              │ 1. อยู่ใน registry?│ → ไม่มี = reject
                              │ 2. input ถูก?      │ → ขาด = reject
                              │ 3. ต้อง confirm?   │ → Rule 72
                              │ 4. ใส่ filter      │ → จาก query_constraints
                              └────────────────────┘
                                         ↓
                                    Query DB
                              (filter บังคับใช้แล้ว)
```

- `command-registry.json` = ประกาศ command ทั้งหมด + input schema + requires_confirmation
- `query_constraints` = ประกาศ table + filter ที่ถูกต้องของทุก read command
- Shadow Command (ไม่อยู่ใน registry) = **ถูกปฏิเสธเสมอ**

## กฎการ Import (บังคับโดย ESLint)

- **V2-V5 ห้าม import `@supabase/supabase-js`** — เฉพาะ V6 และ `lib/supabase/` เท่านั้น
- **V5 ห้าม import จาก V3** — Presenter รับข้อมูลผ่าน parameter เท่านั้น
- **V4 ห้าม import `lib/runtime/engine`** — AI ไม่ register command เอง
- **ห้ามสร้าง type ซ้ำ** — Command/CommandResult/RuntimeCommand ต้องมาจาก `lib/shared/types.ts`

## แหล่งข้อมูลหลัก (Source of Truth)

| สิ่งที่ต้องการ | ที่อยู่ | ห้าม |
|---------------|--------|------|
| Type definitions | `lib/shared/types.ts` | สร้าง type ซ้ำที่อื่น |
| Command definitions | `lib/registry/command-registry.json` | Hardcode command ใน code |
| Query constraints | `command-registry.json → query_constraints` | Hardcode filter ใน code |
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
2. ลงทะเบียน command ใน `command-registry.json` พร้อม input/output/requires_confirmation
3. เพิ่ม query_constraints ถ้าเป็น read command (table + filters)
4. เพิ่ม query handler ใน `lib/v2-rules/dispatcher.ts`
5. สร้าง engine ใน `lib/v3-engines/` ถ้ามี logic คำนวณ
6. สร้าง driver ใน `lib/v6-executor/drivers/` ถ้าต้องเชื่อมระบบนอก
7. อัพเดท presenter ใน `lib/v5-presenter/` ถ้าต้องแสดงผล
8. ลงทะเบียนไฟล์ใน `module-registry.json`

## วิธีรัน Guard Check

```bash
bash scripts/pre-commit-check.sh   # ตรวจก่อน commit
npm run lint                        # ตรวจ ESLint layer rules
npm run type-check                  # ตรวจ TypeScript types
npm run guard                       # ตรวจ governance ทุกข้อ
npm run backup                      # Backup ฐานข้อมูลก่อน deploy
```

## กฎเหล็ก

- ห้าม mock/fake data ใน v3-engines (Rule 94)
- ห้าม hardcode Supabase URL — ใช้ env var เสมอ
- ทุกหน้า render ข้อมูลจาก DB เท่านั้น (Production Mode)
- Document template มีแบบเดียว เปลี่ยนแค่ `document_type`
- ทุก write ต้อง confirmed จากมนุษย์ (Rule 72) — บังคับโดย dispatcher
- Shadow Command (ไม่อยู่ใน registry) ถูกปฏิเสธเสมอ — บังคับโดย dispatcher
