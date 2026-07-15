import { RelationshipWorkspacePage } from "../workspace"

type Params = { params: Promise<{ relationshipId: string }> }

// Routing (Architecture Migration, owner section 6): the one real per-
// relationship workspace URL — relationship_id (companies.id) only, never
// line_user_id. Deep-linkable/bookmarkable, unlike the old
// /admin/line-customers page which had no per-contact route at all.
export default async function RelationshipWorkspaceRoute({ params }: Params) {
  const { relationshipId } = await params
  return <RelationshipWorkspacePage initialRelationshipId={relationshipId} />
}
