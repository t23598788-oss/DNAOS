# ลบกล่องถาม AI ที่ซ้ำซ้อนในหน้าเอกสาร — 2026-10-18

Owner mission: หน้า "เอกสารทั้งหมด" (`/admin/documents`) ที่เปิดใน Tab Bar ของ `/workspace`
มีกล่อง "ถาม AI เรื่องเอกสาร" ซ้ำกับช่อง AI หลักของ Workspace → ถอดออกทั้งกรอบ
คงตาราง/ตัวกรอง/ค้นหา/เครื่องมือจัดการเอกสารเดิมทั้งหมด · ไม่สร้างช่อง AI/แชตใหม่ทดแทน

## ขอบเขตที่แก้ (UI เท่านั้น)

| ไฟล์ | การเปลี่ยนแปลง |
|---|---|
| `app/admin/documents/page.tsx` | ลบ section ท้ายหน้า (h2 "ถาม AI เรื่องเอกสาร", คำอธิบาย, input "พิมพ์คำถามเรื่องเอกสาร...", ปุ่ม "ถาม", กรอบทั้งกรอบ) พร้อม state `aiQuestion/aiAnswer/aiBusy` และ handler `askAi()` ที่ยิง `POST /api/chat` — ไม่มี handler/สเตต AI เหลือในหน้านี้ |
| `scripts/finance-doc-intelligence-test.ts` | T20: สัญญาเดิมบังคับให้หน้ามีคำว่า "ถาม AI" ซึ่งขัดกับคำสั่งเจ้าของรอบนี้ → เปลี่ยนเป็นยืนยัน "ค้น+เปิด+ดาวน์โหลด+พิมพ์ ครบ" **และ** "ไม่มีช่องถาม AI ซ้ำ" (ไม่มี placeholder / aiQuestion / aiBusy / การเรียก `/api/chat`) |

ไม่ได้แตะ: Document Engine (`engines/documents/*`), API (`app/api/admin/documents/*`),
AI Engine/MCP (`services/ai`, `cognitive/*`, `app/api/chat/*`), Database/migrations,
Connect Registry, Canonical Writers, ระบบสิทธิ์องค์กร · ไม่มี commit/push/deploy

## ผลตรวจ (PASS / FAIL)

| # | เงื่อนไข | ผล | หลักฐาน |
|---|---|---|---|
| 1 | ตรวจซอร์สหน้าเอกสารก่อนแก้ | PASS | `app/admin/documents/page.tsx` (269 บรรทัด) — section AI อยู่ท้ายไฟล์เดิม บรรทัด 243–257 |
| 2 | ลบหัวข้อ/คำอธิบาย/ช่องพิมพ์/ปุ่มถาม/กรอบทั้งหมด | PASS | `hasAskAiHeading=false`, `hasAskAiPlaceholder=false`, `hasAskButton=false`, `hasChatApi=false` จาก markup จริงของ component |
| 3 | คงตาราง/ตัวกรอง/ค้นหา/เครื่องมือจัดการเอกสาร | PASS | 7 input + 1 select (ค้นหา, ประเภท, สถานะ, เลขอ้างอิง, วันที่ 2, จำนวนเงิน 2) · หัวตาราง เลขเอกสาร/ประเภท/คู่ค้า/วันที่/จำนวนเงิน/ไฟล์ · ปุ่ม "ค้นหา"/"ล้างตัวกรอง" · เปิด PDF / PNG / ดาวน์โหลด / พิมพ์ (ไม่ได้แก้) |
| 4 | ไม่สร้างช่อง AI/แชตใหม่ทดแทน | PASS | ไม่มี input/ปุ่ม/handler ใหม่ใน diff · composer กลางของ Workspace ไม่ถูกแตะ |
| 5 | ไม่แก้ Document Engine/AI/DB/API/Canonical Writers | PASS | `git diff --stat` = 2 ไฟล์ (UI + test) เท่านั้น |
| 6 | หน้าเอกสารทำงานเดิม ไม่มีช่องถาม AI ซ้ำ | PASS (ดูข้อจำกัด) | typecheck 0 · T20 PASS · layout ลงท้ายที่ตาราง + padding 24px ไม่มีกรอบว่างค้าง |
| 7 | ทดสอบผ่าน Chrome + ภาพหน้าจอ | PASS บางส่วน | ภาพ `/tmp/documents-shots/*.png` (ดูข้อจำกัดเรื่อง session) |

## การตรวจที่รันจริง

```
npx tsc --noEmit                                        → exit 0
npx tsx scripts/finance-doc-intelligence-test.ts        → 27 passed, 2 failed (T1/T5 มีมาก่อน — ดูด้านล่าง)
npx tsx scripts/workspace-tab-bar-test.ts               → exit 0 (20 PASS)
npx tsx scripts/workspace-adaptive-composer-test.ts     → exit 0 (9 PASS)
npx tsx scripts/workspace-icon-cleanup-test.ts          → exit 0 (8 PASS)
npx tsx scripts/workspace-single-sidebar-test.ts        → exit 0 (10 PASS)
npx eslint app/admin/documents/page.tsx                 → 1 error + 1 warning (มีอยู่ก่อนแล้วที่ HEAD)
```

- **T1/T5 (มีมาก่อน ไม่เกี่ยวกับงานนี้)**: `registry/ai-adapter-registry.json` ตั้ง `openai.enabled=false`
  และ `cognitive/pipeline.ts` ถูกแก้จากงานอื่น (hook doc-QA ย้ายตำแหน่ง) — อยู่ในพื้นที่
  "ห้ามแก้ AI Engine" ของงานนี้ จึงไม่แตะและรายงานตามจริง
- **eslint error ที่ค้าง**: `react-hooks/set-state-in-effect` (บรรทัด `useEffect(() => { void load() }, [load])`)
  ตรวจแล้วเกิดเหมือนกันกับไฟล์เวอร์ชัน `HEAD` (ผ่าน `git show HEAD:… | eslint --stdin`) → ไม่ใช่ของใหม่
- **tenant-workspace-org-ui-test**: รันไม่ได้รอบนี้เพราะสคริปต์สตาร์ท `next dev` เอง
  แต่พอร์ต 3141 ถูกเซิร์ฟเวอร์ที่เจ้าของเปิดอยู่ครอบ → "Next dev ออกก่อนพร้อม (exit 1)"
  (เทสต์นี้ผ่านในรอบงานก่อนหน้า)

## ภาพหน้าจอ

- `/tmp/documents-shots/documents-render-1280.png`, `-1024.png` — เรนเดอร์ markup จริงของ
  `DocumentsPage` (react-dom/server) ที่ 1280/1024: เห็นหัวเรื่อง ตัวกรอง ตาราง และ **ไม่มี** กล่อง AI ท้ายหน้า
- `/tmp/documents-shots/workspace-documents-tab-1280.png` — `/workspace` เปิดแท็บ "เอกสาร" แล้ว

## ข้อจำกัด (รายงานตรง)

1. environment นี้ไม่มี Supabase session จริง → ทุกเส้นทาง `/admin/*` ถูก middleware guard ไป
   `/login?next=/admin/documents` (ยืนยันแล้ว: frame ในแท็บเอกสาร = หน้า login) จึง **ถ่ายภาพหน้าจอ
   หน้าเอกสารแบบล็อกอินจริงไม่ได้** · ภาพที่ให้มาจึงเป็น (ก) markup จริงของ component และ (ข) workspace
   ที่เปิดแท็บเอกสาร (เห็นแค่ guard) · เจ้าของต้องเปิดดูด้วยบัญชีของตัวเองที่ `http://localhost:3141/workspace`
2. ตรวจว่าไม่มีช่องถาม AI ซ้ำได้จาก markup ของ component จริง (ไม่พบ heading/placeholder/ปุ่ม/การเรียก `/api/chat`)
   แต่ไม่ได้คลิกทดสอบส่งคำถามหลังล็อกอิน (เพราะยังไม่ได้ล็อกอิน)
3. ไม่ได้รัน `npm run precommit` (สคริปต์เขียน `registry/` ซึ่งอยู่นอกขอบเขตงานนี้)
