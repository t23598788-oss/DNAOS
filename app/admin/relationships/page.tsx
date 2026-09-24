import { RelationshipWorkspacePage } from "./workspace"
import { requireAuthPage } from "@/core/auth/requireAuthPage"
import { ADMIN_TIER } from "@/core/auth/session"

type SearchParams = { [key: string]: string | string[] | undefined }

// Display-layer switch (2026-09-24): default = the BusinessWorkspace-family
// screen the Owner chose; ?ui=legacy renders the ORIGINAL AppShell screen —
// same URL, session, permissions, data and services either way (rollback path
// until the Owner inspects and approves the new screen).
//
// Server-side role gate (2026-09-24): same ADMIN_TIER authority as every API
// this screen calls (registry/permissions.json route_access /admin = super_
// admin/admin/employee). Middleware only checks "logged in" — without this,
// a partner/customer session would reach the shell and live on 403s from the
// API. Role set is UNCHANGED from the registry; this enforces it at the page.
export default async function RelationshipsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireAuthPage("/admin/relationships", ADMIN_TIER)
  const sp = await searchParams
  return <RelationshipWorkspacePage initialRelationshipId={null} legacyUi={sp?.ui === "legacy"} />
}
