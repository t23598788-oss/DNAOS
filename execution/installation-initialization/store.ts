/**
 * หน้าที่: อ่านและสร้าง `initialization.json` ครั้งเดียว — ไม่ใช่ฐานข้อมูลทั่วไป
 *
 * ── การอ่านไม่มีผลข้างเคียงเด็ดขาด ──
 * การถามว่า "การติดตั้งนี้เริ่มต้นแล้วหรือยัง" ต้องไม่ทำให้มันเริ่มต้น ไม่สร้าง
 * ไดเรกทอรี ไม่สร้างไฟล์ ไม่แม้แต่แตะเวลาเข้าถึง การนำเข้าโมดูลนี้ก็เช่นกัน:
 * ไม่มีโค้ดระดับบนสุดที่ทำอะไรเลย
 *
 * ── สร้างได้ครั้งเดียว โดยเคอร์เนล ไม่ใช่โดยการเช็คก่อนเขียน ──
 * `openSync(path,"wx")` แปลเป็น `O_CREAT|O_EXCL` เคอร์เนลรับประกันว่ามีผู้สร้าง
 * สำเร็จรายเดียวข้ามโปรเซสจำนวนเท่าใดก็ตาม รูปแบบ `existsSync -> writeFile`
 * มีช่องว่างระหว่างการตรวจกับการเขียนที่ผู้เขียนสองรายลอดเข้าไปพร้อมกันได้
 *
 * ── ไม่มีทางเขียนทับ ลบ หรือตัดไฟล์ในไฟล์นี้ ──
 * ไม่มี update ไม่มี delete ไม่มี truncate ไม่มีการซ่อมในที่ ระเบียนที่เสียหาย
 * ถูกรายงานว่า CORRUPT และถูกทิ้งไว้เป็นหลักฐาน การลบมันทิ้งคือการลบสิ่งเดียวที่
 * บอกได้ว่าเคยเกิดอะไรขึ้น
 *
 * ── สิ่งที่ไฟล์นี้ไม่ทำ ──
 * ไม่สร้าง installation_id ไม่สร้าง initialization_id ไม่อ่านนาฬิกาเพื่อประกอบ
 * ระเบียน ไม่สร้าง Owner ไม่ออกสิทธิ์ใด และไม่ผูกเครื่อง — **การเก็บลงดิสก์
 * ไม่ใช่อำนาจ** ระเบียนที่ถูกคัดลอกมาจากเครื่องอื่นยังผ่านการตรวจได้ในวันนี้
 * ซึ่งเป็นข้อจำกัดที่ประกาศไว้แล้ว ไม่ใช่สิ่งที่ไฟล์นี้แอบแก้
 *
 * Input: `InstallationInitializationV1` ที่ประกอบเสร็จและถูกต้องแล้ว
 * Output: `readInstallationInitialization`, restricted create implementation
 * Dependency ที่อนุญาต: ../local-state-root/contract.ts,
 * ../../contracts/installation/installation-initialization.ts, node:fs, node:path
 * สิ่งที่ห้ามแตะ: ห้ามใส่ writeFileSync/unlinkSync/rmSync/truncate ในไฟล์นี้
 * ห้ามให้ความล้มเหลวใด ๆ คืนค่า UNINITIALIZED และห้ามสร้างไดเรกทอรีตอนอ่าน
 */

import { closeSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, writeSync } from "node:fs";
import { dirname, sep } from "node:path";
import { initializationFileOf, installationDirectoryOf, resolveLocalStateRoot, STATE_DIRECTORY_MODE, STATE_FILE_MODE } from "../local-state-root/contract";
import type { ResolvedLocalStateRootV1 } from "../local-state-root/contract";
import { validateInitializationRecord } from "../../contracts/installation/installation-initialization";
import type { InstallationInitializationV1 } from "../../contracts/installation/installation-initialization";
import type { CreateOutcome, ReadOutcome, StoreReasonCode } from "./types";

interface LocatedPath { readonly root: ResolvedLocalStateRootV1; readonly file: string }

/** resolve ราก + เส้นทางไฟล์ตอนเรียกทุกครั้ง — ไม่มีค่าใดถูกจับไว้ตอนโหลดโมดูล */
function locate(): LocatedPath | { readonly reason_code: StoreReasonCode; readonly detail: string } {
  const root = resolveLocalStateRoot();
  if (root.status === "UNRESOLVED") {
    return { reason_code: "STATE_ROOT_UNAVAILABLE", detail: `${root.reason_code}: ${root.detail}` };
  }
  if (root.status === "INELIGIBLE") {
    return { reason_code: "UNSAFE_PATH", detail: `${root.reason_code}: ${root.detail}` };
  }
  return { root, file: initializationFileOf(root) };
}

function errnoOf(error: unknown): string {
  return typeof error === "object" && error !== null && "code" in error ? String((error as { code: unknown }).code) : "";
}

/** map ความล้มเหลวของระบบไฟล์เป็นคำศัพท์ปิด — ห้ามปล่อยข้อความ exception ดิบออกไปเป็นสถานะ */
function ioReason(error: unknown): StoreReasonCode {
  const code = errnoOf(error);
  if (code === "EACCES" || code === "EPERM") return "PERMISSION_DENIED";
  return "IO_FAILURE";
}

/**
 * ตรวจว่าเส้นทางไฟล์ปลอดภัยก่อนอ่าน
 *
 * ไฟล์ที่เป็น symlink ถูกปฏิเสธเสมอ ไม่ว่าปลายทางจะไปที่ใด: ระเบียนที่ตัวตนของ
 * การติดตั้งขึ้นอยู่กับมัน ต้องเป็นไฟล์จริงในขอบเขตของตัวเอง ไม่ใช่ตัวชี้ที่ใคร
 * ก็เปลี่ยนปลายทางได้ทีหลัง
 */
function unsafePathReason(file: string, root: ResolvedLocalStateRootV1): string | null {
  let st: ReturnType<typeof lstatSync>;
  try { st = lstatSync(file); } catch { return null; } // ไม่มีอยู่ = ให้ผู้เรียกจัดการ
  if (st.isSymbolicLink()) return "เส้นทางมาตรฐานเป็น symlink — ตัวตนของการติดตั้งต้องไม่ขึ้นกับตัวชี้ที่เปลี่ยนปลายทางได้";
  if (!st.isFile()) return "เส้นทางมาตรฐานไม่ใช่ไฟล์ปกติ";
  try {
    const real = realpathSync(file);
    const stateRoot = realpathSync(root.state_root);
    if (real !== file || !real.startsWith(stateRoot.endsWith(sep) ? stateRoot : stateRoot + sep)) {
      return `เส้นทางจริง ${real} ออกนอกขอบเขตสถานะ ${stateRoot}`;
    }
  } catch (error) { return `พิสูจน์เส้นทางจริงไม่ได้: ${errnoOf(error)}`; }
  return null;
}

/**
 * อ่านสถานะการเริ่มต้นที่เก็บอยู่ — ไม่สร้างอะไรทั้งสิ้น
 *
 * ไฟล์ที่ parse ได้ยังไม่พอ: มันต้องผ่านสัญญา V1 ทั้งการตรวจรูป การ derive
 * `initialization_id` ใหม่ และ `record_digest` ก่อนจะถูกเรียกว่า INITIALIZED
 */
export function readInstallationInitialization(): ReadOutcome {
  const located = locate();
  if (!("file" in located)) return { state: "CORRUPT", reason_code: located.reason_code, detail: located.detail, path: null };
  const { file, root } = located;

  const unsafe = unsafePathReason(file, root);
  if (unsafe !== null) return { state: "CORRUPT", reason_code: "UNSAFE_PATH", detail: unsafe, path: file };

  let raw: string;
  try {
    raw = readFileSync(file, "utf-8");
  } catch (error) {
    // ENOENT เท่านั้นที่แปลว่า "ยังไม่ได้เริ่มต้น" ทุกความล้มเหลวอื่นล้มแบบปิด
    if (errnoOf(error) === "ENOENT") return { state: "UNINITIALIZED", path: file };
    return { state: "CORRUPT", reason_code: ioReason(error), detail: `อ่านไฟล์ไม่สำเร็จ: ${errnoOf(error)}`, path: file };
  }

  if (raw.trim().length === 0) {
    return { state: "CORRUPT", reason_code: "INVALID_JSON", detail: "ไฟล์ว่าง — มีไฟล์อยู่แต่ไม่มีระเบียน", path: file };
  }
  let parsed: unknown;
  try { parsed = JSON.parse(raw); }
  catch { return { state: "CORRUPT", reason_code: "INVALID_JSON", detail: "เนื้อหาไม่ใช่ JSON ที่สมบูรณ์ (อาจถูกเขียนค้าง)", path: file }; }

  const verdict = validateInitializationRecord(parsed);
  if (verdict.status === "CORRUPT") {
    const reason: StoreReasonCode = verdict.reason_code === "DIGEST_MISMATCH" ? "DIGEST_MISMATCH" : "INVALID_CONTRACT";
    return { state: "CORRUPT", reason_code: reason, detail: `${verdict.reason_code}: ${verdict.detail}`, path: file };
  }
  return { state: "INITIALIZED", initialization: verdict.record, path: file };
}

/** เทียบด้วยตัวตนเชิงความหมายของสัญญา ไม่ใช่ด้วยข้อความ JSON หรือลำดับคีย์ */
function sameInitialization(a: InstallationInitializationV1, b: InstallationInitializationV1): boolean {
  return a.initialization_id === b.initialization_id && a.record_digest === b.record_digest;
}

/**
 * สร้างระเบียนการเริ่มต้นหนึ่งใบ ครั้งเดียวตลอดกาล
 *
 * ระเบียนต้องถูกประกอบและตรวจสอบมาแล้วโดยผู้เรียก — ไฟล์นี้ไม่ประกอบระเบียนจาก
 * สภาพแวดล้อมของเครื่อง ไม่สุ่ม id และไม่อ่านนาฬิกา
 *
 * CREATED จะถูกคืนก็ต่อเมื่อเนื้อหาถูกเขียนครบ fsync แล้ว ปิดแล้ว อ่านกลับได้
 * และผ่านสัญญาอีกครั้ง — ไม่ประกาศว่าเริ่มต้นแล้วจากการที่ open สำเร็จ
 */
export function createInstallationInitializationFromCeremony(record: InstallationInitializationV1): CreateOutcome {
  const incoming = validateInitializationRecord(record);
  if (incoming.status === "CORRUPT") {
    return { result: "FAILED", reason_code: "INVALID_CONTRACT", detail: `ระเบียนที่ส่งเข้ามาไม่ผ่านสัญญา: ${incoming.reason_code}`, path: null };
  }

  const located = locate();
  if (!("file" in located)) return { result: "FAILED", reason_code: located.reason_code, detail: located.detail, path: null };
  const { file, root } = located;

  const before = readInstallationInitialization();
  if (before.state === "CORRUPT") return { result: "CORRUPT", reason_code: before.reason_code, detail: before.detail, path: before.path };
  if (before.state === "INITIALIZED") {
    return sameInitialization(before.initialization, incoming.record)
      ? { result: "REPLAY", initialization: before.initialization, path: file }
      : { result: "CONFLICT", existing: before.initialization, path: file,
          detail: `มีการเริ่มต้นที่ถูกต้องอยู่แล้ว (${before.initialization.initialization_id}) ต่างจากที่ขอ (${incoming.record.initialization_id}) — ไม่เขียนทับ` };
  }

  // ไดเรกทอรีถูกสร้างเฉพาะตรงนี้ ในเส้นทางสร้างที่ผู้เรียกสั่งอย่างชัดแจ้งเท่านั้น
  try { mkdirSync(installationDirectoryOf(root), { recursive: true, mode: STATE_DIRECTORY_MODE }); }
  catch (error) { return { result: "FAILED", reason_code: ioReason(error), detail: `สร้างไดเรกทอรีสถานะไม่สำเร็จ: ${errnoOf(error)}`, path: file }; }

  const serialized = `${JSON.stringify(incoming.record, null, 2)}\n`;
  let fd: number;
  try {
    fd = openSync(file, "wx", STATE_FILE_MODE); // O_CREAT|O_EXCL — เคอร์เนลเลือกผู้ชนะรายเดียว
  } catch (error) {
    if (errnoOf(error) === "EEXIST") {
      // แพ้การแข่งขันระหว่างการอ่านกับการสร้าง — อ่านซ้ำแล้วตัดสินจากของจริง
      const after = readInstallationInitialization();
      if (after.state === "INITIALIZED") {
        return sameInitialization(after.initialization, incoming.record)
          ? { result: "REPLAY", initialization: after.initialization, path: file }
          : { result: "CONFLICT", existing: after.initialization, path: file, detail: "ผู้เขียนอีกรายสร้างการเริ่มต้นที่ต่างออกไปก่อน — ไม่เขียนทับ" };
      }
      if (after.state === "CORRUPT") return { result: "CORRUPT", reason_code: after.reason_code, detail: after.detail, path: after.path };
      return { result: "FAILED", reason_code: "EXCLUSIVE_CREATE_LOST", detail: "ไฟล์มีอยู่ตอนสร้าง แต่หายไปตอนอ่านซ้ำ", path: file };
    }
    return { result: "FAILED", reason_code: ioReason(error), detail: `สร้างไฟล์แบบผูกขาดไม่สำเร็จ: ${errnoOf(error)}`, path: file };
  }

  try {
    writeSync(fd, serialized, 0, "utf-8");
    fsyncSync(fd); // ให้เนื้อหาลงดิสก์จริงก่อนประกาศว่าเริ่มต้นแล้ว
  } catch (error) {
    try { closeSync(fd); } catch { /* ปิดไม่ได้ก็ไม่ลบไฟล์ทิ้ง — ปล่อยให้เป็นหลักฐาน CORRUPT */ }
    return { result: "CORRUPT", reason_code: ioReason(error), detail: `เขียนไม่ครบหลังสร้างไฟล์แล้ว: ${errnoOf(error)} — ไม่ลบและไม่เขียนทับ`, path: file };
  }
  try { closeSync(fd); } catch (error) { return { result: "CORRUPT", reason_code: ioReason(error), detail: `ปิดไฟล์ไม่สำเร็จ: ${errnoOf(error)}`, path: file }; }

  // อ่านกลับจากดิสก์แล้วตรวจด้วยสัญญาอีกครั้ง — CREATED มาจากสิ่งที่อ่านได้จริง
  const readBack = readInstallationInitialization();
  if (readBack.state !== "INITIALIZED") {
    return readBack.state === "CORRUPT"
      ? { result: "CORRUPT", reason_code: readBack.reason_code, detail: `อ่านกลับหลังเขียนไม่ผ่าน: ${readBack.detail}`, path: readBack.path }
      : { result: "CORRUPT", reason_code: "IO_FAILURE", detail: "เขียนแล้วแต่อ่านกลับไม่พบไฟล์", path: file };
  }
  if (!sameInitialization(readBack.initialization, incoming.record)) {
    return { result: "CORRUPT", reason_code: "DIGEST_MISMATCH", detail: "สิ่งที่อ่านกลับได้ไม่ใช่ระเบียนที่เพิ่งเขียน", path: file };
  }
  return { result: "CREATED", initialization: readBack.initialization, path: file };
}

/** ตัวชี้ตำแหน่งสำหรับผู้ตรวจ — ไม่สร้างและไม่ตีความ */
export function initializationPath(): string | null {
  const located = locate();
  return "file" in located ? located.file : null;
}
