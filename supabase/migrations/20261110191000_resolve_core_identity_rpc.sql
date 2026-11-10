CREATE OR REPLACE FUNCTION public.resolve_or_create_core_identity(
    p_provider text,
    p_provider_user_id text,
    p_display_name text DEFAULT NULL,
    p_avatar_url text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
AS $function$
DECLARE
    v_core uuid;
    v_provider uuid;
BEGIN
    IF p_provider IS NULL OR p_provider_user_id IS NULL THEN
        RETURN NULL;
    END IF;

    -- Existing provider account -> reuse Master ID, refresh profile.
    SELECT core_identity_id INTO v_core
    FROM public.identity_provider_accounts
    WHERE provider = p_provider
      AND provider_user_id = p_provider_user_id;

    IF v_core IS NOT NULL THEN
        UPDATE public.identity_provider_accounts
           SET provider_display_name = COALESCE(p_display_name, provider_display_name),
               provider_avatar_url = COALESCE(p_avatar_url, provider_avatar_url),
               updated_at = now()
         WHERE provider = p_provider
           AND provider_user_id = p_provider_user_id;

        UPDATE public.core_identities
           SET master_display_name = COALESCE(p_display_name, master_display_name),
               master_avatar_url = COALESCE(p_avatar_url, master_avatar_url),
               updated_at = now()
         WHERE id = v_core;

        RETURN v_core;
    END IF;

    -- New Master ID + provider account.
    INSERT INTO public.core_identities (
        master_display_name,
        master_avatar_url,
        master_type,
        status
    )
    VALUES (
        p_display_name,
        p_avatar_url,
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
        p_provider,
        p_provider_user_id,
        p_display_name,
        p_avatar_url,
        true
    )
    RETURNING id INTO v_provider;

    RETURN v_core;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.resolve_or_create_core_identity(text, text, text, text) TO service_role;
