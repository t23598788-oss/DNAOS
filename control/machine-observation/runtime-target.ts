/**
 * หน้าที่: ตัวตนของ "สิ่งที่ผู้สังเกตต้องไปวัด" — `RuntimeObservationTarget`
 *
 * นี่ไม่ใช่การลงทะเบียนบริการ และไม่ใช่ทะเบียนของผู้ควบคุม: มันประกาศว่า
 * capability หนึ่งมีตัวตนตอนรันอยู่ตรงไหน (process ตัวไหน พอร์ตอะไร health
 * path อะไร) เพื่อให้ผู้สังเกตไม่ต้องเดาจากชื่อไฟล์หรือชื่อโปรเซสอีก
 *
 * ── OBSERVABLE ไม่ใช่ CONTROLLABLE ──
 * แยกกันที่ระดับ "ชนิดข้อมูล" ไม่ใช่ที่ if ปลายทาง: `authority` มีค่าเดียวที่
 * เป็นไปได้คือ `"OBSERVE_ONLY"` แบบนี้ไม่มีทางเขียนโค้ดที่อ่านฟิลด์นี้แล้วได้
 * สิทธิ์ start/stop/restart เพราะชนิดข้อมูลไม่มีค่าที่แปลว่าควบคุมได้เลย
 * ทะเบียนของผู้ควบคุมยังเป็น `control/runtime-control/#SERVICES` เหมือนเดิม
 * และไฟล์นี้ไม่แตะมัน ไม่อ่านมัน และไม่เพิ่มอะไรเข้าไป
 *
 * ── ทุกช่องเป็น optional โดยเจตนา ──
 * เป้าหมายจริงมีรูปร่างต่างกัน: บางตัวมี launchd บนเครื่องนี้ บางตัวมีแค่ URL
 * (Railway, Supabase, n8n) บางตัวมี provider resource id แทน การบังคับให้ทุก
 * เป้าหมายมี launchd จะทำให้ต้องกรอกค่าที่ไม่มีจริง — ซึ่งคือการโกหกในทะเบียน
 * ช่องที่ไม่มีคือ "ยังพิสูจน์ไม่ได้" ไม่ใช่ "ไม่มี" และผู้สังเกตจะรายงานว่าวัด
 * อะไรไม่ได้พร้อมเหตุผล
 *
 * Input: `DeclareRuntimeTargetInput`
 * Output: `declareRuntimeTarget`, `listRuntimeTargets`, `loadRuntimeTarget`,
 * `targetsForCapability`, `RuntimeObservationTarget`
 * Dependency ที่อนุญาต: node:fs, node:path, node:crypto
 * สิ่งที่ห้ามแตะ: ห้ามเพิ่มค่าอื่นให้ `authority` ห้าม import
 * `control/runtime-control/` จากไฟล์นี้ และห้ามใส่ความสามารถสั่งงานใด ๆ
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";

/**
 * ค่าเดียวที่เป็นไปได้ ไม่ใช่ค่าเริ่มต้นของ union ที่มีค่าอื่น — การเพิ่มค่าที่
 * แปลว่าควบคุมได้ ต้องเป็นการแก้ชนิดข้อมูลอย่างจงใจ ซึ่งเห็นได้ใน diff
 */
export type ObservationAuthority = "OBSERVE_ONLY";

export interface RuntimeTargetProcess {
  /** ป้าย launchd บนเครื่องนี้ เมื่อเป้าหมายเป็นบริการที่ launchd ดูแล */
  readonly launchd_label?: string | null;
  /** สตริงที่ต้องพบใน argv เมื่อระบุตัวโปรเซสด้วยพอร์ตไม่ได้ */
  readonly argv_contains?: string | null;
}

export interface RuntimeTargetNetwork {
  readonly host: string;
  readonly port: number;
}

export interface RuntimeTargetHealth {
  readonly path: string;
  readonly expected_status: number;
}

export interface RuntimeObservationTarget {
  readonly runtime_target_id: string;
  readonly capability_id: string;
  /** ชื่อที่คนใช้เรียก — ใช้ค้นได้ แต่ไม่ใช่ตัวตน */
  readonly canonical_name: string;
  readonly process?: RuntimeTargetProcess | null;
  readonly network?: RuntimeTargetNetwork | null;
  readonly health?: RuntimeTargetHealth | null;
  readonly authority: ObservationAuthority;
  readonly declared_at: string;
  /** ทำไมถึงประกาศแบบนี้ — หลักฐานที่พิสูจน์ค่าแต่ละช่อง */
  readonly evidence_refs: readonly string[];
}

export type DeclareRuntimeTargetInput = Omit<RuntimeObservationTarget, "runtime_target_id" | "authority" | "declared_at">;

function targetFile(): string {
  return process.env.RUNTIME_TARGET_STORE
    ?? join(__dirname, "data", "runtime-targets.jsonl");
}

export function listRuntimeTargets(): readonly RuntimeObservationTarget[] {
  const p = targetFile();
  if (!existsSync(p)) return [];
  const rows: RuntimeObservationTarget[] = [];
  for (const line of readFileSync(p, "utf-8").split("\n")) {
    if (!line.trim()) continue;
    try { rows.push(JSON.parse(line) as RuntimeObservationTarget); } catch { /* แถวเสียข้ามไป ไม่ลบ */ }
  }
  return rows;
}

export function loadRuntimeTarget(runtimeTargetId: string): RuntimeObservationTarget | null {
  return listRuntimeTargets().filter((t) => t.runtime_target_id === runtimeTargetId).at(-1) ?? null;
}

/** ค้นด้วย capability_id — ตัวตน ไม่ใช่ชื่อ */
export function targetsForCapability(capabilityId: string): readonly RuntimeObservationTarget[] {
  const latest = new Map<string, RuntimeObservationTarget>();
  for (const t of listRuntimeTargets()) if (t.capability_id === capabilityId) latest.set(t.runtime_target_id, t);
  return [...latest.values()];
}

export type DeclareOutcome =
  | { readonly ok: true; readonly target: RuntimeObservationTarget }
  | { readonly ok: false; readonly reason_code: "NOTHING_OBSERVABLE" | "AMBIGUOUS_EXISTING"; readonly detail: string };

/**
 * ประกาศเป้าหมายหนึ่งตัว
 *
 * ปฏิเสธเมื่อไม่มีช่องใดที่วัดได้เลย — เป้าหมายที่ไม่มีทั้ง process ทั้ง network
 * และทั้ง health ไม่ใช่เป้าหมายของการสังเกต มันคือแถวว่างที่จะทำให้กราฟดูสมบูรณ์
 * ทั้งที่ไม่มีอะไรให้วัด
 */
export function declareRuntimeTarget(input: DeclareRuntimeTargetInput): DeclareOutcome {
  const hasProcess = Boolean(input.process?.launchd_label || input.process?.argv_contains);
  const hasNetwork = Boolean(input.network?.port);
  const hasHealth = Boolean(input.health?.path);
  if (!hasProcess && !hasNetwork && !hasHealth) {
    return { ok: false, reason_code: "NOTHING_OBSERVABLE", detail: `capability ${input.capability_id} ไม่มีช่องใดที่วัดได้ — ไม่ประกาศแถวว่าง` };
  }

  const existing = targetsForCapability(input.capability_id);
  if (existing.length > 1) {
    return { ok: false, reason_code: "AMBIGUOUS_EXISTING", detail: `capability ${input.capability_id} มีเป้าหมายที่ประกาศไว้แล้ว ${existing.length} รายการ — ไม่เพิ่มซ้ำโดยไม่ตัดสิน` };
  }

  const target: RuntimeObservationTarget = {
    runtime_target_id: existing[0]?.runtime_target_id ?? `rt-${randomUUID()}`,
    capability_id: input.capability_id,
    canonical_name: input.canonical_name,
    process: input.process ?? null,
    network: input.network ?? null,
    health: input.health ?? null,
    authority: "OBSERVE_ONLY",
    declared_at: new Date().toISOString(),
    evidence_refs: input.evidence_refs,
  };
  const p = targetFile();
  mkdirSync(dirname(p), { recursive: true });
  appendFileSync(p, `${JSON.stringify(target)}\n`, "utf-8");
  return { ok: true, target };
}
