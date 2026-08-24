/**
 * หน้าที่: the public boundary of `control/integration-verification/` —
 * the only file another capability folder may import from, per
 * `governance/architecture-rules/CAPABILITY_FOLDER_LAW.md` ข้อ 9.
 * `./resolver.ts`, `./host-runtime.ts` stay reachable only through here.
 *
 * Input: re-exports only.
 * Output: `verifyIntegration`, plus every type a caller needs.
 * Dependency ที่อนุญาต: ./resolver.ts, ./types.ts.
 */

export { verifyIntegration } from "./resolver";
export type { IntegrationVerificationStatus, ConsumerRelationshipProof, IntegrationVerificationInput, IntegrationVerificationResult, VerifiedConsumer } from "./types";
