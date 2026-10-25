# DNA OS — WORKSPACE DISPLAY STANDARD V1

**ขอบเขต:** การแสดงผลหน้าจอ `/workspace` (surface chat = `app/workspace/DNAOSChatEngine.tsx` จุดเดียว)
**VERSION:** V1 — implement + lock source (แหล่งความจริงเดียวของหน้าจอแชตหลัก)
**ข้อห้ามรวม:** ห้ามแตะ backend / gateway / business logic / Canonical Writer / auth — ห้ามสร้าง Workspace/Theme Provider ใหม่ — ห้าม push / deploy

---

## 1. Q-TIMELINE STRUCTURE

หนึ่งคำถาม = หนึ่ง `q-entry` — คำตอบและเหตุการณ์จริงทุกอย่างอยู่ใต้ Q หัวข้อเดียวกัน ห้ามแยกคำตอบเป็นแถวคุยใหม่แบบ Chat Bubble ระหว่าง/หลัง streaming

```tsx
<section className="q-timeline workspace-content-column">
  <article className="q-entry">
    <header className="q-heading">
      <span className="q-label">Q</span>
      <div className="q-question">{question}</div>
    </header>
    <div className="q-content">
      <div className="q-events">{toolEvents /* เหตุการณ์จริงเท่านั้น */}</div>
      <div className="q-answer">{answer}</div>
    </div>
  </article>
</section>
```

ข้อกำหนด:
- ต้องเชื่อมกับ `messages` state, message `id`, sessionKey ของ Component เดิม (จัดกลุ่มด้วย `groupMessages()` เท่านั้น — ห้ามสร้างข้อมูลคำถาม/คำตอบปลอม)
- ห้ามจำลองข้อความ "AI กำลังคิด" โดยไม่มีเหตุการณ์ระบบจริง (สถานะ sending/uploading จริงตอน request ยังเดิน = อนุญาต)
- ห้ามเรียก AI ซ้ำเพื่อสร้าง UI events

## 2. CSS CLASSES (อยู่ใน `FRAME_CSS` ของ Component เดิมตัวเดียว)

| Class | หน้าที่ |
|---|---|
| `.q-timeline` | คอนเทนเนอร์ทั้งหมด: `width:100%` · `min-width:0` · flex column · `gap:32px` · `overflow-y:auto` (scroll container) |
| `.q-entry` | หนึ่งคำถาม: `background:transparent` · `border:0` · `border-radius:0` · `box-shadow:none` |
| `.q-heading` | flex row (`align-items:flex-start` · `gap:12px` · `width:100%`) |
| `.q-label` | `flex:0 0 auto` · `font-weight:700` · `font-size:14px` — แสดง "Q" |
| `.q-question` | `flex:1` · `min-width:0` · `font-size:16px` · `font-weight:600` · `line-height:1.65` · `overflow-wrap:anywhere` |
| `.q-content` | `padding:12px 0 0 26px` · `width:100%` · `min-width:0` |
| `.q-events` | `font-size:13px` · `line-height:1.6` — เหตุการณ์จริงระหว่างคำถาม/คำตอบ |
| `.q-error` | ข้อความ error เป็นตัวหนังสือ (`color:#b91c1c`) — ไม่มีกล่อง/ขอบ |
| `.result-block` | ผลลัพธ์ตาราง/fields — `max-width:100%` (อ้างคอลัมน์กลาง) |
| `.result-timeline` | เส้นเวลาคู่ค้า — `max-width:100%` |
| `.document-result` | เอกสาร/HTML/รูป — `width:100%` · `max-width:100%` + `img/canvas` `object-fit:contain` + `iframe` `height:min(80vh,1120px)` |
| `.workspace-content-column` | คอลัมน์กลาง (ดู §4) |

ข้อห้าม CSS:
- ❌ กล่องสีดำรอบคำถาม / กล่องสีขาวรอบคำตอบ (class `bubble-user` / `bubble-dna` / `bubble-error` ลบทิ้งจาก source แล้ว)
- ❌ Bubble และ border รอบคำตอบทั่วไป · ❌ box-shadow รอบข้อความ
- ❌ จัดข้อความผู้ใช้ชิดขวา (`align-items:flex-end` ห้ามกลับมา)
- ❌ `max-width: min(560px,78%) / min(760px,94%) / 920px / 820px` จำกัดซ้ำอีกชั้น
- ❌ สร้าง CSS ชุดที่สอง (ใช้ `FRAME_CSS` ชุดเดียว) · ❌ inline style แข่งกับ CSS หลัก

## 3. BACKGROUND / TEXT COLOR AUTHORITY

- **Background Authority = `#dna-frame{background:var(--paper)}`** (`--paper:#fdfbf8`) — ค่าที่ใช้กับ Workspace อยู่แล้วตาม reference ของ Owner ไม่แต่งสีใหม่จากการคาดเดา
- **Text Color Authority = `color:var(--ink)`** (`--ink:#36332f`) — contrast (54,51,47) บน (253,251,248) อ่านชัด · ห้ามข้อความสีจางจนอ่านยาก
- ทุกชั้นข้อความ (Q / Answer / Tool Events) เลือก `background:transparent` — พื้นหลังต้องมีสีหลักเดียวต่อเนื่องทั้งพื้นที่ Workspace
- พื้นหลังซ้อนจาก Bubble/User/Assistant/Message Container ถูกลบแล้ว — แต่ห้ามลบพื้นหลังของ Workspace หลัก
- เอกสาร (Document Preview) ใช้พื้นเอกสารจริงของ renderer เดิม (BusinessDisplayRenderer / Viewer) — ไม่สร้าง,ไม่ตัด
- ห้ามเปลี่ยนพื้นหลังเป็นสีขาวอัตโนมัติ

## 4. CENTER COLUMN WIDTH

`.workspace-content-column`: `width:100% · max-width:1040px · min-width:0 · margin-inline:auto · box-sizing:border-box · padding-inline:16px`

- ค่ามาตรฐาน V1 = **1040px** (source เดิมไม่มีค่า canonical ที่เจ้าของระบบล็อกไว้ — ถ้ามีจึงใช้ค่าเดิม)
- `Q`, `Answer`, `Tool Result`, `Table`, `Document Preview` และ `form.compose` ทุกตัวอ้างความกว้างคอลัมน์นี้
- ห้ามมี `max-width` ของ Chat Bubble จำกัดซ้ำอีกชั้น (จึงปรับ `result-block` / `result-timeline` เป็น `max-width:100%`)

## 5. COMPOSER FOCUS RULES

`form.compose` (คอมโพเซอร์เดิมตัวเดียว):

1. ใช้ `textarea` เดิมเพียงตัวเดียว `aria-label="คำสั่ง"`
2. คลิกพื้นที่ว่างในกรอบ → focus textarea (handler `focusComposer`: `event.target.closest("button, input, textarea, a, [role='button']")` แล้ว return)
3. ปุ่มแนบไฟล์ / เสียง / ส่ง ไม่ถูกแย่งคลิก (ปุ่มเจอตัวเองใน closest → ไม่ focus แย่ง)
4. textarea ขยายรองรับหลายบรรทัด (`autoGrowComposer` จำกัด 240px) + CSS เดิม `min-height:54px`
5. รองรับภาษาไทย/IME Composition ตาม behavior นิติของ textarea (submit ด้วยปุ่มเท่านั้น ไม่มีการดัก Enter)

โครงเดิมคงเดิม: `<form class="compose workspace-content-column" onClick={focusComposer}>` → `textarea ref` + `<div class="row compose-tools">` (3 ปุ่มเดิม)

## 6. STREAMING RULES + เหตุการณ์จริง

- ข้อความตอบปรากฏใต้ Q เดิมตามข้อมูลจริง — ไม่สร้าง Bubble/entry ใหม่ระหว่าง streaming
- Tool events / system push แสดงใน `.q-events` ใต้ q-entry เดิม
- ผ่าน Response Gateway เดิมเท่านั้น (`/api/chat` · `/api/chat/confirm` · `/api/admin/upload`) — ห้าม transport คู่ขนาน
- สถานะ "กำลังประมวลผล… / กำลังอัปโหลดไฟล์…" = สถานะ request จริง ไม่ใช่ข้อความจำ

## 7. SCROLL RULES

- `.q-timeline` คือ scroll container เดิม (คง `.content:not(--fill)` `max-height:none` และ `.content--fill` `max-height:42vh`)
- **Auto-scroll ไปท้ายเฉพาะเมื่อผู้ใช้อยู่ท้ายรายการอยู่แล้ว** (`stickToBottom`, ห่างท้าย < 48px)
- ผู้ใช้ย้อนอ่าน → หยุด auto-scroll ทันทีจนกว่าจะกลับไปที่รายการล่าสุด

## 8. RESPONSIVE

Desktop 1440 · Tablet 834 · Mobile 390 ต้องผ่านทั้งหมด: Q ชิดซ้ายภายในคอลัมน์กลาง (ไม่มีชิดขวาแบบแชต) · ไม่มี horizontal overflow · Compose อยู่ด้านล่างเสมอ

## 9. LOCK + REGRESSION

- Component เดิมอ้างมาตรฐานนี้ผ่าน CSS ชุดเดียว (`FRAME_CSS`) — ห้าม CSS ซ้ำหลายชุด / inline style แข่ง
- **Regression test:** `node local-runtime/workspace-display-standard-v1-test.mjs http://<BASE>` (source lock + browser จริง: layout, composer focus, ปุ่ม composer, responsive, document width, ประวัติครบ, streaming ไม่สร้าง Bubble) — ทุก check ต้อง PASS ก่อนแก้ V1
- ห้ามแก้ V1 โดยไม่ผ่านการตรวจผลบนหน้าจอ Workspace จริง

**SOURCE FILES ที่แก้ไขใน:** `app/workspace/DNAOSChatEngine.tsx` (Renderer + CSS + Composer · ไฟล์เดียว), ภาพเปรียบเทียบ Before/After: `docs/workspace-screenshots/workspace-before.png` / `workspace-after.png` (+ mobile + JSON evidence) — เก็บใต้ `docs/` (declared top-level) เพื่อไม่สร้าง Shadow Layer ใน deploy-gate
