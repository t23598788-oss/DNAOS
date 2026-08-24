/**
 * หน้าที่: the public boundary of `control/registration-update/` — the
 * only file another capability folder may import from, per
 * `governance/architecture-rules/CAPABILITY_FOLDER_LAW.md` ข้อ 9.
 *
 * Input: re-exports only.
 * Output: `applyMutation`, plus every type a caller needs.
 * Dependency ที่อนุญาต: ./mutation.ts, ./types.ts.
 */

export { applyMutation } from "./mutation";
export type {
  MutationType,
  AddRelationshipPayload,
  RemoveRelationshipPayload,
  AddEvidencePayload,
  AddVersionPayload,
  UpdateRequest,
  UpdateFailureReason,
  UpdateResult,
} from "./types";
