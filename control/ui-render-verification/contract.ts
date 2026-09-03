/**
 * หน้าที่: the public boundary of `control/ui-render-verification/`.
 *
 * Input: re-exports only.
 * Output: impact detection, the render stage, the completion gate, evidence readers.
 * Dependency ที่อนุญาต: ./impact.ts, ./render-verify.ts, ./gate.ts, ./types.ts.
 * สิ่งที่ห้ามแตะ: ห้าม export ทางที่ให้ผู้เรียกเขียน verdict เองโดยไม่ผ่าน verifyRender.
 */

export { assessUiImpact, routeOwnership } from "./impact";
export { verifyRender, readRenderEvidence, renderEvidenceFor, RENDER_EVIDENCE_FILE, type RenderVerificationRequest } from "./render-verify";
export { decideCompletion } from "./gate";
export { classifyRenderEvidence, screenshotLineage, offerHistoricalScreenshotsToLifecycle, type ScreenshotLineage, type EvidenceLifecycleState, type ScreenshotLifecycleOffer } from "./screenshot-lifecycle";
export { UI_RENDER_VERIFIER_CONTRACT_DECLARATION, UI_RENDER_CONTRACT_CAN_SELF_AUTHORIZE } from "./declaration";
export { resolveVerificationAuthorityBinding, validateUiRenderAuthorityBinding, UI_RENDER_VERIFICATION_AUTHORITY_BINDING_V1, UI_RENDER_AUTHORITY_ID } from "./authority-binding";
export { UI_RENDER_TRUSTED_EMISSION_BOUNDARY_DECLARATION, UI_RENDER_DECLARATION_ALONE_GRANTS_RUNTIME_TRUST } from "./emission-boundary-declaration";
export { runUiRenderTrustedVerification, type UiRenderTrustedAdapterInput, type TrustedUiRenderVerificationPackage, type TrustedUiRenderAdapterOutcome } from "./trusted-verification-adapter";
export type { UiImpact, UiImpactAssessment, RenderVerdict, RenderEvidence, CompletionStatus, CompletionDecision } from "./types";
