/**
 * หน้าที่: ตัวตนของ "ที่มาของโค้ด" ที่ข้ามรีโปได้ — `repository_id` +
 * `repo_relative_path`
 *
 * ── path บนเครื่องไม่ใช่ตัวตน ──
 * `~/Desktop/dna-os-control-workspace/server/server.mjs` บอกได้แค่ว่าตอนนี้
 * ใครเช็คเอาต์ไว้ที่ไหน ย้ายโฟลเดอร์แล้วมันเปลี่ยน แต่ซอฟต์แวร์ตัวเดิมไม่ได้
 * กลายเป็นตัวอื่น ตัวตนจึงต้องเป็น (repository, path ภายในรีโปนั้น) และ path
 * บนเครื่องเป็นได้แค่ `checkout_location` ที่บอกตำแหน่งรันไทม์
 *
 * ── path เดียวกันคนละรีโป = คนละของ ──
 * `server/server.mjs` ในสองรีโปคือซอฟต์แวร์คนละตัว การจับคู่ข้ามรีโปจึงถูกห้าม
 * ที่ระดับการเปรียบเทียบ ไม่ใช่ที่มารยาทของผู้เรียก
 *
 * ── ของเก่ายังอ่านได้ ──
 * ทะเบียนบันทึก `source_location` ไว้สี่รูป: absolute (`~/…`), โฟลเดอร์, ไฟล์,
 * และแบบมีคำอธิบายต่อท้าย ทั้งสี่ถูกอ่านและแปลงเป็นตัวตน canonical ตอน resolve
 * โดยไม่แก้แถวเดิมแม้แถวเดียว รูปที่แปลไม่ได้ยังคงเป็น UNKNOWN
 *
 * Input: `RepositoryIdentity`, source_location ดิบจากทะเบียน
 * Output: `CanonicalSourceIdentity`, `normalizeSourceLocation`, `KNOWN_REPOSITORIES`
 * Dependency ที่อนุญาต: none — สัญญาปลายทาง
 * สิ่งที่ห้ามแตะ: ห้ามให้ absolute path เป็นตัวตน และห้ามจับคู่ path ข้ามรีโป
 */

export interface RepositoryIdentity {
  /** `repo:<slug>` — เสถียร ไม่ขึ้นกับตำแหน่งเช็คเอาต์ */
  readonly repository_id: string;
  /** ชื่อที่คนใช้เรียก — ใช้ค้นได้ แต่ไม่ใช่ตัวตน */
  readonly repository_identity: string;
  /** remote จริงที่พิสูจน์ตัวตน ไม่ใช่ชื่อโฟลเดอร์ */
  readonly canonical_remote_identity: string | null;
  readonly current_revision: string | null;
  /** ตำแหน่งบนเครื่อง ณ ขณะนี้ — เปลี่ยนได้ ไม่มีผลต่อ repository_id */
  readonly checkout_location: string | null;
  readonly ownership_evidence: readonly string[];
}

export interface CanonicalSourceIdentity {
  readonly repository_id: string;
  readonly repo_relative_path: string;
}

/**
 * รีโปที่พิสูจน์ตัวตนได้จาก remote จริง
 *
 * `repository_id` มาจาก remote ไม่ใช่จากชื่อไดเรกทอรี — ย้ายโฟลเดอร์ เปลี่ยนชื่อ
 * โฟลเดอร์ หรือเช็คเอาต์ซ้ำที่อื่น ตัวตนไม่เปลี่ยน
 */
export const KNOWN_REPOSITORIES: readonly RepositoryIdentity[] = [
  {
    repository_id: "repo:dna-os-infrastructure",
    repository_identity: "DNA-OS-INFRASTRUCTURE",
    canonical_remote_identity: "github.com/t23598788-oss/-DNA-OS-INFRASTRUCTURE-",
    current_revision: null,
    checkout_location: null,
    ownership_evidence: ["git remote origin ของ working tree นี้"],
  },
  {
    repository_id: "repo:dna-os-control-workspace",
    repository_identity: "dna-os-control-workspace",
    canonical_remote_identity: "github.com/t23598788-oss/dna-os-control-workspace",
    current_revision: null,
    checkout_location: null,
    ownership_evidence: ["git remote origin ของ working tree ที่ com.dnaos.control-workspace รันอยู่"],
  },
];

/** เบาะแสในข้อความที่บอกว่า path นี้เป็นของรีโปไหน — ตรงตัวเท่านั้น ไม่เดา */
const REPO_HINTS: readonly { readonly marker: string; readonly repository_id: string }[] = [
  { marker: "dna-os-control-workspace/", repository_id: "repo:dna-os-control-workspace" },
  { marker: "DNA-OS-INFRASTRUCTURE/", repository_id: "repo:dna-os-infrastructure" },
];

/**
 * แปลง `source_location` ดิบเป็นตัวตน canonical
 *
 * แปลงได้เฉพาะเมื่อรูปนั้นบอกรีโปได้จริง รูปที่เป็น path เปล่าถือว่าเป็นของรีโป
 * ที่ทะเบียนนี้เป็นเจ้าของ (infrastructure) เพราะทะเบียนนี้บันทึกของตัวเองแบบ
 * repo-relative มาตลอด — นั่นเป็นข้อเท็จจริงของข้อมูล ไม่ใช่การสมมติ
 */
export function normalizeSourceLocation(raw: string): CanonicalSourceIdentity | null {
  const head = String(raw ?? "").split(" (")[0].trim();
  if (head.length === 0) return null;

  for (const hint of REPO_HINTS) {
    const at = head.indexOf(hint.marker);
    if (at !== -1) {
      const rel = head.slice(at + hint.marker.length);
      return { repository_id: hint.repository_id, repo_relative_path: rel };
    }
  }
  // absolute path ที่ไม่มีเบาะแสรีโป = แปลงไม่ได้ ไม่เดาว่าเป็นของใคร
  if (head.startsWith("/") || head.startsWith("~")) return null;
  return { repository_id: "repo:dna-os-infrastructure", repo_relative_path: head };
}

/** ครอบกันไหม — ต้องรีโปเดียวกันเท่านั้น path เดียวกันคนละรีโปไม่นับ */
export function covers(owner: CanonicalSourceIdentity, target: CanonicalSourceIdentity): boolean {
  if (owner.repository_id !== target.repository_id) return false;
  // ── ทับท้ายให้เท่ากันก่อนเทียบ ──
  // ทะเบียนเก็บโฟลเดอร์เป็น `control/runtime-control/` แต่ผู้ถามส่ง
  // `control/runtime-control` มา (ตัวทำ path ตัดทับท้ายทิ้ง) การเทียบดิบ ๆ จึง
  // ทำให้โฟลเดอร์หาเจ้าของของตัวเองไม่เจอ ทั้งที่แถวนั้นมีอยู่ในทะเบียน — ของที่
  // ลงทะเบียนไว้แล้วถูกอ่านว่า "ไม่มีเจ้าของ" เพราะอักขระตัวเดียว
  const o = owner.repo_relative_path.replace(/\/+$/, "");
  const t = target.repo_relative_path.replace(/\/+$/, "");
  if (o.length === 0) return false;
  return t === o || t.startsWith(`${o}/`);
}
