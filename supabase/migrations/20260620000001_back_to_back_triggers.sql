-- Enable pg_net extension
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Create webhook function for invoice_payments INSERT
CREATE OR REPLACE FUNCTION public.trg_invoice_payments_webhook()
RETURNS TRIGGER AS $$
DECLARE
    project_ref TEXT := 'tmxkiripdvorrcnuezvm';
BEGIN
    PERFORM net.http_post(
        url := 'https://' || project_ref || '.supabase.co/functions/v1/back-to-back',
        body := jsonb_build_object(
            'type', 'INSERT',
            'table', 'invoice_payments',
            'record', row_to_json(NEW)::jsonb
        ),
        headers := '{"Content-Type": "application/json"}'::jsonb,
        timeout_milliseconds := 5000
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Register trigger on invoice_payments
CREATE OR REPLACE TRIGGER trigger_invoice_payments_webhook
AFTER INSERT ON public.invoice_payments
FOR EACH ROW EXECUTE FUNCTION public.trg_invoice_payments_webhook();

-- Create webhook function for invoice_debts UPDATE
CREATE OR REPLACE FUNCTION public.trg_invoice_debts_webhook()
RETURNS TRIGGER AS $$
DECLARE
    project_ref TEXT := 'tmxkiripdvorrcnuezvm';
BEGIN
    -- Only trigger when status changes to 'PAID'
    IF NEW.invoice_status = 'PAID' AND (OLD.invoice_status IS NULL OR OLD.invoice_status != 'PAID') THEN
        PERFORM net.http_post(
            url := 'https://' || project_ref || '.supabase.co/functions/v1/back-to-back',
            body := jsonb_build_object(
                'type', 'UPDATE',
                'table', 'invoice_debts',
                'record', row_to_json(NEW)::jsonb,
                'old_record', row_to_json(OLD)::jsonb
            ),
            headers := '{"Content-Type": "application/json"}'::jsonb,
            timeout_milliseconds := 5000
        );
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Register trigger on invoice_debts
CREATE OR REPLACE TRIGGER trigger_invoice_debts_webhook
AFTER UPDATE ON public.invoice_debts
FOR EACH ROW EXECUTE FUNCTION public.trg_invoice_debts_webhook();
