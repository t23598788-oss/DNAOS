import { RelationshipWorkspacePage } from "../workspace"
import { requireAuthPage } from "@/core/auth/requireAuthPage"
import { ADMIN_TIER } from "@/core/auth/session"

type Params = { params: Promise<{ relationshipId: string }> }
type SearchParams = { searchParams?: Promise<{ [key: string]: string | string[] | undefined }> }

// Routing (Architecture Migration, owner section 6): the one real per-
// relationship workspace URL — relationship_id (companies.id) only, never
// line_user_id. Deep-linkable/bookmarkable, unlike the old
// /admin/line-customers page which had no per-contact route at all.
// Same display-layer switch as page.tsx: ?ui=legacy = original screen.
// Same server-side ADMIN_TIER gate as page.tsx (registry route_access /admin).
export default async function RelationshipWorkspaceRoute({ params, searchParams }: Params & SearchParams) {
  const { relationshipId } = await params
  await requireAuthPage(`/admin/relationships/${relationshipId}`, ADMIN_TIER)
  const sp = (await searchParams) ?? {}
  return <RelationshipWorkspacePage initialRelationshipId={relationshipId} legacyUi={sp.ui === "legacy"} />
}
