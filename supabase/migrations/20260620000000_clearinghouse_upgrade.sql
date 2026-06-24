-- 1. Enable PostGIS extension
CREATE EXTENSION IF NOT EXISTS postgis;

-- 2. Upgrade partners table
ALTER TABLE public.partners 
ADD COLUMN IF NOT EXISTS capabilities JSONB DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS latitude NUMERIC,
ADD COLUMN IF NOT EXISTS longitude NUMERIC,
ADD COLUMN IF NOT EXISTS geom GEOGRAPHY(Point, 4326);

-- 3. Add geom columns to existing tables
ALTER TABLE public.pit_profiles
ADD COLUMN IF NOT EXISTS geom GEOGRAPHY(Point, 4326);

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

CREATE OR REPLACE TRIGGER trigger_sync_partner_geom
BEFORE INSERT OR UPDATE OF latitude, longitude ON public.partners
FOR EACH ROW EXECUTE FUNCTION public.sync_partner_geom();

-- Sync pit_profiles geometry
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

CREATE OR REPLACE TRIGGER trigger_sync_pit_geom
BEFORE INSERT OR UPDATE OF latitude, longitude ON public.pit_profiles
FOR EACH ROW EXECUTE FUNCTION public.sync_pit_geom();

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
    partner_id UUID REFERENCES public.partners(id) ON DELETE SET NULL,
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
CREATE INDEX IF NOT EXISTS idx_partners_geom ON public.partners USING GIST(geom);
CREATE INDEX IF NOT EXISTS idx_pit_profiles_geom ON public.pit_profiles USING GIST(geom);
CREATE INDEX IF NOT EXISTS idx_jobs_site_geom ON public.jobs USING GIST(site_geom);
