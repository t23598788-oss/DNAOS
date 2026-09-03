/**
 * หน้าที่: เก็บแผนลงดิสก์ทุกครั้งที่มันเปลี่ยน เพื่อให้หน้าจออ่านความคืบหน้าจริง
 * ได้ระหว่างที่งานยังทำอยู่ ไม่ใช่ตอนจบ
 *
 * append-only แบบเดียวกับสโตร์อื่นในระบบ แถวหลังสุดของ plan_id คือสถานะปัจจุบัน
 * ประวัติระหว่างทางไม่ถูกลบ เพราะ "เมื่อกี้ระบบรู้อะไร" มีค่าพอกับ "ตอนนี้รู้อะไร"
 *
 * Input: PreExecutionPlan.
 * Output: savePlan, latestPlanFor, latestPlanForIdentity.
 * Dependency ที่อนุญาต: ./types.ts, node:fs, node:path.
 * สิ่งที่ห้ามแตะ: ห้ามลบแถวเก่า, ห้ามเขียนแผนที่ไม่มี step จริง.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PreExecutionPlan } from "./types";

const DIR = "control/pre-execution-planner/data";
const FILE = "plans.jsonl";

function file(): string {
  const dir = join(process.cwd(), DIR);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, FILE);
  if (!existsSync(path)) writeFileSync(path, "", { encoding: "utf8", mode: 0o600 });
  return path;
}

export function savePlan(plan: PreExecutionPlan): void {
  appendFileSync(file(), `${JSON.stringify(plan)}\n`, { encoding: "utf8", mode: 0o600 });
}

function allPlans(): PreExecutionPlan[] {
  const rows: PreExecutionPlan[] = [];
  for (const line of readFileSync(file(), "utf8").split("\n")) {
    if (line.trim() === "") continue;
    try { rows.push(JSON.parse(line) as PreExecutionPlan); } catch { /* ข้าม */ }
  }
  return rows;
}

/** แถวหลังสุดของ plan นั้น = สถานะปัจจุบัน */
export function latestPlanFor(commandId: string): PreExecutionPlan | null {
  return allPlans().filter((p) => p.command_id === commandId).at(-1) ?? null;
}

/** แผนล่าสุดโดยรวม — ใช้เมื่อหน้าจอยังไม่รู้ command_id */
export function latestPlan(): PreExecutionPlan | null {
  return allPlans().at(-1) ?? null;
}
