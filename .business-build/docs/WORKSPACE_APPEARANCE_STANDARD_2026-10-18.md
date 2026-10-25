# DNA OS — LOCK WORKSPACE APPEARANCE STANDARD (2026-10-18)

สถานะ: **PASS** (UI contract + browser test)
ขอบเขต: Presentation only — ไม่แตะ Business Engine, Database/Schema, Finance logic,
AI Gateway, MCP, Connect Registry, Auth หรือ Document Engine
ไม่ได้ Commit / Push / Deploy

## ผลตรวจตามข้อ 01–08

| ข้อ | ผล | หลักฐาน |
| --- | --- | --- |
| 01 ธีมมาตรฐาน 5 รูปแบบ + ปรับแต่งเอง | **PASS** | `[data-ws-preset]` = กระจกใส / กระจกสว่าง / กระจกเข้ม / กระจกสี / อัตโนมัติ / ปรับแต่งเอง |
| 02 Design Tokens กลางชุดเดียว | **PASS** | shell + Sidebar + Tab Bar + QAI Composer + หน้าจอเครื่องมือ same-origin ใช้ `--ws-*` / `--qai-*` / `--dna-*` ชุดเดียวกัน |
| 03 ปรับแต่งเองเหลือ 6 ตัวควบคุม | **PASS** | โทนสี 1 · ความโปร่งใส · ความเบลอ · ขนาดตัวอักษร · ขนาดไอคอน · ความโค้งของมุม (5 สไลเดอร์) |
| 04 โหมดอัตโนมัติ | **PASS** | `prefers-color-scheme` ผ่าน `matchMedia` เดิม; OS dark → Dark Glass, OS light → Light Glass เปลี่ยนสด |
| 05 ลบส่วนโปรไฟล์ซ้ำ | **PASS** | ไม่มี “โปรไฟล์ของฉัน” / “รูปโปรไฟล์บัญชีนี้” / ปุ่ม “เปลี่ยนรูป” ในแผงหน้าตา |
| 06 ตั้งค่าเหลือจุดเดียว | **PASS** | จุดเดียวที่ปุ่มเฟืองเดิม; Connections & Credentials และโปรไฟล์บริษัทเดิมไม่ถูกแตะ |
| 07 บันทึกการตั้งค่า | **PASS** | ใช้ `app_configs` เดิม key `workspace-ui:<userId>` ผ่าน `GET/PUT /api/workspace/ui-preferences`; ไม่มีตาราง/คอลัมน์/migration ใหม่ |
| 08 ตรวจสอบ | **PASS** | `npx tsx scripts/workspace-final-ui-test.ts` = 13 checks PASS |

## สิ่งที่ตรวจด้วย Browser (Chromium)

เปิด `http://localhost:3141/workspace` และทดสอบจริง:

- ไม่มี Bottom Bar/Footer ทุกชั้น; พื้นที่กลางถึงขอบล่าง
- Composer กล่องเดียว โปร่งใส, hover/focus เปลี่ยนพื้นผิว, ข้อความที่ยังไม่ส่งไม่หาย
- ธีมทั้ง 5 เปลี่ยน shell, Sidebar, Tab Bar, Composer พร้อมกัน
- Auto เปลี่ยนตาม `prefers-color-scheme` โดยไม่ต้องเลือกธีมใหม่
- ปรับเองแล้วตัวอักษร 17px, ไอคอน 26px, มุม 24px, โปร่งใส 55% ส่งถึง Composer ทันที
- บันทึกค่า → reload → ค่ายังอยู่ → คืนค่าเริ่มต้นกลับ Clear Glass
- เปิด `/admin/ui-gallery` ใน `#toolFrame`: ได้ `data-dna-ws-theme` + token กลาง
  (พื้นหลัง/ฟอนต์/การ์ด/ขอบ/มุม) และเปลี่ยนตามธีมขณะเปิดอยู่
- เอกสาร/PDF ใน nested document ไม่ถูกแต่งสี/ฟอนต์ตามธีม (ยังขาว/ดำ/Times เดิม)
- โปรไฟล์บริษัทเดิม + Tab Bar เดิมยังทำงาน

## ภาพหน้าจอ

โฟลเดอร์: `docs/workspace-screenshots/workspace-appearance-2026-10-18/`

1. `01-no-bottom-bar.png`
2. `02-composer-transparent.png`
3. `03-clear-glass.png`
4. `04-light-glass.png`
5. `05-tinted-glass.png`
6. `06-dark-glass.png`
7. `06b-dark-resource-table.png`
8. `07-auto-dark.png`
9. `08-auto-light.png`
10. `09-custom.png`
11. `10-tool-page-dark.png`
12. `11-document-output-unchanged.png`

## ไฟล์ที่แก้ไข / เพิ่ม

### แก้ไข
- `public/material-workspace/index.html` — 5 ธีม + ปรับแต่งเอง, 6 ตัวควบคุม, ไม่มีโปรไฟล์ซ้ำ
- `public/material-workspace/workspace-preferences.js` — token กลาง 5 ธีม, Auto, per-account persistence, ส่ง `mode` ให้ Composer
- `public/material-workspace/workspace-customization.js` — wiring แผงหน้าตาเดียว, scope ปุ่มธีม, bridge ไปยัง tool page
- `public/material-workspace/style.css` — พื้นผิว/ตัวอักษร/ตาราง/ฟอร์ม/Composer ใช้ token กลาง (รวม `--ink`/`--muted` เดิมของ shell)
- `app/globals.css` — central `--dna-*` bridge สำหรับหน้าจอเครื่องมือ same-origin (ไม่แตะ nested document)
- `app/workspace/DNAOSChatEngine.tsx` — รับ `mode` ที่ resolve แล้ว (Auto dark ใช้ Dark Glass ถูกต้อง)
- `app/admin/documents/page.tsx` — เปลี่ยนสี inline ของหน้าเอกสารเป็น `--dna-*` (ไม่แตะ Document Engine/ไฟล์ PDF)
- `scripts/workspace-final-ui-test.ts` — acceptance test ตามมาตรฐานใหม่

### เพิ่ม
- `app/api/workspace/ui-preferences/route.ts` — GET/PUT preference ต่อบัญชี ผ่าน `app_configs` เดิม (ไม่มีตารางใหม่)
- `docs/WORKSPACE_APPEARANCE_STANDARD_2026-10-18.md` — เอกสารนี้
- `docs/workspace-screenshots/workspace-appearance-2026-10-18/*.png`

## คำสั่งตรวจ

```bash
npx tsx scripts/workspace-final-ui-test.ts
npx tsc --noEmit
npx eslint app/workspace/DNAOSChatEngine.tsx scripts/workspace-final-ui-test.ts
```

ผลที่รันจริง:

- `workspace-final-ui-test.ts` — **13 checks PASS**
- `tsc --noEmit` — **PASS** (ไม่มี error)
- `eslint` — 0 error, 1 warning เดิม (`react-hooks/exhaustive-deps` disable ที่ไม่มีปัญหา) ไม่ใช่จากงานนี้
- `workspace-tab-bar-test.ts` — 19 PASS
- `workspace-adaptive-composer-test.ts` — 8 PASS
- `workspace-single-sidebar-test.ts` — 9 PASS
- `workspace-icon-cleanup-test.ts` — 7 PASS
- `one-workspace-navigation-test.ts` — 25 passed, 0 failed
- `tenant-workspace-org-ui-test.ts` — 4 PASS เมื่อใช้ `BASE_URL=http://localhost:3141`
  (ตัวเทสต์เปิด dev server เองไม่ได้ขณะมี dev server รันอยู่ — ข้อจำกัดของ harness ไม่ใช่ UI)

## ข้อจำกัดที่รายงานตรง

1. เครื่องนี้ไม่มี session จริงใน browser context ของเทสต์ → intercept เฉพาะ endpoint ที่ shell เรียกอยู่แล้ว
   (`org-context`, `ui-preferences`, `pits`, connectors, `embed-check`) ไม่ได้เขียน DB จริง
2. การบันทึก preference ฝั่งเซิร์ฟเวอร์ใช้ `app_configs` เดิม (key ต่อ user) — ตรวจด้วย typecheck +
   client PUT/GET contract; ยังไม่ได้ทดสอบกับบัญชีจริงบน production
3. หน้าจอที่ใช้สีสถานะเฉพาะ (แดง/เขียว/เหลือง/น้ำเงิน) ยังคงสีสถานะเดิมเพื่อความหมายทางธุรกิจ;
   พื้นผิว/ตัวอักษร/เส้นขอบ/มุม/ฟอนต์ใช้ token กลาง
4. ไม่ได้ Commit / Push / Deploy — รอเจ้าของตรวจ
