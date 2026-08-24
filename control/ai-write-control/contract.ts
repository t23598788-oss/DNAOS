/**
 * หน้าที่: the public boundary of `control/ai-write-control/` — the only
 * file another capability folder may import from.
 *
 * Input: re-exports only.
 * Output: `submitWriteRequest`, `SubmitWriteRequestOutcome`,
 * `RawWriteRequest`, `isTemporaryWorkspaceArtifact`,
 * `toRegistrationCandidate`, `RegistrationEligibility`,
 * `WriteResultForRegistration`.
 * Dependency ที่อนุญาต: ./ai-write-control.ts, ./write-result-registration.ts, ./types.ts.
 * สิ่งที่ห้ามแตะ: never re-export ./host-runtime.ts.
 */

export { submitWriteRequest } from "./ai-write-control";
export type { SubmitWriteRequestOutcome } from "./ai-write-control";
export type { RawWriteRequest } from "./types";
export { isTemporaryWorkspaceArtifact, toRegistrationCandidate } from "./write-result-registration";
export type { RegistrationEligibility, WriteResultForRegistration } from "./write-result-registration";
