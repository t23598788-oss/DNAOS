/**
 * หน้าที่: the public boundary of `control/system-reference-resolution/` —
 * the only file another capability folder may import from, per
 * `governance/architecture-rules/CAPABILITY_FOLDER_LAW.md` ข้อ 9.
 * `./resolver.ts` stays reachable only through here.
 *
 * Input: re-exports only.
 * Output: `resolveSystemReference`, plus every type a caller needs.
 * Dependency ที่อนุญาต: ./resolver.ts, ./types.ts.
 * สิ่งที่ห้ามแตะ: never re-export anything beyond `resolveSystemReference`
 * and its types — this stays a read-only resolution surface only, no
 * execution.
 */

export { resolveSystemReference } from "./resolver";
export type {
  SystemReferenceRequest,
  SystemReferenceContext,
  SystemReferenceSource,
  SystemReferenceStatus,
  SystemReferenceMatch,
  SystemReferenceResolution,
} from "./types";
