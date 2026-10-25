# DNA OS — WORKSPACE TAB BAR (2026-10-18)

คำสั่ง: เปลี่ยนแถบ Tab Bar ด้านบนของ DNA OS Workspace ให้เป็น **พื้นที่ของหน้าจอ/เว็บไซต์ที่เปิดจริง** ไม่ใช่แถบค้นหาหรือแถบจัดการทรัพยากร
ข้อห้ามที่ยึด: ไม่แตะ Business Engine · AI Engine · MCP · Connect Registry · Database · Canonical Writers · ไม่สร้างข้อมูล/องค์กร/บริการตัวอย่าง · ไม่ commit/push/deploy

URL ที่ตรวจ: `http://localhost:3141/workspace` (dev server เดิม, ไม่ได้ restart/แก้ env)

## ผลตรวจ (PASS / FAIL)

| # | สิ่งที่สั่ง | ผล | หลักฐาน |
|---|---|---|---|
| 1 | ล็อก Tab Bar ไว้ด้านบนตลอด ไม่เลื่อนหาย | **PASS** | `header#tabBar` y=0 · height=40 · `position:sticky` · เนื้อหา scroll ภายใน (`.table-wrap`/`.scroll-list`) — วัดหลังสั่ง `scrollTop=400` ทั้งหน้าและรายการแล้ว y ยังเป็น 0 |
| 2 | ลบช่องค้นหา/ตัวกรองประเภทแหล่ง/"+ เพิ่มทรัพยากร" ออกจากแถบบน และคงไว้ในหน้าจอทรัพยากรเท่านั้น | **PASS** | `header#tabBar` ไม่มี `#search`/`#category`/`#add`/`#refresh` (0/4) · ทั้ง 4 อยู่ใน `#stockPane .resource-toolbar` (4/4) · header text ไม่มีคำว่า "ค้นหาแหล่ง" |
| 3 | Tab Bar แสดงแท็บของหน้าจอที่เปิดจริง | **PASS** | เริ่มด้วย `[Workspace]` · เปิดศูนย์ควบคุมทรัพยากร → 2 แท็บ · เปิด LINE → 3 แท็บ · ปุ่ม `＋` อยู่ปลายแถบ |
| 4 | แต่ละแท็บมีโลโก้/ไอคอน · ชื่อ · ปุ่มปิด · สถานะ active | **PASS** | แท็บ Workspace = ไอคอนแชต (ไม่มีปุ่มปิด = แท็บหลัก) · แท็บ LINE = `<img>` โลโก้จริง `/brand/providers/line.svg` + ปุ่ม × · active = `.is-active` + `aria-selected=true` |
| 5 | กดเครื่องมือจากแถบซ้าย → เปิดในพื้นที่กลาง + เพิ่มแท็บอัตโนมัติ (เปิดซ้ำ = แท็บเดิม) | **PASS** | `[data-view=all]` → แท็บ "ศูนย์ควบคุมทรัพยากร" + `#stockPane` · launcher → แท็บ LINE + `#toolFrame=/admin/line-customers` · กดซ้ำจำนวนแท็บไม่เพิ่ม |
| 6 | คงปุ่มย้อนกลับ/ไปข้างหน้า ทำงานกับประวัติการนำทางจริง | **PASS** | ทุกการเปิด/สลับแท็บถูกบันทึกลง `navHistory` ของ shell · กด ‹ → แท็บก่อนหน้า, › → แท็บถัดไป (ทดสอบบน Chrome จริง) |
| 7 | เว็บภายนอก: ฝังเมื่ออนุญาต · ห้าม iframe = เปิดเบราว์เซอร์ภายนอก ไม่ทำหน้าเลียนแบบ | **PASS** | Facebook (`X-Frame-Options: DENY`) → เปิด `business.facebook.com` ในเบราว์เซอร์จริง และ**ไม่สร้างแท็บ** · `example.com` (ไม่มีข้อจำกัด) → เปิดแท็บ + iframe ชี้เว็บจริง |
| 8 | กล่อง AI ด้านล่างชุดเดียว ไม่สร้างหน้าแชต/ระบบอ่านข้อความใหม่ | **PASS** | `iframe#chatFrame` 1 อัน · หน้าจอแชตเดิม 1 frame · Composer (`textarea`) 1 อัน — แท็บอื่นใช้กล่องลอยตัวเดิม (`body.chat-compact`) |
| 9 | ห้ามแก้ Business Engine/AI/MCP/Connect Registry/DB/Canonical Writers | **PASS** | ไม่มีไฟล์ใน `engines/`, `services/ai/`, MCP routes, `gateway/`, `supabase/`, canonical writer ถูกแก้ |
| 10 | ห้ามสร้างข้อมูล/องค์กร/บริการตัวอย่าง · ห้าม commit/push/deploy | **PASS** | ไม่มีข้อมูลธุรกิจ/ผู้ให้บริการเพิ่มใน `business-tools.json`/`tools.json` · ไม่มี commit/push/deploy |

## ไฟล์ที่แก้ไข

| ไฟล์ | การเปลี่ยน |
|---|---|
| `public/material-workspace/index.html` | `<header>` เดิม (ประวัติ + ชื่อจอ + ช่องค้นหา + ตัวกรอง + ↻ + เพิ่มทรัพยากร) → **Tab Bar** (`#tabBar` = ปุ่ม ‹ › · `#tabStrip` · ปุ่ม `＋`) · ย้าย `#search`/`#category`/`#refresh`/`#add` เข้า `.resource-toolbar` ภายใน `#stockPane` |
| `public/material-workspace/app.js` | เพิ่ม **tab controller**: `tabs`/`activeTabId`/`navHistory` · `renderTabs`/`applyTab`/`activateTab`/`openTab`/`closeTab`/`goBack`/`goForward` · `openResourceTab` (จากไอคอน ▤) · `openToolRoute` (เส้นทางภายใน → แท็บ) · `openExternalTool` + `openInBrowser` (เว็บภายนอก) · ลบ `setScreen`/`#screenTitle` เดิม |
| `public/material-workspace/shell.js` | ไอคอน `＋` ของปุ่มเปิดแท็บใหม่ · คงการต่อสายเดิม (`#chatHome` → หน้าจอแชต) |
| `public/material-workspace/business-launcher.js` | ส่งโลโก้/ไอคอนของรายการเข้าแท็บ (`data-logo`/`data-icon`) · เว็บภายนอกไปที่ `window.openExternalTool` (เดิมเปิดแท็บเบราว์เซอร์ทันที) |
| `public/material-workspace/style.css` | สไตล์ Tab Bar (แท็บ · ไอคอน/โลโก้ · ปุ่มปิด · active · `＋`) + `.resource-toolbar` และให้ `#stockPane` เป็น flex column ที่ scroll ภายใน |
| `app/api/workspace/embed-check/route.ts` | **ใหม่ (read-only)**: `GET ?url=` → ตรวจ `X-Frame-Options` / `CSP frame-ancestors` จาก header จริงของผู้ให้บริการ แล้วตอบ `embeddable` · ตาม redirect เองทุก hop (≤3) · กัน SSRF (http/https เท่านั้น · ปฏิเสธ loopback/private/link-local/multicast · ไม่รับ URL ที่มี credentials) · ไม่คืน body/ข้อมูลภายในระบบ |
| `scripts/workspace-tab-bar-test.ts` | **ใหม่**: เทสต์ Chromium จริง 15 ข้อ + ภาพหน้าจอ |
| `scripts/workspace-single-sidebar-test.ts` | ปรับ assertion 1 จุดตามสัญญาใหม่: ตัวระบุหน้าจอที่เปิด = แท็บ active (เดิมอ่าน `#screenTitle` ที่ถูกถอดตามคำสั่งนี้) — เจตนาเดิม (เปิด `/admin/pits` แล้วหน้าจอทรัพยากรถูกเลือก) ยังตรวจเหมือนเดิม |
| `package.json` | เพิ่มสคริปต์ `workspace-tab-bar:test` |
| `docs/WORKSPACE_TAB_BAR_2026-10-18.md` | รายงานนี้ |

> หมายเหตุ: ไอคอนเริ่มต้นของแท็บเครื่องมือเปลี่ยนจาก "สี่เหลี่ยม 4 ช่อง" เป็นรูปหน้าจอ เพื่อไม่ให้ซ้ำจุดเดียวของปุ่มเปิดเครื่องมือ (`#toolsMain`) ตามข้อกำหนดเดิมของ SINGLE SIDEBAR (regression test ยืนยัน 1 จุด)

## พฤติกรรมที่วัดได้จริง

- **ลำดับแท็บ**: `[Workspace] [ศูนย์ควบคุมทรัพยากร ×] [LINE Official Account ×] [＋]`
- **ปิดแท็บ**: ปิดแท็บที่ active → สลับไปแท็บข้างซ้ายอัตโนมัติ (ถ้าไม่มี → Workspace) · แท็บหลัก Workspace ปิดไม่ได้ (ตรงตามตัวอย่างที่ Workspace ไม่มี ×)
- **เปิดซ้ำ**: id ของแท็บ = `resources` / `route:<path>` / `external:<url>` ⇒ เปิดซ้ำสลับแท็บเดิม ไม่สร้างซ้ำ
- **พื้นที่กลาง**: แท็บแชต = `#homePane` เต็ม · แท็บทรัพยากร = `#stockPane` · แท็บเครื่องมือ/เว็บ = `#toolFrame` (iframe เดิม) · Composer ตัวเดิมย่อเป็นกล่องลอยเมื่อไม่ใช่แท็บแชต
- **เว็บภายนอก**: ตัดสินจาก header จริงเท่านั้น — ไม่มีรายการ "เว็บที่เดาว่าห้าม" ในโค้ด
  - `https://business.facebook.com/latest/inbox` → `x_frame_options_deny` → เปิดเบราว์เซอร์ภายนอก
  - `https://example.com` → `no_frame_restriction` → เปิดเป็นแท็บจริง

## BROWSER_TEST_RESULT

```
BASE_URL=http://localhost:3141 npx tsx scripts/workspace-tab-bar-test.ts
PASS  Tab Bar ล็อกด้านบน: y=0 · height=40 · position=sticky
PASS  ช่องค้นหา · ตัวกรองประเภทแหล่ง · เพิ่มทรัพยากร · ↻ ไม่อยู่บน Tab Bar (อยู่เฉพาะหน้าจอทรัพยากร)
PASS  แท็บ Workspace เริ่มต้น: มีไอคอน · active · ไม่มีปุ่มปิด (แท็บหลัก)
PASS  กดไอคอนศูนย์ควบคุมทรัพยากรในแถบซ้าย → เปิดในพื้นที่กลาง + เพิ่มแท็บ
PASS  เปิดหน้าจอเดิมซ้ำ → สลับแท็บเดิม ไม่สร้างแท็บซ้ำ
PASS  เปิด LINE จากแถบซ้าย → แท็บใหม่ (โลโก้จริง · ชื่อ · ปุ่มปิด · active) + เปิดในพื้นที่กลาง
PASS  เปิดเครื่องมือเดิมซ้ำ → สลับไปแท็บเดิม
PASS  สลับแท็บด้วยการคลิกแท็บ → พื้นที่กลางเปลี่ยนตามแท็บจริง
PASS  ปิดแท็บ → แท็บหาย + สลับไปแท็บข้างเคียงอัตโนมัติ
PASS  ปุ่มย้อนกลับ/ไปข้างหน้าเดินตามประวัติการนำทางจริงของ shell
PASS  Tab Bar ไม่เลื่อนหาย: เนื้อหา scroll ภายใน · แถบบนคงที่ y=0
PASS  เว็บที่ห้าม iframe → เปิดเบราว์เซอร์ภายนอกจริง (...) และไม่สร้างแท็บ
PASS  เว็บที่อนุญาตให้ฝัง → แท็บจริง + iframe ชี้ไปเว็บไซต์จริง (ไม่ใช่หน้าเลียนแบบ)
PASS  กล่อง AI ด้านล่างยังชุดเดียว (iframe แชตเดิม 1 · Composer 1 — ไม่มีหน้าแชต/กล่องใหม่)
PASS  ไม่มี JavaScript error ระหว่างทั้งชุดการทดสอบ

═══ WORKSPACE TAB BAR: 15 checks PASS ═══
```

Regression (ยังผ่านทั้งหมด):

```
npx tsx scripts/workspace-icon-cleanup-test.ts     → 7 checks PASS
npx tsx scripts/workspace-single-sidebar-test.ts   → 9 checks PASS
npx tsc --noEmit                                   → exit 0
npx eslint app/api/workspace/embed-check/route.ts scripts/workspace-tab-bar-test.ts → exit 0
node --check app.js / shell.js / business-launcher.js → ผ่าน
```

## SCREENSHOTS (ภาพหน้าจอจริงจาก Chrome/Chromium)

| ไฟล์ | ความหมาย |
|---|---|
| `/tmp/tabbar-shots/01-workspace-tab.png` | หลังแก้: Tab Bar มีแท็บ Workspace เดียว · ไม่มีช่องค้นหาบนแถบบน |
| `/tmp/tabbar-shots/02-resource-tab.png` | เปิดแท็บ "ศูนย์ควบคุมทรัพยากร" จากไอคอน ▤ — ช่องค้นหา/ตัวกรอง/เพิ่มทรัพยากรอยู่ในหน้าจอนี้ |
| `/tmp/tabbar-shots/03-line-tab.png` | แท็บ LINE Official Account พร้อมโลโก้จริง + ปุ่มปิด + active · หน้าจอเปิดในพื้นที่กลาง |
| `/tmp/tabbar-shots/04-closed-tab.png` | หลังปิดแท็บ LINE → สลับไปแท็บข้างเคียง |
| `/tmp/tabbar-shots/05-facebook-external.png` | Facebook ถูกห้ามฝัง → เปิดเบราว์เซอร์ภายนอก ไม่มีแท็บเลียนแบบ |
| `/tmp/tabbar-shots/06-external-embedded.png` | เว็บที่อนุญาตให้ฝัง → แท็บจริง + iframe ชี้เว็บจริง |
| `/tmp/tabbar-shots/responsive-1024.png`, `responsive-800.png` | ตรวจ 1024×768 และ 800×700: ไม่มี horizontal overflow · เครื่องมือทรัพยากรยังอยู่ในหน้าจอทรัพยากร |

## ข้อจำกัดที่รายงานตรง (ไม่นับเป็น pass)

1. **ไม่มี session จริงบนเครื่องนี้** — `/api/admin/*` ตอบ 401 ตามปกติ (ไม่ mock ข้อมูลธุรกิจ) · แท็บที่เปิดเส้นทาง `/admin/*` จะเห็นหน้า guard ของระบบ (`/login?next=…`) ไม่ใช่เนื้อหาข้างใน ⇒ ตรวจได้ถึงระดับ "เรียกเส้นทางเดิมจริงในพื้นที่กลาง"
2. **การตัดสิน "ฝังได้/ไม่ได้" อิง header ของผู้ให้บริการ ณ เวลาที่กดเปิด** — ถ้าเว็บเปลี่ยนนโยบายภายหลัง ต้องกดเปิดใหม่ ระบบจะตรวจซ้ำ (ไม่มีการ cache คำตอบ)
3. **`embed-check` เป็น read-only และไม่ใช้ auth** (เหมือน `/api/workspace/org-context` ที่ตรวจ session เอง) — มี guard กัน SSRF ครบ แต่ยังเหลือ DNS-rebinding window ตามธรรมชาติของการ resolve ก่อน fetch; response ไม่มีข้อมูลภายในระบบ มีเพียง boolean + เหตุผลเชิง header (ระบุในคอมเมนต์ไฟล์แล้ว)
4. **ปุ่มเฟือง "การเชื่อมต่อ" ในแถบซ้ายยังทำงานเดิม** (แสดง toast ระบบเชื่อมต่อเดิม) — ไม่ได้เปลี่ยนเป็นแท็บ เพราะไม่ใช่หน้าจอ และเพื่อไม่ให้ขัดข้อกำหนด SINGLE SIDEBAR/สิทธิ์เดิม; เครื่องมือ/หน้าจอทั้งหมดที่เหลือเปิดเป็นแท็บตามข้อ 5
5. **ไม่ได้รัน `npm run precommit`** — สคริปต์นั้นเขียน `registry/` (sync-registry/architecture book) ซึ่งเป็นการแก้ไฟล์นอกขอบเขตงานนี้ และไม่ได้ขอ commit; ตรวจด้วย `tsc`, `eslint`, browser tests แทน
6. `public/material-workspace/` ทั้งโฟลเดอร์ยังเป็น untracked ใน git (สถานะเดิมก่อนงานนี้) — ไม่ได้ commit ตามคำสั่ง
