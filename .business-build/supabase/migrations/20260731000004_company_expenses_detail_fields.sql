-- Company Expenses — full receipt detail fields (owner, 2026-07-31)
-- "เก็บทั้งหมดทุกใบ เก็บตั้งแต่รายชื่อตั้งแต่หัวว่าบริษัทใคร" — the original
-- company_expenses table (20260727000002) only kept a single total amount,
-- losing the tax-invoice number, quantity, unit price, and VAT breakdown a
-- real receipt (e.g. a fuel bill) always has — needed for real accounting/
-- VAT reconciliation later, not just a running total.
alter table public.company_expenses
  add column if not exists tax_invoice_no   text,
  add column if not exists quantity         numeric,
  add column if not exists unit             text,
  add column if not exists unit_price       numeric,
  add column if not exists amount_pre_vat   numeric,
  add column if not exists vat_amount       numeric,
  add column if not exists vendor_tax_id    text,
  add column if not exists buyer_name       text,
  add column if not exists notes            text;
