/**
 * ทะเบียนขอบเขตที่เครื่องเป็นเจ้าของ — ไม่ใช่ข้อมูลจากผู้เสนอเปลี่ยนแปลง
 *
 * ตัวจำแนกใช้ไฟล์นี้เป็นความจริงชุดเดียว ผู้เสนอส่งได้แค่ "ไฟล์ที่จะแก้"
 * แล้วเครื่องเป็นคนตัดสินเองว่าไฟล์นั้นอยู่ในขอบเขตที่ถูกป้องกันหรือไม่
 * ฟิลด์ใด ๆ ที่ผู้เสนอประกาศมาว่า "ไม่ใช่ของที่ถูกป้องกัน" ไม่มีผลทั้งสิ้น
 *
 * รายชื่อขอบเขตตรงกับเครื่องมือล็อกกายภาพที่ตรึงไว้แล้ว
 * (scratchpad/dnaos-boundary.sh sha256 ac17da6c…) โดยเจตนา — สองที่นี้
 * ต้องพูดตรงกันเสมอ ไม่งั้นการจำแนกกับการบังคับใช้จะเพี้ยนจากกัน
 */

/** ที่ตั้งของโลกที่ถูกป้องกัน อ้างอิงจากรากรีโปแบบสัมพัทธ์เสมอ */
export interface BoundarySpec {
  readonly boundary: string;
  /** โฟลเดอร์ที่ไฟล์ชั้นเดียวข้างในถือเป็นคำนิยามที่ถูกป้องกัน */
  readonly file_roots: readonly string[];
  /** true = โฟลเดอร์นี้รับไฟล์ใหม่ไม่ได้เลย (ตัวโฟลเดอร์ถูกตรึงด้วย) */
  readonly sealed_dir: boolean;
  /** ทำไมถึงถูกป้องกัน — ข้อความนี้ใช้แสดงต่อ Owner ไม่ใช่ข้อความจากผู้เสนอ */
  readonly owner_facing_reason: string;
}

export const REPO_ROOT = "/Users/tam/Desktop/DNA-OS-INFRASTRUCTURE";
export const LAB_ROOT = "/Users/tam/Developer/DNA-OS/source/DNA-LAB-PERMISSION-REASONER";

export const PROTECTED_BOUNDARIES: readonly BoundarySpec[] = [
  {
    boundary: "write-gate",
    file_roots: [`${REPO_ROOT}/permissions/write-gate`, `${REPO_ROOT}/permissions/write-gate/tests`],
    sealed_dir: true,
    owner_facing_reason: "ประตูตัดสินสิทธิ์เขียนของทั้งระบบ",
  },
  {
    boundary: "architecture-rules",
    file_roots: [`${REPO_ROOT}/governance/architecture-rules`],
    sealed_dir: false, // รับเอกสารใหม่ได้ แต่ 15 ฉบับเดิมถูกตรึง
    owner_facing_reason: "กฎสถาปัตยกรรมที่ Owner รับเป็นฐานแล้ว",
  },
  {
    boundary: "source-promotion",
    file_roots: [`${REPO_ROOT}/governance/source-promotion`, `${REPO_ROOT}/governance/source-promotion/tests`],
    sealed_dir: true,
    owner_facing_reason: "ตัวจำแนกและตัวตรึงคำขอเลื่อนขั้นเอง — แก้ตัวเองไม่ได้",
  },
  {
    boundary: "formulas",
    file_roots: [`${LAB_ROOT}/research/formulas`],
    sealed_dir: true,
    owner_facing_reason: "ทะเบียนสูตรคำนวณที่ตรึงแล้ว",
  },
  {
    boundary: "ownership",
    file_roots: [`${LAB_ROOT}/dna_os/ownership`],
    sealed_dir: true,
    owner_facing_reason: "คำนิยามความเป็นเจ้าของทรัพยากร",
  },
  {
    boundary: "calculator",
    file_roots: [`${LAB_ROOT}/dna_os/calculator`],
    sealed_dir: true,
    owner_facing_reason: "แกนคำนวณราคา",
  },
  {
    boundary: "normalize",
    file_roots: [`${LAB_ROOT}/dna_os/normalize`],
    sealed_dir: true,
    owner_facing_reason: "การแปลงข้อมูลดิบให้เป็นรูปแบบมาตรฐาน",
  },
];

export const BOUNDARY_NAMES: readonly string[] = PROTECTED_BOUNDARIES.map((b) => b.boundary);

export function findBoundary(name: string): BoundarySpec | null {
  return PROTECTED_BOUNDARIES.find((b) => b.boundary === name) ?? null;
}
