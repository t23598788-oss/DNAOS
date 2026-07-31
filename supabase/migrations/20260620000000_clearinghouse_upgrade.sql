-- 1. Enable PostGIS extension
CREATE EXTENSION IF NOT EXISTS postgis;

-- Local-migration bootstrap fix (owner, 2026-07-30, KM-007 —
-- registry/existence.json known_mistakes): this file's timestamp (June 20)
-- is EARLIER than the migrations that actually CREATE public.partners
-- (20260709000003) and public.pit_profiles (20260710000008) — it only ever
-- worked in production because those tables already existed there before
-- migration tracking started. public.jobs has NO CREATE TABLE in any
-- migration at all — it was created directly against production,
-- off-record, and its real full schema can only come from a pg_dump of the
-- live database, not from this repo's migrations. The stub below is a
-- genuine no-op in production (that table already exists there with its
-- real columns) — it exists solely so a fresh local bootstrap (supabase
-- start / supabase db reset) has a real jobs table to attach these
-- triggers/FKs/indexes to, without guessing at columns beyond the 3 this
-- file itself already needs. Once real data is pulled from production via
-- pg_dump, that import overwrites/extends this stub with the true schema.
CREATE TABLE IF NOT EXISTS public.jobs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  site_latitude numeric,
  site_longitude numeric
);

-- 2. Upgrade partners table
-- Guarded (unlike the jobs stub above): public.partners gets its real,
-- full CREATE TABLE later in 20260709000003_migrate_live_line_tables.sql.
-- On a fresh local bootstrap this file runs BEFORE that one, so partners
-- doesn't exist yet here — skip harmlessly now;
-- 20260710000011_geom_columns_bootstrap_fix.sql (added 2026-07-30) re-applies these same ADD COLUMN
-- statements right after partners/pit_profiles really exist, so a fresh
-- install still ends up with every column either way. In production this
-- IF just runs true immediately since partners already exists.
DO $$ BEGIN
  IF to_regclass('public.partners') IS NOT NULL THEN
    ALTER TABLE public.partners
    ADD COLUMN IF NOT EXISTS capabilities JSONB DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS latitude NUMERIC,
    ADD COLUMN IF NOT EXISTS longitude NUMERIC,
    ADD COLUMN IF NOT EXISTS geom GEOGRAPHY(Point, 4326);
  END IF;
END $$;

-- 3. Add geom columns to existing tables
DO $$ BEGIN
  IF to_regclass('public.pit_profiles') IS NOT NULL THEN
    ALTER TABLE public.pit_profiles
    ADD COLUMN IF NOT EXISTS geom GEOGRAPHY(Point, 4326);
  END IF;
END $$;

ALTER TABLE public.jobs
ADD COLUMN IF NOT EXISTS site_geom GEOGRAPHY(Point, 4326);

-- 4. Create geometry synchronization triggers
-- Sync partners geometry
CREATE OR REPLACE FUNCTION public.sync_partner_geom()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.latitude IS NOT NULL AND NEW.longitude IS NOT NULL THEN
        NEW.geom := ST_SetSRID(ST_MakePoint(NEW.longitude, NEW.latitude), 4326)::geography;
    ELSE
        NEW.geom := NULL;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger creation on partners/pit_profiles moved to
-- 20260710000011_geom_columns_bootstrap_fix.sql (2026-07-30) — same reason
-- as the guarded ALTERs above: on a fresh local bootstrap neither table
-- exists yet at this point in the file order, and CREATE TRIGGER requires
-- its target table to already exist. sync_partner_geom()/sync_pit_geom()
-- (the functions, not the triggers) are still defined here since
-- CREATE FUNCTION never depends on partners/pit_profiles existing.
CREATE OR REPLACE FUNCTION public.sync_pit_geom()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.latitude IS NOT NULL AND NEW.longitude IS NOT NULL THEN
        NEW.geom := ST_SetSRID(ST_MakePoint(NEW.longitude, NEW.latitude), 4326)::geography;
    ELSE
        NEW.geom := NULL;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Sync jobs geometry
CREATE OR REPLACE FUNCTION public.sync_job_geom()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.site_latitude IS NOT NULL AND NEW.site_longitude IS NOT NULL THEN
        NEW.site_geom := ST_SetSRID(ST_MakePoint(NEW.site_longitude, NEW.site_latitude), 4326)::geography;
    ELSE
        NEW.site_geom := NULL;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trigger_sync_job_geom
BEFORE INSERT OR UPDATE OF site_latitude, site_longitude ON public.jobs
FOR EACH ROW EXECUTE FUNCTION public.sync_job_geom();

-- 5. Create resource_transactions table
CREATE TABLE IF NOT EXISTS public.resource_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    job_id UUID REFERENCES public.jobs(id) ON DELETE CASCADE,
    -- partner_id's REFERENCES public.partners(id) constraint moved to
    -- 20260710000011_geom_columns_bootstrap_fix.sql (2026-07-30) — partners
    -- doesn't exist yet at this point on a fresh local bootstrap either.
    partner_id UUID,
    resource_type VARCHAR NOT NULL, -- 'machinery_hours', 'logistics_trips', etc.
    resource_label VARCHAR NOT NULL, -- e.g., 'คูโบต้าแม็คโคร U-55', 'รถพ่วง 18 ล้อ'
    quantity NUMERIC NOT NULL DEFAULT 0,
    unit VARCHAR NOT NULL, -- 'ชั่วโมง', 'เที่ยว', 'กิโลเมตร'
    unit_cost NUMERIC NOT NULL DEFAULT 0,
    unit_price NUMERIC NOT NULL DEFAULT 0,
    markup_margin NUMERIC NOT NULL DEFAULT 0,
    total_cost NUMERIC NOT NULL DEFAULT 0,
    total_price NUMERIC NOT NULL DEFAULT 0,
    note TEXT,
    meta JSONB DEFAULT '{}'::jsonb
);

-- Index for spatial query acceleration
-- partners/pit_profiles indexes moved to
-- 20260710000011_geom_columns_bootstrap_fix.sql (2026-07-30) — same reason.
CREATE INDEX IF NOT EXISTS idx_jobs_site_geom ON public.jobs USING GIST(site_geom);
