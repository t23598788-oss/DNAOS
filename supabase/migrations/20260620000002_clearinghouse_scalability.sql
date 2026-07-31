-- 1. Create atomic counter increment function to prevent race conditions in document number generation
CREATE OR REPLACE FUNCTION public.increment_counter(counter_key TEXT)
RETURNS BIGINT AS $$
DECLARE
    new_number BIGINT;
BEGIN
    UPDATE public.document_counters
    SET last_number = last_number + 1, updated_at = NOW()
    WHERE key = counter_key
    RETURNING last_number INTO new_number;
    RETURN new_number;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Local-migration bootstrap fix (owner, 2026-07-30, KM-007 —
-- registry/existence.json known_mistakes): app_configs is only really
-- CREATEd later, in 20260707000003_app_configs.sql — this file's June
-- timestamp predates it, same shape as every other KM-007 case in this
-- session. Guarded so a fresh local bootstrap doesn't fail here; the real
-- config rows get re-inserted (ON CONFLICT DO NOTHING, so still safe to
-- run twice) once app_configs actually exists — see
-- 20260710000011_geom_columns_bootstrap_fix.sql for the reapply. No-op in
-- production (app_configs, the constraint, and these rows already exist).
DO $$ BEGIN
  IF to_regclass('public.app_configs') IS NOT NULL THEN
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
  END IF;
END $$;

-- 4. Update webhook trigger functions to pull project reference and secret token dynamically from configurations
-- This guarantees environmental portability (Staging/Production/Multi-company setups) without changing database code.
CREATE OR REPLACE FUNCTION public.trg_invoice_payments_webhook()
RETURNS TRIGGER AS $$
DECLARE
    project_ref TEXT;
    secret_token TEXT;
BEGIN
    -- Fetch dynamic settings from app_configs
    SELECT COALESCE(data, 'tmxkiripdvorrcnuezvm') INTO project_ref FROM public.app_configs WHERE title = 'supabase-project-ref';
    SELECT COALESCE(data, 'clearinghouse_sec_token_999') INTO secret_token FROM public.app_configs WHERE title = 'webhook-secret-token';

    PERFORM net.http_post(
        url := 'https://' || project_ref || '.supabase.co/functions/v1/back-to-back',
        body := jsonb_build_object(
            'type', 'INSERT',
            'table', 'invoice_payments',
            'record', row_to_json(NEW)::jsonb
        ),
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'X-Webhook-Secret', secret_token
        ),
        timeout_milliseconds := 5000
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.trg_invoice_debts_webhook()
RETURNS TRIGGER AS $$
DECLARE
    project_ref TEXT;
    secret_token TEXT;
BEGIN
    -- Only trigger when status changes to 'PAID'
    IF NEW.invoice_status = 'PAID' AND (OLD.invoice_status IS NULL OR OLD.invoice_status != 'PAID') THEN
        -- Fetch dynamic settings from app_configs
        SELECT COALESCE(data, 'tmxkiripdvorrcnuezvm') INTO project_ref FROM public.app_configs WHERE title = 'supabase-project-ref';
        SELECT COALESCE(data, 'clearinghouse_sec_token_999') INTO secret_token FROM public.app_configs WHERE title = 'webhook-secret-token';

        PERFORM net.http_post(
            url := 'https://' || project_ref || '.supabase.co/functions/v1/back-to-back',
            body := jsonb_build_object(
                'type', 'UPDATE',
                'table', 'invoice_debts',
                'record', row_to_json(NEW)::jsonb,
                'old_record', row_to_json(OLD)::jsonb
            ),
            headers := jsonb_build_object(
                'Content-Type', 'application/json',
                'X-Webhook-Secret', secret_token
            ),
            timeout_milliseconds := 5000
        );
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
