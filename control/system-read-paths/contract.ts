/**
 * หน้าที่: the public boundary of `control/system-read-paths/` — the only file
 * another capability folder may import from, per
 * `../../governance/architecture-rules/CAPABILITY_FOLDER_LAW.md` ข้อ 9.
 *
 * Input: re-exports only.
 * Output: the declared read paths, their runtime verifier, the circuit graph
 * generator, the external Blueprint read boundary, and the conformance
 * classifier.
 * Dependency ที่อนุญาต: ./registry.ts, ./blueprint-index.ts, ./conformance.ts, ./types.ts.
 * สิ่งที่ห้ามแตะ: ห้าม export ฟังก์ชันเขียนใดๆ จากโฟลเดอร์นี้ — read paths only.
 */

export { READ_PATHS, verifyReadPaths, readPathCircuitGraph } from "./registry";
export { readBlueprintReferences, blueprintReadPathStatus, type BlueprintReference, type BlueprintReadResult } from "./blueprint-index";
export { compareSourceToBlueprint, type ConformanceFinding, type ConformanceStatus } from "./conformance";
export type { ReadPathDeclaration, ReadRequestSpec, ReadResponseSpec, ReadPathVerification, ReadDomain } from "./types";
