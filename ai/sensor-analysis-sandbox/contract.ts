/**
 * หน้าที่: the public boundary of `ai/sensor-analysis-sandbox/` — the only
 * file another capability folder may import from, per
 * `../../governance/architecture-rules/CAPABILITY_FOLDER_LAW.md` ข้อ 9.
 *
 * Note what is NOT re-exported: `./sandbox-runner.py` and
 * `./run-sandbox.sh` are not reachable from here at all. Nothing outside this
 * folder may launch the model directly — a caller gets the pipeline, which
 * always validates, or it gets nothing.
 *
 * Input: re-exports only.
 * Output: the input contract, the output contract + its validator, and the
 * one-way pipeline entry points.
 * Dependency ที่อนุญาต: ./input-contract.ts, ./output-contract.ts, ./analyze.ts.
 * สิ่งที่ห้ามแตะ: ห้าม re-export อะไรก็ตามที่ทำให้เรียกโมเดลได้โดยข้าม validator.
 */

export { buildInputFromSensor, runSandbox, type AnalysisRun } from "./analyze";
export { projectEvent, referenceUniverse, type SandboxEvent, type SandboxInput, type SandboxPatterns } from "./input-contract";
export {
  validateSandboxOutput,
  ANOMALY_CLASSES, PATTERN_TYPES, CONFIDENCE_LEVELS,
  type AnomalyClass, type PatternType, type Confidence,
  type SandboxFinding, type SandboxOutput, type ValidationResult,
} from "./output-contract";
