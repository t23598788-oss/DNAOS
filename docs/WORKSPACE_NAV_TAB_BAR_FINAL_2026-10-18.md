# WORKSPACE NAVIGATION + TAB BAR — FINAL PASS/FAIL (2026-10-18)

คำสั่ง owner: ปรับ Workspace Navigation และ Tab Bar ที่ `http://localhost:3141/workspace`
แก้เฉพาะหน้าจอ/ระบบนำทาง · ไม่สร้างระบบใหม่ทับของเดิม · ห้ามแตะ Business Engine / Finance / Accounting / Database /
Connect Registry / AI Engine / MCP / Canonical Writers / ระบบสิทธิ์องค์กร · **ห้าม commit / push / deploy**

ตรวจบน Chromium จริง (Playwright) ที่ dev server เดิม `http://localhost:3141` — ไม่ restart, ไม่แก้ env, ไม่มี mock ข้อมูลธุรกิจ
(เทสต์ intercept เฉพาะ `/api/workspace/org-context`, `/api/chat`, `/api/admin/pits` ตามที่ระบุในหัวข้อ "ข้อจำกัด")

## ผลตรวจตามคำสั่ง 13 ข้อ

| # | คำสั่ง | ผล | หลักฐานที่วัดได้ |
|---|---|---|---|
| 1 | ลบตัวเลือก "องค์กร" มุมขวาบน + กรอบเลือก "สำนักงานใหญ่" · ห้ามลบข้อมูล/สิทธิ์หลังบ้าน | **PASS** | `[data-testid=org-context-control]` = 0 ทุก frame · `#workspace-org` / `select[aria-label='เลือกองค์กร']` = 0 · ข้อความ "องค์กร"/"สำนักงานใหญ่" ในหน้า = 0 · `OrgContextProvider` + `GET/POST /api/workspace/org-context` + `org_members` ไม่ถูกแก้ — แชตยังได้ org จาก cookie เดิม (`ถาม SYNTH-ORG-A...`) |
| 2 | ลบปุ่มรูปข้อความมุมขวาของพื้นที่กลาง · ห้ามสร้างปุ่มเปิดแชต/หน้าข้อความซ้ำ · คงกล่อง AI ด้านล่าง | **PASS** | `.corner` = 0 · `[data-testid=history-button]` = 0 · `.msg-panel` ที่เปิดค้าง = 0 · `iframe#chatFrame` 1 · `textarea[aria-label='คำสั่ง']` 1 · ส่งคำสั่งแล้วได้คำตอบจริง |
| 3 | ย้ายปุ่ม `...` จากด้านขวาของพื้นที่กลางขึ้น Tab Bar ใช้จัดการแท็บ/หน้าต่าง | **PASS** | `.edge.right` (⋯ เดิม) = 0 ในพื้นที่กลาง · `#tabBar #tabOverflow` = 1 · เมนูแสดงทุกแท็บ + "หน้าต่างปัจจุบัน" · สลับแท็บจากเมนูได้ · "ปิดแท็บอื่น" เหลือ `[Workspace, ศูนย์ควบคุมทรัพยากร]` · เมนูปิดเองหลังเลือก |
| 4 | เพิ่มปุ่ม `(+)` บน Tab Bar สำหรับเปิดแท็บใหม่ | **PASS** | `#tabBar #newTab` = 1 · กดแล้วเปิดเมนูเครื่องมือเดิม (`#businessLauncher`) เพื่อเลือกหน้าจอที่จะเปิดเป็นแท็บ — ใช้ทางเข้าเดิม ไม่สร้างเมนูชุดที่สอง |
| 5 | เพิ่มแว่นขยายบน Tab Bar สำหรับค้นหา/เปิดเว็บผ่าน URL | **PASS** | `#tabBar #tabSearch` = 1 (aria-label "ค้นหาหรือเปิดเว็บไซต์ด้วย URL") · พิมพ์ "ศูนย์ควบคุม" → เจอแท็บ/เครื่องมือ · วาง `https://example.org` → เปิดเป็นแท็บจริง และ `#toolFrame src = https://example.org` |
| 6 | กดไอคอนเครื่องมือจากแถบซ้าย → เปิดในพื้นที่กลาง + สร้างแท็บอัตโนมัติ | **PASS** | `[data-view=all]` → แท็บ "ศูนย์ควบคุมทรัพยากร" + `#stockPane` · launcher LINE → แท็บ + `#toolFrame=/admin/line-customers` |
| 7 | แต่ละแท็บมีไอคอน/โลโก้ · ชื่อ · ปุ่มปิด · สถานะ active | **PASS** | แท็บ LINE มี `<img>` โลโก้จริง `/brand/providers/line.svg` · แท็บ Workspace มีไอคอน SVG และไม่มีปุ่มปิด (แท็บหลัก) · active = `.is-active` + `aria-selected=true` |
| 8 | เปิดเครื่องมือ/เว็บเดิมซ้ำ → กลับแท็บเดิม ไม่สร้างซ้ำ | **PASS** | id แท็บ = `resources` / `route:<path>` / `external:<url>` · จำนวนแท็บไม่เพิ่มเมื่อเปิดซ้ำ |
| 9 | คงปุ่มย้อนกลับ/ไปข้างหน้า ทำงานกับประวัติจริง | **PASS** | ‹ › เดินตาม `navHistory` ของ shell: ย้อนกลับ → แท็บก่อนหน้า, ไปข้างหน้า → แท็บถัดไป; ปุ่มถูก disable ที่ปลายประวัติ |
| 10 | หนึ่งเครื่องมือมีทางเข้าหลักไอคอนเดียว | **PASS** | sidebar เดียว 48px · เมนูเครื่องมือ 54 รายการจาก asset เดิม · ไอคอนสี่เหลี่ยม (จุดเปิดเครื่องมือ) = 1 จุดทั้งเซสชัน · ไม่มีปุ่มเปิดช่องทางซ้ำใน Workspace |
| 11 | เว็บภายนอก: ตรวจข้อจำกัดการฝังก่อน · ห้าม iframe → เปิดเบราว์เซอร์จริง · ห้ามทำหน้าเลียนแบบ | **PASS** | Facebook (`X-Frame-Options: DENY`) → เปิด `business.facebook.com` ในเบราว์เซอร์จริง และ **ไม่สร้างแท็บ** · `example.com` / `example.org` (ไม่มีข้อจำกัด) → แท็บ + iframe ชี้เว็บจริง (ตรวจจาก `/api/workspace/embed-check` ซึ่งอ่าน header จริง ไม่มีรายการเดาในโค้ด) |
| 12 | ห้ามแก้ Business Engine / Finance / Accounting / DB / Connect Registry / AI·MCP / Canonical Writers / สิทธิ์องค์กร | **PASS** | diff แตะเฉพาะ `app/workspace/*` (presentation), `public/material-workspace/*` (shell), `scripts/*-test.ts`, `docs/` · ไม่มีไฟล์ใน engines/, services/ai/, MCP routes, supabase/migrations, canonical writer, core/auth ถูกแก้ |
| 13 | ห้าม commit / push / deploy | **PASS** | ไม่ได้รันคำสั่ง git ที่เขียนใด ๆ (ไม่มี commit/push/deploy) |

## ไฟล์ที่แก้ในรอบนี้

| ไฟล์ | การเปลี่ยน |
|---|---|
| `app/workspace/WorkspaceFrame.tsx` | **ถอด** `<OrgContextControl />` ออก (เหลือ `OrgContextProvider` เป็นเจ้าของ state เดียว + `ChatWithOrg` remount ตาม org) — ลบเฉพาะ "หน้าจอเลือก" ไม่แตะ API/ข้อมูล/สิทธิ์ |
| `app/workspace/DNAOSChatEngine.tsx` | เมื่อถูกฝังใน Workspace (`embedded`): ไม่วาด `.corner` (ปุ่มรูปข้อความ) และ `.edge right` (⋯) อีก — หน้าจออื่นที่ใช้ frame นี้ (เช่น `/admin/relationships`) ยังคงปุ่มเดิม |
| `public/material-workspace/index.html` | Tab Bar เพิ่ม `#tabSearch` (แว่นขยาย) และ `#tabOverflow` (⋯) ต่อจาก `#newTab` · เพิ่มแผง `#tabOverflowPanel` (เมนูจัดการแท็บ/หน้าต่าง) และ `#tabSearchPanel` (ค้นหา/URL) — วางนอก `<header>` เพราะ header มี `overflow:hidden` |
| `public/material-workspace/app.js` | `renderTabMenu/toggleTabMenu` (รายการแท็บ · สลับ · ปิดแท็บ · ปิดแท็บอื่น · ปิดทั้งหมด · เปิดแท็บใหม่) · `searchMatches/renderTabSearch/runSearchRow` (ค้นแท็บ/เครื่องมือ + เปิด URL ผ่าน `openExternalTool` เดิม) · `ensureTools` (ใช้ `tools.json` เดิมร่วมกับ dialog เครื่องมือ) · ปิดแผงด้วยคลิกนอก/Escape · `applyTab` อัปเดตเมนูถ้าเปิดอยู่ |
| `public/material-workspace/style.css` | สไตล์ `.tab-tool` (🔍/⋯) และ `.tab-pop*` (แผงเมนู/ค้นหา) — ใช้ palette/เงาเดียวกับ launcher เดิม |
| `public/material-workspace/business-launcher.js` | คลิกนอก launcher ไม่ปิดเมื่อมาจาก `#newTab` / `#tabMenuNew` (ปุ่มใหม่อยู่บน Tab Bar จึงถูกมองเป็น "คลิกนอก" แล้ว launcher ปิดทันทีที่เพิ่งเปิด) — ไม่สร้าง launcher/menu ชุดใหม่ |
| `scripts/workspace-tab-bar-test.ts` | เพิ่ม 4 checks ใหม่ (ปุ่มบน Tab Bar · ไม่มี org/ปุ่มข้อความ · เมนู ⋯ · 🔍 เปิด URL จริง) → 19 checks |
| `scripts/tenant-workspace-org-ui-test.ts` | เขียนใหม่ตามสัญญาใหม่: ไม่มีตัวเลือกองค์กรทุกชั้น + org ยังมาถึงแชตจาก cookie เดิม + ส่งคำสั่งได้ + ไม่มีปุ่มซ้ำ (4 checks) |
| `scripts/workspace-adaptive-composer-test.ts` | เปิดหน้าจอทรัพยากรก่อนวัด compact mode (ระบุสถานะให้ชัด ไม่พึ่งลำดับโหลด) · เปลี่ยนข้อ 6 จาก "ปุ่มประวัติเปิดแผง" เป็น "ไม่มีปุ่มข้อความ/⋯ + กล่องล่างตอบกลับจริง" |
| `scripts/workspace-icon-cleanup-test.ts` | แทนการรอ `[data-testid=org-context-control]` (ถูกลบแล้ว) ด้วยการรอ shell iframe จริง |
| `scripts/workspace-single-sidebar-test.ts` | เช่นเดียวกัน — readiness วัดจาก shell frame แทนตัวเลือกองค์กร |
| `docs/WORKSPACE_NAV_TAB_BAR_FINAL_2026-10-18.md` | รายงานนี้ |

ไม่ได้แตะ: `package.json`, migration, registry, `.env*`, ระบบสิทธิ์, Business Engine, AI/MCP

> คงไฟล์ `app/workspace/OrgContextControl.tsx` ไว้ (ไม่ถูก import/render) เพื่อไม่ให้สูญเสีย component เดิมในกรณี owner ต้องการนำกลับ —
> การถอดครั้งนี้คือ "ไม่แสดงบนหน้าจอ" ไม่ใช่ลบความสามารถของระบบ

## Browser test (ผลจริง)

```
BASE_URL=http://localhost:3141 npx tsx scripts/workspace-tab-bar-test.ts        → 19 checks PASS (exit 0)
BASE_URL=http://localhost:3141 npx tsx scripts/workspace-adaptive-composer-test.ts → 8 checks PASS (exit 0)
BASE_URL=http://localhost:3141 npx tsx scripts/workspace-icon-cleanup-test.ts    → 7 checks PASS (exit 0)
BASE_URL=http://localhost:3141 npx tsx scripts/workspace-single-sidebar-test.ts  → 9 checks PASS (exit 0)
BASE_URL=http://localhost:3141 npx tsx scripts/tenant-workspace-org-ui-test.ts   → 4 checks PASS (exit 0)
npx tsc --noEmit                                                                 → exit 0
npx eslint <ไฟล์ที่แก้>                                                          → exit 0 (0 error)
node --check public/material-workspace/app.js                                    → OK
```

สรุปจาก `workspace-tab-bar-test` (19 ข้อ):

```
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
PASS  เว็บที่ห้าม iframe → เปิดเบราว์เซอร์ภายนอกจริง (business.facebook.com) และไม่สร้างแท็บ
PASS  เว็บที่อนุญาตให้ฝัง → แท็บจริง + iframe ชี้ไปเว็บไซต์จริง (ไม่ใช่หน้าเลียนแบบ)
PASS  กล่อง AI ด้านล่างยังชุดเดียว (iframe แชตเดิม 1 · Composer 1 — ไม่มีหน้าแชต/กล่องใหม่)
PASS  Tab Bar มี ＋ (เปิดแท็บใหม่ผ่านเมนูเครื่องมือเดิม) · 🔍 · ⋯ ครบและใช้งานได้
PASS  ไม่มีตัวเลือกองค์กร · ไม่มีปุ่มข้อความ/⋯ ในพื้นที่กลาง (⋯ อยู่บน Tab Bar)
PASS  ⋯ บน Tab Bar = เมนูจัดการแท็บ/หน้าต่าง: แสดงทุกแท็บ · สลับ · ปิดแท็บอื่น · ปิดเมนูเอง
PASS  🔍 บน Tab Bar: ค้นหาแท็บ/เครื่องมือ + เปิด URL เป็นแท็บของเว็บจริง (ไม่สร้างหน้าเลียนแบบ)
PASS  ไม่มี JavaScript error ระหว่างทั้งชุดการทดสอบ
```

## ภาพหน้าจอจริง (`/tmp/tabbar-shots`)

| ไฟล์ | แสดง |
|---|---|
| `01-workspace-tab.png` | Workspace เริ่มต้น: Tab Bar + แท็บเดียว |
| `02-resource-tab.png` | กดเครื่องมือจากแถบซ้าย → เปิดกลาง + แท็บใหม่ |
| `03-line-tab.png` | แท็บ LINE (โลโก้จริง · ชื่อ · ปุ่มปิด · active) |
| `04-closed-tab.png` | หลังปิดแท็บ → สลับไปแท็บข้างเคียง |
| `05-facebook-external.png` | เว็บห้ามฝัง → เปิดเบราว์เซอร์จริง ไม่มีแท็บ |
| `06-external-embedded.png` | เว็บที่ฝังได้ → แท็บ + iframe เว็บจริง |
| `07-tabbar-controls.png` | Tab Bar มี ＋ / 🔍 / ⋯ และไม่มีองค์กร/ปุ่มข้อความ |
| `08-tab-overflow-menu.png` | เมนู ⋯ จัดการแท็บและหน้าต่าง |
| `09-tab-search-url.png` | 🔍 + เปิด URL เป็นแท็บจริง |
| `responsive-1024.png`, `responsive-800.png` | Tab Bar ที่ความกว้าง 1024 / 800 |
| `search-1024.png`, `search-800.png` | แผงค้นหาที่ความกว้าง 1024 / 800 |

ภาพชุด org/แชต: `/tmp/dna-workspace-shots/after-1-no-org-control.png`, `after-2-chat-org-context.png`, `after-3-no-dup-buttons.png`

## ข้อจำกัด / สิ่งที่ตรวจไม่ได้ (รายงานตรง)

- **ไม่มี session จริงบนเครื่องนี้** (ไม่มี local Supabase และห้ามสร้าง/แก้ผู้ใช้ production) → org ที่ใช้ในเทสต์มาจากการ intercept
  `/api/workspace/org-context`; แท็บที่เปิด `/admin/*` แสดงหน้า guard `/login?next=…` ไม่ใช่เนื้อหาข้างใน
- **การตัดสิน "ฝังได้/ไม่ได้"** อ้าง header ของเว็บ ณ เวลากดเปิด (ไม่ cache) — เว็บที่เปลี่ยน header ภายหลังอาจได้ผลต่างจากที่วัดวันนี้
- **ไม่รัน `npm run precommit`** เพราะสคริปต์เขียน `registry/` (นอกขอบเขตงานนี้) และยังไม่มีการขอ commit
- `scripts/relationships-ui-test.ts`: **70 PASS / 5 FAIL — ไม่ใช่ผลจากงานนี้** เงื่อนไขที่ fail อ่านสตริงจาก
  `app/workspace/WorkspaceFrame.tsx` (เช่น `.msg-panel`, `className="compose"`, ปุ่มเสียงใน compose) ซึ่งย้ายไปอยู่ที่
  `DNAOSChatEngine.tsx` ตั้งแต่ก่อนงานรอบนี้ · ไฟล์ที่ผมแก้ใน `WorkspaceFrame.tsx` มีเพียงการถอด `OrgContextControl`
  และไม่ได้แตะส่วนที่ 5 เงื่อนไขนั้นอ้างถึง (ไม่ได้แก้เทสต์นี้ให้ผ่าน)
- ไม่มี commit / push / deploy

**STOP — รอเจ้าของตรวจหน้าจอที่ `http://localhost:3141/workspace` ก่อนอนุมัติ**
