/**
 * หน้าที่: the ONLY module outside this folder is allowed to import from —
 * the public contract of `control/owner-command/`. `owner-command.ts`
 * (submit/render logic) and `host-runtime.ts` (ambient id/time) are
 * private implementation. Mirrors this repo's existing pattern (see
 * `../command-router/contract.ts`, `../../execution/run/contract.ts`).
 *
 * Input: re-exports only.
 * Output: `submitOwnerCommand`, `previewOwnerCommand`, `renderOwnerSurface`,
 * plus every type a caller needs to build a request or read the surface.
 * Dependency ที่อนุญาต: ./owner-command.ts, ./types.ts.
 * สิ่งที่ห้ามแตะ: never re-export ./host-runtime.ts here — stays private.
 *
 * Runtime transport: `transport/owner-command-http/server.ts` wires an
 * external local process to this contract over loopback HTTP. The transport
 * is intentionally bounded: it does not grant execution permission by
 * itself; the router and policy gate still decide every command.
 */

export { previewOwnerCommand, renderOwnerSurface, submitOwnerCommand } from "./owner-command";
export type { SubmitOwnerCommandOutcome } from "./owner-command";
export type { OwnerCapabilityStatus, OwnerSurfaceState } from "./types";
