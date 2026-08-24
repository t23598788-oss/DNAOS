/**
 * หน้าที่: the public boundary of `control/source-workspace/` — the only
 * file another capability folder may import from, per
 * `governance/architecture-rules/CAPABILITY_FOLDER_LAW.md` ข้อ 9.
 *
 * Input: re-exports only.
 * Output: `createWorkspace`, `removeWorkspace`, plus every type a caller needs.
 * Dependency ที่อนุญาต: ./resolver.ts, ./types.ts.
 */

export { createWorkspace, removeWorkspace } from "./resolver";
export type { WorkspaceReservation, CreateWorkspaceInput, CreateWorkspaceResult, CreateWorkspaceStatus, RemoveWorkspaceResult, RemoveWorkspaceStatus } from "./types";
