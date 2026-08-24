/**
 * หน้าที่: the public boundary of `control/work-result-ingress/` — the
 * only file another capability folder may import from, per
 * `governance/architecture-rules/CAPABILITY_FOLDER_LAW.md` ข้อ 9.
 * `./ingress.ts`, `./classifier.ts`, and `./continuation.ts` stay
 * reachable only through here.
 *
 * Input: re-exports only.
 * Output: `ingestWorkResult`, `splitWorkResultIntoCandidates`,
 * `continueRegisteredArtifact`, plus every type a caller needs.
 * Dependency ที่อนุญาต: ./ingress.ts, ./classifier.ts, ./continuation.ts, ./types.ts.
 */

export { ingestWorkResult } from "./ingress";
export { splitWorkResultIntoCandidates } from "./classifier";
export { continueRegisteredArtifact } from "./continuation";
export type { ContinuationStage, ContinuationInput, ContinuationResult } from "./continuation";
export type { CapabilityIntroduced, WorkResultInput, WorkResultIngressStatus, RegisteredArtifact, WorkResultIngressResult } from "./types";
