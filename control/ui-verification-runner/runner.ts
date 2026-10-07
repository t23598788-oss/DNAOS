/**
 * หน้าที่: ผู้ประสานการตรวจหน้าจอ — DNA OS เรียกตัวนี้ ตัวนี้เรียกเบราว์เซอร์
 * จริงผ่าน ./cdp.ts แล้วคืนผล PASS/FAIL/BLOCKED ที่เครื่องเป็นคนตัดสิน
 *
 * Owner, 2026-09-05: "AI does NOT verify AI" ที่นี่จึงไม่มีการเรียกโมเดล ไม่มี
 * การอ่านข้อความของ Agent และไม่มีการดูภาพเพื่อสรุปผล status ของทั้งการรัน
 * คำนวณจาก status ของ check ล้วน ๆ: มี FAIL แม้ข้อเดียว = FAIL, ไม่มี FAIL แต่
 * มี BLOCKED = BLOCKED, ที่เหลือ = PASS
 *
 * Input: VerificationRequest (./types.ts)
 * Output: VerificationResult ที่ append ลง ./data/verifications.jsonl พร้อม
 * screenshot เป็นหลักฐานประกอบ (ไม่ใช่ที่มาของผล)
 * Dependency ที่อนุญาต: ./cdp.ts, ./checks.ts, ./types.ts, node built-ins
 * สิ่งที่ห้ามแตะ:
 * - ห้ามให้ผู้เรียกส่งรายการ check เข้ามาเอง ต้องมาจาก profile ที่ประกาศไว้
 * - ห้ามคืน PASS เมื่อมี check ที่ BLOCKED
 * - ห้ามปล่อยเบราว์เซอร์ค้าง ต้อง close() ใน finally เสมอ
 * - ห้ามเปิด loop ถ่ายภาพหรือ polling
 */

import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openSession } from "./cdp";
import { checkCollapsedRail, checkConsoleErrors, checkDuplicatedHeading, checkNetworkErrors, checkOverlapGeometry, checkRouteLoad, checkStaleRouteContent, checkTopDivider } from "./checks";
import type { Check, VerificationRequest, VerificationResult } from "./types";

const HERE = dirname(fileURLToPath(import.meta.url));
export const VERIFICATIONS_FILE: string = join(HERE, "data", "verifications.jsonl");
const SHOT_DIR: string = join(HERE, "data", "screenshots");

/**
 * ชุดตรวจที่ประกาศไว้ ผู้เรียกเลือกได้แค่ชื่อ ไม่ได้แต่งรายการเอง — กันไม่ให้
 * ผู้ถูกตรวจเลือกข้อสอบของตัวเอง
 */
export const PROFILES: Readonly<Record<string, { console_allowlist: readonly string[]; network_allowlist: readonly string[] }>> = {
  OWNER_SURFACE_V1: {
    // ยังไม่มีรายการยกเว้น — ถ้าจะเพิ่มต้องมีเหตุผลที่ Owner รับ ไม่ใช่เพิ่มเพื่อให้ผ่าน
    console_allowlist: [],
    network_allowlist: [],
  },
};

export async function runVerification(request: VerificationRequest): Promise<VerificationResult> {
  const profile = PROFILES[request.verification_profile];
  const started_at = new Date().toISOString();
  const verification_id = `verif-${randomUUID()}`;
  const checks: Check[] = [];
  const evidence: string[] = [];

  if (!profile) {
    const result: VerificationResult = {
      verification_id, verification_request_id: request.verification_request_id,
      work_id: request.work_id, task_id: request.task_id, change_id: request.change_id,
      profile: request.verification_profile, status: "BLOCKED", checks: [], evidence: [],
      started_at, finished_at: new Date().toISOString(),
      decided_by: "control/ui-verification-runner (deterministic, no model)",
    };
    record(result);
    return result;
  }

  mkdirSync(SHOT_DIR, { recursive: true });
  let session: Awaited<ReturnType<typeof openSession>> | null = null;
  try {
    session = await openSession({ windowWidth: 1440, windowHeight: 900 });
    for (const route of request.affected_routes) {
      const url = `${request.base_url}${route}`;
      session.clearObservations();
      await session.navigate(url);

      // หลักฐานภาพ — เก็บไว้ให้ Owner เปิดดู ไม่ได้ใช้ตัดสิน
      let shot: string | null = null;
      try {
        const b64 = await session.screenshot();
        if (b64) {
          shot = join(SHOT_DIR, `${verification_id}-${route.replace(/[^a-z0-9]+/gi, "_")}.png`);
          writeFileSync(shot, Buffer.from(b64, "base64"));
          evidence.push(shot);
        }
      } catch { /* ถ่ายภาพไม่ได้ไม่ทำให้ผลเปลี่ยน ภาพเป็นหลักฐานประกอบ */ }

      checks.push(await checkRouteLoad(session, route, url));
      checks.push(await checkDuplicatedHeading(session, route));
      checks.push(await checkTopDivider(session, route));
      checks.push(await checkOverlapGeometry(session, route));
      checks.push(await checkCollapsedRail(session, route));
      checks.push(checkConsoleErrors(session, route, profile.console_allowlist));
      checks.push(checkNetworkErrors(session, route, profile.network_allowlist));
      for (const c of checks.slice(-7)) if (c.evidence_pointer === null && shot !== null) {
        (checks[checks.indexOf(c)] as { evidence_pointer: string | null }).evidence_pointer = shot;
      }
    }

    // เปลี่ยน route จริงเพื่อดูของค้าง — ต้องมีอย่างน้อยสอง route ถึงตรวจได้
    if (request.affected_routes.length >= 2) {
      checks.push(await checkStaleRouteContent(session, request.base_url, request.affected_routes[0]!, request.affected_routes[1]!));
    }
  } catch (error) {
    checks.push({
      check_id: "RUNNER", check_type: "ROUTE_LOAD", route: "-",
      expected: "runner รันได้จนจบ",
      observed_machine_value: { error: error instanceof Error ? error.message : String(error) },
      status: "BLOCKED", reason: "runner ล้มระหว่างทาง จึงตรวจไม่ครบ", evidence_pointer: null,
    });
  } finally {
    // RELEASE — ปิดเบราว์เซอร์และลบโปรไฟล์ทุกเส้นทาง รวมทั้งตอน error
    if (session) { try { await session.close(); } catch { /* ปิดไม่ได้ก็ต้องไม่กลืนผล */ } }
  }

  const status = checks.some((c) => c.status === "FAIL") ? "FAIL"
    : checks.some((c) => c.status === "BLOCKED") ? "BLOCKED" : "PASS";

  const result: VerificationResult = {
    verification_id, verification_request_id: request.verification_request_id,
    work_id: request.work_id, task_id: request.task_id, change_id: request.change_id,
    profile: request.verification_profile, status, checks, evidence,
    started_at, finished_at: new Date().toISOString(),
    decided_by: "control/ui-verification-runner (deterministic, no model)",
  };
  record(result);
  return result;
}

function record(result: VerificationResult): void {
  mkdirSync(dirname(VERIFICATIONS_FILE), { recursive: true });
  appendFileSync(VERIFICATIONS_FILE, `${JSON.stringify(result)}\n`, "utf-8");
}
