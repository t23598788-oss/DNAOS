-- Unified Identity Hub: Layer 1 (Core Identity) + Layer 2 (Omnichannel Bindings)
-- Additive migration: keeps existing tables/columns for backward compatibility.

BEGIN;

-- ---------------------------------------------------------------------------
-- Layer 1: Core Identity (Master ID)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.core_identities (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    auth_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    master_type text NOT NULL DEFAULT 'person'
        CHECK (master_type IN ('person', 'business', 'system')),
    master_display_name text,
    master_avatar_url text,
    primary_email text,
    status text NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'inactive', 'merged', 'deleted')),
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS core_identities_auth_user_id_uidx
    ON public.core_identities (auth_user_id)
    WHERE auth_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS core_identities_status_idx
    ON public.core_identities (status);

-- ---------------------------------------------------------------------------
-- Layer 1: Provider / Social account connections (OAuth + channel identity)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.identity_provider_accounts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    core_identity_id uuid NOT NULL REFERENCES public.core_identities(id) ON DELETE CASCADE,
    provider text NOT NULL
        CHECK (provider IN ('LINE', 'FACEBOOK', 'TIKTOK', 'WHATSAPP', 'GOOGLE', 'EMAIL', 'PHONE')),
    provider_user_id text NOT NULL,
    provider_display_name text,
    provider_avatar_url text,
    access_token text,
    refresh_token text,
    token_expires_at timestamptz,
    scopes text[] NOT NULL DEFAULT '{}'::text[],
    raw_profile jsonb NOT NULL DEFAULT '{}'::jsonb,
    is_primary boolean NOT NULL DEFAULT false,
    linked_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (provider, provider_user_id)
);

CREATE INDEX IF NOT EXISTS identity_provider_accounts_core_identity_idx
    ON public.identity_provider_accounts (core_identity_id);

-- ---------------------------------------------------------------------------
-- Layer 3 (prepared): Business capability overlay on top of Master ID
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.identity_business_capabilities (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    core_identity_id uuid NOT NULL REFERENCES public.core_identities(id) ON DELETE CASCADE,
    capability_type text NOT NULL
        CHECK (capability_type IN ('partner_profile', 'quarry', 'concrete_plant', 'ecommerce_store', 'logistics_fleet', 'pit_profile')),
    capability_ref_id uuid,
    capability_ref_table text,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (core_identity_id, capability_type, capability_ref_id)
);

CREATE INDEX IF NOT EXISTS identity_business_capabilities_core_identity_idx
    ON public.identity_business_capabilities (core_identity_id);

-- ---------------------------------------------------------------------------
-- Layer 2: Refactor channel bindings into ingestion gate -> Master ID
-- ---------------------------------------------------------------------------
ALTER TABLE public.partner_channel_bindings
    ADD COLUMN IF NOT EXISTS core_identity_id uuid REFERENCES public.core_identities(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS provider_account_id uuid REFERENCES public.identity_provider_accounts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS partner_channel_bindings_core_identity_idx
    ON public.partner_channel_bindings (core_identity_id);

-- Backfill missing LINE bindings from existing inbound events (real IDs only).
INSERT INTO public.partner_channel_bindings (
    channel_type,
    channel_user_id,
    display_name,
    avatar_url,
    source,
    first_seen_at,
    last_seen_at,
    created_at,
    updated_at
)
SELECT DISTINCT ON (le.line_user_id)
    'LINE'::text AS channel_type,
    le.line_user_id AS channel_user_id,
    le.line_name AS display_name,
    le.line_picture AS avatar_url,
    'IMPORTED'::text AS source,
    COALESCE(le.created_at, now()) AS first_seen_at,
    COALESCE(le.created_at, now()) AS last_seen_at,
    now() AS created_at,
    now() AS updated_at
FROM public.line_events le
WHERE le.line_user_id ~ '^U[0-9a-f]{32}$'
  AND NOT EXISTS (
      SELECT 1
      FROM public.partner_channel_bindings pcb
      WHERE pcb.channel_type = 'LINE'
        AND pcb.channel_user_id = le.line_user_id
  )
ORDER BY le.line_user_id, le.created_at DESC
ON CONFLICT (channel_type, channel_user_id) DO NOTHING;

-- Backfill Master ID + provider account for every channel binding.
DO $$
DECLARE
    r record;
    v_core uuid;
    v_provider uuid;
BEGIN
    FOR r IN
        SELECT DISTINCT ON (channel_type, channel_user_id)
            id,
            channel_type,
            channel_user_id,
            display_name,
            avatar_url,
            last_seen_at
        FROM public.partner_channel_bindings
        WHERE core_identity_id IS NULL
        ORDER BY channel_type, channel_user_id, last_seen_at DESC
    LOOP
        INSERT INTO public.core_identities (
            master_display_name,
            master_avatar_url,
            master_type,
            status
        )
        VALUES (
            r.display_name,
            r.avatar_url,
            'person',
            'active'
        )
        RETURNING id INTO v_core;

        INSERT INTO public.identity_provider_accounts (
            core_identity_id,
            provider,
            provider_user_id,
            provider_display_name,
            provider_avatar_url,
            is_primary
        )
        VALUES (
            v_core,
            r.channel_type,
            r.channel_user_id,
            r.display_name,
            r.avatar_url,
            true
        )
        RETURNING id INTO v_provider;

        UPDATE public.partner_channel_bindings
        SET core_identity_id = v_core,
            provider_account_id = v_provider,
            updated_at = now()
        WHERE channel_type = r.channel_type
          AND channel_user_id = r.channel_user_id
          AND core_identity_id IS NULL;
    END LOOP;
END $$;

-- Preserve existing 1-click business binding as Layer 3 overlay.
INSERT INTO public.identity_business_capabilities (
    core_identity_id,
    capability_type,
    capability_ref_id,
    capability_ref_table,
    metadata
)
SELECT
    pcb.core_identity_id,
    'partner_profile'::text,
    pcb.partner_business_profile_id,
    'partner_business_profiles'::text,
    jsonb_build_object('source', 'backfill_from_partner_channel_bindings')
FROM public.partner_channel_bindings pcb
WHERE pcb.core_identity_id IS NOT NULL
  AND pcb.partner_business_profile_id IS NOT NULL
ON CONFLICT (core_identity_id, capability_type, capability_ref_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- RLS + policies (service role + admin workspace read)
-- ---------------------------------------------------------------------------
ALTER TABLE public.core_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.identity_provider_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.identity_business_capabilities ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'core_identities'
          AND policyname = 'service_role full access to core_identities'
    ) THEN
        CREATE POLICY "service_role full access to core_identities"
            ON public.core_identities
            FOR ALL
            TO service_role
            USING (true)
            WITH CHECK (true);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'identity_provider_accounts'
          AND policyname = 'service_role full access to identity_provider_accounts'
    ) THEN
        CREATE POLICY "service_role full access to identity_provider_accounts"
            ON public.identity_provider_accounts
            FOR ALL
            TO service_role
            USING (true)
            WITH CHECK (true);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'identity_business_capabilities'
          AND policyname = 'service_role full access to identity_business_capabilities'
    ) THEN
        CREATE POLICY "service_role full access to identity_business_capabilities"
            ON public.identity_business_capabilities
            FOR ALL
            TO service_role
            USING (true)
            WITH CHECK (true);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'partner_channel_bindings'
          AND policyname = 'admin_workspace_read_partner_channel_bindings'
    ) THEN
        CREATE POLICY "admin_workspace_read_partner_channel_bindings"
            ON public.partner_channel_bindings
            FOR SELECT
            TO authenticated
            USING (is_admin_workspace_user());
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'partner_channel_bindings'
          AND policyname = 'service_role full access to partner_channel_bindings'
    ) THEN
        CREATE POLICY "service_role full access to partner_channel_bindings"
            ON public.partner_channel_bindings
            FOR ALL
            TO service_role
            USING (true)
            WITH CHECK (true);
    END IF;
END $$;

COMMIT;
