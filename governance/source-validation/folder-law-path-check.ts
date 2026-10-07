/**
 * ตรวจ "หนึ่ง path" ตามกฎเดิมของ CAPABILITY_FOLDER_LAW ก่อนจะมีการเขียนจริง
 *
 * ไม่ได้เพิ่มกฎใหม่ — ใช้แถวเดียวกับที่ runCapabilityFolderLawGate ตรวจอยู่แล้ว
 * คือ SOURCE_FILE_OUTSIDE_CAPABILITY_BOUNDARY (ข้อ 2 ของกฎหมาย) เพียงแต่
 * ประเมินกับ "ไฟล์ที่กำลังจะถูกเขียน" แทนที่จะสแกนทั้ง snapshot
 *
 * เหตุผลที่ต้องเป็นรายไฟล์: snapshot ปัจจุบันมีการละเมิดค้างอยู่ 251 รายการ
 * ถ้าเอาผลรวมของ snapshot มาปิดประตูเขียน ระบบจะเขียนอะไรไม่ได้เลยจนกว่าจะ
 * ล้างของเก่าหมด ซึ่งกฎหมายไม่ได้สั่งให้ทำแบบนั้น — กฎหมายสั่งว่า
 * "ลำดับต้องถูกตั้งแต่ commit แรกที่สร้างไฟล์นั้น" (ข้อ 1) และ
 * "ห้ามสร้างไฟล์ใหม่ไว้ที่ root หรือในโฟลเดอร์ของ capability อื่น" (ข้อ 2)
 * ทั้งสองข้อพูดถึงไฟล์ที่กำลังถูกสร้าง ไม่ใช่สภาพรวมของ repo
 */
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";

const LAW = "governance/architecture-rules/CAPABILITY_FOLDER_LAW.md";

/** นามสกุลที่นับว่าเป็น source — ชุดเดียวกับ folder-law-gate.ts */
const SOURCE_EXT = [".ts", ".tsx", ".mjs", ".cjs", ".js", ".py"];

function isSourceFile(path: string): boolean {
  return SOURCE_EXT.some((e) => path.toLowerCase().endsWith(e));
}

export type FolderLawPathVerdict = "ALLOW" | "REJECT" | "NOT_A_SOURCE_FILE";

export interface FolderLawPathResult {
  readonly verdict: FolderLawPathVerdict;
  readonly rule_row: string | null;
  readonly target_path: string;
  readonly measured: string;
  readonly evidence_ref: string;
}

/**
 * @param targetPath path สัมพัทธ์จากรากรีโป
 * @param repoRoot   รากรีโปที่ใช้ตัดสิน (ค่าเริ่มต้น = cwd ของโปรเซส)
 */
export function checkFolderLawForPath(targetPath: string, repoRoot: string = process.cwd()): FolderLawPathResult {
  const base = (m: Partial<FolderLawPathResult>): FolderLawPathResult => ({
    verdict: "ALLOW", rule_row: null, target_path: targetPath,
    measured: "", evidence_ref: `${LAW}#ข้อ1-2`, ...m,
  });

  if (!isSourceFile(targetPath)) {
    return base({ verdict: "NOT_A_SOURCE_FILE", measured: "ไม่ใช่ไฟล์ source ตามนามสกุลที่กฎระบุ" });
  }

  const parts = targetPath.split("/").filter((p) => p !== "" && p !== ".");

  // ข้อ 2 — ไฟล์ source ที่รากของ repo
  if (parts.length <= 1) {
    return base({
      verdict: "REJECT", rule_row: "SOURCE_FILE_OUTSIDE_CAPABILITY_BOUNDARY",
      measured: "ไฟล์ source วางอยู่ที่รากของ repo ไม่ได้อยู่ในโฟลเดอร์ความสามารถใด",
    });
  }

  // ข้อ 2 — ไฟล์ source วางตรงในกลุ่มหลัก (เช่น control/x.ts) โดยไม่มีโฟลเดอร์ความสามารถ
  if (parts.length === 2) {
    return base({
      verdict: "REJECT", rule_row: "SOURCE_FILE_OUTSIDE_CAPABILITY_BOUNDARY",
      measured: `ไฟล์ source วางอยู่ในกลุ่มหลัก ${parts[0]}/ โดยตรง ไม่ได้อยู่ในโฟลเดอร์ความสามารถใด`,
    });
  }

  // ข้อ 1 — โฟลเดอร์ความสามารถต้องมีอยู่ก่อนไฟล์ ไม่ใช่สร้างไฟล์แล้วค่อยแก้ทีหลัง
  const capabilityFolder = parts.slice(0, 2).join("/");
  const abs = join(repoRoot, capabilityFolder);
  if (!existsSync(abs) || !statSync(abs).isDirectory()) {
    return base({
      verdict: "REJECT", rule_row: "CAPABILITY_WITHOUT_OWN_FOLDER",
      measured: `โฟลเดอร์ความสามารถ ${capabilityFolder}/ ยังไม่มีอยู่ — กฎข้อ 1 บังคับให้สร้างโฟลเดอร์ก่อนไฟล์`,
      evidence_ref: `${LAW}#ข้อ1`,
    });
  }

  return base({ measured: `อยู่ในโฟลเดอร์ความสามารถ ${capabilityFolder}/ ตามกฎข้อ 3` });
}
