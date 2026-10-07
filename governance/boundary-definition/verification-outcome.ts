/**
 * R2 · ผลการพิสูจน์จริง — อ่านจากการรันที่เกิดขึ้นแล้ว ไม่ใช่จากการคาดว่าจะผ่าน
 * ไฟล์ที่ถูกกันไว้ไม่รัน (มีผลข้างเคียงนอกขอบเขตการตรวจ) ไม่นับเป็นผ่าน
 */
import { existsSync, readFileSync } from "node:fs";
import type { Cited } from "./source-evidence";
import { cite } from "./source-evidence";

const RUN = "governance/boundary-definition/data/verification-run.json";
interface Row { file: string; status: string; exit_code: number | null; duration_s?: number }
interface RunFile { ran: Row[]; not_run: { file: string; reason: string }[] }

let cached: RunFile | null = null;
function load(): RunFile | null {
  if (cached !== null) return cached;
  if (!existsSync(RUN)) return null;
  try { cached = JSON.parse(readFileSync(RUN, "utf8")) as RunFile; } catch { return null; }
  return cached;
}

export function verificationOutcome(evidenceFiles: readonly string[]): Cited<string> | null {
  const run = load();
  if (run === null || evidenceFiles.length === 0) return null;
  const ran = run.ran.filter((r) => evidenceFiles.includes(r.file));
  const skipped = run.not_run.filter((r) => evidenceFiles.includes(r.file));
  if (ran.length === 0) {
    if (skipped.length === 0) return null;
    return cite(`NOT_RUN — ${skipped.length} ไฟล์ถูกกันไว้ (${skipped[0].reason})`, `${RUN} not_run`);
  }
  const pass = ran.filter((r) => r.status === "PASS").length;
  const verdict = pass === ran.length && skipped.length === 0 ? "PASS" : pass === 0 ? "FAIL" : "PARTIAL";
  const detail = `${verdict} — รัน ${ran.length} ผ่าน ${pass}${skipped.length > 0 ? ` · กันไว้ ${skipped.length}` : ""}`;
  return cite(detail, `${RUN} · ${ran.map((r) => `${r.file}=${r.status}`).join(" · ").slice(0, 260)}`);
}

export function passFailCondition(method: string): Cited<string> | null {
  if (!method) return null;
  return cite(
    `PASS ก็ต่อเมื่อทุกไฟล์พิสูจน์ที่ทะเบียนชี้ไป จบด้วย exit code 0 และไม่มีไฟล์ใดถูกกันไว้ไม่รัน`,
    `นิยามจากวิธีพิสูจน์ที่พบจริง: ${method} · ตัดสินโดย ${RUN}`,
  );
}
