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
export { classifyRenderEvidence, screenshotLineage, submitHistoricalScreenshotsToLifecycle, type ScreenshotLineage, type EvidenceLifecycleState } from "./screenshot-lifecycle";
export type { UiImpact, UiImpactAssessment, RenderVerdict, RenderEvidence, CompletionStatus, CompletionDecision } from "./types";
