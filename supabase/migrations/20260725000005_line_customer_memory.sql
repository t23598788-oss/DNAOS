-- Per-customer behavioral memory (owner, 2026-07-25): "จำพฤติกรรมจำลักษณะ
-- ของลูกค้าแต่ละคน เหมือนที่ระบบ AI ทำกันนั่นแหละ...อย่าพึ่งปล่อยให้ไปชน LLM
-- โดยตรงถ้าข้อมูลยังไม่โดนกรองดีพอ" — same idea as this AI's own memory of
-- the owner across sessions, but per LINE customer: short, distilled,
-- freeform notes about how this person communicates and what they tend to
-- need, built up over real conversations and fed back in as context before
-- generating a reply.
--
-- Hard boundary (Rule 111/ห้ามเดา): this table is for conversational tone
-- and behavior only — never a source for prices, debts, or any financial
-- fact. Those stay DB-sourced from the real business tables exactly as
-- every other engine in this codebase already requires.
create table if not exists public.line_customer_memory (
  line_user_id text primary key,
  notes text not null default '',
  updated_at timestamptz not null default now()
);

alter table public.line_customer_memory enable row level security;

create policy service_role_only on public.line_customer_memory
  for all using (false);
