/**
 * หน้าที่: ชนิดข้อมูลของ "ที่เก็บสถานะเฉพาะการติดตั้ง" — ยังไม่ใช่ตัวตนของการติดตั้ง
 *
 * ไฟล์นี้ตอบคำถามเดียว: สถานะที่ต้องอยู่รอดการเปลี่ยนซอร์ส **วางไว้ที่ไหนได้**
 * ไม่ได้ตอบว่าการติดตั้งนี้คือใคร ไม่ได้สร้างอะไร และไม่ได้ตีความว่าไฟล์ที่
 * path นั้นมีอยู่แล้วแปลว่าอะไร
 *
 * ── ทำไมต้องอยู่นอกรีโป ──
 * ทุกสโตร์ของ DNA OS วันนี้อยู่ในรีโป และไฟล์ `data/*.jsonl` 26 ไฟล์ถูกติดตาม
 * ใน git ถ้าตัวตนของการติดตั้งอยู่ที่เดียวกัน `git clone` จะพามันไปด้วย
 * เครื่องสองเครื่องจะอ้างตัวตนเดียวกันโดยไม่มีใครรู้
 *
 * Input: `ResolveLocalStateRootInput`
 * Output: `LocalStateRootV1`, `ResolvedLocalStateRootV1`, ค่าคงที่สิทธิ์
 * Dependency ที่อนุญาต: none — เป็นสัญญาปลายทาง
 * สิ่งที่ห้ามแตะ: ห้ามเพิ่มสถานะที่แปลว่า "ยอมให้ใช้ที่ในรีโปได้" และห้ามเพิ่ม
 * ฟิลด์ที่ตีความเนื้อหาของไฟล์ที่ path นั้น
 */

export type LocalStateRootStatus = "RESOLVED" | "UNRESOLVED" | "INELIGIBLE";

/** มาจากค่าเริ่มต้นของแพลตฟอร์ม หรือมาจากการตั้งค่าอย่างชัดแจ้ง — ผู้อ่านต้องแยกออก */
export type LocalStateRootOrigin = "PLATFORM_DEFAULT" | "EXPLICIT_OVERRIDE";

export interface ResolvedLocalStateRootV1 {
  readonly status: "RESOLVED";
  /** absolute path ที่ resolve symlink แล้วเท่าที่มีอยู่จริง — ยังไม่ถูกสร้าง */
  readonly state_root: string;
  readonly origin: LocalStateRootOrigin;
  readonly platform: string;
  /** รากของซอร์สที่ใช้ตัดสิน — คนละสิ่งกับ state_root เสมอ */
  readonly source_root: string;
}

export interface UnresolvedLocalStateRootV1 {
  readonly status: "UNRESOLVED";
  readonly reason_code: "UNSUPPORTED_PLATFORM" | "HOME_UNRESOLVABLE";
  readonly detail: string;
}

export interface IneligibleLocalStateRootV1 {
  readonly status: "INELIGIBLE";
  readonly reason_code:
    | "INSIDE_SOURCE_ROOT"
    | "SOURCE_ROOT_UNRESOLVABLE"
    | "CANDIDATE_UNRESOLVABLE"
    | "RELATIVE_OVERRIDE"
    | "EMPTY_OVERRIDE";
  readonly detail: string;
  /** candidate ที่ถูกปฏิเสธ ตามที่ resolve ได้ — เพื่อให้อ่านย้อนหลังได้ว่าปฏิเสธอะไร */
  readonly candidate: string;
}

export type LocalStateRootV1 =
  | ResolvedLocalStateRootV1
  | UnresolvedLocalStateRootV1
  | IneligibleLocalStateRootV1;

export interface ResolveLocalStateRootInput {
  /** ทับรากของซอร์สที่ใช้ตัดสิน — สำหรับเทสต์ ค่าเริ่มต้นคือรากของรีโปนี้ */
  readonly source_root?: string;
  /** ทับแพลตฟอร์ม — สำหรับเทสต์ ค่าเริ่มต้นคือ process.platform ตอนเรียก */
  readonly platform?: string;
}

/**
 * สิทธิ์ที่ **ผู้เขียนในอนาคต** ต้องใช้ตอนสร้าง ไฟล์นี้ไม่ chmod อะไรทั้งสิ้น
 *
 * ขอบเขตภัยคุกคามที่แท้จริง: กันผู้ใช้อื่นบนเครื่องเดียวกันเท่านั้น
 * **ไม่กันโปรเซสใด ๆ ที่รันในบัญชีผู้ใช้เดียวกัน** ซึ่งเป็นขอบเขตความเชื่อถือ
 * ของทั้งแบบจำลองนี้อยู่แล้ว การอ้างว่ามันกันได้มากกว่านี้คือการอ้างเกินจริง
 */
export const STATE_DIRECTORY_MODE = 0o700;
export const STATE_FILE_MODE = 0o600;
