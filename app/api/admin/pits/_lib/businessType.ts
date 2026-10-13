/**
 * BUSINESS TYPE RULES — app/api/admin/pits/_lib/businessType.ts
 *
 * หน้าที่: ตัดสิน "ประเภทกิจการ" ของบ่อ/แพลนท์ 1 รายการ = 1 ประเภท จากข้อมูลที่มีอยู่แล้ว
 * (ชื่อ + วัสดุที่ผูกราคา) เท่านั้น — ไม่เดาเมื่อหลักฐานไม่พอ และไม่ใช้ชื่อบริษัท
 * อย่างเดียวตัดสิน (ต้องมีรูปแบบคำที่ระบุประเภทได้ชัดเจนในชื่อ หรือหลักฐานจากวัสดุ)
 *
 * ไม่สร้างตาราง/คอลัมน์ใหม่: ใช้ "code" ของตาราง facility_types ที่มีอยู่ใน LIVE
 * (SAND_PIT · ROCK_QUARRY · SOIL_PIT · CONCRETE_PLANT · FACTORY · MATERIAL_SHOP)
 * — TRANSPORT ไม่มี code ใน facility_types จึงส่งกลับเป็น null + รายงาน MISSING
 *
 * Pure module: ไม่มี import ใด ๆ — ใช้ซ้ำจาก API route, test และ script ได้ทันที
 */

export type BusinessTypeCode =
  | "SAND_PIT"
  | "ROCK_QUARRY"
  | "SOIL_PIT"
  | "FACTORY"        // โรงงานผลิตภัณฑ์คอนกรีต (ใช้ code FACTORY ที่มีอยู่)
  | "CONCRETE_PLANT" // โรงงานคอนกรีตผสมเสร็จ (ใช้ code CONCRETE_PLANT ที่มีอยู่)
  | "MATERIAL_SHOP"
  | "TRANSPORT"      // ไม่มีใน facility_types → facilityTypeCode = null
  | "UNCLASSIFIED";

export interface BusinessTypeResult {
  code: BusinessTypeCode;
  label: string;
  /** code ที่จะเขียนลง pit_profiles.facility_type_id ได้จริง (null = ยังไม่มีในตาราง) */
  facilityTypeCode: string | null;
  /** เหตุผลที่ตัดสิน — เก็บไว้ตรวจย้อนกลับได้ */
  evidence: string;
}

export const BUSINESS_TYPE_LABELS: Record<BusinessTypeCode, string> = {
  SAND_PIT: "บ่อทราย",
  ROCK_QUARRY: "โรงโม่หิน",
  SOIL_PIT: "บ่อดินและลูกรัง",
  FACTORY: "โรงงานผลิตภัณฑ์คอนกรีต",
  CONCRETE_PLANT: "โรงงานคอนกรีตผสมเสร็จ",
  MATERIAL_SHOP: "ร้าน/บริษัทจำหน่ายวัสดุ",
  TRANSPORT: "ผู้ให้บริการขนส่ง",
  UNCLASSIFIED: "ยังจำแนกไม่ได้",
};

/** ชื่อวัสดุจริงในฐาน → ประเภทที่มันบ่งชี้ */
const MATERIAL_RULES: { code: BusinessTypeCode; words: string[] }[] = [
  { code: "ROCK_QUARRY", words: ["หินคลุก", "หินก่อสร้าง", "หินย่อย", "หิน1-2", "หิน 1-2"] },
  { code: "SAND_PIT", words: ["ทราย"] },
  { code: "SOIL_PIT", words: ["ดินถม", "ลูกรัง", "ดินลูกรัง"] },
];

/** รูปแบบคำในชื่อที่บ่งชี้ประเภทได้ชัดเจน (ไม่ใช่ชื่อแบรนด์ลอย ๆ) */
const NAME_RULES: { code: BusinessTypeCode; pattern: RegExp }[] = [
  { code: "ROCK_QUARRY", pattern: /โรงโม่|โม่หิน/ },
  { code: "SAND_PIT", pattern: /ทราย/ },
  { code: "SOIL_PIT", pattern: /บ่อดิน|บ่อลูกรัง/ },
  { code: "CONCRETE_PLANT", pattern: /ผสมเสร็จ|แพลน.{0,4}ปูน|แพล้น.{0,4}ปูน/ },
  { code: "FACTORY", pattern: /ผลิตภัณฑ์คอนกรีต|คอนกรีตอัดแรง|สำเร็จรูป|สําเร็จรูป|เดคคอร์|พื้นพิมลาย/ },
  { code: "MATERIAL_SHOP", pattern: /วัสดุก่อสร้าง|ค้าวัสดุ|ร้านวัสดุ/ },
  { code: "TRANSPORT", pattern: /transport|ขนส่ง|รถบรรทุก/ },
];

/** ล้างช่องว่างที่มองไม่เห็น (พบ \u200b ในชื่อจริง) + lowercase */
export function normalizeThai(input: string | null | undefined): string {
  return (input ?? "")
    .replace(/[\u200b\u200c\u200d\ufeff]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

const UNCLASSIFIED: BusinessTypeResult = {
  code: "UNCLASSIFIED",
  label: BUSINESS_TYPE_LABELS.UNCLASSIFIED,
  facilityTypeCode: null,
  evidence: "ไม่พบรูปแบบคำที่ระบุประเภทในชื่อ และไม่มีวัสดุที่ผูกราคา",
};

/**
 * ตัดสิน 1 รายการ = 1 ประเภท (ไม่มีทางนับซ้ำ)
 * ลำดับหลักฐาน: ชื่อที่บ่งชี้ได้ชัดเจน (ชุดเดียว) → วัสดุที่ผูกราคา (ชุดเดียว) → ไม่แน่ใจ = UNCLASSIFIED
 * ถ้าชุดหลักฐานขัดกันเอง (ได้มากกว่า 1 ประเภท) = UNCLASSIFIED เสมอ
 */
export function resolveBusinessType(input: {
  pit_name: string | null;
  materialNames?: readonly string[];
}): BusinessTypeResult {
  const name = normalizeThai(input.pit_name);
  const mats = (input.materialNames ?? []).map(normalizeThai);

  const nameHits = NAME_RULES.filter((r) => r.pattern.test(name)).map((r) => r.code);
  const matHits = [...new Set(
    MATERIAL_RULES.filter((r) => r.words.some((w) => mats.some((m) => m.includes(w)))).map((r) => r.code),
  )];

  const make = (code: BusinessTypeCode, evidence: string): BusinessTypeResult => ({
    code,
    label: BUSINESS_TYPE_LABELS[code],
    facilityTypeCode: code === "TRANSPORT" || code === "UNCLASSIFIED" ? null : code,
    evidence,
  });

  // ชื่อบ่งชี้ได้ชุดเดียว → ใช้ชื่อ (วัสดุที่ขัดกันไม่พลิกหมวด เพราะชื่อระบุตัวตนกิจการไว้แล้ว)
  const uniqueNameHits = [...new Set(nameHits)];
  if (uniqueNameHits.length === 1) {
    const code = uniqueNameHits[0];
    const corroborates = matHits.length === 1 && matHits[0] === code;
    return make(code, `ชื่อ:${uniqueNameHits[0]}${corroborates ? " +วัสดุตรงกัน" : ""}`);
  }
  if (uniqueNameHits.length > 1) return { ...UNCLASSIFIED, evidence: `ชื่อชี้หลายประเภท: ${uniqueNameHits.join(",")}` };

  // ไม่มีชื่อบ่งชี้ → ใช้วัสดุที่ผูกราคาจริง (ต้องได้ชุดเดียว)
  if (matHits.length === 1) return make(matHits[0], `วัสดุ:${mats.join(",")}`);
  if (matHits.length > 1) return { ...UNCLASSIFIED, evidence: `วัสดุชี้หลายประเภท: ${matHits.join(",")}` };

  return UNCLASSIFIED;
}

/** กลุ่มตัวกรองบนหน้าจอ (อิง code ข้างบน ไม่มีประเภทใหม่นอกตาราง) */
export const BUSINESS_TYPE_GROUPS: { key: string; label: string; codes: BusinessTypeCode[] }[] = [
  { key: "ALL", label: "ทั้งหมด", codes: [] },
  { key: "RAW_MATERIAL", label: "บ่อวัสดุ (บ่อทราย · โรงโม่หิน · บ่อดินและลูกรัง)", codes: ["SAND_PIT", "ROCK_QUARRY", "SOIL_PIT"] },
  { key: "CONCRETE_PRODUCTS", label: "โรงงานผลิตภัณฑ์คอนกรีต", codes: ["FACTORY"] },
  { key: "CONCRETE_PLANT", label: "โรงงานคอนกรีตผสมเสร็จ", codes: ["CONCRETE_PLANT"] },
  { key: "MATERIAL_SHOP", label: "ร้าน/บริษัทจำหน่ายวัสดุ", codes: ["MATERIAL_SHOP"] },
  { key: "TRANSPORT", label: "ผู้ให้บริการขนส่ง", codes: ["TRANSPORT"] },
  { key: "UNCLASSIFIED", label: "ยังจำแนกไม่ได้", codes: ["UNCLASSIFIED"] },
];
