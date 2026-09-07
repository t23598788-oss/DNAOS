/**
 * หน้าที่: DNA OS คำนวณ "ขอบเขตที่เล็กที่สุดที่พอ" ก่อนส่งงานให้ Agent และ
 * เก็บใบอนุญาตนั้นไว้ให้ด่านเขียนไฟล์ตรวจได้
 *
 * Owner, 2026-09-05: ห้าม Agent full-scan เพื่อหาเป้า และห้าม Agent ขยาย scope
 * เอง แผนที่จึงเป็นผู้ตอบว่าไฟล์ไหนเกี่ยวข้อง ไม่ใช่การค้นทั้งรีโปทุกครั้ง
 * ถ้าแผนที่ตอบไม่ได้ ผลคือ SCOPE_UNRESOLVED และต้องปฏิเสธการรัน ไม่ใช่ถอย
 * ไปสแกนทั้งรีโป
 *
 * ใบอนุญาตผูกกับ correlation_id เพราะนั่นคือคีย์ที่ FileWriteRequest ถืออยู่
 * แล้วจริง (execution/file-write/types.ts) ไม่ต้องเปลี่ยนสัญญาของด่านเขียน
 *
 * Input: เจตนาของ Owner (route/element) และคีย์งาน
 * Output: ScopeGrant ที่บันทึกลง ./data/scope-grants.jsonl
 * Dependency ที่อนุญาต: ./surface-map.ts, node built-ins
 * สิ่งที่ห้ามแตะ:
 * - ห้ามให้ผู้เรียกส่ง allowed_files เข้ามาเอง ต้องมาจากแผนที่
 * - ห้ามคืน scope ที่ resolve ไม่ได้เป็น "อนุญาตทั้งหมด"
 * - ห้ามลบแถวใบอนุญาต — ปิดด้วยการ append แถวปิด
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { findSurface, surfacesWithElement, type SurfaceSpec } from "./surface-map";

const HERE = dirname(fileURLToPath(import.meta.url));
export const SCOPE_FILE: string = join(HERE, "data", "scope-grants.jsonl");

export interface ScopeGrant {
  readonly scope_id: string;
  readonly correlation_id: string;
  readonly work_id: string | null;
  readonly task_id: string | null;
  readonly intent: string;
  readonly target_routes: readonly string[];
  readonly target_elements: readonly string[];
  readonly allowed_files: readonly string[];
  readonly required_verifiers: readonly string[];
  readonly expected_effect: string;
  readonly granted_at: string;
  readonly closed: boolean;
}

export type ScopeResolution =
  | { readonly status: "RESOLVED"; readonly grant: ScopeGrant }
  | { readonly status: "SCOPE_UNRESOLVED"; readonly reason: string };

export interface ScopeIntent {
  readonly correlation_id: string;
  readonly work_id: string | null;
  readonly task_id: string | null;
  readonly intent: string;
  /** route ที่เจตนาแตะ ถ้ารู้ */
  readonly route?: string;
  /** element ที่เจตนาแตะ ถ้ารู้ — ใช้หา route เองจากแผนที่ */
  readonly element_id?: string;
}

/**
 * แปลงเจตนาเป็นขอบเขต ไม่มีการค้นรีโป มีแต่การเปิดแผนที่
 * ระบุไม่ได้ทั้ง route และ element = ตอบไม่ได้ ไม่ใช่ให้ทั้งหมด
 */
export function resolveScope(intent: ScopeIntent): ScopeResolution {
  let surfaces: readonly SurfaceSpec[] = [];
  if (intent.route) {
    const s = findSurface(intent.route);
    if (!s) return { status: "SCOPE_UNRESOLVED", reason: `route "${intent.route}" ไม่อยู่ในแผนที่พื้นผิว` };
    surfaces = [s];
  } else if (intent.element_id) {
    surfaces = surfacesWithElement(intent.element_id);
    if (surfaces.length === 0) return { status: "SCOPE_UNRESOLVED", reason: `element "${intent.element_id}" ไม่อยู่ในแผนที่พื้นผิว` };
  } else {
    return { status: "SCOPE_UNRESOLVED", reason: "เจตนาไม่ได้ระบุ route หรือ element — แผนที่หาเป้าไม่ได้ และห้ามถอยไปสแกนทั้งรีโป" };
  }

  const allowed = [...new Set(surfaces.flatMap((s) =>
    intent.element_id
      ? s.elements.filter((e) => e.element_id === intent.element_id).map((e) => e.owner_file)
      : s.owner_files))];
  if (allowed.length === 0) return { status: "SCOPE_UNRESOLVED", reason: "แผนที่หาไฟล์เจ้าของของเป้านี้ไม่ได้" };

  const grant: ScopeGrant = {
    scope_id: `scope-${randomUUID()}`,
    correlation_id: intent.correlation_id, work_id: intent.work_id, task_id: intent.task_id,
    intent: intent.intent,
    target_routes: surfaces.map((s) => s.route),
    target_elements: intent.element_id ? [intent.element_id] : surfaces.flatMap((s) => s.elements.map((e) => e.element_id)),
    allowed_files: allowed,
    required_verifiers: [...new Set(surfaces.map((s) => s.verification_profile))],
    expected_effect: `เปลี่ยนเฉพาะ ${allowed.length} ไฟล์ที่เป็นเจ้าของเป้าหมาย โดยไม่แตะไฟล์อื่น`,
    granted_at: new Date().toISOString(), closed: false,
  };
  record(grant);
  return { status: "RESOLVED", grant };
}

function record(grant: ScopeGrant): void {
  mkdirSync(dirname(SCOPE_FILE), { recursive: true });
  appendFileSync(SCOPE_FILE, `${JSON.stringify(grant)}\n`, "utf-8");
}

/** ใบอนุญาตที่ยังเปิดอยู่ของ correlation นี้ — แถวหลังชนะ */
export function activeScopeFor(correlationId: string): ScopeGrant | null {
  if (!existsSync(SCOPE_FILE)) return null;
  let found: ScopeGrant | null = null;
  for (const line of readFileSync(SCOPE_FILE, "utf-8").split("\n")) {
    if (line.trim() === "") continue;
    try {
      const row = JSON.parse(line) as ScopeGrant;
      if (row.correlation_id === correlationId) found = row;
    } catch { /* แถวเสียหนึ่งแถวไม่ทำให้ใบอนุญาตทั้งไฟล์ใช้ไม่ได้ */ }
  }
  return found !== null && !found.closed ? found : null;
}

export function closeScope(grant: ScopeGrant): void {
  record({ ...grant, closed: true, granted_at: new Date().toISOString() });
}

/** เป้าหมายนี้อยู่ในขอบเขตไหม — เทียบ path ตรง ๆ ไม่มีการอนุมาน */
export function pathInScope(grant: ScopeGrant, targetPath: string): boolean {
  return grant.allowed_files.some((f) => f === targetPath || f.endsWith(`/${targetPath}`) || targetPath.endsWith(f));
}
