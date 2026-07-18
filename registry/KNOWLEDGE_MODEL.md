# DNA OS Knowledge Model — Index

**สถานะ**: ร่าง — ยังไม่ apply schema จริง

Owner (2026-07-17) กำหนดให้ Knowledge Model แยกเป็น 4 ชั้น แต่ละชั้นตอบคำถามคนละข้อ และ**จงใจแยกเป็นไฟล์คนละไฟล์** (ไม่ใช่แค่หัวข้อในเอกสารเดียว) เพื่อบังคับไม่ให้รายละเอียดเทคโนโลยี (SQL, Postgres, Supabase) รั่วเข้าไปปนกับความหมาย (semantics) โดยไม่ตั้งใจในอนาคต — ถ้าไฟล์ไหนเริ่มมีคำว่า `create table`/`jsonb`/ชื่อ view ปรากฏ นั่นคือสัญญาณว่าเนื้อหาอยู่ผิดไฟล์แล้ว

```
Knowledge Model
        │
        ├── Constitution      → registry/KNOWLEDGE_CONSTITUTION.md
        │     "กฎคืออะไร" — Entry/Link/Status/Lifecycle/Domain หมายความว่าอะไร,
        │     ใครมีสิทธิ์เปลี่ยน status, ทำไมห้ามลบ. ไม่มีคำว่า SQL/Postgres/
        │     Supabase อยู่ในไฟล์นี้แม้แต่คำเดียว — อ่านแล้วอธิบายได้แม้ไม่รู้จัก
        │     ฐานข้อมูลใดๆ เลย
        │
        ├── Schema             → registry/KNOWLEDGE_SCHEMA.md
        │     "เก็บอย่างไร" — โครงสร้างข้อมูลเชิงนามธรรม (field, type, constraint)
        │     เขียนแบบ technology-neutral (เช่น "Entry.domains: non-empty set of
        │     Domain" ไม่ใช่ "domains knowledge.entry_domain[] not null") —
        │     แปลเป็นภาษาฐานข้อมูลไหนก็ได้โดยไม่ต้องตีความใหม่
        │
        ├── Runtime Mapping   → registry/KNOWLEDGE_RUNTIME_MAPPING.md
        │     "Runtime จะใช้ความรู้นี้อย่างไร" — สัญญา (contract) ระหว่าง
        │     Knowledge Model กับส่วนอื่นของ DNA OS: ใครอ่านอะไรได้, ใครเขียน
        │     อะไรต้องระบุอะไรก่อน, query pattern ที่ระบบจริงต้องการ (Active-only,
        │     Rule Lineage, Valid-at)
        │
        └── Storage Adapter   → supabase/migrations/20260717000004_knowledge_schema.sql
              "วันนี้เก็บที่ไหน" — การ realize Schema เป็นจริงบนเทคโนโลยีหนึ่ง
              (Postgres/Supabase วันนี้) ไฟล์นี้เท่านั้นที่มีสิทธิ์พูดภาษา SQL —
              ถ้าย้ายไป storage อื่นในอนาคต เปลี่ยนเฉพาะไฟล์นี้ อีก 3 ไฟล์ไม่ต้องแตะ
```

## กฎการตรวจสอบตัวเอง (self-check เวลาจะแก้ไฟล์ไหนก็ตาม)

ก่อนเพิ่มประโยคใดๆ ลงในเอกสารกลุ่มนี้ ให้ถามว่า:

- ประโยคนี้พูดถึง**ความหมาย** (เช่น "Active คือความรู้ที่ระบบถือว่าจริงตอนนี้") → อยู่ **Constitution**
- ประโยคนี้พูดถึง**field/type** (เช่น "Entry มี created_at เป็น timestamp") → อยู่ **Schema**
- ประโยคนี้พูดถึง**ใครอ่าน/เขียนอะไรได้** หรือ **query pattern ที่ระบบต้องการจริง** → อยู่ **Runtime Mapping**
- ประโยคนี้พูดถึง**syntax เฉพาะ Postgres/Supabase** (SQL, RLS policy, trigger function) → อยู่ **Storage Adapter** เท่านั้น

ถ้าประโยคหนึ่งตอบได้มากกว่า 1 ข้อ ให้แยกเป็นหลายประโยค คนละไฟล์ — นี่คือกลไกเดียวที่ทำให้คำตอบ "ย้าย storage ได้โดยไม่เสียความหมาย" (จากคำถาม 50 ปีของ owner) เป็นจริงแบบตรวจสอบได้ ไม่ใช่แค่คำยืนยัน
