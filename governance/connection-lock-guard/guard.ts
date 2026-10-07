/**
 * หน้าที่: ล็อกสิ่งที่พิสูจน์แล้วสามอย่างไม่ให้ถูกเปลี่ยนโดยงานทั่วไป —
 * คำศัพท์ความสัมพันธ์ของทะเบียน และบันทึกการล็อกการเชื่อมต่อ
 *
 * ล็อกแบบ "ตรวจพบการเปลี่ยน" ไม่ใช่ "ห้ามเขียนไฟล์": ไฟล์เหล่านี้ยังเป็นของ
 * เจ้าของเดิมและยังแก้ได้เมื่อ Owner ตั้งใจ สิ่งที่ล็อกทำคือทำให้การเปลี่ยน
 * **เงียบ ๆ** เป็นไปไม่ได้ — งานทั่วไปที่ไปแตะจะทำให้ชุดทดสอบล้มทันทีพร้อมบอก
 * ว่าเปลี่ยนบล็อกไหน การจะผ่านได้ต้องรีเบสไลน์อย่างจงใจ ซึ่งเป็นการกระทำที่
 * เห็นได้ใน diff
 *
 * แฮชเฉพาะ "บล็อกที่ถูกล็อก" ไม่ใช่ทั้งไฟล์: ไฟล์เหล่านี้มีของอย่างอื่นอยู่ด้วย
 * การแฮชทั้งไฟล์จะเตือนผิดทุกครั้งที่มีคนแก้เรื่องที่ไม่เกี่ยวกัน ซึ่งจะทำให้
 * คนเลิกเชื่อสัญญาณนี้ในที่สุด
 *
 * Input: (none) — อ่านไฟล์จริงในทรี
 * Output: `verifyConnectionLocks`, `computeLockState`, `LOCKED_REGIONS`
 * Dependency ที่อนุญาต: node:fs, node:path, node:crypto
 * สิ่งที่ห้ามแตะ: ห้ามให้ไฟล์นี้แก้ไฟล์ที่มันตรวจ และห้ามอัปเดต lock.json
 * โดยอัตโนมัติ — การรีเบสไลน์ต้องเป็นคำสั่งที่คนตั้งใจสั่ง
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const REPO = join(__dirname, "..", "..");

export interface LockedRegion {
  readonly region_id: string;
  readonly file: string;
  /** บรรทัดเริ่มต้นที่ต้องเจอ (ตรงตัว) — ถ้าหาไม่เจอ ถือว่าโครงสร้างถูกรื้อ */
  readonly start_marker: string;
  /** บรรทัดปิดของบล็อก นับจาก start_marker เป็นต้นไป */
  readonly end_marker: string;
  readonly why: string;
}

export const LOCKED_REGIONS: readonly LockedRegion[] = [
  {
    region_id: "registry-relationship-kind-union",
    file: "software/registry-database/types.ts",
    start_marker: "export type RelationshipKind =",
    end_marker: '| "ROUTE_RESULT_TO_EXECUTOR_DISPATCH";',
    why: "คำศัพท์ความสัมพันธ์เป็นชุดปิดของ system-truth owner — การเพิ่มค่าโดยไม่ตั้งใจทำให้ขอบที่ยังไม่พิสูจน์ถูกบันทึกเป็นความจริงของระบบ",
  },
  {
    region_id: "registry-valid-relationship-kinds",
    file: "software/registry-database/registry-writer.ts",
    start_marker: "const VALID_RELATIONSHIP_KINDS: ReadonlySet<string> = new Set<RelationshipKind>([",
    end_marker: "]);",
    why: "ประตูที่ปฏิเสธ relationship_kind ที่ไม่รู้จัก — ถ้าถูกผ่อน ทะเบียนจะรับขอบอะไรก็ได้",
  },
  {
    region_id: "registry-chain-relationship-kinds",
    file: "software/registry-database/registry-writer.ts",
    start_marker: "const CHAIN_RELATIONSHIP_KINDS: ReadonlySet<string> = new Set<RelationshipKind>([",
    end_marker: "]);",
    why: "ชุดที่บังคับว่า target ต้องเป็น capability ที่ลงทะเบียนจริง — ถ้าขอบใหม่หลุดออกจากชุดนี้ จะชี้ไปหาสิ่งที่ไม่มีอยู่ได้",
  },
  {
    region_id: "observation-authority-type",
    file: "control/machine-observation/runtime-target.ts",
    start_marker: "ค่าเดียวที่เป็นไปได้ ไม่ใช่ค่าเริ่มต้นของ union",
    end_marker: 'export type ObservationAuthority = "OBSERVE_ONLY";',
    why: "ชนิดข้อมูลที่แยก OBSERVABLE ออกจาก CONTROLLABLE — การเพิ่มค่าที่แปลว่าควบคุมได้ จะทำให้คำถามสถานะกลายเป็นสิทธิ์สั่งงานบริการโดยไม่มีใครเห็น",
  },
  {
    region_id: "route-executor-bindings",
    file: "control/owner-backbone/route-dispatch.ts",
    start_marker: "export const EXECUTOR_BINDINGS: readonly ExecutorBinding[] = [",
    end_marker: "];",
    why: "ตารางเดียวที่แปลง route -> executor จริง การเพิ่มแถวคือการมอบอำนาจสั่งงานให้เส้นทางใหม่ และการเปลี่ยน execution_enabled คือการเปิดสิ่งที่ Owner ยังไม่อนุมัติ",
  },
];

/** ไฟล์บันทึกการล็อกการเชื่อมต่อ — แฮชทั้งไฟล์ เพราะทุกแถวคือความจริงที่ล็อกไว้ */
export const LOCKED_FILES: readonly { readonly file_id: string; readonly file: string; readonly why: string }[] = [
  {
    file_id: "connection-locks",
    file: "control/owner-backbone/data/connection-locks.jsonl",
    why: "บันทึกที่ทำให้ประกอบการเชื่อมต่อกลับได้โดยไม่ต้องเดา source — การแก้ย้อนหลังคือการเขียนประวัติใหม่",
  },
];

function extractRegion(region: LockedRegion): { ok: true; text: string } | { ok: false; reason: string } {
  const p = join(REPO, region.file);
  if (!existsSync(p)) return { ok: false, reason: `FILE_MISSING: ${region.file}` };
  const lines = readFileSync(p, "utf-8").split("\n");
  const start = lines.findIndex((l) => l.trimEnd() === region.start_marker || l.includes(region.start_marker));
  if (start === -1) return { ok: false, reason: `START_MARKER_NOT_FOUND: ${region.region_id}` };
  for (let i = start + 1; i < lines.length; i += 1) {
    if (lines[i].trim() === region.end_marker.trim()) {
      return { ok: true, text: lines.slice(start, i + 1).join("\n") };
    }
  }
  return { ok: false, reason: `END_MARKER_NOT_FOUND: ${region.region_id}` };
}

const sha = (text: string): string => createHash("sha256").update(text).digest("hex");

export interface LockEntry { readonly id: string; readonly kind: "REGION" | "FILE"; readonly digest: string | null; readonly problem: string | null }

/** อ่านสถานะปัจจุบันของทุกสิ่งที่ถูกล็อก — ไม่เปรียบเทียบ ไม่ตัดสิน */
export function computeLockState(): readonly LockEntry[] {
  const entries: LockEntry[] = [];
  for (const region of LOCKED_REGIONS) {
    const extracted = extractRegion(region);
    entries.push(extracted.ok
      ? { id: region.region_id, kind: "REGION", digest: sha(extracted.text), problem: null }
      : { id: region.region_id, kind: "REGION", digest: null, problem: extracted.reason });
  }
  for (const f of LOCKED_FILES) {
    const p = join(REPO, f.file);
    entries.push(existsSync(p)
      ? { id: f.file_id, kind: "FILE", digest: sha(readFileSync(p, "utf-8")), problem: null }
      : { id: f.file_id, kind: "FILE", digest: null, problem: `FILE_MISSING: ${f.file}` });
  }
  return entries;
}

export interface LockBaseline { readonly locked_at: string; readonly entries: Readonly<Record<string, string>> }

export function loadBaseline(): LockBaseline | null {
  const p = join(__dirname, "lock.json");
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, "utf-8")) as LockBaseline; } catch { return null; }
}

export type LockVerdict =
  | { readonly ok: true; readonly checked: number; readonly locked_at: string }
  | { readonly ok: false; readonly reason_code: "NO_BASELINE" | "DRIFT" | "UNREADABLE"; readonly drifted: readonly { readonly id: string; readonly expected: string; readonly actual: string | null; readonly why: string }[]; readonly detail: string };

/**
 * เทียบสถานะปัจจุบันกับเส้นฐาน
 *
 * ค่าที่หายไปจากเส้นฐาน (id ใหม่) ถือว่า DRIFT เช่นกัน — การเพิ่มบล็อกที่ถูกล็อก
 * โดยไม่รีเบสไลน์ก็คือการเปลี่ยนขอบเขตการล็อกอย่างเงียบ ๆ
 */
export function verifyConnectionLocks(): LockVerdict {
  const baseline = loadBaseline();
  if (!baseline) return { ok: false, reason_code: "NO_BASELINE", drifted: [], detail: "ไม่พบ governance/connection-lock-guard/lock.json" };

  const whyOf = (id: string): string =>
    LOCKED_REGIONS.find((r) => r.region_id === id)?.why ?? LOCKED_FILES.find((f) => f.file_id === id)?.why ?? "";

  const current = computeLockState();
  const drifted: { id: string; expected: string; actual: string | null; why: string }[] = [];
  for (const entry of current) {
    const expected = baseline.entries[entry.id];
    if (expected === undefined) { drifted.push({ id: entry.id, expected: "(ไม่มีในเส้นฐาน)", actual: entry.digest, why: whyOf(entry.id) }); continue; }
    if (entry.digest !== expected) drifted.push({ id: entry.id, expected, actual: entry.digest, why: whyOf(entry.id) });
  }
  for (const id of Object.keys(baseline.entries)) {
    if (!current.some((e) => e.id === id)) drifted.push({ id, expected: baseline.entries[id], actual: null, why: whyOf(id) });
  }

  if (drifted.length > 0) {
    return { ok: false, reason_code: "DRIFT", drifted, detail: `${drifted.length} บล็อกที่ถูกล็อกเปลี่ยนไปจากเส้นฐาน` };
  }
  return { ok: true, checked: current.length, locked_at: baseline.locked_at };
}
