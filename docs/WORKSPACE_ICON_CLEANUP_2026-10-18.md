# DNA OS — WORKSPACE ICON & CONTROL CLEANUP (2026-10-18)

คำสั่ง: คืน Workspace ให้มีแถบเครื่องมือหลักชุดเดียว · หน้าจอแชตโล่ง ไม่ซ้อนปุ่มควบคุม
ข้อห้ามที่ยึด: ไม่สร้าง UI/voice engine ใหม่ · ไม่ลบ Business Tools · ไม่แตะ DB/AI/MCP/Finance Writer · ไม่ deploy ก่อนผล Browser ผ่าน

## STRUCTURE ที่ตรวจ (Source ก่อนแก้)

| ไฟล์ | บทบาทที่พบ |
|---|---|
| `app/workspace/WorkspaceFrame.tsx` | เปลือกเดียวของ workspace — ชั้นนอก `/workspace` ฝัง shell · ชั้นใน `?materialSurface=chat\|tools` |
| `app/workspace/DesktopWorkspaceShell.tsx` | ผิวเครื่องมือ (desktop) มี rail ของตัวเอง — ใช้ที่เดียวใน `WorkspaceFrame` |
| `app/workspace/DNAOSChatEngine.tsx` | หน้าจอแชต: `.corner` (ประวัติ) · `.edge left` (กล่องเครื่องมือ) · `.gear` (ตั้งค่า) · กล่องพิมพ์ + แนบไฟล์/เสียง/ส่ง |
| `public/material-workspace/*` | shell (48px rail: เปิดเครื่องมือ · แชท · ศูนย์ควบคุมทรัพยากร · ตั้งค่า) + relay org context |
| Voice | **ไม่มีระบบบันทึกเสียงใน source เลย** (ไม่พบ `MediaRecorder`/`SpeechRecognition`/`getUserMedia`) — ของเดิมคือ TTS (`speechSynthesis`) เปิด/ปิดด้วยปุ่มเดียว ไม่แตะไมโครโฟน |

## FILES_CHANGED (งานนี้)

| ไฟล์ | การเปลี่ยน |
|---|---|
| `app/workspace/DNAOSChatEngine.tsx` | นำเข้า `Volume2, VolumeX` · ปุ่มเสียงในแถบเครื่องมือของกล่องพิมพ์เปลี่ยนจากปุ่มข้อความใหญ่ `"🔊 เสียง: เปิด"` เป็น **ไอคอน** ขนาดเท่าปุ่มอื่น (`data-testid="voice-toggle"`, คง `aria-pressed`/`aria-label`/`title` เดิม) |
| `package.json` | เพิ่มสคริปต์ `workspace-icon-cleanup:test` |
| `scripts/workspace-icon-cleanup-test.ts` | เทสต์ Browser จริง (ใหม่) — 7 ข้อ |
| `docs/WORKSPACE_ICON_CLEANUP_2026-10-18.md` | รายงานนี้ |

(สแตมป์งานรอบก่อนที่ยังไม่ commit และอยู่ในไฟล์เดียวกัน: `embedded` prop ที่ซ่อน `.gear`/`.edge left` เมื่อถูกฝัง — เป็นส่วนของ DUPLICATE_CONTROLS_REMOVED ด้านล่าง)

## DUPLICATE_CONTROLS_REMOVED

| ควบคุม | ก่อน | หลัง | วิธี |
|---|---|---|---|
| **ไอคอนสี่เหลี่ยม** (grid 4 ช่อง) | 2 จุด: shell `#toolsMain` + แชต `.edge left` | **1 จุด** = shell `#toolsMain` (แถบนำทางเดิม) | ซ่อน `.edge left` เฉพาะเมื่อถูกฝัง (`embedded`) — ไม่สร้างปุ่มใหม่ |
| **ตั้งค่า** | 2 จุด: shell `#settings` + แชต `.gear` | **1 จุด** = shell `#settings` (ตำแหน่งเดิม) | ซ่อน `.gear` ในโหมดถูกฝัง |
| **ปุ่มเสียงขนาดใหญ่** | ปุ่มข้อความ `"🔊 เสียง: เปิด"` (101×44) กินพื้นที่แถบกล่องพิมพ์ | ไอคอน 44×44 เท่าปุ่มอื่น (วัดจาก Browser) | เปลี่ยนเนื้อหาปุ่มเดิมเป็นไอคอน ไม่ย้าย/ไม่ลบความสามารถ |
| org control | 2 ชุด (parent+nested) | 1 ชุด | งานรอบก่อน (`OrgContextProvider.standalone` + relay ใน `public/material-workspace/app.js`) |

## ORIGINAL_CONTROLS_RESTORED (ของเดิมที่ยังทำงานครบ)

- **แถบนำทาง shell** = ที่เดียวของไอคอนเครื่องมือ: เปิดเครื่องมือ · แชท · ศูนย์ควบคุมทรัพยากร · ตั้งค่า (ไม่มีการสร้าง navigation ใหม่)
- **ปุ่มตั้งค่า** อยู่ตำแหน่งเดิมในแถบ shell และเส้นทาง `/admin/settings` ยังเปิดได้จากผิวเครื่องมือ (ยืนยันด้วย `iframe[src*="/admin/settings"]`)
- **ระบบเสียง** ยังอยู่และเปิด/ปิดได้จากปุ่มเดิมในแถบเครื่องมือของกล่องพิมพ์ (TTS เท่านั้น · ไม่มี auto-listen)
- **ปุ่มแนบไฟล์ + ปุ่มส่ง** คงเดิมทุกประการ · กล่องพิมพ์เหลือชุดเดียว
- **เครื่องมือธุรกิจ**: ผิวเครื่องมือยังมี สร้างเอกสาร/เอกสาร/ศูนย์ควบคุมทรัพยากร/ตั้งค่า และผิวศูนย์ควบคุมทรัพยากรโหลดข้อมูลจาก `GET /api/admin/pits` แล้วแสดงรายการ+ตัวนับได้จริง

## BROWSER_TEST_RESULT

`BASE_URL=http://localhost:3141 npx tsx scripts/workspace-icon-cleanup-test.ts` → **EXIT 0 · 7 checks PASS**

```
PASS  ไอคอนสี่เหลี่ยมเหลือ 1 จุด (shell #toolsMain) และพื้นที่แชตไม่มีปุ่มเครื่องมือซ้ำ
PASS  ปุ่มตั้งค่าเหลือ 1 จุด (ตำแหน่งเดิมในแถบ shell) และออกจากกล่องแชตแล้ว
PASS  พื้นที่แชตเหลือกล่องพิมพ์ชุดเดียว + ปุ่มแนบไฟล์/ส่งเดิมครบ
PASS  ปุ่มเสียงเป็นไอคอนเล็กในตำแหน่งเดิม (แถบเครื่องมือกล่องพิมพ์) · กดเปิด/ปิดได้
      · ไม่มีการเปิดไมโครโฟนหรือบันทึกเสียง (getUserMedia/MediaRecorder = 0 ตลอดเซสชัน)
INFO  หน้าตั้งค่า: เปิดเส้นทางเดิมแล้ว · ปลายทาง=/login?next=%2Fadmin%2Fsettings
      (ไม่มี session จริงบนเครื่องนี้ ⇒ guard ทำงานตามปกติ)
PASS  ผิวเครื่องมือยังอยู่ครบ (สร้างเอกสาร/เอกสาร/ศูนย์ควบคุมทรัพยากร/ตั้งค่า) และเส้นทางหน้าตั้งค่าเดิมยังเปิดได้
PASS  ผิวธุรกิจ (ศูนย์ควบคุมทรัพยากร) ยังเปิดและแสดงข้อมูลจริงได้ (2 รายการ · counters OK)
PASS  หลังเปิดทุกผิว: ไอคอนสี่เหลี่ยม 1 จุด · ไม่มีการเปิดไมโครโฟนทั้งเซสชัน
```

Regression ของงาน tenant: `tenant-workspace-org-ui:test` → EXIT 0 · 5 checks PASS
Gates: `tsc --noEmit` 0 · `npm run precommit` 0

## SCREENSHOT_BEFORE_AFTER

| ไฟล์ | ความหมาย |
|---|---|
| `/tmp/icon-shots/before-1-parent.png`, `before-2-chat.png` | ก่อนแก้ (ถ่ายจาก source จริงก่อนเปลี่ยนปุ่มเสียง: แถบกล่องพิมพ์มีปุ่มข้อความ 🔊 ขนาดใหญ่) |
| `/tmp/icon-shots/after-1-parent.png` | ชั้นนอก: org control ชุดเดียว ไม่มีไอคอนแชตซ้อน |
| `/tmp/icon-shots/after-2-chat.png` | หน้าแชตหลังแก้: กล่องพิมพ์ชุดเดียว · แนบไฟล์ · ไอคอนเสียงเล็ก · ส่ง |
| `/tmp/icon-shots/after-3-tools-settings.png` | ผิวเครื่องมือ + แท็บเส้นทาง `/admin/settings` |
| `/tmp/icon-shots/after-4-stock-table.png` | ผิวศูนย์ควบคุมทรัพยากรแสดงข้อมูลจริง |

ก่อนหน้า (งาน org control): `/tmp/dup-shots/before-1-default.png`, `before-2-chat.png` แสดงตัวเลือกองค์กร 2 ชุดที่พิกัด parent `(1238,12)` + nested `(1190,12)`

## ข้อจำกัดที่รายงานตรง (ไม่นับเป็น pass)

1. **"กดบันทึกเสียงได้" ตรวจไม่ได้** — ไม่มีระบบบันทึกเสียง/สั่งงานด้วยเสียงใน source เลย (ไม่พบ `MediaRecorder`/`SpeechRecognition`/`getUserMedia` ทั้ง repo) จึงยืนยันได้เฉพาะว่า **ไม่มี** การเปิดไมโครโฟน/บันทึกเสียงอัตโนมัติ (นับ 0 ตลอดเซสชัน) และการกดปุ่มเสียงเป็นการสลับ TTS เท่านั้น — ถ้าต้องการบันทึกเสียงจริง ต้องมีคำสั่งสร้างระบบใหม่ (นอกขอบเขตที่ห้ามไว้)
2. **หน้าตั้งค่า/เอกสาร ต้องมี session จริง** — บนเครื่องนี้ (ไม่มี local Supabase, ห้ามใช้ผู้ใช้ production) ปลายทางถูก guard ไป `/login?next=…` ตรวจได้แค่ว่าเส้นทางเดิมยังถูกเรียก (`iframe[src*="/admin/settings"]` → `/admin/settings?desktop=1`) ไม่ใช่เนื้อหาหน้า
3. **ยังไม่ deploy** ตามคำสั่ง — production ยังเป็นโค้ดเดิม (`/workspace` 307 · `/api/workspace/org-context` 401)
4. `public/material-workspace/` ทั้งโฟลเดอร์ยัง **untracked** ใน git
5. แถบนำทางของผิวเครื่องมือ (216px) ยังซ้อนกับแถบ shell (48px) — ตามการตัดสินของ Owner ในรายงานก่อน (`docs/WORKSPACE_ORG_CONTROL_FIX_2026-10-18.md` §4.1) เพราะเป็นทางเดียวไป `/admin/pits`, `/admin/documents` ฯลฯ
