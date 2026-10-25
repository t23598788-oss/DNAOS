# QAI COMPOSER · WORKSPACE DISPLAY — 2026-10-18

Owner mission: ปรับ QAI Composer และพื้นที่แสดงผล DNA OS Workspace
URL ตรวจ: `http://localhost:3141/workspace`
โหมด: UI เท่านั้น · ไม่ commit / ไม่ push / ไม่ deploy · **STOP รอเจ้าของตรวจหน้าจอ**

## สรุปผล

| # | เงื่อนไข | ผล | หลักฐาน (วัดจริง Chromium 1440×900) |
|---|---|---|---|
| 01 | กล่องเปล่า 48–56px · ไม่มีกล่องใหญ่ตั้งแต่เริ่ม | **PASS** | `form.compose` = **50px** (เดิม **145px**) · textarea 38px |
| 01 | 1 บรรทัดยังกะทัดรัด | **PASS** | 50px (ไม่ขยายเกินจำเป็น) |
| 01 | หลายบรรทัดขยายอัตโนมัติ + เพดาน + scroll ภายใน | **PASS** | textarea 38 → **96px** (เพดาน) · `overflow-y:auto` · `scrollHeight > clientHeight` |
| 01 | ส่งแล้วกลับกะทัดรัด | **PASS** | หลังส่ง = 50px (draft ถูกล้าง + autoGrow reset) |
| 02 | เปลี่ยนปุ่มแนบไฟล์ใหญ่ → ไอคอน (+) เล็ก | **PASS** | ปุ่ม 32×32 ไอคอน 18px · ไม่มีปุ่ม "แนบไฟล์" ในแถบหลัก |
| 02 | (+) เปิดเมนูเครื่องมือ QAI | **PASS** | เมนู 3 รายการ: แนบไฟล์ · รูปภาพ · เอกสาร (ทั้งหมดใช้ `/api/admin/upload` เดิม) |
| 02 | แสดงเฉพาะเครื่องมือที่ระบบมีจริง | **PASS** | ไม่มีรายการที่ไม่มี backend · ไม่สร้างระบบอัปโหลดใหม่ |
| 02 | เลือกแล้วแสดงรายการที่เลือกอย่างกะทัดรัด | **PASS** | chip `รูปภาพ ×` (data-testid=`compose-selected-tool`) · เคลียร์เมื่ออัปโหลดเสร็จ |
| 02 | (×) ปิดเมนู · Esc · คลิกนอกเมนู | **PASS** | ทั้งสามเส้นทางปิดเมนูจริง |
| 03 | ไอคอนไมโครโฟนขนาดเล็ก | **PASS** | 32×32 อยู่ขวาของช่องพิมพ์ |
| 03 | ตรวจระบบรับเสียงเดิมก่อน · ไม่มี = แสดงไม่พร้อมใช้งาน | **PASS** | DNA OS มีแต่ TTS (`speak`) ไม่มี speech-input hook · ปุ่ม `aria-disabled=true` + title + กดแล้วขึ้นสถานะ "ไม่พร้อมใช้งาน" |
| 03 | ห้ามสร้าง Voice Engine ใหม่ | **PASS** | ไม่มี `getUserMedia`/`MediaRecorder`/SpeechRecognition ใหม่ · วัด `__micCalls = 0` ตลอดเซสชัน |
| 04 | ซ้าย (+) · กลางช่องพิมพ์ · ขวาไมค์ + ส่ง | **PASS** | x = 185 · 223 · 1138 · 1176 |
| 04 | ไอคอนเล็กสม่ำเสมอ · ไม่มีปุ่มแนบใหญ่ · ไม่มีกล่องซ้ำต่อแท็บ | **PASS** | ปุ่ม 32px เท่ากัน · `form.compose = 1` · `textarea = 1` · `#homePane = 1` |
| 05 | ลดพื้นที่ด้านล่าง · ไม่มี Bottom Bar ทับ · เพิ่มพื้นที่กลาง | **PASS** | ช่องว่างใต้ Composer หน้าแชต **78px → 10px** · `footer = 0` · stage padding ล่าง 78→10 |
| 05 | Composer ตำแหน่งเดิมเมื่อสลับแท็บ | **PASS** | กล่องเดิม `#homePane` จุดเดียว bottom = 888 ทั้ง compact/กลับแท็บ · ไม่ reload |
| 06 | พื้นหลังขาว/อ่อนสะอาด · ขอบบาง · เงาอ่อน | **PASS** | `#dna-frame` = `rgb(255,255,255)` · border 1px · เงานุ่ม |
| 06 | Composer โปร่งแสงเล็กน้อย · ยังอ่านชัด | **PASS** | `rgba(255,255,255,0.78)` + blur 8px · ink `#36332f` เดิม |
| 07 | ใช้ Composer เดิม · ไม่แตะ Business/AI/MCP/DB/Writers/Tab Bar | **PASS** | แก้เฉพาะ UI ใน `DNAOSChatEngine` + shell CSS + เทสต์/รายงาน |
| 08 | ตรวจ Chrome + ภาพก่อน/หลัง + PASS/FAIL | **PASS** | 11/11 checks · ภาพอยู่ใน `docs/workspace-screenshots/qai-composer-2026-10-18/` |

**ไม่มี FAIL ในขอบเขตงานนี้**

## ค่าวัดก่อน / หลัง

| จุดวัด | ก่อน | หลัง |
|---|---|---|
| Composer ว่าง (หน้าแชต) | 145px | **50px** |
| Composer 1 บรรทัด | 145px | **50px** |
| Composer 6 บรรทัด | 203px (textarea 112px) | **108px** (textarea 96px + scroll) |
| ช่องว่างล่าง Composer → ขอบ stage | 78px | **10px** |
| Compact (แท็บเครื่องมือ) | 191px ล้น iframe 126px | **48px** ในกล่อง 66px |
| ปุ่มในแถบหลัก | แนบไฟล์ + ส่ง | **(+) + ไมค์ + ส่ง** |

## ไฟล์ที่แก้

| ไฟล์ | การเปลี่ยนแปลง |
|---|---|
| `app/workspace/DNAOSChatEngine.tsx` | Composer ใหม่ใน component เดิม: กล่องเปล่า 50px · auto-grow 38→96px + scroll · (+) เมนู 3 เครื่องมือ (ใช้ upload เดิม) · chip รายการที่เลือก · ไมค์สถานะไม่พร้อมใช้งาน · layout ซ้าย/กลาง/ขวา · พื้นหลังโปร่งแสง/ขอบบาง/เงานุ่ม · ลด stage padding ล่าง 78→10 · ซิงก์สถานะ focus กับ shell ผ่าน document focusin/focusout (แก้ class ค้าง) |
| `public/material-workspace/style.css` | จองพื้นที่ล่างของ compact 92→84px (กล่องเปล่า 50px) · คง single adaptive composer เดิม |
| `scripts/workspace-qai-composer-test.ts` | เทสต์ใหม่ 11 checks (Chromium จริง) |
| `package.json` | เพิ่ม `workspace-qai-composer:test` |
| `docs/QAI_COMPOSER_WORKSPACE_2026-10-18.md` | รายงานนี้ |
| `docs/workspace-screenshots/qai-composer-2026-10-18/` | ภาพก่อน 4 ภาพ + หลัง 7 ภาพ |

ไม่ได้แตะ: AI Gateway / `POST /api/chat` / cognitive pipeline / MCP / Connect / Database / Canonical Writers / Tab Bar / เมนูธุรกิจ

## ผลรันจริง

```
npx tsc --noEmit                                      → exit 0
npx eslint app/workspace/DNAOSChatEngine.tsx scripts/workspace-qai-composer-test.ts
                                                      → exit 0 (0 error · 1 warning เดิม: unused eslint-disable)
npx tsx scripts/workspace-qai-composer-test.ts        → 11 checks PASS (exit 0)
npx tsx scripts/workspace-adaptive-composer-test.ts   → 8 checks PASS (exit 0)
npx tsx scripts/workspace-icon-cleanup-test.ts        → 7 checks PASS (exit 0)
npx tsx scripts/workspace-tab-bar-test.ts             → 19 checks PASS (exit 0)
npx tsx scripts/one-workspace-navigation-test.ts      → 25 passed, 0 failed (exit 0)
npx tsx scripts/workspace-single-sidebar-test.ts      → 9 checks PASS (exit 0)
BASE_URL=http://localhost:3141 npx tsx scripts/tenant-workspace-org-ui-test.ts
                                                      → 4 checks PASS (exit 0)
```

## ข้อจำกัด (รายงานตรง)

1. **ไม่มี session จริงใน environment นี้** — เทสต์ intercept เฉพาะ `GET /api/workspace/org-context`,
   `POST /api/chat`, `POST /api/admin/upload` ที่ระดับ browser เพื่อให้พิมพ์/ส่ง/อัปโหลดได้
   (ไม่เขียน DB · ไม่ mock ข้อมูลธุรกิจอื่น) — หน้าจอ `/admin/*` ที่เปิดในแท็บยัง guard ไป `/login` ตามปกติ
2. **ยังไม่มีระบบรับเสียง (speech-to-text) ใน DNA OS** — ปุ่มไมค์จึงแสดง "ไม่พร้อมใช้งาน"
   ตามข้อ 03 และไม่เปิดอุปกรณ์เสียงเลย หากเจ้าของมี engine รับเสียงอยู่แล้ว สามารถลงทะเบียน
   `window.dnaVoiceInput` เพื่อให้ปุ่มเปลี่ยนเป็นพร้อมใช้ได้โดยไม่ต้องแก้ Composer
3. **Compact composer** ใช้พฤติกรรมเดิมที่เจ้าของอนุมัติไว้ (ลอยด้านล่าง 66px / hover-focus 126px)
   — เปลี่ยนเฉพาะความสูงภายในให้พอดี 48px และเมนู (+) แสดงได้โดยไม่ถูกตัด
4. **ธีมเบราว์เซอร์/ระบบปฏิบัติการ** ไม่ถูกแตะ
5. `public/material-workspace/` ทั้งโฟลเดอร์เป็นไฟล์ untracked ของ repo นี้ (ไม่ได้ถูก commit มาก่อน)
   → `style.css` จึงเทียบ diff ตรง ๆ ไม่ได้ ตรวจด้วยการอ่านไฟล์ + เทสต์จริงแทน
6. ยังไม่ commit / push / deploy ตามคำสั่ง — **หยุดรอเจ้าของตรวจหน้าจอ**

## ภาพหน้าจอ

`docs/workspace-screenshots/qai-composer-2026-10-18/`

- ก่อน: `before-1-chat-empty.png` (145px) · `before-2-chat-one-line.png` · `before-3-chat-many-lines.png` · `before-4-tool-compact.png`
- หลัง: `after-1-chat-empty.png` (50px) · `after-2-chat-one-line.png` · `after-3-chat-many-lines.png`
  · `after-4-menu-open.png` · `after-5-mic-status.png` · `after-6-compact-empty.png` · `after-7-compact-menu.png`
