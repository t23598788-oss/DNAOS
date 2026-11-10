-- USER ROLE MAPPING + EVENT-DRIVEN RULES (owner, 2026-11-10)
--
-- Owner's brief, in three parts:
--   1. "เพิ่มฟิลด์ role ในระบบ เช่น ROLE_CUSTOMER, ROLE_SUPPLIER_SAND,
--      ROLE_TRANSPORTER, ROLE_ENGINEER"                      → role_definitions + role_assignments
--   2. "ถ้าเกิด Event แบบนี้ → ยิงข้อความ/งานไปหา Role ไหนอัตโนมัติ"
--      (เช่น EVENT_ORDER_CREATED → ROLE_SUPPLIER_SAND + ROLE_TRANSPORTER)
--                                                            → event_rules + event_rule_runs
--   3. Dashboard "God View" ที่ดู flow งาน/รถ/เงิน + override เคสมีปัญหา
--                                                            → อ่านจาก truck_jobs/truck_events/
--                                                              customer_orders/invoices ที่มีอยู่แล้ว
--
-- Why a separate catalog instead of a column on partners:
--   one company/person can hold MORE THAN ONE network role (a sand pit that also
--   runs its own trucks is ROLE_SUPPLIER_SAND + ROLE_TRANSPORTER), and a role is
--   assigned to a partner, a LINE user or an app profile — three different
--   subjects with three different id spaces. A join table (role_assignments)
--   expresses that without duplicating partner rows, and lets the rules engine
--   resolve "who do I notify for ROLE_TRANSPORTER" with one query.
--
-- Nothing here replaces the existing app_role enum on public.profiles (that is
-- the login/permission tier: super_admin/admin/...). This layer is the BUSINESS
-- NETWORK role used for routing, addressed by code (ROLE_*).
--
-- Safe to re-run: every object is `if not exists` and every seed is
-- `on conflict do nothing`.

-- ── 1. Role catalog ─────────────────────────────────────────────────────────
create table if not exists public.role_definitions (
  code            text primary key,
  label_th        text not null,
  label_en        text not null,
  description_th  text,
  -- 'line' = this role can receive a LINE push when a rule targets it.
  -- 'none' = the role exists for mapping/reporting only (no outbound channel).
  notify_channel  text not null default 'line'
    check (notify_channel in ('line', 'none')),
  sort_order      integer not null default 100,
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

insert into public.role_definitions (code, label_th, label_en, description_th, sort_order)
values
  ('ROLE_CUSTOMER',      'ลูกค้า',        'Customer',    'ผู้สั่งซื้อวัสดุ/ผู้ว่าจ้างงาน — ปลายทางของงานและเอกสาร', 10),
  ('ROLE_SUPPLIER_SAND', 'เจ้าของบ่อทราย', 'Sand supplier', 'เจ้าของบ่อ/แหล่งวัสดุ ผู้รับงานจัดหาวัสดุตามออเดอร์', 20),
  ('ROLE_TRANSPORTER',   'ผู้ขนส่ง',      'Transporter', 'เจ้าของรถ/คนขับ ผู้รับงานขนส่งวัสดุถึงหน้างาน', 30),
  ('ROLE_ENGINEER',      'ช่าง/วิศวกร',   'Engineer',    'ผู้ตรวจงานหน้างาน/ประเมินคุณภาพและปริมาณ', 40)
on conflict (code) do nothing;

-- ── 2. Role assignments (who holds which role) ──────────────────────────────
-- subject_kind picks the id space:
--   partner   → public.partners.id      (subject_id = uuid as text)
--   line_user → LINE userId             (subject_id = line user id)
--   profile   → public.profiles.id      (subject_id = uuid as text)
-- line_user_id is what the notifier actually pushes to; it is copied onto the
-- row so a partner/role can be notified without a join through LINE tables.
create table if not exists public.role_assignments (
  id            uuid primary key default gen_random_uuid(),
  role_code     text not null references public.role_definitions (code)
                  on update cascade on delete restrict,
  subject_kind  text not null
    check (subject_kind in ('partner', 'line_user', 'profile')),
  subject_id    text not null,
  display_name  text,
  line_user_id  text,
  partner_id    uuid,
  active        boolean not null default true,
  note          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (role_code, subject_kind, subject_id)
);

create index if not exists idx_role_assignments_role
  on public.role_assignments (role_code)
  where active;
create index if not exists idx_role_assignments_line_user
  on public.role_assignments (role_code, line_user_id)
  where active and line_user_id is not null;
create index if not exists idx_role_assignments_subject
  on public.role_assignments (subject_kind, subject_id);

-- ── 3. Event rules (event → roles → action) ─────────────────────────────────
-- conditions is a small, explicit vocabulary evaluated by
-- engines/rules/matching.ts (NOT SQL, NOT eval):
--   { "total": 50000 }                 exact equality (string/number/bool)
--   { "total": { "gte": 50000 } }      numeric compare: gte | lte | gt | lt
--   { "material": { "in": ["ทราย", "หินคลุก"] } }
--   { "material": { "equals": "ทราย", "caseInsensitive": true } }
-- Keys are payload keys; dotted keys ("customer.province") reach into nested
-- objects. An empty object means "every event of this type".
create table if not exists public.event_rules (
  id                uuid primary key default gen_random_uuid(),
  code              text not null unique,
  name              text not null,
  event_type        text not null,
  target_roles      text[] not null default '{}',
  action            text not null default 'notify_line'
    check (action in ('notify_line', 'flag_exception')),
  channel           text not null default 'line'
    check (channel in ('line', 'in_app')),
  message_template  text,
  conditions        jsonb not null default '{}'::jsonb,
  priority          integer not null default 100,
  active            boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists idx_event_rules_event_type
  on public.event_rules (event_type)
  where active;

-- Seed the example from the brief: order created → sand supplier + transporter.
insert into public.event_rules
  (code, name, event_type, target_roles, action, message_template, priority)
values
  (
    'RULE_ORDER_CREATED_BROADCAST',
    'ออเดอร์ใหม่ → แจ้งบ่อทราย + ผู้ขนส่ง',
    'EVENT_ORDER_CREATED',
    array['ROLE_SUPPLIER_SAND', 'ROLE_TRANSPORTER'],
    'notify_line',
    E'งานใหม่ {{order_no}}\nลูกค้า: {{customer_name}}\nวัสดุ: {{material}} {{quantity}}\nปลายทาง: {{destination}}\nรับงานได้ที่หน้า งาน ของ DNA OS',
    10
  ),
  (
    'RULE_TRUCK_DELIVERED_NOTIFY_CUSTOMER',
    'รถส่งของถึงหน้างาน → แจ้งลูกค้า',
    'EVENT_TRUCK_DELIVERED',
    array['ROLE_CUSTOMER'],
    'notify_line',
    E'งาน {{order_no}} ส่งถึงหน้างานแล้ว\nหากมีปัญหาหรือปริมาณไม่ครบ แจ้งกลับได้ในแชตนี้',
    20
  )
on conflict (code) do nothing;

-- ── 4. Rule run log (append-only) ───────────────────────────────────────────
-- One row per (event × rule) that was evaluated. `mode` separates a dry run
-- (owner testing a rule from the UI) from a live dispatch, so a test never
-- looks like a real send in the audit trail.
create table if not exists public.event_rule_runs (
  id          uuid primary key default gen_random_uuid(),
  rule_id     uuid references public.event_rules (id) on delete set null,
  rule_code   text,
  event_type  text not null,
  event_key   text,
  payload     jsonb not null default '{}'::jsonb,
  mode        text not null default 'dry_run'
    check (mode in ('dry_run', 'live')),
  matched     boolean not null default false,
  targets     jsonb not null default '[]'::jsonb,
  status      text not null default 'logged'
    check (status in ('logged', 'sent', 'partial', 'failed', 'skipped')),
  error       text,
  created_at  timestamptz not null default now()
);

create index if not exists idx_event_rule_runs_created
  on public.event_rule_runs (created_at desc);
create index if not exists idx_event_rule_runs_event
  on public.event_rule_runs (event_type, created_at desc);

-- ── 5. Access control ───────────────────────────────────────────────────────
-- Admin-only data. The service_role (all API routes) bypasses RLS; anon and
-- authenticated browser clients get nothing by default because no policy is
-- granted here. Public read is deliberately NOT opened: the role map and the
-- notification rules are control-room data, not storefront data.
alter table public.role_definitions  enable row level security;
alter table public.role_assignments  enable row level security;
alter table public.event_rules       enable row level security;
alter table public.event_rule_runs   enable row level security;

comment on table public.role_definitions is
  'Network role catalog (ROLE_CUSTOMER, ROLE_SUPPLIER_SAND, ROLE_TRANSPORTER, ROLE_ENGINEER, ...) used for routing events to people.';
comment on table public.role_assignments is
  'Which partner / LINE user / profile holds which network role. line_user_id is the push target.';
comment on table public.event_rules is
  'Event-driven routing rules: event_type + conditions -> target_roles + action. Evaluated by engines/rules.';
comment on table public.event_rule_runs is
  'Append-only log of every rule evaluation (dry_run or live) with the targets that were resolved.';
