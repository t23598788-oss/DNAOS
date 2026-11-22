-- Keep sensitive canonical finance/document views behind authenticated
-- application routes. Direct browser/PostgREST roles receive no SELECT grant.
-- The existing server-side service_role readers remain available.

ALTER VIEW public.document_canonical SET (security_invoker = true);
REVOKE ALL ON public.document_canonical FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.document_canonical TO service_role;

ALTER VIEW public.invoice_payment_summary SET (security_invoker = true);
REVOKE ALL ON public.invoice_payment_summary FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.invoice_payment_summary TO service_role;
