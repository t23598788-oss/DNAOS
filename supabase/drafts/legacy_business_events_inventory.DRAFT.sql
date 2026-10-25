-- DRAFT — READ ONLY. Safe to run with a read-only role. Writes nothing.
-- Output: one row per category with a count. No ids, names, phones or messages.
--
-- Categories (evidence-based, never guessed):
--   scoped                : organization_id is already set (trusted by the RPC)
--   derivable_line_link   : no organization_id, but the source LINE user is linked to a
--                           company whose organization_id is set. NEEDS REVIEW before any backfill.
--   derivable_partner     : no organization_id, but partner_id points to a company whose
--                           organization_id is set. NEEDS REVIEW before any backfill.
--   unidentified          : no trusted link to any organization. Do NOT backfill, do NOT open to tenants.
--
-- Precedence: a row is counted once, in the first matching category above its own.

WITH classified AS (
  SELECT
    b.id,
    CASE
      WHEN b.organization_id IS NOT NULL THEN 'scoped'
      WHEN EXISTS (
        SELECT 1
          FROM public.company_line_links l
          JOIN public.companies c ON c.id = l.company_id
         WHERE l.line_user_id = b.source_line_user_id
           AND c.organization_id IS NOT NULL
      ) THEN 'derivable_line_link'
      WHEN EXISTS (
        SELECT 1
          FROM public.companies c
         WHERE c.id = b.partner_id
           AND c.organization_id IS NOT NULL
      ) THEN 'derivable_partner'
      ELSE 'unidentified'
    END AS category
  FROM public.business_events b
)
SELECT category, count(*) AS events
  FROM classified
 GROUP BY category
 ORDER BY category;
