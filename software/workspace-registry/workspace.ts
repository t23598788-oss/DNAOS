/**
 * หน้าที่: define Workspace — a scoped working context within an Account
 * (e.g. a specific integration/project/environment). Deliberately the
 * least-specified concept in this repo — real shape should come from the
 * first real Workspace use case, not be guessed now.
 *
 * Input: none (pure type definition).
 * Output: `Workspace`.
 * Dependency ที่อนุญาต: none.
 * สิ่งที่ห้ามแตะ: do not expand this type speculatively — an Identity can
 * already hold Membership directly at workspace scope
 * (../../permissions/access-control/membership.ts's scope_type="workspace")
 * without Workspace itself needing more fields for that to work.
 *
 * NOT_YET_BUILT: no real Workspace has been registered.
 */

export interface Workspace {
  workspace_id: string;
  account_id: string;
  display_name: string;
}
