-- Evolution Knowledge Architecture — STORAGE ADAPTER layer (owner, 2026-07-17)
--
-- This is the ONLY file in the Knowledge Model allowed to speak SQL/Postgres
-- (see registry/KNOWLEDGE_MODEL.md's 4-layer split: Constitution / Schema /
-- Runtime Mapping / Storage Adapter). It realizes the technology-neutral
-- model defined in registry/KNOWLEDGE_SCHEMA.md on today's concrete storage
-- (Postgres/Supabase). If storage ever changes (owner's 50-year question),
-- only this file is rewritten — KNOWLEDGE_CONSTITUTION.md, KNOWLEDGE_SCHEMA.md,
-- and KNOWLEDGE_RUNTIME_MAPPING.md do not change, because none of them
-- reference Postgres/Supabase/SQL at all.
--
-- v2: added Validity/Provenance/Confidence + derived_from/contradicts links
-- v3: added Living Knowledge cycle (observation/experience entry_types),
--     Actionable flags (runtime/ai/human), Knowledge Domain, and Lifecycle
--     (as a DERIVED view, not a new column — see knowledge.lifecycle_stage)
--
-- Separate Postgres schema from `public` (business data) — matches the
-- owner's own diagram: Business Schema / Registry Schema / Knowledge Schema,
-- one Supabase project, three namespaces. Scope: NET NEW tables only. Does
-- NOT migrate registry/CONSTITUTION.json or any existing registry/*.json
-- file's authority — that was flagged separately as a 46-file blast-radius
-- decision requiring its own confirmation, not part of this migration.
--
-- NOT YET APPLIED to the live database — owner explicitly asked to write
-- the Knowledge Model documents first and let them settle before this runs.
-- This file is the design artifact for that review.

create schema if not exists knowledge;

-- ── Requirement 1: every knowledge entry has its own identity ──────────────
-- `id` (uuid) is the system identity. `code` is the stable, human-readable
-- identity (e.g. "INC-2026-0717", "DEC-2026-0717-001", "RULE-111") — reuses
-- the DNA-NNNNNN convention already established in registry/CHANGELOG.json
-- rather than inventing a second numbering scheme (Rule 103).
--
-- Knowledge vs Evolution (owner's point 1): NOT split into separate tables
-- today, per the owner's own "ไม่จำเป็นต้องแยกเป็นหลายตารางวันนี้" — instead,
-- "Evolution" is defined as a QUERY PATTERN over this same table: entries
-- of entry_type='rule' chained via link_type='evolved_from'/'superseded_by'
-- (see knowledge.rule_lineage view near the bottom). If this ever needs to
-- become its own table, the view is the seam to cut along — no redesign of
-- entries/links needed then either.

-- Living Knowledge cycle (owner, round 3, 2026-07-17): Observation -> Decision
-- -> Implementation -> Validation -> Experience -> new Knowledge. Decision =
-- architecture_decision, Implementation = commit, Validation = validation
-- already existed; 'observation' and 'experience' added to complete the
-- cycle as real, storable entry_types (not just a diagram) — an AI noticing
-- a pattern in production, before anyone decides anything about it, is now
-- a real Entry (source='ai_analysis', confidence='observed'/'hypothesis'),
-- and the reflective "what we learned after the fact" is a distinct
-- 'experience' entry, separate from 'lesson' (a lesson is a stated, citable
-- takeaway; an experience is the raw record the lesson was drawn from —
-- same relationship as observation:decision, via a derived_from link).
create type knowledge.entry_type as enum (
  'observation',
  'incident',
  'architecture_decision',
  'engineering_journal',
  'lesson',
  'experience',
  'rule',
  'pattern',
  'commit',
  'deployment',
  'validation'
);

-- ── Requirement 2: status ───────────────────────────────────────────────────
-- One shared vocabulary across all entry types, kept deliberately small.
-- Type-specific nuance (e.g. an incident's open/resolved distinction beyond
-- active/historical) lives in `metadata`, not as more enum values — avoids
-- an enum that grows without bound as new entry_types appear.

create type knowledge.entry_status as enum (
  'active',       -- currently true / currently in force
  'historical',   -- no longer current, but not wrong when it was written — kept for context
  'superseded',   -- explicitly replaced by a newer entry (see knowledge.links)
  'deprecated',   -- known to be a bad idea now, kept as a permanent warning
  'rejected'      -- an alternative that was considered and explicitly not chosen
);

-- ── Owner's addition 3: Provenance ──────────────────────────────────────────
-- Where a piece of knowledge came from — determines how much weight it
-- should carry. An owner_decision and an ai_analysis are not equally
-- authoritative even if both are status='active'.

create type knowledge.entry_source as enum (
  'owner_decision',
  'ai_analysis',
  'incident',
  'production',
  'external_document',
  'experiment'
);

-- ── Owner's addition 4: Confidence ──────────────────────────────────────────
-- Separate from `source` on purpose — an owner_decision is always fully
-- confident by definition (it's a decision, not an estimate), but an
-- ai_analysis or production observation can range from verified fact down
-- to an untested hypothesis. Conflating the two would lose information.

create type knowledge.confidence_level as enum (
  'verified',      -- directly confirmed against real, current evidence
  'observed',      -- seen to be true at least once, not re-verified since
  'hypothesis',    -- a reasoned guess, not yet tested
  'experimental'   -- actively being tried, outcome not yet known
);

-- Owner's round-3 addition: Knowledge Domain — which real-world area this
-- entry belongs to. Array, not a single value: one entry can legitimately
-- span domains (e.g. Rule 111 is both architecture AND communication).
create type knowledge.entry_domain as enum (
  'architecture',
  'business',
  'ai',
  'runtime',
  'infrastructure',
  'communication',
  'security',
  'finance'
);

create table knowledge.entries (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  entry_type knowledge.entry_type not null,
  title text not null,
  summary text not null,
  detail text,
  status knowledge.entry_status not null default 'active',

  -- Owner's addition 3 (Provenance) + 4 (Confidence)
  source knowledge.entry_source not null,
  confidence knowledge.confidence_level not null default 'observed',

  -- Owner's round-3 addition: Knowledge Domain — required, at least one.
  domains knowledge.entry_domain[] not null,

  -- Owner's round-3 addition: "Every Knowledge Must Be Actionable" — who is
  -- this entry actually FOR. No default: every insert must declare these
  -- explicitly, per entry, not inherited blindly from entry_type (a rule is
  -- USUALLY runtime+ai+human actionable, an incident usually isn't
  -- runtime-actionable — but the owner's own examples are "usually", not
  -- "always", so this stays a real per-row decision, not a computed column).
  runtime_actionable boolean not null,
  ai_actionable boolean not null,
  human_actionable boolean not null,

  -- Owner's addition 2: Validity — a separate dimension from `status`.
  -- `status` answers "what do we consider true NOW"; valid_from/valid_until
  -- answer "during what real-world period was/is this true" — lets a future
  -- query answer "what rule governed the system in May 2026" even after
  -- that rule has since moved to status='superseded'.
  valid_from timestamptz not null default now(),
  valid_until timestamptz,             -- null = still valid / open-ended

  -- Requirement 7 (creation half of the footprint)
  created_by text not null,             -- 'owner' | 'Claude' | 'GPT' | 'Gemini' | a real developer name
  created_at timestamptz not null default now(),

  -- Requirement 7 (status-change half — see knowledge.status_history for
  -- the full append-only trail; these two columns hold only the LATEST
  -- change for fast reads, same "current + history" split this codebase
  -- already uses elsewhere, e.g. debt_snapshots + implied recompute).
  status_changed_by text,
  status_changed_at timestamptz,
  status_changed_reason text,

  -- Type-specific fields live here, not as new columns per entry_type —
  -- e.g. architecture_decision entries store {"alternatives_considered":
  -- [{"option": "...", "result": "rejected", "reason": "..."}]} per the
  -- owner's send-document-v2 example.
  metadata jsonb not null default '{}'::jsonb,

  constraint valid_period_order check (valid_until is null or valid_until > valid_from),
  constraint domains_not_empty check (cardinality(domains) > 0)
);

create index entries_type_idx on knowledge.entries(entry_type);
create index entries_status_idx on knowledge.entries(status);
create index entries_source_idx on knowledge.entries(source);
create index entries_validity_idx on knowledge.entries(valid_from, valid_until);
create index entries_domains_idx on knowledge.entries using gin(domains);

-- ── Requirement 3: reference prior/later knowledge ──────────────────────────
-- A typed edge table, not just two self-referencing FK columns on `entries`
-- — the owner's own example chain (Incident -> Decision -> Commit ->
-- Deployment -> Validation -> Lesson) is 5 hops across DIFFERENT entry_types,
-- which a single evolved_from/superseded_by pair per row can't express
-- (an entry can be the ancestor of several different descendants, and a
-- descendant can have several ancestors — e.g. one decision resolving two
-- incidents at once). This IS the Knowledge Graph the owner named directly.

create type knowledge.link_type as enum (
  'evolved_from',   -- this entry grew out of / refines the target
  'superseded_by',  -- the target replaces this entry (inverse: superseded_by is on the OLD entry, pointing at the NEW one)
  'caused_by',       -- this entry (e.g. a decision) exists because of the target (e.g. an incident)
  'resolved_by',     -- this entry (e.g. an incident) was closed by the target (e.g. a validation)
  'implements',      -- this entry (e.g. a commit) implements the target (e.g. a rule/decision)
  'references',      -- weak link, context only, no lifecycle implication
  'derived_from',    -- owner's addition: this entry (e.g. a lesson) was distilled FROM the target (e.g. an incident) — weaker than evolved_from (no refinement claim, just origin)
  'contradicts'      -- owner's addition: this entry conflicts with the target — both can stay active simultaneously (e.g. two decisions under real debate) or one gets superseded later; the link itself doesn't resolve the conflict, it records that one exists
);

create table knowledge.links (
  id uuid primary key default gen_random_uuid(),
  from_entry_id uuid not null references knowledge.entries(id) on delete cascade,
  to_entry_id uuid not null references knowledge.entries(id) on delete cascade,
  link_type knowledge.link_type not null,
  created_at timestamptz not null default now(),
  unique (from_entry_id, to_entry_id, link_type)
);

create index links_from_idx on knowledge.links(from_entry_id);
create index links_to_idx on knowledge.links(to_entry_id);

-- ── Requirement 4: nothing is deleted, only status changes ─────────────────
-- Hard technical guarantee, not just a convention — mirrors Constitution
-- Rule 104 ("Nothing Is Wasted"), now enforced at the database level for
-- this schema specifically.

create or replace function knowledge.forbid_delete() returns trigger as $$
begin
  raise exception 'knowledge.% cannot be deleted (row id=%) — change status instead. See Constitution Rule 104 (Nothing Is Wasted) and Rule 111/112.', TG_TABLE_NAME, OLD.id;
  return null;
end;
$$ language plpgsql;

create trigger no_delete_entries before delete on knowledge.entries
  for each row execute function knowledge.forbid_delete();
create trigger no_delete_links before delete on knowledge.links
  for each row execute function knowledge.forbid_delete();

-- ── Requirement 7: automatic, append-only digital footprint ────────────────
-- Every status change is captured here automatically — a human/AI updating
-- `entries.status` cannot forget to leave a trail; the trigger does it.

create table knowledge.status_history (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references knowledge.entries(id) on delete cascade,
  from_status knowledge.entry_status,
  to_status knowledge.entry_status not null,
  reason text not null,
  changed_by text not null,
  changed_at timestamptz not null default now()
);

create or replace function knowledge.log_status_change() returns trigger as $$
begin
  if OLD.status is distinct from NEW.status then
    if NEW.status_changed_reason is null or NEW.status_changed_by is null then
      raise exception 'status_changed_by and status_changed_reason are required when changing knowledge.entries.status (id=%)', NEW.id;
    end if;
    insert into knowledge.status_history (entry_id, from_status, to_status, reason, changed_by)
    values (NEW.id, OLD.status, NEW.status, NEW.status_changed_reason, NEW.status_changed_by);
    NEW.status_changed_at := now();
    if NEW.status != 'active' and NEW.valid_until is null then
      NEW.valid_until := now();
    end if;
  end if;
  return NEW;
end;
$$ language plpgsql;

create trigger track_status_change before update on knowledge.entries
  for each row execute function knowledge.log_status_change();

alter table knowledge.status_history enable row level security;
create policy service_role_only on knowledge.status_history for all using (false);

-- ── Requirement 6: Runtime reads ONLY active knowledge ──────────────────────
-- A dedicated view is the one thing runtime code should ever query — never
-- knowledge.entries directly — so "Runtime uses only Active knowledge" is
-- structural, not a convention someone has to remember.

create view knowledge.active_entries as
  select * from knowledge.entries where status = 'active';

-- Owner's point 1 (Evolution as a distinct read pattern, not a new table):
-- rule lineage — walk entry_type='rule' chained by evolved_from/superseded_by.
create view knowledge.rule_lineage as
  select
    l.from_entry_id, e1.code as from_code, e1.title as from_title, e1.status as from_status,
    l.link_type,
    l.to_entry_id, e2.code as to_code, e2.title as to_title, e2.status as to_status
  from knowledge.links l
  join knowledge.entries e1 on e1.id = l.from_entry_id
  join knowledge.entries e2 on e2.id = l.to_entry_id
  where e1.entry_type = 'rule' and e2.entry_type = 'rule'
    and l.link_type in ('evolved_from', 'superseded_by');

-- Owner's point 2 (Validity): "what governed the system at time T" —
-- parameterize by passing a timestamp; example usage in
-- registry/KNOWLEDGE_CONSTITUTION.md.
create view knowledge.valid_at as
  select * from knowledge.entries
  where valid_from <= now() and (valid_until is null or valid_until > now());

-- Owner's round-3 addition: Knowledge Lifecycle (Observed -> Verified ->
-- Operational -> Historical). NOT a new column, per owner's explicit
-- decision after a naming collision was flagged: "Observed"/"Verified"
-- already existed as confidence_level values, and "Historical" already
-- existed as a status value — a 4th independent column using the same
-- words would let combinations exist that mean nothing (e.g.
-- lifecycle='operational' with status='deprecated' simultaneously).
-- lifecycle_stage is instead 100% DERIVED from (status, confidence) —
-- cannot desync from either, by construction.
create view knowledge.lifecycle_stage as
  select
    e.*,
    case
      when e.status in ('deprecated', 'rejected') then 'historical'
      when e.status in ('historical', 'superseded') then 'historical'
      when e.status = 'active' and e.confidence in ('verified', 'observed') then 'operational'
      when e.confidence = 'verified' then 'verified'
      else 'observed'
    end as lifecycle_stage
  from knowledge.entries e;

-- ── Requirement 5: one shared source for AI and humans ──────────────────────
-- Satisfied structurally — this is ordinary Postgres/PostgREST, reachable
-- by any client (Claude, GPT, Gemini, a human via Supabase Studio, a future
-- admin UI) with the same credentials model already used everywhere else
-- in this codebase. No additional design needed beyond RLS below.

alter table knowledge.entries enable row level security;
create policy service_role_only on knowledge.entries for all using (false);
alter table knowledge.links enable row level security;
create policy service_role_only on knowledge.links for all using (false);
