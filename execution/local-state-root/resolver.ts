/**
 * หน้าที่: resolve ว่าที่เก็บสถานะเฉพาะการติดตั้งอยู่ที่ path ไหน — และปฏิเสธ
 * ทุก path ที่ตกอยู่ในรีโป
 *
 * ── resolve ตอนเรียก ไม่ใช่ตอนโหลดโมดูล ──
 * ไม่ใช่ข้อควรระวังเชิงทฤษฎี: ระบบนี้เคยเสียหลักฐาน 187 แถวเพราะ path ถูกผูก
 * ตอน import แล้วเทสต์ที่ตั้ง env หลัง import ไปเขียนทับสโตร์จริง ที่นี่จึงอ่าน
 * HOME, env override และแพลตฟอร์ม **ทุกครั้งที่ถูกเรียก** ไม่มีค่าใดถูกจับไว้
 * ตอนโหลดไฟล์
 *
 * ── ล้มแบบปิด ไม่ใช่เตือนแล้วไปต่อ ──
 * path ที่ตกในรีโปคืนค่า INELIGIBLE เสมอ ไม่มีทางเลือกสำรองที่พาไปเก็บในรีโป
 * เพราะความล้มเหลวแบบนั้นเงียบสนิท: ระบบยังทำงานปกติ จนกระทั่งมีคน clone แล้ว
 * ได้ตัวตนของการติดตั้งติดไปด้วย
 *
 * ── ไม่สร้างอะไรเลย ──
 * ไม่มี mkdir ไม่มีการเขียนไฟล์ ไม่มี chmod การถามว่า "ควรเก็บที่ไหน" ต้อง
 * ตอบได้โดยไม่เปลี่ยนเครื่อง
 *
 * Input: `ResolveLocalStateRootInput`
 * Output: `resolveLocalStateRoot`, `installationDirectoryOf`,
 * `initializationFileOf`, `DNA_OS_STATE_ROOT_ENV`
 * Dependency ที่อนุญาต: ./types.ts, node:fs (อ่านอย่างเดียว), node:os, node:path
 * สิ่งที่ห้ามแตะ: ห้ามใส่ mkdir/writeFile/chmod ในไฟล์นี้ ห้ามให้ path ในรีโป
 * ผ่านได้ไม่ว่ากรณีใด และห้ามตีความเนื้อหาของไฟล์ที่ path ที่คืนออกไป
 */

import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import type {
  LocalStateRootV1, ResolveLocalStateRootInput, ResolvedLocalStateRootV1,
} from "./types";

export const DNA_OS_STATE_ROOT_ENV = "DNA_OS_STATE_ROOT";

/** ชื่อไดเรกทอรีตามธรรมเนียม macOS สำหรับข้อมูลแอปต่อผู้ใช้ที่ไม่ใช่ความลับ */
const MACOS_APPLICATION_SUPPORT = join("Library", "Application Support", "DNA OS");

/**
 * รากของซอร์สโดยปริยาย — คำนวณจากตำแหน่งไฟล์นี้ ไม่ใช่จาก `process.cwd()`
 *
 * cwd เปลี่ยนได้ตามที่ใครสักคนเรียกโปรแกรม ซึ่งเป็นข้อบกพร่องตระกูลเดียวกับ
 * การผูก path ตอนโหลดโมดูล ตำแหน่งของไฟล์นี้เทียบกับรากไม่เปลี่ยน
 */
function defaultSourceRoot(): string {
  return resolve(__dirname, "..", "..");
}

/**
 * resolve symlink เท่าที่ทำได้ โดยไม่สร้างอะไร
 *
 * path ปลายทางอาจยังไม่มีอยู่ (นั่นคือกรณีปกติก่อนการติดตั้ง) จึงไล่ขึ้นไปหา
 * บรรพบุรุษที่ใกล้ที่สุดที่มีอยู่จริง resolve symlink ตรงนั้น แล้วต่อส่วนที่
 * ยังไม่มีกลับเข้าไป — วิธีนี้ทำให้ symlink ที่ชี้กลับเข้ารีโปถูกจับได้ แม้
 * ปลายทางจะยังไม่ถูกสร้าง
 */
function realpathOfDeepestExisting(candidate: string): string | null {
  let current = resolve(candidate);
  const trailing: string[] = [];
  for (;;) {
    if (existsSync(current)) {
      try { return join(realpathSync(current), ...trailing.reverse()); }
      catch { return null; }
    }
    const parent = dirname(current);
    if (parent === current) return null; // ถึงรากแล้วยังไม่พบสิ่งที่มีอยู่จริง
    trailing.push(current.slice(parent.length + 1));
    current = parent;
  }
}

function isInside(child: string, parent: string): boolean {
  return child === parent || child.startsWith(parent.endsWith(sep) ? parent : parent + sep);
}

/**
 * ตอบว่าสถานะเฉพาะการติดตั้งควรอยู่ path ไหน
 *
 * ไม่มีการสร้าง ไม่มีการอ่านเนื้อหา และการมีอยู่ของไฟล์ใด ๆ ที่ path ที่คืนไป
 * **ไม่ถูกตีความที่นี่** — ไฟล์นี้ไม่รู้ว่าการติดตั้งเริ่มต้นแล้วหรือยัง
 */
export function resolveLocalStateRoot(input: ResolveLocalStateRootInput = {}): LocalStateRootV1 {
  const sourceRootRaw = input.source_root ?? defaultSourceRoot();
  const sourceRoot = realpathOfDeepestExisting(sourceRootRaw);
  if (sourceRoot === null) {
    return {
      status: "INELIGIBLE", reason_code: "SOURCE_ROOT_UNRESOLVABLE", candidate: "",
      detail: `resolve รากของซอร์สไม่ได้: ${sourceRootRaw} — ตัดสินการกันรีโปไม่ได้จึงปฏิเสธ`,
    };
  }

  const raw = process.env[DNA_OS_STATE_ROOT_ENV];
  const hasOverride = raw !== undefined;

  let candidateRaw: string;
  let origin: ResolvedLocalStateRootV1["origin"];
  const platform = input.platform ?? process.platform;

  if (hasOverride) {
    if (raw.trim().length === 0) {
      return {
        status: "INELIGIBLE", reason_code: "EMPTY_OVERRIDE", candidate: "",
        detail: `${DNA_OS_STATE_ROOT_ENV} ถูกตั้งเป็นค่าว่าง — การตั้งค่าที่ตั้งใจแต่ว่างเปล่าไม่ถูกตีความเป็น "ไม่ได้ตั้ง"`,
      };
    }
    if (!isAbsolute(raw)) {
      return {
        status: "INELIGIBLE", reason_code: "RELATIVE_OVERRIDE", candidate: raw,
        detail: `${DNA_OS_STATE_ROOT_ENV} ต้องเป็น absolute path — path สัมพัทธ์ขึ้นกับ cwd ซึ่งเปลี่ยนได้ตามผู้เรียก`,
      };
    }
    candidateRaw = raw;
    origin = "EXPLICIT_OVERRIDE";
  } else {
    // แพลตฟอร์มที่ยังพิสูจน์ไม่ได้ ต้องไม่ตกกลับไปเก็บในรีโป — ไม่มี path ให้คืน
    if (platform !== "darwin") {
      return {
        status: "UNRESOLVED", reason_code: "UNSUPPORTED_PLATFORM",
        detail: `ยังไม่มีค่าเริ่มต้นที่พิสูจน์แล้วสำหรับแพลตฟอร์ม "${platform}" — ตั้ง ${DNA_OS_STATE_ROOT_ENV} อย่างชัดแจ้ง`,
      };
    }
    const home = process.env.HOME ?? homedir(); // อ่านตอนเรียก ไม่ใช่ตอนโหลด
    if (typeof home !== "string" || home.length === 0 || !isAbsolute(home)) {
      return { status: "UNRESOLVED", reason_code: "HOME_UNRESOLVABLE", detail: "หาโฮมไดเรกทอรีของผู้ใช้ปัจจุบันไม่ได้" };
    }
    candidateRaw = join(home, MACOS_APPLICATION_SUPPORT);
    origin = "PLATFORM_DEFAULT";
  }

  const candidate = realpathOfDeepestExisting(candidateRaw);
  if (candidate === null) {
    return {
      status: "INELIGIBLE", reason_code: "CANDIDATE_UNRESOLVABLE", candidate: candidateRaw,
      detail: `resolve path ปลายทางไม่ได้: ${candidateRaw} — พิสูจน์ไม่ได้ว่าไม่ได้ชี้กลับเข้ารีโปจึงปฏิเสธ`,
    };
  }

  if (isInside(candidate, sourceRoot)) {
    return {
      status: "INELIGIBLE", reason_code: "INSIDE_SOURCE_ROOT", candidate,
      detail: `${candidate} อยู่ในรากของซอร์ส ${sourceRoot} — สถานะที่เก็บในรีโปจะถูก clone ไปพร้อมซอร์ส`,
    };
  }

  return { status: "RESOLVED", state_root: candidate, origin, platform, source_root: sourceRoot };
}

/** `<STATE_ROOT>/installation` — ตัวชี้ตำแหน่งเท่านั้น ไม่ถูกสร้างและไม่ถูกอ่าน */
export function installationDirectoryOf(root: ResolvedLocalStateRootV1): string {
  return join(root.state_root, "installation");
}

/**
 * `<STATE_ROOT>/installation/initialization.json` — ตัวชี้ตำแหน่งเท่านั้น
 *
 * รับเฉพาะ root ที่ผ่านการ resolve แล้ว: ชนิดข้อมูลกันไม่ให้คำนวณ path จาก root
 * ที่ถูกปฏิเสธ การมีอยู่ของไฟล์นี้ไม่ถูกตีความที่นี่ ผู้เขียนในอนาคตต้องสร้าง
 * ด้วย `openSync(path, "wx")` โดยตรง ไม่ใช่ผ่าน lease lock ที่ปล่อยได้
 */
export function initializationFileOf(root: ResolvedLocalStateRootV1): string {
  return join(installationDirectoryOf(root), "initialization.json");
}
