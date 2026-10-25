# DNA OS — SINGLE SIDEBAR / LOCK EXISTING LAYOUT (2026-10-18)

คำสั่ง: รวมไอคอนนำทางไว้ที่ Sidebar หลักชุดเดียว · ตรึง Sidebar และ Top Bar เดิม · คืนพื้นที่กลางให้แชต/ตาราง/ผลลัพธ์ธุรกิจ
ข้อห้ามที่ยึด: ไม่สร้าง UI/ไอคอน/Navigation ใหม่ · ไม่เปลี่ยน Business Engine · ไม่แตะ DB/AI/MCP/Finance Writer · ไม่ deploy ก่อน Browser ผ่าน

## ORIGINAL_LAYOUT_OWNER

| สิ่งที่OWNER | Component/ไฟล์ | หลักฐาน |
|---|---|---|
| **Sidebar หลัก** | `public/material-workspace/index.html` (`<aside aria-label="เครื่องมือ">` 48px) + `style.css` (`body{grid-template-columns:48px minmax(0,1fr)}`) | วัดจริง: aside กว้าง 48px x=0 · มี 4 ปุ่มเดิม (เปิดเครื่องมือ/แชท/ศูนย์ควบคุมทรัพยากร/ตั้งค่า) |
| **Top Bar หลัก** | `public/material-workspace/index.html` (`<header>` 44px) + `style.css` (`header{height:44px;flex:0 0 44px}`) | วัดจริง: header ชุดเดียว, พื้นที่กลางเริ่มใต้ header |
| **พื้นทีกลาง** | `public/material-workspace/index.html` (`<main>` → `#stockPane` / `#homePane` / `#toolPane > #toolFrame`) | ทุกเครื่องมือ/แชต/ตารางถูกแสดงใน 3 pane นี้เท่านั้น |
| Layout lock | shell เอง (`html,body{overflow:hidden}` + grid + `aside{height:100dvh}`) | ไม่เพิ่ม global CSS ใด ๆ (ห้าม `aside{position:fixed}` / `main{margin-left:64px}` ตามคำสั่ง) |

Navigation ที่แสดงบนจอทั้งหมดถูกขับด้วย `public/material-workspace/shell.js` (`#chatHome` → `openWorkspaceSurface('chat')`, `#toolsMain` → เมนูเครื่องมือ) และใช้ `#toolFrame` เป็นที่แสดงผล — ไม่มี navigation ชุดที่สอง

## DUPLICATE_LAYOUT_SOURCE

**`app/workspace/DesktopWorkspaceShell.tsx`** (เรนเดอร์โดย `WorkspaceFrame` เมื่อ `?materialSurface=tools` ซึ่ง shell เปิดใน `#toolFrame`):

- `aside` 216px ของตัวเอง (`data-testid=desktop-rail`) พร้อม `nav` 5 ปุ่ม → **ผู้ใช้เห็น sidebar 2 ชุดพร้อมกัน** (48px + 216px, ทั้งคู่ x=0)
- `div[role=tablist]` 46px ของตัวเอง (`data-testid=desktop-tabstrip`) → **top bar 2 ชั้น** (shell header + tab strip)
- วัดก่อนแก้ (Browser จริง, 2026-10-18 13:12): `{"/workspace": asides 0} · {shell: asides 1 (48px, x=0)} · {"?materialSurface=tools": asides 1 (216px, x=0), navs 1} · {"?desktopContent=1": asides 0}`

## FILES_CHANGED

| ไฟล์ | การเปลี่ยน |
|---|---|
| `public/material-workspace/shell.js` | `#toolsMain` เปิด **เมนูเครื่องมือเดิม** (`window.openToolsDialog()`) แทนการเปิดผิว desktop ที่มี sidebar/tab bar ชุดที่สอง |
| `public/material-workspace/app.js` | ต่อสายเมนูเครื่องมือเดิม (`#toolsDialog`/`#toolList`/`#toolSearch` + `tools.json` เดิม) ให้เลือกแล้วเปิดใน `#toolFrame` เดิม (`openToolRoute`) — เพิ่มเฉพาะ JS ผูกของเดิม ไม่มี UI/ไอคอนใหม่ |
| `app/workspace/DesktopWorkspaceShell.tsx` | รับ prop `embedded` — เมื่อถูกฝัง **ไม่วาด aside และ tab strip ของตัวเอง** (ยังคง iframe/tabs/handler เดิมทั้งหมด) |
| `app/workspace/WorkspaceFrame.tsx` | ส่ง `embedded` เข้า `DesktopWorkspaceShell` (ค่าเดิมของ frame นี้: `!!materialSurface \|\| desktopContent`) |
| `app/workspace/DNAOSChatEngine.tsx` | ลำโพง: ย้ายจากกล่องพิมพ์ → ไอคอนเล็กใต้ข้อความตอบกลับ (`data-testid=reply-tts`, ใช้ `speak()` เดิม) · ตัดการอ่านอัตโนมัติ 4 จุด · state `voiceOn/voiceRef` ที่ไม่ใช้แล้วออก · CSS ใหม่จำกัดที่ `#dna-frame .reply-tts` เท่านั้น |
| `package.json` | เพิ่มสคริปต์ `workspace-single-sidebar:test` |
| `scripts/workspace-single-sidebar-test.ts` | เทสต์ Browser ใหม่ (9 ข้อ ตามข้อ 10) |
| `scripts/workspace-icon-cleanup-test.ts` | อัปเดตสัญญาเดิมตามคำสั่งใหม่ (ลำโพงไม่อยู่ใน Composer; ทางเข้าเครื่องมือ = เมนูใน sidebar) |
| `docs/WORKSPACE_SINGLE_SIDEBAR_2026-10-18.md` | รายงานนี้ |

## REMOVED_DUPLICATES

| ซ้ำ | ก่อน | หลัง |
|---|---|---|
| Sidebar | 2 ชุด (shell 48px + `desktop-rail` 216px) | **1 ชุด** (shell 48px) |
| Top Bar | 2 ชั้น (shell header 44px + `desktop-tabstrip` 46px) | **1 ชั้น** (shell header) |
| ทางเข้าเครื่องมือ | ปุ่มใน sidebar + rail ในผิวเครื่องมือ + ไอคอน `.edge left` ในแชต | **จุดเดียว** = `#toolsMain` → เมนูเครื่องมือเดิม |
| ปุ่มตั้งค่า | shell `#settings` + `.gear` ในแชต (+ rail ในผิวเครื่องมือ) | **จุดเดียว** = shell `#settings` |
| ปุ่มลำโพง | ปุ่มข้อความในกล่องพิมพ์ (`🔊 เสียง: เปิด`) | ไอคอนเล็กใต้ข้อความตอบกลับเท่านั้น (0 ในกล่องพิมพ์) |

## RESTORED_BUSINESS_VIEWS

- **แชตหลัก** — พื้นที่กลางเดิม (`?materialSurface=chat`) กล่องพิมพ์ชุดเดียว ปุ่มแนบไฟล์/ส่งเดิม
- **ตารางธุรกิจเดิม** — ผิวศูนย์ควบคุมทรัพยากร (`#stockPane`) โหลด `GET /api/admin/pits` แล้วแสดงรายการ + ตัวนับจริง
- **เครื่องมือที่เปิดจากไอคอน** — เมนูเครื่องมือเดิม 54 รายการ / 3 กลุ่ม (จาก `tools.json`) เปิดใน `#toolFrame` เดิม; เส้นทางภายนอก (LINE, Cloud GPU) เปิดแท็บใหม่
- **เอกสารและผลลัพธ์ธุรกิจ** — ผลลัพธ์จาก `/api/chat` ยังแสดงใน timeline เดิม พร้อมไอคอนลำโพงใต้คำตอบ
- **หน้าตั้งค่า** — เส้นทาง `/admin/settings` เดิมยังถูกเรียก (ยืนยันจาก `iframe src`)

## BROWSER_TEST_RESULT

`BASE_URL=http://localhost:3141 npx tsx scripts/workspace-single-sidebar-test.ts` → **EXIT 0 · 9 checks PASS**

```
PASS  Sidebar มีชุดเดียว (48px ของ shell) — ทุก frame รวมกันนับได้ 1
PASS  Top Bar มีชุดเดียวและไม่ซ้อนพื้นที่กลาง
PASS  ไอคอนแชทเปิดพื้นที่กลางได้ และไม่มี sidebar ซ้อน
PASS  เปิดเครื่องมือจาก sidebar ได้ · เมนูครบ 54 รายการ/3 กลุ่ม · layout ไม่ขยับ · sidebar ยังชุดเดียว
INFO  เครื่องมือที่เลือก: เปิดเส้นทางเดิมในพื้นที่กลางแล้ว ⇒ /login?next=%2Fadmin%2Fpits
PASS  เครื่องมือที่เลือกเปิดในพื้นที่กลางเดิม (iframe เดิม) — layout คงที่
PASS  ตาราง/ผิวธุรกิจเดิมเปิดได้ (2 รายการ) และไม่มี horizontal overflow (shell + แชต)
PASS  ลำโพงเป็นไอคอนเล็กใต้ข้อความตอบกลับ · ไม่มีปุ่มใดบังพื้นที่แชต/กล่องพิมพ์
PASS  ไม่อ่านอัตโนมัติ · กดไอคอนลำโพงใต้คำตอบแล้วอ่านจริง · ไม่เปิดไมโครโฟน
PASS  ปุ่มตั้งค่าเหลือจุดเดียวใน sidebar หลัก และยังทำงาน (แสดงสถานะการเชื่อมต่อเดิม)
```

Regression (ยังผ่านทั้งหมด): `workspace-icon-cleanup:test` **7 PASS** · `tenant-workspace-ui:test` **5 PASS**
Gates: `tsc --noEmit` 0 · `npm run precommit` 0 (knip unused 0 · architecture 0 broken/0 unused) · `node --check` shell.js/app.js ผ่าน

รายละเอียดที่วัดได้: พิกัด `aside/header/พื้นที่กลาง` **เท่ากันทุกสถานะ** (ก่อน/หลังเปิดแชต/เปิดเครื่องมือ/เปิดเครื่องมือในพื้นที่กลาง) · ไม่มี horizontal overflow ทั้ง shell และชั้นในแชต · ไม่มีปุ่มใดทับกล่องพิมพ์

## SCREENSHOT_BEFORE_AFTER

| ไฟล์ | ความหมาย |
|---|---|
| `/tmp/sidebar-shots/before-1-tools-two-rails.png` | **ก่อนแก้** (จับก่อนเริ่มงานนี้ 13:12): เปิดเครื่องมือแล้วเห็น sidebar 2 ชุด (48px shell + 216px rail ของผิวเครื่องมือ) |
| `/tmp/sidebar-shots/after-1-default.png` | หลังแก้: sidebar 48px ชุดเดียว + top bar ชุดเดียว + พื้นที่กลาง |
| `/tmp/sidebar-shots/after-2-tools-menu.png` | เมนูเครื่องมือเดิม (54 รายการ/3 กลุ่ม) เปิดจากปุ่มเดียวใน sidebar โดย layout ไม่ขยับ |
| `/tmp/sidebar-shots/after-3-tool-in-center.png` | เครื่องมือที่เลือกเปิดในพื้นที่กลางเดิม |
| `/tmp/sidebar-shots/after-4-chat-reply-tts.png` | แชตหลังแก้: กล่องพิมพ์ไม่มีปุ่มลำโพง + ไอคอนลำโพงเล็กใต้ข้อความตอบกลับ |
| `/tmp/sidebar-shots/after-5-settings.png` | ปุ่มตั้งค่าจุดเดียวใน sidebar หลัก |
| `/tmp/icon-shots/before-2-chat.png` → `after-2-chat.png` | เทียบปุ่มเสียงในกล่องพิมพ์ (ก่อน/หลัง) |

## ข้อจำกัดที่รายงานตรง (ไม่นับเป็น pass)

1. **ผิว desktop เดิม (`?materialSurface=tools`) ไม่ถูกเรียกจาก sidebar อีกแล้ว** — เพราะมันเป็นแหล่งซ้ำของ sidebar/top bar; โค้ดยังอยู่ครบและเปิดได้ตรง ๆ แต่ปลายทางทั้งหมดของมัน (Workspace/สร้างเอกสาร/เอกสาร/ศูนย์ควบคุมทรัพยากร/ตั้งค่า) เข้าถึงได้จากเมนูเครื่องมือเดิมใน sidebar ⇒ ถ้า Owner ต้องการคงผิวนี้เป็นทางเข้าหลัก ต้องเลือกว่าจะให้ sidebar ชุดใดเป็นชุดเดียว (ปัจจุบันเลือก shell)
2. **session จริงไม่มีบนเครื่องนี้** — ปลายทาง `/admin/*` ถูก guard ไป `/login?next=…`; ตรวจได้ถึงระดับ "เรียกเส้นทางเดิมจริง" ไม่ใช่เนื้อหาหน้า
3. ยังไม่ deploy (ตามคำสั่ง) · `public/material-workspace/` ทั้งโฟลเดอร์ยัง untracked ใน git
4. ระบบเสียงยังเป็น TTS (`speak`) เท่านั้น — repo ไม่มีระบบบันทึกเสียง/สั่งงานด้วยเสียง (ไม่พบ `MediaRecorder`/`SpeechRecognition`), ไม่มีการเปิดไมโครโฟนทั้งเซสชัน (นับ 0)
5. ป้าย Next.js Dev Tools (dev-only) ลอยมุมซ้ายล่าง — เทสต์ลบ overlay นี้ก่อนคลิกปุ่มตั้งค่า (ไม่ใช่ UI ของผลิตภัณฑ์)
