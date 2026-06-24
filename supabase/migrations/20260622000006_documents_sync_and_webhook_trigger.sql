-- 1. Create function to automatically sync document_items from the document's JSON data
CREATE OR REPLACE FUNCTION public.sync_document_items_from_data()
RETURNS TRIGGER AS $$
DECLARE
    item RECORD;
    idx INTEGER := 1;
BEGIN
    -- Check if data->'items' exists and is a jsonb array
    IF NEW.data IS NOT NULL AND jsonb_typeof(NEW.data->'items') = 'array' THEN
        -- Check if document_items already has rows for this document
        IF NOT EXISTS (SELECT 1 FROM public.document_items WHERE document_id = NEW.id) THEN
            -- Loop through the items and insert them
            FOR item IN SELECT * FROM jsonb_to_recordset(NEW.data->'items') AS x(description TEXT, qty NUMERIC, unit_price NUMERIC, line_total NUMERIC, unit_label TEXT) LOOP
                INSERT INTO public.document_items (
                    id,
                    document_id,
                    line_no,
                    item_date,
                    description,
                    qty,
                    unit_key,
                    unit_label,
                    unit_price,
                    line_total
                ) VALUES (
                    gen_random_uuid(),
                    NEW.id,
                    idx,
                    COALESCE(NEW.issue_date, CURRENT_DATE),
                    item.description,
                    item.qty,
                    COALESCE(item.unit_label, 'คิว'),
                    COALESCE(item.unit_label, 'คิว'),
                    item.unit_price,
                    item.line_total
                );
                idx := idx + 1;
            END LOOP;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create AFTER trigger to sync document_items
CREATE OR REPLACE TRIGGER trigger_sync_document_items
    AFTER INSERT OR UPDATE OF data ON public.documents
    FOR EACH ROW
    EXECUTE FUNCTION public.sync_document_items_from_data();

-- 2. Create function to trigger back-to-back webhook on document confirmation
CREATE OR REPLACE FUNCTION public.trg_documents_webhook()
RETURNS TRIGGER AS $$
DECLARE
    project_ref TEXT;
    secret_token TEXT;
BEGIN
    -- Only trigger when confirmed_at is set or status changes to confirmed/sent
    IF (NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at AND NEW.confirmed_at IS NOT NULL) OR 
       (NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('confirmed', 'sent')) THEN
       
        -- Fetch dynamic settings from app_configs
        SELECT COALESCE(data, 'tmxkiripdvorrcnuezvm') INTO project_ref FROM public.app_configs WHERE title = 'supabase-project-ref';
        SELECT COALESCE(data, 'clearinghouse_secret_token_999') INTO secret_token FROM public.app_configs WHERE title = 'webhook-secret-token';

        PERFORM net.http_post(
            url := 'https://' || project_ref || '.supabase.co/functions/v1/back-to-back',
            body := jsonb_build_object(
                'type', 'UPDATE',
                'table', 'documents',
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

-- Create AFTER UPDATE trigger for webhooks on documents
CREATE OR REPLACE TRIGGER trigger_documents_webhook
    AFTER UPDATE ON public.documents
    FOR EACH ROW
    EXECUTE FUNCTION public.trg_documents_webhook();
