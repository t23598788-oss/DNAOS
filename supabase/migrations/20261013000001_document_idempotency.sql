-- Document save integrity (2026-10-13 — DNA OS DOCUMENT SAVE INTEGRITY)
--
-- ปัญหา: /api/admin/documents (document.create) ไม่มีการกันซ้ำระดับ DB —
--   createDocument() insert ตรง ๆ ไม่มี unique constraint บน document_no และ
--   executeBusinessJob ไม่ได้ persist/ตรวจ idempotency_key (adapter ห้ามแตะ DB)
--   ผล: Retry / Double-click / Concurrent Request / Multi-device สร้างเอกสารการเงินซ้ำได้จริง
--
-- หลักการแก้ (ถูกต้องตาม boundary):
--   - ใช้ client idempotency key (UUID ต่อ 1 ความตั้งใจบันทึก) — "คำสั่งเดิม" = key เดิม → dedup
--   - เอกสารใหม่ (แม้เนื้อหาเหมือนกัน) = คนละคำสั่ง = คนละ key → สร้างได้ปกติ
--     (ห้ามตัดสินด้วย content-hash — จะผูกเอกสารเนื้อหาเหมือนกันเป็นฉบับเดียวผิด)
--   - unique PK ของตารางนี้คือตัวบังคับระดับ DB สำหรับ concurrent (race ที่ check-then-insert พลาด)
--   - ไม่สร้าง Document Writer ใหม่ — createDocument canonical เดิมถูกเรียกเหมือนเดิม
--
-- **ยังไม่ Apply** — เตรียมไว้ให้ Owner review ก่อน (ห้าม worker apply เองตามกติกา)
-- หลัง apply: ตาราง document_idempotency จะลบ condition "ข้าม dedup เมื่อ 42P01" ใน route ออกได้

create table if not exists public.document_idempotency (
  idempotency_key text primary key,
  document_id     uuid not null,
  document_no     text,
  actor           text,
  created_at      timestamptz not null default now()
);

-- index lookup ตาม key (PK  уже có) — document_id สำหรับ reverse-lookup/audit
create index if not exists document_idempotency_document_id_idx on public.document_idempotency (document_id);

-- RLS: service_role only (เหมือนตาราง canonical อื่น — เขียนผ่าน service role ที่ bypass RLS,
-- anon/authenticated ถูกกันที่ policy)
alter table public.document_idempotency enable row level security;
drop policy if exists service_role_only on public.document_idempotency;
create policy service_role_only on public.document_idempotency for all using (false);
