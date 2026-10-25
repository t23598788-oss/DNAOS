# ONE WORKSPACE · ONE NAVIGATION · ONE AI COMPOSER — 2026-10-18

Owner mission: รวม Workspace ให้เหลือ navigation และกล่อง AI ชุดเดียว
URL ตรวจ: `http://localhost:3141/workspace`

## สิ่งที่ทำ (UI / navigation เท่านั้น)

1. **ถอดแถบไอคอนแนวตั้งด้านในหน้า LINE Official Account**
   (`app/admin/line-customers/page.tsx` เดิมมี `RAIL_ITEMS` = LINE · งาน · คู่ค้า · เอกสาร ·
   คลังเอกสาร · การเงิน · ศูนย์ควบคุมทรัพยากร) — ลบเฉพาะ navigation ซ้ำ **ไม่ลบเครื่องมือ**
   โดยทำ `railItems` ของ `presentation/shell/AppShell.tsx` เป็น optional (ไม่ส่ง = ไม่วาด rail
   แต่ ListColumn รายชื่อลูกค้า + เนื้อหาหลักยังอยู่ครบ)
2. **Sidebar หลักของ Workspace เป็นทางเข้าเดียว**: `tools.json` เปลี่ยนรายการ "LINE" จาก
   `external: https://manager.line.biz/` → `route: /admin/line-customers` (หน้าจอ LINE จริงในแท็บ)
   และเพิ่ม `LINE Manager` (เว็บผู้ให้บริการจริง) ใน `business-tools.json` กลุ่ม LINE / Social
   ⇒ ไม่มีเครื่องมือไหนหายไป และไม่มีทางเข้าซ้ำสำหรับหน้าจอเดียวกัน
3. **ถอดช่อง/ปุ่ม "ถาม AI" เฉพาะหน้า LINE** (ปุ่ม action `ai` + popover `aiAskOpen` + ฟังก์ชัน `askAi`)
   เพราะซ้ำกับกล่องกลาง — **คงการรับส่งข้อความ LINE จริงทั้งหมด** (ช่องตอบลูกค้า `sendReply`,
   แนบไฟล์ `/api/admin/upload`, ส่งแจ้งหนี้ `/send-debt`, ส่งเอกสาร `/send-document`)
   badge "รอใบเสนอราคา" ที่เคยอยู่บนไอคอน rail ย้ายมาแสดงในแถบหัวหน้าเดิม (ตัวเลขจาก API เดิม)
4. **กล่อง AI กลางตัวเดียวทุกแท็บ** (โครงเดิมของ shell ไม่สร้างใหม่):
   `#chatFrame` โหลดครั้งเดียวด้วย `/workspace?materialSurface=chat`, `#homePane` ไม่ถูกซ่อน,
   แท็บอื่นจะได้ `body.chat-compact` → กล่องเดิมย่อเป็นกล่องลอย · เพิ่มการส่ง **บริบทแท็บ**
   จาก shell → กล่องกลางด้วย `postMessage` เดิม (`dna-workspace-active-screen`)
   และแสดงเป็น chip "บริบท: …" ในกล่องกลาง (ไม่มี engine/gateway/สัญญา `/api/chat` ใหม่)

## ไฟล์ที่แก้

| ไฟล์ | การเปลี่ยนแปลง |
|---|---|
| `presentation/shell/AppShell.tsx` | `railItems`/`activeRailKey` เป็น optional · วาด `IconRail` เฉพาะเมื่อส่งมา (backward compatible) |
| `app/admin/line-customers/page.tsx` | ถอด `RAIL_ITEMS`/`railItems` · ถอดปุ่ม+ช่อง "ถาม AI" (`aiAskOpen/aiAskText/askAi`) · ย้าย badge รอใบเสนอราคาไปหัวหน้า · ไม่แตะ reply/upload/send-debt/send-document |
| `public/material-workspace/tools.json` | LINE → `/admin/line-customers` (ทางเข้าหลักชุดเดียว) |
| `public/material-workspace/business-tools.json` | เพิ่ม `line-manager` (เว็บจริง) ในกลุ่ม LINE / Social |
| `public/material-workspace/app.js` | `postActiveScreen()` + ส่งบริบทซ้ำตอน `chatFrame` load |
| `app/workspace/DNAOSChatEngine.tsx` | รับ `dna-workspace-active-screen` · chip "บริบท: …" ใน `<form class=compose>` เดียว · `data-active-screen` |
| `scripts/one-workspace-navigation-test.ts` | เทสต์ใหม่ 25 ข้อ (source-truth + Chromium จริง) |
| `scripts/finance-doc-intelligence-test.ts` | T20 ปรับสัญญา: ทางเข้าคลังเอกสารย้ายไป Sidebar หลัก (ไม่มี rail ซ้อน) — เปลี่ยนเพราะเจ้าของสั่งถอด rail |

ไม่ได้แตะ: Chat/AI Engine, Gateway, Document/Finance Engine, Connect Gateway,
Database/Writer, migration, ระบบสิทธิ์ — และไม่มี commit/push/deploy

หมายเหตุ: โฟลเดอร์ `public/material-workspace/` ทั้งโฟลเดอร์ยังเป็นไฟล์ untracked ของ repo นี้
(ไม่ได้ถูก commit มาก่อน) — การแก้ `app.js`/`tools.json`/`business-tools.json` จึงเทียบ diff ตรง ๆ ไม่ได้
ตรวจด้วยการอ่านไฟล์ + เทสต์จริงแทน

## ผลตรวจ PASS / FAIL (ตามข้อสั่ง 12 ข้อ)

| # | เงื่อนไข | ผล | หลักฐาน |
|---|---|---|---|
| 1 | ตรวจโครงสร้าง UI/Component เดิมก่อนแก้ | PASS | shell = `public/material-workspace` (tab bar + `#chatFrame` เดียว) · LINE = `AppShell` + `RAIL_ITEMS` (ต้นเหตุ rail ซ้อน) |
| 2 | ยุบแถบไอคอนด้านใน LINE (ไม่ลบเครื่องมือ) | PASS | `A1`/`A2` — ไม่มี `RAIL_ITEMS`, ไม่ส่ง `railItems`; AppShell render ไม่มี rail (`w-[64px]` = false) แต่ ListColumn + content ยังอยู่ |
| 3 | ใช้แถบหลักด้านซ้ายเป็นทางเข้าเดียว | PASS | `A7` — ทุก route เดิม (LINE/งาน/คู่ค้า/เอกสาร/คลังเอกสาร/การเงิน/ลูกหนี้/ศูนย์ควบคุมทรัพยากร) อยู่ใน `tools.json`/`business-tools.json`; shell มี `aside` = 1 |
| 4 | เลือกเครื่องมือ → เปิดกลาง + แท็บ + สลับแท็บเดิม ไม่ซ้ำ | PASS | `B8` (เปิดซ้ำ = 1 แท็บ), `B10` (LINE เปิดเป็นแท็บ) · `workspace-tab-bar-test` 20 PASS |
| 5 | Composer กลางตัวเดิมทุกแท็บ (รวมเว็บภายนอก) | PASS | `B3` (compose=1, textarea=1 บนแท็บเครื่องมือ), `B12` (แท็บ example.com ยังใช้กล่องเดิม) |
| 6 | ข้อความที่พิมพ์ค้างไม่หายเมื่อเปลี่ยนแท็บ | PASS | `B4`/`B6` — พิมพ์แล้วสลับแท็บ/กลับมา ค่าเดิมครบ |
| 7 | ส่งผ่าน AI Gateway + สิทธิ์เดิม รักษาบริบทแท็บ | PASS (มีข้อจำกัด) | `A13` ยังเรียก `POST /api/chat` เดิม (session/auth เดิม) · บริบทแท็บส่งผ่าน `postMessage` และแสดงบนกล่อง (`B5`/`B7`) — **ไม่เพิ่มฟิลด์/ไม่แก้ pipeline** (ต้องไม่แตะ AI Engine) |
| 8 | ถอดช่อง AI ซ้ำเฉพาะหน้า คงการรับส่งข้อความจริง | PASS | `A3` (ไม่มีปุ่ม/ช่องถาม AI ในหน้า LINE) · `A5` (reply/upload/send-debt/send-document ยังอยู่) · `A4` (หน้าเอกสารยังไม่มีช่อง AI) |
| 9 | ไม่สร้าง Chat/AI Composer/Document/Finance/Connect/DB ใหม่ | PASS | diff มีเฉพาะ UI shell + config เครื่องมือ + เทสต์ |
| 10 | ไม่แก้ระบบหลังบ้าน/ฐานข้อมูล/ไม่สร้างข้อมูลตัวอย่าง | PASS | ไม่มีไฟล์ API/DB ใน diff · เทสต์สตับเฉพาะ response ฝั่ง browser (ไม่เขียน DB) |
| 11 | ตรวจ Chrome ตามรายการ | PASS (ดูข้อจำกัด) | `one-workspace-navigation-test` 25/25 PASS · ไม่มี JS error |
| 12 | ภาพหน้าจอก่อน/หลัง + PASS/FAIL | PASS บางส่วน | ภาพอยู่ `/tmp/one-workspace/shots` |

### ผลรันจริง

```
npx tsc --noEmit                                     → exit 0
npx tsx scripts/one-workspace-navigation-test.ts     → 25 passed, 0 failed
npx tsx scripts/workspace-tab-bar-test.ts            → 20 PASS (exit 0)
npx tsx scripts/workspace-icon-cleanup-test.ts       → 8 PASS (exit 0)
npx tsx scripts/workspace-single-sidebar-test.ts     → 10 PASS (exit 0)
npx tsx scripts/workspace-adaptive-composer-test.ts  → 9 PASS (exit 0)
npx tsx scripts/line-auto-reply-test.ts              → 30 PASS (exit 0)
npx tsx scripts/document-image-preview-test.ts       → 28 PASS (exit 0)
npx tsx scripts/finance-doc-intelligence-test.ts     → 27 passed, 2 failed (T1/T5 มีมาก่อน)
npx tsx scripts/provider-credentials-test.ts         → 51 PASS, 1 FAIL (PHASE8 มีมาก่อน)
```

- `finance` T1/T5 = openai adapter `enabled=false` และลำดับ doc-QA hook ใน `cognitive/pipeline.ts`
  (พื้นที่ AI Engine ที่ห้ามแก้ในงานนี้) — มีมาก่อนงานนี้
- `provider-credentials` PHASE8 อ่าน `router.push("/admin/settings")` จาก `app/workspace/WorkspaceFrame.tsx`
  แต่โค้ดย้ายไป `DNAOSChatEngine.tsx` ตั้งแต่ก่อนงานนี้ (ตรวจ `git show HEAD` แล้ว = 0 match)
- ESLint: หน้า LINE มี 4 error (`set-state-in-effect`, refs during render) — ตรวจบน `HEAD` แล้วเกิดเหมือนกัน
  (4 error เดิม) ไม่ใช่ของใหม่ · ไฟล์อื่นที่แก้ไม่มี error ใหม่

## ภาพหน้าจอ (`/tmp/one-workspace/shots`)

- ก่อนแก้: `01-before-chat-tab.png`
- หลังแก้: `11-after-chat-tab.png` · `12-after-tool-tab-composer.png` (กล่องกลางย่อ + chip "บริบท: เอกสาร")
  · `13-after-draft-kept.png` (ข้อความค้างอยู่หลังสลับแท็บ) · `14-after-line-tab.png` (แท็บ LINE จาก Sidebar)
  · `15-after-external-tab.png` (แท็บเว็บภายนอก + กล่องเดิม)

## ข้อจำกัด (รายงานตรง)

1. **ไม่มี Supabase session ใน environment นี้** → `/admin/line-customers` ถูก middleware พาไป
   `/login?next=/admin/line-customers` (ยืนยันจาก frame URL) จึง **ถ่ายภาพหน้า LINE ที่ถอด rail แล้วไม่ได้**
   — หลักฐานการถอด rail คือ source-truth + render ของ `AppShell` (มี/ไม่มี railItems) และแท็บที่เปิดจริง
   เจ้าของต้องเปิดดูด้วยบัญชีของตัวเอง
2. เพื่อให้ทดสอบ "พิมพ์แล้วสลับแท็บ" ได้ เทสต์สตับเฉพาะ `GET /api/workspace/org-context` ที่ระดับ browser
   (ไม่แตะ DB ไม่บันทึก org) — การยิงคำสั่งจริงยังต้องมี session
3. บริบทแท็บ: กล่องกลางแสดงและได้รับบริบทจาก shell แต่ **ไม่ได้ส่งข้อมูลหน้าจอเข้า `/api/chat`**
   เพราะสัญญา/pipeline อยู่ใน AI Engine ที่ห้ามแก้ — ถ้าเจ้าของต้องการให้ AI รู้หน้าจอที่เปิดอยู่
   ต้องอนุมัติแก้ `cognitive/pipeline` แยกต่างหาก
4. ไม่ได้รัน `npm run precommit` (สคริปต์เขียน `registry/` นอกขอบเขตงานนี้)
