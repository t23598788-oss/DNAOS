/**
 * หน้าที่: DNA OS เลือกผู้ตรวจเอง — จำแนกชนิดการเปลี่ยนแปลงจาก path แล้วหา
 * verifier ที่ลงทะเบียนไว้จริงในทะเบียนกลาง
 *
 * Owner, 2026-09-05: "ห้าม Agent เลือก verifier เอง … capability -> registry
 * lookup -> eligibility -> availability -> verifier selection" ที่นี่จึงไม่รับ
 * ชื่อ verifier จากผู้เรียกเลย ผู้เรียกส่งได้แค่ "ไฟล์อะไรเปลี่ยน" ที่เหลือ
 * ตัดสินจากกฎ path กับสถานะจริงในทะเบียน
 *
 * Input: รายการ path ที่เปลี่ยน
 * Output: VerifierSelection — ชนิดการเปลี่ยนแปลง และ verifier ที่ใช้ได้จริง
 * Dependency ที่อนุญาต: ../ui-render-verification/contract.ts (assessUiImpact),
 * node built-ins สำหรับอ่านทะเบียน
 * สิ่งที่ห้ามแตะ:
 * - ห้ามรับ verifier_id จากผู้เรียก
 * - ห้ามคืน verifier ที่สถานะในทะเบียนไม่ใช่ REGISTERED
 * - ห้ามเดาว่า "ไม่มีในทะเบียน" แปลว่า "ใช้ได้"
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assessUiImpact } from "../ui-render-verification/contract";

const REGISTRY_DIR = join(process.cwd(), "software/registry-database/data/canonical");

export type ChangeClass = "UI_SURFACE" | "SOURCE_CODE" | "NO_IMPACT" | "UNRESOLVED";

export interface VerifierSelection {
  readonly change_class: ChangeClass;
  readonly verifier_id: string | null;
  readonly registered: boolean;
  readonly available: boolean;
  readonly routes: readonly string[];
  readonly reason: string;
}

/** อ่านทะเบียนแบบแถวหลังชนะ — แถวเก่าที่ถูกแทนแล้วต้องไม่ถูกนับ */
function registeredCapabilityNames(): ReadonlySet<string> {
  const names = new Map<string, string>();
  try {
    for (const line of readFileSync(join(REGISTRY_DIR, "capabilities.jsonl"), "utf-8").split("\n")) {
      if (line.trim() === "") continue;
      try {
        const row = JSON.parse(line) as { capability_id?: string; canonical_name?: string; status?: string };
        if (row.capability_id && row.canonical_name) names.set(row.capability_id, `${row.canonical_name}|${row.status ?? ""}`);
      } catch { /* แถวเสียหนึ่งแถวไม่ทำให้ทั้งทะเบียนใช้ไม่ได้ */ }
    }
  } catch { return new Set(); }
  const out = new Set<string>();
  for (const value of names.values()) {
    const [name, status] = value.split("|");
    if (status === "REGISTERED" && name) out.add(name);
  }
  return out;
}

/**
 * ชนิดการเปลี่ยนแปลง -> ชื่อ capability ของผู้ตรวจ
 *
 * ตารางนี้เป็นของ DNA OS ไม่ใช่ของผู้ถูกตรวจ การเพิ่มบรรทัดที่นี่คือการ
 * ประกาศว่า "ระบบมีผู้ตรวจชนิดนี้แล้ว" ซึ่งต้องมีจริงในทะเบียนถึงจะถูกเลือก
 */
const VERIFIER_FOR: Readonly<Record<string, string>> = {
  UI_SURFACE: "ui-verification-runner",
  SOURCE_CODE: "source-validation",
};

export function selectVerifier(changedPaths: readonly string[]): VerifierSelection {
  const impact = assessUiImpact(changedPaths);
  const registered = registeredCapabilityNames();

  const change_class: ChangeClass = impact.impact === "YES" ? "UI_SURFACE"
    : impact.impact === "UNRESOLVED" ? "UNRESOLVED" : "NO_IMPACT";

  if (change_class === "NO_IMPACT") {
    return { change_class, verifier_id: null, registered: false, available: false, routes: [],
      reason: `ไม่กระทบหน้าจอ — ${impact.reason}` };
  }
  if (change_class === "UNRESOLVED") {
    // ตัดสินไม่ได้ = ต้องตรวจ ไม่ใช่ปล่อยผ่าน (fail closed)
    const name = VERIFIER_FOR.UI_SURFACE!;
    const isRegistered = registered.has(name);
    return { change_class, verifier_id: isRegistered ? name : null, registered: isRegistered, available: isRegistered,
      routes: impact.routes, reason: `ตัดสินผลกระทบไม่ได้ — ${impact.reason}; ส่งเข้าตรวจแทนการปล่อยผ่าน` };
  }

  const name = VERIFIER_FOR.UI_SURFACE!;
  const isRegistered = registered.has(name);
  return {
    change_class, verifier_id: isRegistered ? name : null, registered: isRegistered, available: isRegistered,
    routes: impact.routes,
    reason: isRegistered
      ? `การเปลี่ยนแปลงกระทบหน้าจอ — ผู้ตรวจ "${name}" อยู่ในทะเบียนและใช้ได้`
      : `การเปลี่ยนแปลงกระทบหน้าจอ แต่ผู้ตรวจ "${name}" ยังไม่ถูกลงทะเบียน จึงเลือกไม่ได้`,
  };
}
