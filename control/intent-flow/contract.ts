/**
 * หน้าที่: ขอบเขตสาธารณะของ `control/intent-flow/` ตาม CAPABILITY_FOLDER_LAW ข้อ 9
 *
 * Input: re-export เท่านั้น
 * Output: แบบจำลองเส้นทาง สัญญาขอบเขต และตัววิเคราะห์ขอบเขตแรกที่พัง
 * Dependency ที่อนุญาต: ./types.ts, ./recovery-flow.ts, ./analyzer.ts
 * สิ่งที่ห้ามแตะ: ห้าม export เส้นทางที่ซ่อมหรือส่งงาน — ที่นี่วิเคราะห์อย่างเดียว
 */

export { RECOVERY_OUTCOME, RECOVERY_FLOW, RECOVERY_CONTRACTS } from "./recovery-flow";
export { analyzeFlow } from "./analyzer";
export type { AnalyzeInput } from "./analyzer";
export type {
  ExpectedHumanOutcome, FlowStep, StepImplementation, BoundaryContract,
  StepObservation, StepVerdict, FlowAnalysis, ResponsibilityClass,
} from "./types";

export { bindRunObservations, readRunSources, readDeclaredSemantics, STEP_BINDING } from "./runtime-binding";
export type { RuntimeStepObservation, RunSources, StepBinding } from "./runtime-binding";
export { analyzeRun } from "./run-analyzer";
export type { RunAnalysis, BoundaryResult, RunResponsibility, HumanOutcomeResult } from "./run-analyzer";
export { compareSemantics, classifyTransformation, UNKNOWN } from "./semantics";
export type { SemanticValue, SemanticComparison, MismatchClass, MismatchDimension, DimensionResult, TransformationRecord, TransformationVerdict } from "./semantics";
export { implementationForStep, DECLARED_PATHS } from "./implementation-map";
