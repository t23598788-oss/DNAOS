/**
 * หน้าที่: the public boundary of `control/self-understanding-ingress/` —
 * the only file another capability folder may import from, per
 * `governance/architecture-rules/CAPABILITY_FOLDER_LAW.md` ข้อ 9.
 * `./resolver.ts` stays reachable only through here.
 *
 * Input: re-exports only.
 * Output: `acceptIngressRequest`, plus every type a caller needs.
 * Dependency ที่อนุญาต: ./resolver.ts, ./types.ts.
 */

export { acceptIngressRequest } from "./resolver";
export type { SelfUnderstandingIngressRequest, IngressStatus, IngressResult } from "./types";
