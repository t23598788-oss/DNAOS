# DNA OS Knowledge Schema

**Layer**: ชั้น **Schema** ของ Knowledge Model (ดู `registry/KNOWLEDGE_MODEL.md`) — ตอบคำถาม **"เก็บอย่างไร"** เขียนแบบ technology-neutral: ไม่มี SQL, ไม่มีชื่อ table/view เฉพาะ Postgres — อธิบายด้วย field/type/constraint ล้วนๆ ที่แปลงเป็นภาษาฐานข้อมูลใดก็ได้ (Postgres วันนี้, SQLite/MongoDB/graph DB ในอนาคต) โดยไม่ต้องตีความใหม่

การ realize schema นี้จริงบน Postgres/Supabase อยู่ที่ Storage Adapter (`supabase/migrations/20260717000004_knowledge_schema.sql`) — ไฟล์นั้นเท่านั้นที่มีสิทธิ์พูดภาษา SQL

---

## Entity: Entry

ความรู้หนึ่งชิ้น

| Field | Type | Required | หมายเหตุ |
|---|---|---|---|
| identity | stable unique identifier | yes | ระบบ (เช่น UUID) + มนุษย์อ่านได้ (เช่น `INC-2026-0717`) — สองรูปแบบของ identity เดียวกัน |
| entry_type | enum: Observation / Incident / Architecture Decision / Engineering Journal / Lesson / Experience / Rule / Pattern / Commit / Deployment / Validation | yes | ปิด (closed set) ตาม Constitution — ห้าม client กำหนดค่าใหม่เอง |
| title | short text | yes | |
| summary | text | yes | สรุปสั้น อ่านจบใน 1 ย่อหน้า |
| detail | text | no | เรื่องราว/เหตุผลแบบเต็ม |
| status | enum: Active / Historical / Superseded / Deprecated / Rejected | yes, default Active | ดู KNOWLEDGE_CONSTITUTION.md |
| source | enum: Owner Decision / AI Analysis / Incident / Production / External Document / Experiment | yes | Provenance — ไม่มี default บังคับระบุ |
| confidence | enum: Verified / Observed / Hypothesis / Experimental | yes, default Observed | |
| domains | non-empty set of: Architecture / Business / AI / Runtime / Infrastructure / Communication / Security / Finance | yes, at least 1 | |
| runtime_actionable | boolean | yes, no default | |
| ai_actionable | boolean | yes, no default | |
| human_actionable | boolean | yes, no default | |
| valid_from | timestamp | yes, default = creation time | จุดเริ่มของ Validity period |
| valid_until | timestamp, nullable | no | null = ยังไม่สิ้นสุด. ถ้ามีค่า ต้องมากกว่า valid_from |
| created_by | identity of actor (human name / AI name) | yes | |
| created_at | timestamp | yes, default = now | immutable หลังสร้าง |
| status_changed_by | identity of actor | เมื่อมีการเปลี่ยน status | |
| status_changed_at | timestamp | เมื่อมีการเปลี่ยน status | |
| status_changed_reason | text | เมื่อมีการเปลี่ยน status | บังคับคู่กับ status_changed_by — ขาดอย่างใดอย่างหนึ่งไม่ได้ |
| metadata | open-ended structured data (key-value) | no, default empty | field เฉพาะแต่ละ entry_type อยู่ที่นี่ (เช่น `alternatives_considered` สำหรับ Architecture Decision) แทนที่จะเพิ่ม column ใหม่ทุกครั้งที่มี entry_type ใหม่ |

**Invariant**: ไม่มี operation "ลบ Entry" ในโมเดลนี้เลย — มีแต่ "เปลี่ยน status" การลบไม่ใช่แค่ "ไม่แนะนำ" แต่ไม่มีอยู่ในชุด operation ที่โมเดลนี้อนุญาต

## Entity: Link

ความสัมพันธ์แบบมีทิศทางระหว่าง Entry สองชิ้น

| Field | Type | Required |
|---|---|---|
| from_entry | reference to Entry | yes |
| to_entry | reference to Entry | yes |
| link_type | enum: evolved_from / superseded_by / caused_by / resolved_by / implements / references / derived_from / contradicts | yes |
| created_at | timestamp | yes, default = now |

**Invariant**: คู่ (from_entry, to_entry, link_type) ต้องไม่ซ้ำกัน — ความสัมพันธ์ประเภทเดียวกันระหว่าง Entry คู่เดียวกัน มีได้แค่ 1 แถว ไม่มี "ลบ Link" เช่นเดียวกับ Entry

## Entity: Status History

บันทึกทุกครั้งที่ Entry เปลี่ยน status (append-only, มนุษย์/AI ไม่มีสิทธิ์เขียนตรง — เกิดขึ้นอัตโนมัติเมื่อ Entry.status เปลี่ยน)

| Field | Type | Required |
|---|---|---|
| entry | reference to Entry | yes |
| from_status | enum (เหมือน Entry.status) | no (null ถ้าเป็นการสร้างครั้งแรก) |
| to_status | enum (เหมือน Entry.status) | yes |
| reason | text | yes |
| changed_by | identity of actor | yes |
| changed_at | timestamp | yes, default = now |

## Derived Views (คำนวณจาก Entity ข้างบน ไม่ใช่ข้อมูลที่เก็บแยก)

การมีอยู่ของ view เหล่านี้เป็นส่วนหนึ่งของ Schema — แต่**ค่า**ของมันไม่ได้ถูกเก็บเป็น field ใหม่ในตัว Entry เอง (คำนวณสดทุกครั้งที่อ่าน):

- **Active View** — Entry ทั้งหมดที่ status = Active เท่านั้น
- **Lifecycle Stage** — คำนวณจาก (status, confidence) ตามตารางใน KNOWLEDGE_CONSTITUTION.md ไม่ใช่ field แยก
- **Rule Lineage** — Entry ประเภท Rule ที่เชื่อมกันผ่าน evolved_from/superseded_by เท่านั้น
- **Valid At (T)** — Entry ทั้งหมดที่ valid_from ≤ T และ (valid_until ว่าง หรือ valid_until > T)

รายละเอียดว่า**ใครใช้ view ไหนตอนไหน** อยู่ที่ `registry/KNOWLEDGE_RUNTIME_MAPPING.md` ไม่ใช่ไฟล์นี้ — ไฟล์นี้บอกแค่ว่า view เหล่านี้มีอยู่และคำนวณจากอะไร
