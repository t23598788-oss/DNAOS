-- Keep business/document/finance projections behind authenticated application routes.
-- Browser/PostgREST roles receive no direct SELECT; server-side service_role remains.

ALTER VIEW public.company_debt_current SET (security_invoker = true);
REVOKE ALL ON public.company_debt_current FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.company_debt_current TO service_role;

ALTER VIEW public.document_references_inverse SET (security_invoker = true);
REVOKE ALL ON public.document_references_inverse FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.document_references_inverse TO service_role;

ALTER VIEW public.document_versions_next SET (security_invoker = true);
REVOKE ALL ON public.document_versions_next FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.document_versions_next TO service_role;

ALTER VIEW public.receipt_documents_bank_line SET (security_invoker = true);
REVOKE ALL ON public.receipt_documents_bank_line FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.receipt_documents_bank_line TO service_role;

ALTER VIEW public.suppliers_and_plants SET (security_invoker = true);
REVOKE ALL ON public.suppliers_and_plants FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.suppliers_and_plants TO service_role;
