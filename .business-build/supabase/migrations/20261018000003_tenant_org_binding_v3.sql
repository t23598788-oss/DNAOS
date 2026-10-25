-- TENANT ORG BINDING V3 (additive · 2026-10-18 · owner mission REMAINING GAPS EXECUTION)
--
-- ปิด GAP_ORG_MAPPING 3 กลุ่ม จาก registry/TENANT_DATA_COVERAGE.json:
--   1) Bank Statements / Bank Notifications  → bank_statement_transactions, bank_notifications
--   2) Evidence / File Snapshots             → storage_evidence, file_snapshots
--   3) Transactions / Partner Ledger         → transactions, resource_transactions
--
-- ตรวจ Source เดิมก่อนแก้ (ยืนยันบน production แบบ read-only 2026-10-18):
--   · ทั้ง 6 ตารางมีจริงใน production และยังไม่มี organization_id/company_id
--   · transactions ผูก partner_id (partners ไม่มี company/org link) → ownership ต้องอยู่ที่
--     แถว ledger เอง ไม่เดาจาก partner
--   · bank_statement_transactions ผูก matched_receipt_document_id + account_number (masked)
--     → ไม่สามารถ join กลับองค์กรได้แน่นอน ⇒ ต้อง stamp organization_id ตอน ingestion
--   · storage_evidence ผูก resource_id (storage scan) และ file_snapshots ผูก content_hash
--     → เป็นหลักฐานของงานใน workspace องค์กร ⇒ stamp organization_id ตอนเก็บหลักฐาน
--
-- กฎ:
--   · organization_id เป็น nullable additive (ไม่ทำลายข้อมูลเดิม · ไม่ backfill production)
--   · แถวที่ยังไม่ map (NULL) = ไม่อยู่ในสิทธิ์ session ใด (fail-closed) — service-role เดิมเท่านั้น
--   · ไม่ seed องค์กร/ข้อมูลจริงใด · DNA OS ไม่ถูกกำหนดเป็น tenant เริ่มต้น
--   · write ยังคุมด้วย service-key + canonical writer gate (assertWriteScope) — migration นี้เปิดเฉพาะ SELECT
--
-- ทดสอบ: scripts/tenant-matrix-test.ts (STEP 1 block · Postgres จริง + RLS + JWT claims + concurrency)

-- ─── 1) Bank statements / notifications ───
alter table public.bank_statement_transactions
  add column if not exists organization_id uuid references public.organizations(id);
create index if not exists bank_statement_transactions_org_idx
  on public.bank_statement_transactions (organization_id);
alter table public.bank_statement_transactions enable row level security;
create policy tenant_org_binding_select
  on public.bank_statement_transactions for select to authenticated
  using (organization_id is not null and public.tenant_has_membership(organization_id));

alter table public.bank_notifications
  add column if not exists organization_id uuid references public.organizations(id);
create index if not exists bank_notifications_org_idx
  on public.bank_notifications (organization_id);
alter table public.bank_notifications enable row level security;
create policy tenant_org_binding_select
  on public.bank_notifications for select to authenticated
  using (organization_id is not null and public.tenant_has_membership(organization_id));

-- ─── 2) Evidence / File snapshots ───
alter table public.storage_evidence
  add column if not exists organization_id uuid references public.organizations(id);
create index if not exists storage_evidence_org_idx
  on public.storage_evidence (organization_id);
alter table public.storage_evidence enable row level security;
create policy tenant_org_binding_select
  on public.storage_evidence for select to authenticated
  using (organization_id is not null and public.tenant_has_membership(organization_id));

-- file_snapshots PK = content_hash (ไม่มี id) — org binding ต่อหลักฐาน ไม่ใช่ต่อ path
alter table public.file_snapshots
  add column if not exists organization_id uuid references public.organizations(id);
create index if not exists file_snapshots_org_idx
  on public.file_snapshots (organization_id);
alter table public.file_snapshots enable row level security;
create policy tenant_org_binding_select
  on public.file_snapshots for select to authenticated
  using (organization_id is not null and public.tenant_has_membership(organization_id));

-- ─── 3) Transactions / Partner ledger ───
alter table public.transactions
  add column if not exists organization_id uuid references public.organizations(id);
create index if not exists transactions_org_idx
  on public.transactions (organization_id);
alter table public.transactions enable row level security;
create policy tenant_org_binding_select
  on public.transactions for select to authenticated
  using (organization_id is not null and public.tenant_has_membership(organization_id));

-- resource_transactions = ledger ของ canonical resource writer (job-scoped)
alter table public.resource_transactions
  add column if not exists organization_id uuid references public.organizations(id);
create index if not exists resource_transactions_org_idx
  on public.resource_transactions (organization_id);
alter table public.resource_transactions enable row level security;
create policy tenant_org_binding_select
  on public.resource_transactions for select to authenticated
  using (organization_id is not null and public.tenant_has_membership(organization_id));
