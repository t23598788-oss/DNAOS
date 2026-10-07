/**
 * R2 · ชั้นนโยบาย — อ่านจากเอกสารที่ Owner ประกาศเอง ไม่ใช่ที่ผมคิดขึ้น
 *
 * ฟิลด์กลุ่มนโยบาย (allowed_scope · forbidden_scope · prohibited …) ค้นพบจาก
 * โค้ดไม่ได้โดยธรรมชาติ เพราะมันคือการตัดสินใจ ไม่ใช่ข้อเท็จจริงในซอร์ส
 * จึงต้องมีแหล่งประกาศ — ที่นี่ใช้สองฉบับที่ Owner ประกาศและ LOCKED แล้ว
 *
 *   governance/architecture-rules/CAPABILITY_FOLDER_LAW.md
 *     ประกาศ Owner 2026-08-14 · "บังคับกับคน AI agent และเครื่องมือทุกตัว
 *     ที่สร้างหรือแก้ source code ใน repo นี้ ไม่มีข้อยกเว้น"
 *     §2 ห้ามสร้างไฟล์ใหม่ที่ root หรือในโฟลเดอร์ของ capability อื่น
 *     §3 โฟลเดอร์หนึ่งเก็บของความสามารถนั้น "เท่านั้น"
 *
 *   governance/architecture-rules/STRUCTURE_LOCK_MAP.md
 *     Owner รับเป็นฐานสถาปัตยกรรมแล้ว · ประกาศขอบเขต LOCKED พร้อมจุดต่อขยาย
 *
 * ฟิลด์ที่เอกสารทั้งสองไม่ได้พูดถึง ยังคงเป็น UNRESOLVED ตามเดิม
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Cited } from "./source-evidence";
import { cite } from "./source-evidence";

const FOLDER_LAW = "governance/architecture-rules/CAPABILITY_FOLDER_LAW.md";
const LOCK_MAP = "governance/architecture-rules/STRUCTURE_LOCK_MAP.md";

function lawIsDeclared(): boolean {
  if (!existsSync(FOLDER_LAW)) return false;
  const t = readFileSync(FOLDER_LAW, "utf8");
  return /status:\s*LOCKED/.test(t) && /ไม่มีข้อยกเว้น/.test(t);
}

/** โฟลเดอร์ของ capability จาก entrypoint จริง — ฐานของขอบเขตที่เขียนได้ */
function capabilityFolder(entrypoint: string): string | null {
  if (!entrypoint) return null;
  const p = entrypoint.replace(/\s*\+.*$/, "").trim();
  if (!p || p.startsWith("/")) return null;
  return p.endsWith("/") ? p.replace(/\/$/, "") : dirname(p);
}

/** §3 — เขียนได้เฉพาะในโฟลเดอร์ของความสามารถตัวเอง */
export function allowedScope(entrypoint: string): Cited<string[]> | null {
  if (!lawIsDeclared()) return null;
  const folder = capabilityFolder(entrypoint);
  if (folder === null) return null;
  return cite(
    [`เขียนได้เฉพาะภายใน ${folder}/ (source · contract · config · policy · test)`],
    `${FOLDER_LAW} §3 — โฟลเดอร์หนึ่งเก็บของความสามารถนั้นเท่านั้น`,
  );
}

/** §2 — ห้ามสร้างไฟล์ที่ root และห้ามเขียนในโฟลเดอร์ของความสามารถอื่น */
export function forbiddenScope(entrypoint: string): Cited<string[]> | null {
  if (!lawIsDeclared()) return null;
  const folder = capabilityFolder(entrypoint);
  if (folder === null) return null;
  return cite(
    [
      "ห้ามสร้างไฟล์ใหม่ที่รากของ repo",
      `ห้ามสร้างหรือแก้ไฟล์ในโฟลเดอร์ของ capability อื่น (นอก ${folder}/)`,
      "ห้ามสร้างไฟล์ก่อนสร้าง capability folder",
    ],
    `${FOLDER_LAW} §1 §2 — ประกาศ Owner 2026-08-14 บังคับกับ AI agent ไม่มีข้อยกเว้น`,
  );
}

/** ข้อมูลที่ห้ามแตะ — มาจากข้อห้ามเดียวกัน มองในมุมข้อมูล */
export function prohibitedData(entrypoint: string): Cited<string[]> | null {
  const f = forbiddenScope(entrypoint);
  if (f === null) return null;
  return cite(
    [`ข้อมูลของ capability อื่นนอก ${capabilityFolder(entrypoint)}/`, "ไฟล์ที่รากของ repo"],
    f.evidence,
  );
}

export interface LockedBoundary { readonly name: string; readonly structure: string; readonly extension: string; }

/** อ่านตาราง LOCKED จาก STRUCTURE_LOCK_MAP — Owner รับเป็นฐานแล้ว */
export function lockedBoundaries(): readonly LockedBoundary[] {
  if (!existsSync(LOCK_MAP)) return [];
  const out: LockedBoundary[] = [];
  for (const line of readFileSync(LOCK_MAP, "utf8").split("\n")) {
    const m = /^\|\s*([^|]+?)\s*\|\s*(LOCKED|—)\s*\|\s*([^|]*?)\s*\|\s*([^|]*?)\s*\|/.exec(line);
    if (m && m[2] === "LOCKED") out.push({ name: m[1], structure: m[2], extension: m[4] });
  }
  return out;
}

/** ขอบเขตที่ถูกล็อกซึ่งครอบ entrypoint นี้ — ใช้เติมข้อห้ามระดับสถาปัตยกรรม */
export function lockedConstraint(entrypoint: string): Cited<string[]> | null {
  const locked = lockedBoundaries();
  if (locked.length === 0) return null;
  const folder = capabilityFolder(entrypoint);
  if (folder === null) return null;
  const HIT: readonly { readonly re: RegExp; readonly name: string }[] = [
    { re: /^software\/registry-database/, name: "Registry" },
    { re: /^permissions\/write-gate/, name: "Write Gate" },
    { re: /^governance\/architecture-rules/, name: "Owner Documentation" },
  ];
  const hit = HIT.find((h) => h.re.test(folder));
  if (hit === undefined) return null;
  const row = locked.find((l) => l.name.includes(hit.name));
  if (row === undefined) return null;
  return cite(
    [`อยู่ในขอบเขต LOCKED "${row.name}" — เปลี่ยนโครงสร้างได้ต่อเมื่อเจ้าของสั่งปลดล็อกชัดเจน`,
     `จุดต่อขยายที่อนุญาต: ${row.extension || "ไม่ระบุ"}`],
    `${LOCK_MAP} ตาราง LOCKED แถว "${row.name}"`,
  );
}
