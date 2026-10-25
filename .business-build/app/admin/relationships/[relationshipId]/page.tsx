import { RelationshipWorkspacePage } from "../workspace"
import { requireAuthPage } from "@/core/auth/requireAuthPage"
import { ADMIN_TIER } from "@/core/auth/session"

type Params = { params: Promise<{ relationshipId: string }> }

// Routing (Architecture Migration, owner section 6): the one real per-
// relationship workspace URL — relationship_id (companies.id) only, never
// line_user_id. Deep-linkable/bookmarkable, unlike the old
// /admin/line-customers page which had no per-contact route at all.
// Display = WorkspaceFrame shell โดยตรง (START-HERE ข้อ17) — ?ui=legacy
// removed, ย้อนกลับผ่าน Git เท่านั้น (ข้อ22) · Same server-side ADMIN_TIER
// gate as page.tsx (registry route_access /admin).
export default async function RelationshipWorkspaceRoute({ params }: Params) {
  const { relationshipId } = await params
  await requireAuthPage(`/admin/relationships/${relationshipId}`, ADMIN_TIER)
  return <RelationshipWorkspacePage initialRelationshipId={relationshipId} />
}
