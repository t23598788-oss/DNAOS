/**
 * หน้าที่: จุดที่ DNA OS ลงมือตรวจเอง — จำแนกการเปลี่ยนแปลง เลือกผู้ตรวจจาก
 * ทะเบียน เรียกผู้ตรวจ แล้วแปลงผลของเครื่องให้เป็นหลักฐานที่ประตูเดิมอ่านได้
 *
 * ทำไมต้องมีตัวกลางนี้: ประตู `control/ui-render-verification/gate.ts#decideCompletion`
 * ถูกบังคับใช้ใน source อยู่แล้วสามจุด (agent-gateway/gateway.ts,
 * work-result-ingress/ingress.ts, work-coordination/coordination.ts) แต่มันอ่าน
 * หลักฐานจาก render-evidence.jsonl ซึ่งไม่มีใครผลิตในเส้น production เลย
 * ทุกงานที่กระทบหน้าจอจึงถูกปฏิเสธด้วย NO_EVIDENCE ตลอด ตัวนี้คือผู้ผลิต
 * หลักฐานที่หายไป ไม่ได้มาแทนประตู และไม่ได้ผ่อนกฎของประตู
 *
 * Agent ไม่มีสิทธิ์ใด ๆ ที่นี่: ผู้เรียกส่งได้แค่ execution_id กับรายการไฟล์
 * ที่เปลี่ยน ส่วน verdict มาจาก control/ui-verification-runner ซึ่งอ่านค่าจริง
 * จากเบราว์เซอร์ (Owner, 2026-09-05: "AI does NOT verify AI")
 *
 * Input: execution_id, changed_paths, base_url, work/task identity
 * Output: DispatchOutcome + แถวหลักฐานใน render-evidence.jsonl
 * Dependency ที่อนุญาต: ./selection.ts, ../ui-verification-runner/contract.ts,
 * ../ui-render-verification/contract.ts, node built-ins
 * สิ่งที่ห้ามแตะ:
 * - ห้ามเขียน verdict VERIFIED ถ้า runner ไม่ได้คืน PASS
 * - ห้ามให้ผู้เรียกเลือก verifier หรือชุดตรวจ
 * - ห้ามกลืน exception เป็น PASS — ล้มระหว่างตรวจคือ UNPROVEN
 */

import { appendFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { RENDER_EVIDENCE_FILE } from "../ui-render-verification/contract";
import { runVerification } from "../ui-verification-runner/contract";
import type { VerificationResult } from "../ui-verification-runner/contract";
import { selectVerifier, type VerifierSelection } from "./selection";

export interface DispatchInput {
  readonly execution_id: string;
  readonly work_id: string | null;
  readonly task_id: string | null;
  readonly changed_paths: readonly string[];
  readonly base_url: string;
  /** route ที่ต้องตรวจ ถ้าไม่ระบุจะใช้ route ที่ตัวจำแนกหาได้จาก path */
  readonly routes?: readonly string[];
}

export interface DispatchOutcome {
  readonly dispatched: boolean;
  readonly selection: VerifierSelection;
  readonly verification: VerificationResult | null;
  readonly evidence_written: boolean;
  readonly reason: string;
}

/** ผลของเครื่อง -> คำตัดสินในภาษาของประตูเดิม ไม่มีการผ่อนปรนระหว่างทาง */
const VERDICT_FOR = { PASS: "VERIFIED", FAIL: "FAILED", BLOCKED: "UNPROVEN" } as const;

export async function dispatchVerification(input: DispatchInput): Promise<DispatchOutcome> {
  const selection = selectVerifier(input.changed_paths);

  if (selection.change_class === "NO_IMPACT") {
    return { dispatched: false, selection, verification: null, evidence_written: false,
      reason: "ไม่ต้องตรวจ — การเปลี่ยนแปลงไม่กระทบหน้าจอ ประตูเดิมจะปล่อยผ่านเอง" };
  }
  if (selection.verifier_id === null) {
    return { dispatched: false, selection, verification: null, evidence_written: false,
      reason: selection.reason };
  }

  const routes = (input.routes && input.routes.length > 0 ? input.routes : selection.routes);
  if (routes.length === 0) {
    return { dispatched: false, selection, verification: null, evidence_written: false,
      reason: "เลือกผู้ตรวจได้ แต่ไม่มี route ที่ต้องตรวจ — ไม่เดา route เอง" };
  }

  const verification = await runVerification({
    verification_request_id: `vr-${randomUUID()}`,
    work_id: input.work_id, task_id: input.task_id,
    change_id: input.execution_id,
    changed_files: input.changed_paths,
    affected_routes: routes,
    verification_profile: "OWNER_SURFACE_V1",
    base_url: input.base_url,
  });

  const failed = verification.checks.filter((c) => c.status !== "PASS");
  const evidence = {
    execution_id: input.execution_id,
    change_id: input.execution_id,
    resource_id: [selection.verifier_id],
    capability_id: [selection.verifier_id],
    route: routes[0]!,
    runtime_url: `${input.base_url}${routes[0]!}`,
    source_digest: verification.verification_id,
    data_source: `control/ui-verification-runner#${verification.verification_id}`,
    screenshot_path: verification.evidence[0] ?? "",
    evidence_reference: `verifications.jsonl#${verification.verification_id}`,
    observed_at: verification.finished_at,
    expected_elements: verification.checks.map((c) => c.check_id),
    found_elements: verification.checks.filter((c) => c.status === "PASS").map((c) => c.check_id),
    missing_elements: failed.map((c) => c.check_id),
    visual_regression: "NOT_CHECKED" as const,
    verdict: VERDICT_FOR[verification.status],
    reason: `ผู้ตรวจ ${selection.verifier_id} คืน ${verification.status} จาก ${verification.checks.length} ข้อ (ไม่ผ่าน ${failed.length})`,
  };
  appendFileSync(RENDER_EVIDENCE_FILE, `${JSON.stringify(evidence)}\n`, "utf-8");

  return { dispatched: true, selection, verification, evidence_written: true,
    reason: `ตรวจแล้วด้วย ${selection.verifier_id}: ${verification.status}` };
}
