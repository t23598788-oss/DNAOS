/**
 * Owner Control Center — relocated (2026-10-24, unified public entry pass).
 *
 * HISTORY: "/" used to render this page (Root Domain UI Conversion,
 * owner 2026-08-05). The public website is now the single entry point for every
 * visitor (customers, suppliers, partners, operators), so "/" must answer 200
 * without a session; the operational dashboard is internal and therefore moves
 * here, behind the SAME guard and the SAME component.
 *
 * Guard: requireAuthPage(ADMIN_TIER) — one real session check
 * (core/auth/session.getAuthedUser), not a second auth implementation.
 * Middleware also protects /admin/* — defense in depth, unchanged.
 */
import { requireAuthPage } from "@/core/auth/requireAuthPage"
import { ADMIN_TIER } from "@/core/auth/session"
import OperationalWorkspace from "@/app/OperationalWorkspace"
import ownerContext from "@/registry/owner-context.json"

// Reads the live session cookie per request — never prerendered.
export const dynamic = "force-dynamic"

export default async function AdminOperationsPage() {
  await requireAuthPage("/admin/operations", ADMIN_TIER)
  // Directive 007 (2026-10-27): owner identity stays server-side — the page is
  // a server component, so the JSON is never packaged into any client bundle;
  // the client workspace receives only the displayed fields via props.
  return <OperationalWorkspace ownerContext={ownerContext} />
}
