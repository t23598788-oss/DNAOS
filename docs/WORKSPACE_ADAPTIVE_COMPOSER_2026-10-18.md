# DNA OS — SINGLE ADAPTIVE CHAT COMPOSER (2026-10-18)

เป้าหมาย: มีช่องพิมพ์ AI **กล่องเดียวตลอด Workspace** ใช้ Component เดิม ปรับขนาด/ความโปร่งใสตามพื้นที่ทำงาน
ข้อห้ามที่ยึด: ไม่สร้าง UI/Chat Engine/AI Gateway ใหม่ · ไม่แก้ Business Engine/MCP/Database/Finance Writer · ไม่ deploy ก่อน Browser ผ่าน

## ORIGINAL_COMPOSER

| ชั้น | สิ่งที่พบ | สถานะ |
|---|---|---|
| `app/workspace/DNAOSChatEngine.tsx` (`form.compose` + `textarea[aria-label='คำสั่ง']`) | **Composer ตัวจริง / เจ้าของเดียว** — ยิง `POST /api/chat` (pipeline เดิม), มีแนบไฟล์, ปุ่มส่ง, ลำโพงใต้คำตอบ | ✅ ใช้ต่อ ไม่แตะ engine |
| `public/material-workspace/index.html` (`#homePane > #chatForm/#chatDraft/#attachChat/#voiceChat/#sendChat`) | ฟอร์มแชตของ shell เอง — **ไม่มี JS ผูกเลย** (`setScreen` ซ่อน `#homePane` ทุกครั้ง ⇒ ไม่เคยแสดง) = **Composer ซ้ำซ้อนที่ตายอยู่** | ❌ ถอดออก แล้วใช้ `#homePane` เป็นที่โฮสต์หน้าจอแชตเดิม |
| `app/workspace/DesktopWorkspaceShell.tsx` | แถบ/aside ของตัวเอง (ปิดไปแล้วในงาน SINGLE SIDEBAR) | — |

**เจ้าของ Composer เพียงตัวเดียว = `DNAOSChatEngine` (หน้า `/workspace?materialSurface=chat`)** ซึ่งตอนนี้ถูกโหลด **ครั้งเดียว** ใน `#chatFrame` และคงอยู่ตลอด session

## FILES_CHANGED

| ไฟล์ | การเปลี่ยน |
|---|---|
| `public/material-workspace/index.html` | ถอดฟอร์มแชตซ้ำใน `#homePane` → วาง `#chatFrame` (iframe หน้าจอแชตเดิม) |
| `public/material-workspace/style.css` | Compact Floating + โปร่งใส/hover/โฟกัส + จองที่ด้านล่าง (`body.chat-compact …`) — selector ของ shell เองเท่านั้น (ไม่มี `aside{position:fixed}` / `main{margin-left}`) |
| `public/material-workspace/app.js` | `setScreen` สลับโหมดเต็ม/compact โดยไม่ reload หน้าแชต · `openWorkspaceSurface('chat')` ไม่ตั้ง src ใหม่ · relay org ไป `#chatFrame` + เก็บค่าล่าสุด replay · รับ `dna-chat-composer-active` (โฟกัสกล่องพิมพ์) และ `dna-workspace-open-route` (เปิดเครื่องมือใน `#toolFrame` เดิม) |
| `app/workspace/DNAOSChatEngine.tsx` | CSS: โปร่งใส→ชัดเมื่อ hover/focus, compact mode เมื่อพื้นที่เตี้ย (`max-height:150px`), จัดลิสต์ประวัติ · `postComposerActive()` แจ้ง shell ตอนโฟกัส/เบลอ · ปุ่มประวัติเปิดแผงรายการหัวข้อ+ลำดับเหตุการณ์จากบทสนทนาจริง · `openWorkspaceRouteInShell()` ให้เครื่องมือเปิดในพื้นที่กลางเดิมแทนการ navigate ทิ้งหน้าแชต |
| `app/workspace/OrgContextProvider.tsx` | handshake องค์กรแบบมีขอบเขต: ฝั่งลูกขอซ้ำ (สูงสุด ~6s) จนได้ประกาศจริง — แก้ปัญหา "ประกาศมาถึงก่อนหน้าจอพร้อม" ที่เกิดจากการโหลดหน้าแชตค้างไว้ตั้งแต่เปิด shell |
| `package.json` | เพิ่มสคริปต์ `workspace-adaptive-composer:test` |
| `scripts/workspace-adaptive-composer-test.ts` | เทสต์ Browser ใหม่ (8 ข้อ ตามข้อ 12) |
| `scripts/workspace-single-sidebar-test.ts` | ปรับตัววัด "พื้นที่กลาง" ให้เป็น pane เนื้อหา (`#stockPane/#toolPane/#homePane` เต็มจอ) เพราะกล่องแชตย่อลอยเป็นของลอยโดยเจตนา + หยิบ frame แชตที่ยัง alive |
| `docs/WORKSPACE_ADAPTIVE_COMPOSER_2026-10-18.md` | รายงานนี้ |

## CHAT_STATE_RESULT

- หน้าแชตโหลด **ครั้งเดียว** (`#chatFrame`) ⇒ state/ข้อความที่พิมพ์ค้างอยู่ใน React state เดิม ไม่ถูกสร้าง session ใหม่เมื่อสลับหน้าจอ
- เทสต์ยืนยัน: พิมพ์ `DRAFT-KEEP-2026-1018` → เปิดเครื่องมือ (`/admin/pits`) → กลับหน้าแชต → ค่าคงอยู่ **และตัวแปรที่ฝังใน window ของ frame ยังอยู่** (`__composerMarker === "kept"`) ⇒ หน้าแชตไม่ถูก reload จริง
- การ navigate เดิมที่ทำให้หน้าแชตถูกล้าง (คลิกเครื่องมือใน drawer / `navigate_url` จาก pipeline) เปลี่ยนเป็นสั่ง shell เปิดใน `#toolFrame` ผ่าน postMessage (`dna-workspace-open-route`) ⇒ Composer/ข้อความคงอยู่
- ไม่มี Chat Database/session ใหม่ และไม่เขียน business event ใด ๆ (ข้อ 10) — เทสต์เซสชันนี้ไม่มีการเขียน DB เลย

## COMPACT_MODE_RESULT

| สถานะ | ผลที่วัดได้จริง (Chromium 1440×900) |
|---|---|
| หน้าจอแชต | `#homePane` เต็มพื้นที่ (1440×~864) ไม่มี `body.chat-compact` = **Composer ขนาดปกติด้านล่าง** |
| ตาราง/เครื่องมือ/เอกสาร | `body.chat-compact` → กล่องลอย `h=66px`, `w≤560`, อยู่ด้านล่าง (`y>500`), **opacity 0.55** |
| Hover | opacity **1**, สูง **66 → 126px** (ขยายเท่าที่จำเป็นต่อการพิมพ์) |
| Focus (คลิกในกล่องพิมพ์) | แจ้ง shell (`dna-chat-composer-active`) → คง opacity 1/ขยายไว้แม้เอาเมาส์ออก; blur แล้วกลับ compact |
| ไม่บังเนื้อหา | `#toolPane/#stockPane` จอง `padding-bottom:92px` ⇒ ขอบล่างของ iframe เนื้อหา **อยู่เหนือกล่องลอย** (`frame.bottom ≤ panel.top`) |
| ภายในกล่อง (compact) | หน้าแชตซ่อนเฉพาะส่วนที่ไม่จำเป็น (ไทม์ไลน์/ปุ่มขอบจอ) แต่ยังเหลือกล่องพิมพ์หนึ่งเดียว + ปุ่มแนบไฟล์/ส่งเดิม |
| ข้อความที่พิมพ์ค้าง | ไม่ถูกลบทั้งตอนย่อและตอน blur (state เดิม) — ยืนยันในเทสต์ |

## HISTORY_BUTTON_RESULT

- ปุ่มเดิมมุมขวาบน (`.corner`, `data-testid="history-button"`) เปิดแผงเดิม (`aside.msg-panel`) — ไม่มีปุ่ม/ที่จัดเก็บใหม่
- เนื้อหาในแผง: **รายการหัวข้อสนทนา + ลำดับเหตุการณ์** จากบทสนทนาจริงของเซสชัน (`groupMessages` เดิม) หรือ `messagePanel` ที่หน้าอื่นส่งมา (relationships ใช้ต่อได้เหมือนเดิม)
- ไม่มีข้อมูล ⇒ แสดงข้อความตรงไปตรงมา (`data-testid="history-empty"`) ว่าไม่มีหัวข้อในเซสชันนี้ และไม่สร้างข้อมูลจำลอง/ไม่บันทึกเป็น business event

## BROWSER_TEST_RESULT

`workspace-adaptive-composer:test` → **EXIT 0 · 8 checks PASS**
```
PASS  Composer มีเพียงหนึ่งกล่อง (ตอนเปิดตาราง/ศูนย์ควบคุมทรัพยากร) · Sidebar เดียว
PASS  Compact Floating + โปร่งใส (0.55) → hover ชัด/ขยาย (1, 66→126)
PASS  Focus ค้างไว้ → กล่องคงความชัด/ขนาดแม้เอาเมาส์ออก
PASS  เปลี่ยนแท็บไปเครื่องมือแล้วข้อความที่พิมพ์ค้างไม่หาย (หน้าแชตไม่ reload) · Composer ยังเดียว
PASS  กล่องลอยไม่บังเนื้อหาเครื่องมือ (พื้นที่กลางจองที่ด้านล่างให้) · Sidebar เดียว
PASS  หน้าแชตหลัก = Composer ขนาดปกติด้านล่าง (เต็มพื้นที่) และข้อความยังอยู่
PASS  ปุ่มประวัติเดิมเปิดแผงหัวข้อสนทนา + ลำดับเหตุการณ์จากข้อมูลจริง (ไม่สร้างข้อมูลจำลอง)
PASS  ท้ายเซสชัน: Composer หนึ่งกล่อง · Sidebar ชุดเดียว (ไม่มีของซ้อน)
```
Regression (รันทั้งหมดหลังแก้): `workspace-single-sidebar:test` **9 PASS** · `workspace-icon-cleanup:test` **7 PASS** · `tenant-workspace-ui:test` **5 PASS**
Gates: `tsc --noEmit` 0 · `npm run precommit` 0 (knip broken 0/unused 0) · `node --check` app.js/shell.js ผ่าน

## SCREENSHOTS

| ไฟล์ | ความหมาย |
|---|---|
| `/tmp/composer-shots/before-1-chat-full-composer.png` | ก่อนงานนี้: หน้าแชตมี Composer ในกรอบของตัวเอง (ไม่มีโหมด compact) |
| `/tmp/composer-shots/before-2-tool-open-no-composer.png` | ก่อนงานนี้: เปิดเครื่องมือแล้ว **ไม่มีช่องพิมพ์เหลืออยู่เลย** (ปัญหาที่งานนี้แก้) |
| `/tmp/composer-shots/after-1-stock-compact.png`, `after-2-compact-floating.png` | เปิดตาราง/ศูนย์ควบคุมทรัพยากร: กล่องเดียว ย่อเล็ก โปร่งใส |
| `/tmp/composer-shots/after-3-hover-expanded.png` | hover: ชัดขึ้น + ขยายเท่าที่จำเป็น |
| `/tmp/composer-shots/after-4-tool-with-composer.png` | เปิดเครื่องมือ `/admin/pits` แล้ว Composer ตัวเดิมยังอยู่ ไม่บังเนื้อหา |
| `/tmp/composer-shots/after-5-chat-normal.png` | หน้าแชตหลัก: Composer ขนาดปกติด้านล่าง |
| `/tmp/composer-shots/after-6-history-panel.png` | แผงประวัติจากปุ่มเดิม (หัวข้อ + ลำดับเหตุการณ์จริง) |

## ข้อจำกัดที่รายงานตรง (ไม่นับเป็น pass)

1. **ไม่ deploy** ตามคำสั่ง · production ยังเป็นโค้ดเดิม
2. **session จริงไม่มีบนเครื่องนี้** — หน้าปลายทาง `/admin/*` ถูก guard ไป `/login?next=…`; ตรวจได้ถึงระดับ "เรียกเส้นทางเดิมจริง" ไม่ใช่เนื้อหาหน้า
3. **ความโปร่งใส** ใช้ `opacity` ของกล่อง (`#homePane`) — ค่าเฉพาะเจาะจงเป็น **0.55 เมื่อไม่ใช้งาน → 1 เมื่อ hover/โฟกัส**; ถ้า Owner ต้องการระดับอื่น (เช่น 0.35/0.75 หรือเบลอหลัง) ปรับค่าเดียวใน `style.css` ได้
4. `public/material-workspace/` ทั้งโฟลเดอร์ยัง **untracked** ใน git
5. ระบบเสียงยังเป็น TTS `speak()` (ไม่มีระบบบันทึกเสียงใน repo) และไม่มีการเปิดไมโครโฟนทั้งเซสชัน
6. เทสต์ dev-only: ลบ overlay ของ Next.js Dev Tools ก่อนคลิกปุ่มมุมซ้ายล่างในเทสต์ single-sidebar
