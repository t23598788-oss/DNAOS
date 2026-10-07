/**
 * หน้าที่: เทียบ "ความจริง" ที่เดินผ่านขอบเขต ไม่ใช่แค่รูปแบบข้อมูล
 *
 * ── ทำไมถูกชนิดยังไม่พอ ──
 * ต้นทางส่งสตริง `"500"` ที่หมายถึงเงินบาท ปลายทางรับสตริงได้สำเร็จแล้วตีความ
 * เป็นจำนวนชิ้น ขอบเขตนี้ "ผ่าน" ทุกการตรวจทางเทคนิค แต่ความจริงเปลี่ยนไปแล้ว
 * ตรงนั้น การเทียบจึงต้องแยกเก้ามิติออกจากกัน และรายงานทีละมิติ
 *
 * ── UNKNOWN คือ UNKNOWN ──
 * มิติที่ฝั่งใดฝั่งหนึ่งไม่รู้ ให้ผล `UNVERIFIABLE` ไม่ใช่ `MATCH` และไม่ใช่
 * `MISMATCH` การเดาความหมายจากชื่อไฟล์ ชื่อตัวแปร โค้ดข้างเคียง หรือความน่าจะเป็น
 * ถูกห้ามที่ระดับชนิดข้อมูล — ไม่มีฟังก์ชันใดในไฟล์นี้รับ "ความน่าจะเป็น" เป็นอินพุต
 *
 * Input: `SemanticValue` สองฝั่ง
 * Output: `compareSemantics`, `MismatchClass`, `SemanticValue`
 * Dependency ที่อนุญาต: none
 * สิ่งที่ห้ามแตะ: ห้ามเติมค่าให้ช่องที่เป็น UNKNOWN และห้ามยุบสองมิติเป็นมิติเดียว
 */

export const UNKNOWN = "UNKNOWN" as const;

/** ความจริงหนึ่งชิ้นที่เดินผ่านขอบเขต — เก็บตัวชี้/แฮช ไม่ใช่ payload ทั้งก้อน */
export interface SemanticValue {
  readonly identity: string | null;
  readonly type: string | null;
  /** ตัวชี้หรือแฮช ไม่ใช่ค่าจริง — ขอบเขตนี้ไม่คัดลอกข้อมูลใหญ่ */
  readonly value_reference: string | null;
  readonly meaning: string;
  readonly unit: string;
  readonly contract_version: string | null;
  readonly destination: string | null;
  readonly state: string | null;
  readonly authority: string | null;
}

export type MismatchDimension =
  | "IDENTITY" | "TYPE" | "VALUE" | "MEANING" | "UNIT"
  | "CONTRACT_VERSION" | "DESTINATION" | "STATE" | "AUTHORITY";

export type DimensionVerdict = "MATCH" | "MISMATCH" | "UNVERIFIABLE";

export interface DimensionResult {
  readonly dimension: MismatchDimension;
  readonly verdict: DimensionVerdict;
  readonly upstream: string | null;
  readonly downstream: string | null;
  readonly detail: string;
}

export type MismatchClass =
  | "NO_MISMATCH"
  | "IDENTITY_MISMATCH" | "TYPE_MISMATCH" | "VALUE_MISMATCH"
  | "MEANING_MISMATCH" | "UNIT_MISMATCH" | "CONTRACT_VERSION_MISMATCH"
  | "ROUTING_MISMATCH" | "STATE_MISMATCH" | "AUTHORITY_MISMATCH";

const CLASS_OF: Readonly<Record<MismatchDimension, MismatchClass>> = {
  IDENTITY: "IDENTITY_MISMATCH", TYPE: "TYPE_MISMATCH", VALUE: "VALUE_MISMATCH",
  MEANING: "MEANING_MISMATCH", UNIT: "UNIT_MISMATCH",
  CONTRACT_VERSION: "CONTRACT_VERSION_MISMATCH", DESTINATION: "ROUTING_MISMATCH",
  STATE: "STATE_MISMATCH", AUTHORITY: "AUTHORITY_MISMATCH",
};

/** ลำดับการรายงาน: ความหมายและหน่วยมาก่อนรูปแบบ เพราะความจริงเปลี่ยนที่นั่น */
const ORDER: readonly MismatchDimension[] = [
  "MEANING", "UNIT", "IDENTITY", "AUTHORITY", "CONTRACT_VERSION",
  "DESTINATION", "STATE", "TYPE", "VALUE",
];

function judge(dim: MismatchDimension, up: string | null, down: string | null): DimensionResult {
  if (up === null || down === null) {
    return { dimension: dim, verdict: "UNVERIFIABLE", upstream: up, downstream: down,
      detail: "ฝั่งใดฝั่งหนึ่งไม่ประกาศค่าไว้ — ไม่ตัดสิน" };
  }
  if (up === UNKNOWN || down === UNKNOWN) {
    return { dimension: dim, verdict: "UNVERIFIABLE", upstream: up, downstream: down,
      detail: "UNKNOWN คือ UNKNOWN — ไม่แปลงเป็นความหมายที่อนุมานเอง" };
  }
  return up === down
    ? { dimension: dim, verdict: "MATCH", upstream: up, downstream: down, detail: "ตรงกัน" }
    : { dimension: dim, verdict: "MISMATCH", upstream: up, downstream: down, detail: `"${up}" != "${down}"` };
}

export interface SemanticComparison {
  readonly dimensions: readonly DimensionResult[];
  readonly mismatch_class: MismatchClass;
  /** ความจริงยังเป็นเรื่องเดียวกันอยู่ไหม — ต่างจาก "ผ่านทางเทคนิคไหม" */
  readonly truth_preserved: boolean;
  /** ผ่านการตรวจเชิงรูปแบบไหม (identity/type/value/contract/destination/state) */
  readonly technically_valid: boolean;
  readonly unverifiable_dimensions: readonly MismatchDimension[];
}

const TRUTH_DIMENSIONS: readonly MismatchDimension[] = ["MEANING", "UNIT", "AUTHORITY"];

/**
 * เทียบสองฝั่งของขอบเขตทีละมิติ
 *
 * `technically_valid` กับ `truth_preserved` แยกกันโดยเจตนา: ขอบเขตที่ผ่านทาง
 * เทคนิคแต่ความหมายเปลี่ยน คือกรณีที่อันตรายที่สุดและมองไม่เห็นด้วยการตรวจ
 * แบบเดิม
 */
export function compareSemantics(upstream: SemanticValue, downstream: SemanticValue): SemanticComparison {
  const dims: DimensionResult[] = [
    judge("IDENTITY", upstream.identity, downstream.identity),
    judge("TYPE", upstream.type, downstream.type),
    judge("VALUE", upstream.value_reference, downstream.value_reference),
    judge("MEANING", upstream.meaning, downstream.meaning),
    judge("UNIT", upstream.unit, downstream.unit),
    judge("CONTRACT_VERSION", upstream.contract_version, downstream.contract_version),
    judge("DESTINATION", upstream.destination, downstream.destination),
    judge("STATE", upstream.state, downstream.state),
    judge("AUTHORITY", upstream.authority, downstream.authority),
  ];
  const byDim = new Map(dims.map((d) => [d.dimension, d]));
  const firstBad = ORDER.find((d) => byDim.get(d)?.verdict === "MISMATCH");
  return {
    dimensions: dims,
    mismatch_class: firstBad ? CLASS_OF[firstBad] : "NO_MISMATCH",
    truth_preserved: !TRUTH_DIMENSIONS.some((d) => byDim.get(d)?.verdict === "MISMATCH"),
    technically_valid: !dims.some((d) => d.verdict === "MISMATCH" && !TRUTH_DIMENSIONS.includes(d.dimension)),
    unverifiable_dimensions: dims.filter((d) => d.verdict === "UNVERIFIABLE").map((d) => d.dimension),
  };
}

export type TransformationVerdict = "AUTHORIZED_TRANSFORMATION" | "SEMANTIC_DIVERGENCE" | "NO_CHANGE" | "UNVERIFIABLE";

export interface TransformationRecord {
  readonly step_id: string;
  readonly input_meaning: string;
  readonly transformation_id: string | null;
  readonly output_meaning: string;
  readonly verdict: TransformationVerdict;
  readonly detail: string;
}

/**
 * ความหมายเปลี่ยนภายในขั้น ต้องมีตัวตนของการแปลงกำกับเสมอ
 *
 * เปลี่ยนโดยไม่มี `transformation_id` = การกลายความหมายอย่างเงียบ ๆ ซึ่งเป็น
 * สิ่งเดียวกับที่ทำให้ "500 บาท" กลายเป็น "500 ชิ้น" โดยไม่มีใครเห็น
 */
export function classifyTransformation(
  stepId: string, inputMeaning: string, outputMeaning: string, transformationId: string | null,
): TransformationRecord {
  if (inputMeaning === UNKNOWN || outputMeaning === UNKNOWN) {
    return { step_id: stepId, input_meaning: inputMeaning, transformation_id: transformationId,
      output_meaning: outputMeaning, verdict: "UNVERIFIABLE", detail: "ความหมายฝั่งใดฝั่งหนึ่งยังไม่รู้ — ไม่ตัดสิน" };
  }
  if (inputMeaning === outputMeaning) {
    return { step_id: stepId, input_meaning: inputMeaning, transformation_id: transformationId,
      output_meaning: outputMeaning, verdict: "NO_CHANGE", detail: "ความหมายไม่เปลี่ยน" };
  }
  return transformationId !== null
    ? { step_id: stepId, input_meaning: inputMeaning, transformation_id: transformationId, output_meaning: outputMeaning,
        verdict: "AUTHORIZED_TRANSFORMATION", detail: `แปลงโดยประกาศไว้: ${transformationId}` }
    : { step_id: stepId, input_meaning: inputMeaning, transformation_id: null, output_meaning: outputMeaning,
        verdict: "SEMANTIC_DIVERGENCE", detail: "ความหมายเปลี่ยนโดยไม่มีตัวตนของการแปลงกำกับ" };
}
