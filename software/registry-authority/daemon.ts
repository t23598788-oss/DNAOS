/**
 * ผู้มีอำนาจเขียนทะเบียน — ตัวเดียวในระบบที่เขียน canonical registry ได้
 *
 * ออกแบบให้ทำได้อย่างเดียว: ต่อท้ายแถวลงตารางที่อนุญาต
 * ไม่มีอินเทอร์เฟซรันคำสั่ง ไม่มีอินเทอร์เฟซเขียน path ตามใจ ไม่มีการลบไฟล์
 * ปลายทางเป็นค่าคงที่ในไฟล์นี้ คำขอกำหนดปลายทางไม่ได้
 *
 * ของจริงรันเป็น LaunchDaemon ในนาม root และ canonical dir เป็นของ root
 * ทำให้โปรเซสในนาม tam เขียนตรงไม่ได้ แต่ยังขอผ่านที่พักคำขอได้
 */
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { validateAuthorityRequest } from "./protocol";
import type { AuthorityResult } from "./protocol";

export interface DaemonPaths {
  /** โฟลเดอร์ข้อมูลจริง — ของ root ในการติดตั้งจริง */
  readonly canonicalDir: string;
  /** ที่พักคำขอ — tam วางคำขอได้ แต่แก้ผลลัพธ์ไม่ได้ */
  readonly spoolDir: string;
}

const nowIso = (): string => new Date().toISOString();

function writeResult(paths: DaemonPaths, result: AuthorityResult): void {
  const dir = join(paths.spoolDir, "results");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${result.request_id}.json`), JSON.stringify(result));
}

/** ประมวลผลคำขอที่ค้างอยู่หนึ่งรอบ — คืนจำนวนที่จัดการไป */
export function drainOnce(paths: DaemonPaths): { applied: number; rejected: number } {
  const inbox = join(paths.spoolDir, "inbox");
  const done = join(paths.spoolDir, "processed");
  for (const d of [inbox, done, paths.canonicalDir]) if (!existsSync(d)) mkdirSync(d, { recursive: true });

  let applied = 0, rejected = 0;
  for (const name of readdirSync(inbox).sort()) {
    if (!name.endsWith(".json")) continue;
    const file = join(inbox, name);
    let raw: unknown = null;
    try { raw = JSON.parse(readFileSync(file, "utf8")); } catch { raw = null; }

    const v = validateAuthorityRequest(raw);
    if (v.ok === false) {
      rejected++;
      const id = (raw as { request_id?: unknown } | null)?.request_id;
      writeResult(paths, {
        request_id: typeof id === "string" ? id : name.replace(/\.json$/, ""),
        status: "REJECTED", reason_code: v.reason_code, decided_at: nowIso(),
      });
      renameSync(file, join(done, name));
      continue;
    }

    // ปลายทางถูกประกอบจากค่าคงที่ + ชื่อตารางที่ผ่าน allowlist แล้วเท่านั้น
    const target = join(paths.canonicalDir, `${v.request.table}.jsonl`);
    try {
      appendFileSync(target, `${JSON.stringify(v.request.row)}\n`);
      applied++;
      writeResult(paths, { request_id: v.request.request_id, status: "APPLIED", reason_code: null, decided_at: nowIso() });
    } catch (error) {
      rejected++;
      writeResult(paths, {
        request_id: v.request.request_id, status: "REJECTED",
        reason_code: `WRITE_FAILED: ${error instanceof Error ? error.message : String(error)}`.slice(0, 120),
        decided_at: nowIso(),
      });
    }
    renameSync(file, join(done, name));
  }
  return { applied, rejected };
}
