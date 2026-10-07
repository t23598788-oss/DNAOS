/**
 * หน้าที่: เก็บ profile ลงดิสก์แบบ append-only และอ่านกลับ — คีย์ด้วย resource_id
 * ที่ทะเบียน canonical ออกให้ ไม่ใช่ id ของตัวเอง (Owner, LOCKED PRINCIPLE).
 *
 * ไม่มีบรรทัดใดในไฟล์นี้เปิดไฟล์ใน data/canonical/ เพื่อเขียน — แบบเดียวกับ
 * control/durable-meaning/ ถ้าไฟล์ของชั้นนี้หายไป ตัวตนของ resource ยังอยู่ครบ
 *
 * append-only เพราะสถานะความรู้เปลี่ยนตามเวลา และการรู้ว่า "เมื่อวานเรารู้อะไร"
 * มีค่าเท่ากับการรู้ว่าวันนี้รู้อะไร — แถวหลังสุดของ resource_id หนึ่งคือสถานะปัจจุบัน
 *
 * Input: ExecutionProfile[].
 * Output: writeProfiles, readProfiles, latestProfileFor.
 * Dependency ที่อนุญาต: ./types.ts, node:fs, node:path.
 * สิ่งที่ห้ามแตะ: ห้ามเขียนลง data/canonical/, ห้ามลบแถวเก่า, ห้ามเก็บ secret.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ExecutionProfile } from "./types";

const DATA_DIR = "software/execution-profile/data";
const FILE = "execution-profiles.jsonl";

function file(): string {
  const dir = join(process.cwd(), DATA_DIR);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, FILE);
  if (!existsSync(path)) writeFileSync(path, "", { encoding: "utf8", mode: 0o600 });
  return path;
}

export function writeProfiles(profiles: readonly ExecutionProfile[]): number {
  const path = file();
  for (const profile of profiles) appendFileSync(path, `${JSON.stringify(profile)}\n`, { encoding: "utf8", mode: 0o600 });
  return profiles.length;
}

export function readProfiles(): readonly ExecutionProfile[] {
  const rows: ExecutionProfile[] = [];
  for (const line of readFileSync(file(), "utf8").split("\n")) {
    if (line.trim() === "") continue;
    try { rows.push(JSON.parse(line) as ExecutionProfile); } catch { /* แถวเสียข้ามไป ไม่ลบ */ }
  }
  return rows;
}

/** แถวหลังสุดของแต่ละ resource_id คือสถานะปัจจุบัน */
export function latestProfiles(): readonly ExecutionProfile[] {
  const latest = new Map<string, ExecutionProfile>();
  for (const profile of readProfiles()) latest.set(profile.resource_id, profile);
  return [...latest.values()];
}

export function latestProfileFor(resourceId: string): ExecutionProfile | null {
  return latestProfiles().find((p) => p.resource_id === resourceId) ?? null;
}
