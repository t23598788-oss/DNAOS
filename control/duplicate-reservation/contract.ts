/**
 * หน้าที่: the public boundary of `control/duplicate-reservation/` — the
 * only file another capability folder may import from, per
 * `governance/architecture-rules/CAPABILITY_FOLDER_LAW.md` ข้อ 9.
 *
 * Input: re-exports only.
 * Output: `reserveAndRegister`, plus every type a caller needs.
 * Dependency ที่อนุญาต: ./resolver.ts, ./types.ts.
 */

export { reserveAndRegister } from "./resolver";
export type { ReservationOutcome, ReserveAndRegisterResult } from "./types";
