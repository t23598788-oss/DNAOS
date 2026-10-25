-- Company Expenses — real structured columns, not a notes dump (owner, 2026-07-31)
-- "ลงให้ครบ...จะได้ทำรายการอ้างอิงได้...ไม่ใช่ว่า ai อ่านเอกสารไม่ออก...แต่ใน
-- ฐานข้อมูลมันไม่มีตารางให้ระบบเอาลง" — every real field on a receipt needs
-- its own queryable column, not text stuffed into `notes`. `notes` stays for
-- genuinely unstructured leftovers only.
alter table public.company_expenses
  add column if not exists issued_at        timestamptz, -- exact date+time the document was issued (not just expense_date)
  add column if not exists printed_at       timestamptz, -- when the receipt was printed, if different from issued_at
  add column if not exists branch_code      text,
  add column if not exists branch_name      text,
  add column if not exists branch_address   text,
  add column if not exists employee_name    text,
  add column if not exists document_source  text; -- e.g. "NO POS" — the source system named on the document itself
