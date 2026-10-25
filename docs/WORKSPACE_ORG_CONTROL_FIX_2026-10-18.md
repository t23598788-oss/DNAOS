# WORKSPACE DUPLICATE ORG CONTROL — SOURCE → FIX → BROWSER EVIDENCE (2026-10-18)

คำสั่ง Owner: `DNA OS — WORKSPACE DUPLICATE CONTROL FIX` (ห้ามสร้าง/ลบองค์กร · ห้ามแตะ Business Engine/MCP/AI Runtime/Finance Writer/โครงสร้าง DB · ห้าม deploy ก่อนหน้าจอผ่าน)

## 1) ต้นทางของข้อความ "สำนักงานใหญ่"

| ชั้น | ผลตรวจ |
|---|---|
| Source (ts/tsx) | ไม่มี — เจอเฉพาะ placeholder ตัวอย่างใน `app/admin/jobs/create/page.tsx:299` ("เช่น หน้างานบางนา, สำนักงานใหญ่") |
| Migration | ไม่มี `insert` ลง `public.organizations` ใน migrations ใด |
| Seed | ไม่มีไฟล์ seed องค์กรใน repo |
| ข้อมูลจริง production | **มีจริง 1 แถว**: `id=1f52520a-39fa-448f-8455-9ee4c72b00b0`, `name="สำนักงานใหญ่"`, `created_at=2026-10-18T05:17:21Z`, `created_by=33a80907…` (owner) |

**ใครสร้าง**: สคริปต์ bootstrap ครั้งเดียวที่รันในภารกิจ tenant (เมื่อ 2026-10-18 05:17Z) ภายใต้คำสั่ง Owner `REMAINING GAPS EXECUTION` — ไม่ใช่ seed ของระบบ ไม่ใช่ migration และสคริปต์ถูกลบหลังใช้ (`scripts/_tmp_bootstrap_org.mjs` ไม่มีแล้ว)
**คำสั่ง Owner รองรับหรือไม่**: รองรับเฉพาะ "bootstrap องค์กรเริ่มต้น 1 แห่ง" — ไม่ได้รองรับการมีอยู่ซ้ำบนหน้าจอ (ซึ่งเป็นบั๊ก UI ที่งานนี้แก้)
**สถานะปัจจุบัน**: `organizations` = **1 แถว**, `org_members` = 2 (owner 1 / admin 1) · `companies.organization_id` ที่ถูก stamp = **0** (ไม่ backfill)
**ห้ามลบ**: งานนี้ไม่ลบ/ไม่แก้แถวนี้ (reversible ด้วย SQL เดียวถ้า Owner สั่ง)

## 2) ต้นเหตุของ "ตัวเลือกองค์กร 2 ชุด"

workspace จริงเป็น **สองชั้น** และทั้งสองชั้นเรนเดอร์ `OrgContextControl` ของตัวเอง:

```
/workspace                                  ← PARENT  (WorkspaceFrame: <OrgContextControl/> + iframe shell)
└─ iframe /material-workspace/index.html     ← SHELL   (แถบเครื่องมือของตัวเอง 4 ปุ่ม · ไม่มี org UI)
   └─ iframe /workspace?materialSurface=chat ← CHILD   (WorkspaceFrame ซ้ำ → <OrgContextControl/> ซ้ำ)
```

- Parent component: `app/workspace/WorkspaceFrame.tsx`
- Child component: `app/workspace/WorkspaceFrame.tsx` (เรนเดอร์ซ้ำที่ `?materialSurface=chat|tools` ผ่าน shell)
- State กลางเดิม: `app/workspace/OrgContextProvider.tsx` — แต่เดิมทุกชั้นเรียก `fetch GET /api/workspace/org-context` เอง ⇒ มี authority 2 ตัว
- วัดพิกัดจริงก่อนแก้: parent `(x=1238,y=12)` + nested `(x=1190,y=12)` ทับกันมุมขวาบน (screenshot: `/tmp/dup-shots/before-1-default.png`, `before-2-chat.png`)
- ไอคอนซ้ำ: child วาด `.gear` (ตั้งค่า) และ `.edge left` (กล่องเครื่องมือ) ทั้งที่ shell มีปุ่มเดียวกันอยู่แล้ว

## 3) การแก้ (ใช้ component/state เดิม ไม่สร้าง navigation/workspace ใหม่)

| ไฟล์ | การเปลี่ยน |
|---|---|
| `app/workspace/OrgContextProvider.tsx` | เพิ่มโหมด `standalone` — parent เท่านั้นเป็นเจ้าของ fetch/POST/state; child ไม่ fetch/POST ซ้ำ แต่รับค่าจาก parent ผ่าน `postMessage` (same-origin) + ขอค่าปัจจุบันตอน mount (`dna-org-context-request`) |
| `app/workspace/WorkspaceFrame.tsx` | `OrgContextControl` เรนเดอร์ **เฉพาะชั้นนอก** (`!embedded`); `ChatWithOrg` ยัง remount ตาม org (key) เหมือนเดิม |
| `app/workspace/DNAOSChatEngine.tsx` | รับ prop `embedded` — ซ่อนเฉพาะ `.gear` + `.edge left` ที่ซ้ำกับ shell; คง `.edge right` (คำสั่งของรายการ) และ `.corner` (ประวัติการสื่อสาร) |
| `public/material-workspace/app.js` | shell ทำหน้าที่ **relay** ข้อความ `dna-org-context` / `dna-org-context-request` ระหว่าง parent ↔ `#toolFrame` (ชั้นในไม่ได้รับ postMessage ตรงเพราะมี shell คั่น) — ไม่เพิ่ม state/UI ใดใน shell |

ไม่มี: องค์กรใหม่ · การลบข้อมูล · การแก้ schema · Business Engine/MCP/AI Runtime/Finance Writer

## 4) Browser test (Chromium จริง, http://localhost:3141/workspace)

`scripts/tenant-workspace-org-ui-test.ts` — session จริงใช้ไม่ได้บนเครื่องนี้ (ไม่มี local Supabase และห้ามสร้าง/แก้ผู้ใช้ production) จึง intercept `/api/workspace/org-context` + `/api/chat` ด้วย org สังเคราะห์ A/B

```
EXIT=0  →  5 checks PASS
  org control (ชั้นนอก): x=1237.72 y=12 w=186.28 h=40 — มี 1 ตำแหน่งเท่านั้น
PASS  ชั้นนอกแสดงตัวเลือกองค์กรชุดเดียว (ไม่มี DNA OS) + ฝัง desktop shell
PASS  ยังไม่เลือก org → ชั้นในปิด composer + ไม่มีตัวเลือก/ไอคอนซ้ำ (รวมทุกชั้น = 1 ชุด)
PASS  เลือก org ที่ชั้นนอก → ชั้นในเปลี่ยนเป็น 'ถาม SYNTH-ORG-A...' (ไม่ต้อง reload)
PASS  มีผลลัพธ์ของ org A อยู่บนจอชั้นใน
PASS  สลับ org → ชั้นในล้างแชต/ผลลัพธ์เดิม และยังเหลือตัวเลือกชุดเดียว
```

Screenshot หลังแก้: `/tmp/dna-workspace-shots/after-1-default-no-org.png`, `after-2-chat-no-org.png`, `after-3-chat-orgA.png`, `after-4-chat-orgB.png`

Gates: `tsc --noEmit` = 0 · `npm run precommit` = 0 · `node --check public/material-workspace/app.js` = ok

## 4.1) พบเพิ่ม: แถบนำทางซ้อนบนผิว "เครื่องมือ" (ยังไม่แก้ — รอ Owner ตัดสิน)

วัดจริงด้วย Chromium (เปิด `/workspace` → กดปุ่ม "เปิดเครื่องมือ" ของ shell):

| Frame | aside | nav | org control | หมายเหตุ |
|---|---|---|---|---|
| `/workspace` (ชั้นนอก) | 0 | 0 | 1 | ตัวเลือกองค์กรตำแหน่งเดียว |
| `/material-workspace/index.html` (shell) | 1 (48px, x=0) | 0 | 0 | แถบ shell |
| `/workspace?materialSurface=tools` (ชั้นใน) | 1 (216px, x=0) | 1 | 0 | `DesktopWorkspaceShell` วาดแถบของตัวเอง → **เห็นสองแถบซ้อนกัน** |

สาเหตุ: `DesktopWorkspaceShell` (ใช้ที่เดียวใน `WorkspaceFrame`) ออกแบบเป็น desktop เต็มหน้าจอ จึงมี rail ของตัวเอง
**ทำไมยังไม่แก้**: rail ของชั้นในเป็นทางเดียวไป `/admin/create-document`, `/admin/documents`, `/admin/pits`, `/admin/settings` — ซ่อนทิ้ง = ตัดการเข้าถึงเส้นทางจริง และถ้าจะย้ายเข้า shell ก็เข้าข่าย "สร้าง Navigation ใหม่" ที่คำสั่งห้าม ⇒ ต้องให้ Owner เลือกว่าแถบใดเป็นแถบเดียว

## 5) ยังไม่ทำ / ข้อจำกัด

- **ไม่ deploy** ตามคำสั่ง (รอ Owner ตรวจหน้าจอก่อน) — โค้ดยังอยู่บน working tree
- live session ของ Owner (ระบบ login จริง) ไม่ได้ทดสอบ — BLOCKED เหมือนเดิม
- `public/material-workspace/` ทั้งโฟลเดอร์ยัง **untracked** ใน git (shell เดิมไม่เคยถูก track) ⇒ ต้อง `git add` ก่อน commit งานนี้
- แถบนำทางซ้อนบนผิวเครื่องมือ (§4.1) ยังอยู่ — เป็นการตัดสินของ Owner ไม่ใช่บั๊กที่แก้ได้โดยไม่ตัดการเข้าถึง
