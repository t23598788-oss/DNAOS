# DNA OS — WORKSPACE FINAL UI (owner mission 2026-10-18)

สถานะ: **LOCAL PASS — STOP รอเจ้าของตรวจและอนุมัติ**  
URL ตรวจ: **http://localhost:3141/workspace** (dev server รันอยู่)  
ยังไม่ commit / push / deploy ตาม RELEASE GATE ข้อ 09

---

## สรุป PASS / FAIL

| # | ข้อกำหนด | ผล | หลักฐาน |
|---|---|---|---|
| 01 | ลบ Bottom Bar / Footer ทุกหน้าจอ Workspace | **PASS** | `footer = 0` ทุกชั้น · `#homePane/#stockPane/#toolPane` สูงถึง y=900 · Composer ห่างขอบล่าง 10px · ลบ footer ของ `/workspace/capability` (`MaterialsHost`) แล้ว |
| 02 | QAI Composer โปร่งใส · hover/focus · ข้อความไม่หาย | **PASS** | กล่องเปล่า 50px · `rgba(255,255,255,0.78)` · hover/focus เปลี่ยนพื้นผิว+เส้นขอบ · ออกจาก focus แล้ว draft ยังอยู่ · `(+) / ไมค์ / ส่ง` ครบ · Composer เดียว |
| 03 | แผงปรับแต่งสี/พื้นผิว + 3 presets + reset + บันทึกตามบัญชี | **PASS** | 9 ค่าปรับแล้วเปลี่ยนทันทีทั้ง shell และ Composer · กระจกใส/สีอ่อน/เข้ม · reset กลับค่าเริ่มต้น · PUT→reload→GET คงค่า |
| 04 | ทางลัด (+) · เพิ่ม/ลบ/เปลี่ยนไอคอน/ขนาด · เปิดผ่าน Tab Bar เดิม | **PASS** | เพิ่ม 3 ประเภท (เครื่องมือ DNA OS / บริการที่ลงทะเบียน / เว็บไซต์) · โลโก้บริการล็อก · เปลี่ยนไอคอน/ขนาด/ลบได้ · เปิดเป็นแท็บเดิม |
| 05 | Google Maps ในกลุ่มเครื่องมือเชื่อมต่อภายนอก | **PASS** | กลุ่ม `07 External Tools` · โลโก้จริง `/brand/providers/google-maps.svg` · ไม่มี badge สถานะเชื่อมต่อ · เปิดผ่าน `openExternalTool` เดิม |
| 06 | เปลี่ยนรูปโปรไฟล์ของตัวเองผ่านจุดตั้งค่าเดิม | **PASS** | อัปโหลดผ่าน `POST /api/admin/upload` เดิม · path เก็บใน preferences ของบัญชี · preview แสดงรูป · ไม่แตะข้อมูลบริษัท/สิทธิ์ |
| 07 | ขอบเขตห้ามแก้ | **PASS** | ไม่แตะ Business Engine / Finance / Canonical Writers / Schema / AI Gateway / MCP / Connect Registry / Auth / ธุรกรรม / Document Engine |
| 08 | ตรวจ 10 ข้อบน Chrome + ภาพหน้าจอ | **PASS** | 12 checks ใน `workspace-final-ui:test` + ภาพ 11 ไฟล์ |
| 09 | RELEASE GATE | **STOP** | รอเจ้าของยืนยัน “โอเค” ก่อน commit/push/deploy |

> ข้อ 08.10 “ระบบธุรกิจเดิมไม่เสียหาย”: regression ของ Workspace ผ่านทั้งหมด (ด้านล่าง)  
> `finance-doc-intelligence-test` มี 2 FAIL ที่มีอยู่ก่อนแล้วในไฟล์ AI ที่งานนี้ไม่ได้แก้ (`registry/ai-adapter-registry.json`, `cognitive/pipeline.ts`, `services/ai/adapters.ts` — มี modification ค้างจากงานอื่น) ไม่ใช่ผลจากงานนี้

---

## สิ่งที่แก้ไข / เพิ่ม

### หน้าตา Workspace (03)
- `public/material-workspace/workspace-preferences.js` — token engine + presets + per-account store
- `public/material-workspace/workspace-customization.js` — แผงตั้งค่า + ทางลัด + รูปโปรไฟล์
- `public/material-workspace/index.html` — แผง `#workspaceSettings`, `#shortcutDialog`, shortcut rail
- `public/material-workspace/style.css` — CSS Glass tokens, dark/light surfaces, panels, shortcut rail
- `app/api/workspace/ui-preferences/route.ts` — GET/PUT preferences ตาม user id
  - ใช้ **`app_configs` เดิม** key `workspace-ui:<userId>` — **ไม่มีตาราง/คอลัมน์/migration ใหม่**
  - sanitize ค่าสี/ตัวเลข/ทางลัด/Storage path ก่อนบันทึก

### QAI Composer (02/03)
- `app/workspace/DNAOSChatEngine.tsx`
  - Composer เดิมรับ theme ผ่าน `postMessage` same-origin (`dna-workspace-theme`)
  - ใช้ `--qai-*` tokens กับพื้นผิว/ขอบ/มุม/เบลอ และ map เป็น `--paper/--ink/--line/--soft` เดิม
  - default token = ค่าเดิมทุกค่า (QAI test 11 PASS เหมือนก่อนแก้)
  - ไม่สร้าง Chat Engine / AI Composer / gateway ใหม่

### ทางลัด (04)
- ปุ่ม `＋` ใต้ไอคอนหลักใน sidebar เดิม
- เลือกจาก `business-tools.json` + `tools.json` ที่มีจริง, บริการที่ลงทะเบียน (โลโก้จริงล็อก) หรือเว็บไซต์ที่ผู้ใช้กรอก
- ทุกทางลัดเรียก `openToolRoute` / `openExternalTool` เดิม → Tab Bar เดิม

### Google Maps (05)
- `public/material-workspace/business-tools.json` — group `07` + `google-maps`
- `public/brand/providers/google-maps.svg` — Wikimedia Commons `Google_Maps_icon_(2020).svg`
- `public/brand/providers/SOURCES.md` — provenance

### รูปโปรไฟล์ (06)
- ส่วน “โปรไฟล์ของฉัน” ในแผงตั้งค่าเดิม
- อัปโหลดผ่าน Storage เดิม (`attachments`, guard เดิม) แล้วเก็บ path ใน preferences ของบัญชี
- ไม่แตะ `profiles` role, company settings, หรือข้อมูลบริษัท

### Bottom bar (01)
- `app/workspace/capability/MaterialsHost.tsx` — ลบ `<footer>` ที่เคยกั้นล่าง; ย้ายลิงก์กลับไปอยู่ใน header

### Test / report
- `scripts/workspace-final-ui-test.ts` (ใหม่)
- `package.json` — `workspace-final-ui:test`
- `docs/workspace-screenshots/workspace-final-ui-2026-10-18/` — ภาพจริง 11 ไฟล์

---

## หลักฐานการทดสอบ (รันซ้ำหลังแก้ครั้งสุดท้าย)

```bash
npx tsc --noEmit                 # 0 error
npx eslint <files>               # 0 error (1 warning เดิมใน DNAOSChatEngine)
npx tsx scripts/workspace-final-ui-test.ts   # 12 checks PASS
npx tsx scripts/workspace-qai-composer-test.ts # 11 checks PASS
```

Regression ที่รันและผ่าน:

| ชุด | ผล |
|---|---|
| `workspace-final-ui:test` | **12 PASS** |
| `workspace-qai-composer:test` | **11 PASS** |
| `workspace-adaptive-composer:test` | **8 PASS** |
| `workspace-icon-cleanup:test` | **7 PASS** |
| `workspace-single-sidebar:test` | **9 PASS** |
| `workspace-tab-bar:test` | **19 PASS** |
| `one-workspace-navigation-test` | **25 PASS** |
| `tenant-workspace-org-ui:test` (`BASE_URL=3141`) | **4 PASS** |
| `workspace-tool-bindings-test` | PASS |
| `finance-doc-intelligence-test` | 27 PASS / 2 FAIL (มีอยู่ก่อนแล้วในไฟล์ AI ที่ไม่ได้แก้) |

### ภาพหน้าจอจริง
`docs/workspace-screenshots/workspace-final-ui-2026-10-18/`

1. `01-no-bottom-bar.png`
2. `02-resource-table-full-height.png`
3. `03-composer-transparent.png`
4. `04-appearance-custom.png`
5. `05-appearance-dark.png`
6. `05b-appearance-dark-resource.png`
7. `06-shortcut-manager.png`
8. `07-shortcuts-after-edit.png`
9. `08-google-maps.png`
10. `09-profile-picture.png`
11. `10-document-tab-full-height.png`

---

## ข้อจำกัดที่รายงานตรงไปตรงมา

1. เครื่องนี้ไม่มี session จริง → เทสต์ intercept เฉพาะ endpoint ที่ shell เรียกอยู่แล้ว (`org-context`, `ui-preferences`, `pits`, `upload`, `embed-check`, connector status) เพื่อตรวจ UI contract; **ไม่ได้เขียน DB จริง**
2. การบันทึก preference ฝั่งเซิร์ฟเวอร์ใช้ `app_configs` เดิม (key ต่อ user) — ตรวจด้วย typecheck + client PUT/GET contract; ยังไม่ได้ทดสอบกับบัญชีจริงบน production
3. หน้าจอที่เปิดใน `#toolFrame` (เช่น `/admin/documents`) ยังใช้ design system เดิมของหน้านั้นตามขอบเขต 07 — งานนี้เปลี่ยนเฉพาะ Workspace chrome, หน้าจอแชต, ตารางทรัพยากร และ Composer
4. ยังไม่มี speech-input engine — ปุ่มไมค์ยังแสดง “ไม่พร้อมใช้งาน” ตามของเดิม
5. `public/material-workspace/` และ `public/brand/providers/` เป็นโฟลเดอร์ untracked เดิมของ workspace นี้ (ไม่ได้ commit)

---

## RELEASE GATE

- ขั้นที่ 1: แก้ไข + ทดสอบบน Local — **เสร็จ**
- ขั้นที่ 2: เปิด Chrome ที่ `http://localhost:3141/workspace` ให้เจ้าของตรวจ — **พร้อม**
- ขั้นที่ 3: **STOP รอเจ้าของยืนยัน “โอเค”**
- ขั้นที่ 4: หลังอนุมัติเท่านั้นจึง commit / push / deploy ตามกระบวนการ Production เดิม

**ยังไม่มีการ commit / push / deploy ใด ๆ**
