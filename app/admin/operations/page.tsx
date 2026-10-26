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
import archBook from "@/registry/architecture-book.json"
import { buildOwnerDisplayDTO } from "./owner-context-dto"

// Reads the live session cookie per request — never prerendered.
export const dynamic = "force-dynamic"

export default async function AdminOperationsPage() {
  await requireAuthPage("/admin/operations", ADMIN_TIER)
  // Directives 007/008 (2026-10-27): the full owner-context.json is a private
  // operator registry. React/Flight serializes the RUNTIME object passed as a
  // prop — a TypeScript interface does not filter anything — so the page
  // materializes an explicit minimal DTO server-side here.
  const ownerDisplay = buildOwnerDisplayDTO(ownerContext)
  // Perf 009 (summary-only DTO): the 3.9 MB architecture-book JSON is read
  // server-side here (it was previously imported into the client workspace,
  // then only tree-shaken by usage luck). The client receives exactly the
  // five summary numbers the UI displays.
  const archSummary = {
    broken: Number(archBook.summary?.broken ?? 0),
    ok: Number(archBook.summary?.ok ?? 0),
    total: Number(archBook.summary?.total ?? 0),
    unused: Number(archBook.summary?.unused ?? 0),
    unregistered: Number(archBook.summary?.unregistered ?? 0),
    version: typeof archBook.version === 'string' ? archBook.version : undefined,
    generated_at: typeof archBook.generated_at === 'string' ? archBook.generated_at : undefined,
  }
  return <OperationalWorkspace ownerContext={ownerDisplay} archSummary={archSummary} />
}
