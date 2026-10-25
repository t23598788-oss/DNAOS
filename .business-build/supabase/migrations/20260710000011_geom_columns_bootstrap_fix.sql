-- Local-migration bootstrap fix (owner, 2026-07-30, KM-007 —
-- registry/existence.json known_mistakes). Companion to the guards added
-- in 20260620000000_clearinghouse_upgrade.sql: that file's timestamp is
-- earlier than the migrations that actually CREATE public.partners
-- (20260709000003) and public.pit_profiles (20260710000008) — this file's
-- timestamp (20260710000011) is deliberately after both. On a fresh local
-- bootstrap, June 20's ALTER/TRIGGER/INDEX statements touching partners/
-- pit_profiles now skip harmlessly (guarded), so this file re-applies the
-- exact same statements here, once both tables are guaranteed to actually
-- exist. In production this is a complete no-op — every column/trigger/
-- index/constraint here already exists there from the original
-- 20260620000000 run.

ALTER TABLE public.partners
ADD COLUMN IF NOT EXISTS capabilities JSONB DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS latitude NUMERIC,
ADD COLUMN IF NOT EXISTS longitude NUMERIC,
ADD COLUMN IF NOT EXISTS geom GEOGRAPHY(Point, 4326);

ALTER TABLE public.pit_profiles
ADD COLUMN IF NOT EXISTS geom GEOGRAPHY(Point, 4326);

CREATE OR REPLACE TRIGGER trigger_sync_partner_geom
BEFORE INSERT OR UPDATE OF latitude, longitude ON public.partners
FOR EACH ROW EXECUTE FUNCTION public.sync_partner_geom();

CREATE OR REPLACE TRIGGER trigger_sync_pit_geom
BEFORE INSERT OR UPDATE OF latitude, longitude ON public.pit_profiles
FOR EACH ROW EXECUTE FUNCTION public.sync_pit_geom();

DO $$ BEGIN
  ALTER TABLE public.resource_transactions
  ADD CONSTRAINT resource_transactions_partner_id_fkey
  FOREIGN KEY (partner_id) REFERENCES public.partners(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN
  NULL; -- already applied in production
END $$;

CREATE INDEX IF NOT EXISTS idx_partners_geom ON public.partners USING GIST(geom);
CREATE INDEX IF NOT EXISTS idx_pit_profiles_geom ON public.pit_profiles USING GIST(geom);

-- Companion reapply for 20260620000002_clearinghouse_scalability.sql's
-- guarded app_configs block — app_configs is created 20260707000003,
-- safely before this file's timestamp, so it's guaranteed to exist here.
DO $$ BEGIN
  IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints
      WHERE constraint_name = 'app_configs_title_key' AND table_name = 'app_configs'
  ) THEN
      ALTER TABLE public.app_configs ADD CONSTRAINT app_configs_title_key UNIQUE (title);
  END IF;

  INSERT INTO public.app_configs (title, data)
  VALUES
      ('supabase-project-ref', 'tmxkiripdvorrcnuezvm'),
      ('webhook-secret-token', 'clearinghouse_sec_token_999'),
      ('pricing-markup-percent', '25'),
      ('vehicle-default-capacity', '10')
  ON CONFLICT (title) DO NOTHING;
END $$;

-- Companion reapply for 20260622000003_conversation_state_and_entity_registry.sql's
-- deferred entity_registry.event_id FK — line_events is created
-- 20260709000002, safely before this file's timestamp.
DO $$ BEGIN
  ALTER TABLE public.entity_registry
  ADD CONSTRAINT entity_registry_event_id_fkey
  FOREIGN KEY (event_id) REFERENCES public.line_events(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN
  NULL; -- already applied in production
END $$;

-- Companion reapply for 20260626000001_line_events_receiver_columns.sql's
-- guarded ALTER — line_events is created 20260709000002, safely before
-- this file's timestamp.
ALTER TABLE public.line_events
  ADD COLUMN IF NOT EXISTS reply_token TEXT,
  ADD COLUMN IF NOT EXISTS group_id TEXT,
  ADD COLUMN IF NOT EXISTS event_timestamp TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS raw_json JSONB,
  ADD COLUMN IF NOT EXISTS line_message_id TEXT;

-- Companion reapply for 20260705000001_business_events_partner_timeline.sql's
-- deferred business_events.partner_id FK — partners is created
-- 20260709000003, safely before this file's timestamp.
DO $$ BEGIN
  ALTER TABLE public.business_events
  ADD CONSTRAINT business_events_partner_id_fkey
  FOREIGN KEY (partner_id) REFERENCES public.partners(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN
  NULL; -- already applied in production
END $$;

-- Companion reapply for 20260705000002_transaction_state_machine.sql's
-- deferred transactions.partner_id FK.
DO $$ BEGIN
  ALTER TABLE public.transactions
  ADD CONSTRAINT transactions_partner_id_fkey
  FOREIGN KEY (partner_id) REFERENCES public.partners(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN
  NULL; -- already applied in production
END $$;

-- Companion reapply for 20260705000003_transaction_type_and_parties.sql's
-- deferred transactions.supplier_id FK.
DO $$ BEGIN
  ALTER TABLE public.transactions
  ADD CONSTRAINT transactions_supplier_id_fkey
  FOREIGN KEY (supplier_id) REFERENCES public.partners(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN
  NULL; -- already applied in production
END $$;

-- Companion reapply for 20260705000004_link_partner_pit_profile.sql's
-- guarded partners.pit_profile_id column — pit_profiles is created
-- 20260710000008, safely before this file's timestamp. The historical
-- one-off identity-match UPDATE in that file is skipped here deliberately
-- (real customer data, meaningless on an empty local table — tomorrow's
-- real pg_dump import brings in the true row already linked).
ALTER TABLE public.partners
  ADD COLUMN IF NOT EXISTS pit_profile_id uuid
    REFERENCES public.pit_profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_partners_pit_profile_id
  ON public.partners(pit_profile_id)
  WHERE pit_profile_id IS NOT NULL;
