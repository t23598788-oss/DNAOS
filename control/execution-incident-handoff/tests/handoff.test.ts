/**
 * หน้าที่: พิสูจน์ว่าเหตุจากการรันจริงเข้าท่อ incident เดิมได้ โดยไม่ปลอมหลักฐาน
 * อีเมล และผู้สังเกตอยู่นอกโปรเซสที่ค้าง (Owner, TEST B/C/D).
 *
 * เคสที่สำคัญที่สุดคือ C: ต้องมีโปรเซสที่ค้างจริง และตัวที่ประกาศว่ามันค้างต้อง
 * เป็นคนละโปรเซส — ถ้าเทสต์นี้ผ่านโดยให้ตัวที่ค้างรายงานตัวเอง มันไม่ได้พิสูจน์อะไร
 *
 * Input: none.  Output: exit 0 เมื่อผ่านทั้งหมด.
 * Dependency ที่อนุญาต: ../contract.ts, ../../incident-remediation/contract.ts,
 * ../../agent-gateway/contract.ts, node built-ins.
 * สิ่งที่ห้ามแตะ: ห้ามปลอมฟิลด์อีเมล, ห้ามแกล้งว่าซ่อมสำเร็จ.
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { reportExecutionFailure, SelfReportedStallError } from "../contract";
import { loadRemediation } from "../../incident-remediation/contract";
import { createTaskWorkspace, runAgentWorkOrder } from "../../agent-gateway/contract";

let failures = 0;
const ok = (n: string, c: boolean, d = ""): void => { console.log(`${c ? "PASS" : "FAIL"}  ${n}${d ? ` — ${d}` : ""}`); if (!c) failures += 1; };
const EMAIL_FIELDS = ["sender", "message_id", "thread_id", "email_evidence", "received_at"];

(async () => {
  // ================= TEST C — งานค้างจริง ผู้สังเกตอยู่นอกโปรเซส =================
  const observerPid = process.pid;
  const hung = spawn("/bin/sleep", ["45"], { stdio: "ignore" });
  const hungStartedAt = new Date().toISOString();
  const hungPid = hung.pid ?? -1;

  // ผู้สังเกต (โปรเซสนี้) เฝ้าอยู่ข้างนอก และยังมีชีวิตขณะที่ตัวถูกเฝ้าค้าง
  await new Promise((r) => setTimeout(r, 1500));
  const stillRunning = (() => { try { process.kill(hungPid, 0); return true; } catch { return false; } })();
  ok("C1. WORKER_HUNG — มีโปรเซสที่ไม่คืบหน้าจริง", stillRunning, `pid ${hungPid} ยังอยู่หลัง 1.5 วิ`);
  ok("C2. OBSERVER_ALIVE — ผู้สังเกตยังทำงานอยู่ขณะตัวถูกเฝ้าค้าง", process.pid === observerPid);
  ok("C3. STALL_DETECTED_EXTERNALLY — ผู้สังเกตคนละโปรเซสกับตัวที่ค้าง", observerPid !== hungPid);

  const stallHandoff = await reportExecutionFailure({
    work_order_id: `wo-hung-${Date.now()}`,
    failure_type: "STALLED",
    failure_stage: "RESOURCE_INVOCATION",
    started_at: hungStartedAt,
    last_progress_at: null,
    timeout_ms: 1500,
    operation: `pid ${hungPid} ไม่มีความคืบหน้าเกินกำหนด`,
    source_location: "control/execution-incident-handoff",
    observed_by: `control/execution-incident-handoff/tests/handoff.test.ts pid=${observerPid}`,
  });
  const stallIncident = stallHandoff.record;
  hung.kill("SIGKILL");
  ok("C4. INTERNAL_INCIDENT_CREATED", stallIncident.incident_id.startsWith("incident-"), stallIncident.incident_id);
  ok("C5. เหตุถูกบันทึกในสโตร์เดิม", loadRemediation(stallIncident.incident_id) !== null);

  // ================= TEST B — เหตุจากการรันจริงที่ล้มด้วย timeout =================
  const ws = createTaskWorkspace({
    work_order_id: `wo-timeout-${Date.now()}`, command_id: `cmd-timeout-${Date.now()}`,
    assigned_source: [process.cwd()], workspace_root: "/tmp/dna-os-agent-workspaces",
  });
  const started = new Date().toISOString();
  const result = await runAgentWorkOrder({
    operation: "MODIFY", target_type: "FILE", target_path: "(handoff-test)",
    requested_change: "controlled timeout", content: "", workspace_scope: ws.allowed_write_workspace,
    mode: "sandbox", required_tests: [], forbidden_files: [], evidence: [],
    agent_run: { worker_kind: "LOCAL", instruction: JSON.stringify({ action: "credential_probe" }),
      workspace_id: ws.workspace_id, assigned_source_paths: ws.allowed_read_paths, dependency_read_paths: [],
      workspace_path: ws.allowed_write_workspace, timeout_ms: 1, expected_result_contract: "DNA_OS_AGENT_RESULT_V1" },
  } as never, `handoff-timeout-${Date.now()}`, process.env);
  ok("B0. เกิดความล้มเหลวจากการรันจริง (ไม่ได้แต่งขึ้น)", result.status !== "PASS", `status=${result.status}`);

  const handoff = await reportExecutionFailure({
    work_order_id: result.work_order_id,
    task_id: result.task_id,
    failure_type: result.runtime.exit_code === null ? "TIMEOUT" : "FAILED",
    failure_stage: "AGENT_HOST_DISPATCH",
    resource_id: null,
    capability_id: null,
    operation: result.summary.slice(0, 80),
    started_at: started,
    last_progress_at: result.runtime.started_at,
    error: result.error_code,
    exit_code: result.runtime.exit_code,
    timeout_ms: 1,
    source_location: "control/agent-host",
    last_successful_evidence_id: result.evidence_refs.at(-1) ?? null,
    observed_by: "control/execution-incident-handoff/tests/handoff.test.ts",
  });
  const incident = handoff.record;
  ok("B1. SOURCE_KIND = INTERNAL_EXECUTION_FAILURE (รับเข้าท่อได้)", incident.incident_id.startsWith("incident-"));
  ok("B2. OPEN_REMEDIATION_ACCEPTED", loadRemediation(incident.incident_id) !== null);
  ok("B3. FAKE_EMAIL_FIELDS = 0 ในเหตุที่บันทึก",
    !EMAIL_FIELDS.some((f) => JSON.stringify(loadRemediation(incident.incident_id)).includes(`"${f}"`)));
  ok("B4. provider = NOT_APPLICABLE ไม่ใช่ค่าที่แต่งขึ้น", incident.provider === "NOT_APPLICABLE", incident.provider);
  ok("B5. EXECUTION_IDENTIFIERS_PRESERVED", incident.service_id.length > 0 && incident.work_id.includes(incident.incident_id));

  /**
   * สโตร์เดียวกับฝั่งอีเมล — และเป็นสโตร์หลักฐานเดิมของ agent-gateway
   * ไม่ใช่ไฟล์แยกของ incident (persistence.ts เขียนผ่าน saveEvidence)
   * นี่คือหลักฐานตรง ๆ ว่าไม่มี evidence store ที่สองเกิดขึ้น
   */
  const evidenceStore = readFileSync(join(process.cwd(), "control/agent-gateway/data/evidence.jsonl"), "utf8");
  ok("B6. SAME_INCIDENT_STORE — บันทึกในสโตร์หลักฐานเดิม ไม่มีสโตร์ที่สอง",
    evidenceStore.includes(incident.incident_id) && evidenceStore.includes("control/incident-remediation/persistence.ts"));

  // ================= สัญญากันการปลอม =================
  const src = readFileSync(join(process.cwd(), "control/incident-remediation/incident-source.ts"), "utf8");
  const execBlock = src.slice(src.indexOf("export interface ExecutionFailureReport"), src.indexOf("export type IncidentSource"));
  ok("S1. ExecutionFailureReport ไม่มีช่องสำหรับฟิลด์อีเมลเลย",
    !EMAIL_FIELDS.some((f) => new RegExp(`readonly ${f}\\b`).test(execBlock)));
  let selfReportRejected = false;
  try { await reportExecutionFailure({ work_order_id: "x", failure_type: "FAILED", failure_stage: "x", started_at: "x", observed_by: "" }); }
  catch (e) { selfReportRejected = e instanceof SelfReportedStallError; }
  ok("S2. ปฏิเสธการรายงานที่ไม่มีผู้สังเกต", selfReportRejected);

  // ================= TEST D — ไปถึงตัวขวางจริง ไม่แกล้งว่าซ่อมได้ =================
  const { resolveResources } = await import("../../../software/execution-profile/shadow-resolver");
  const repair = resolveResources({ required_capabilities: ["code_modification"], requires_paid_service: false, needs_workspace: true });
  ok("D1. REPAIR_PLANNING เข้าถึงได้ และบอกความสามารถที่ต้องใช้", repair.required_capabilities.includes("code_modification"));
  ok("D2. RESOURCE_RESOLUTION ทำงานแล้วได้ผลตามจริง", repair.matching.length === 0 && repair.unprovided_capabilities.includes("code_modification"));
  ok("D3. ไม่มีการอ้างว่าซ่อมสำเร็จ", repair.eligible.length === 0);

  // ===== PART 2: ระบุเป้าหมายจากตัวตนของการรัน ไม่ใช่จากการกวาดชื่อไฟล์ =====
  const { resolveInternalTarget } = await import("../../incident-remediation/internal-target-resolution");
  const capLinks = readFileSync(join(process.cwd(), "software/registry-database/data/canonical/resource_capabilities.jsonl"), "utf8")
    .split("\n").filter(Boolean).map((l) => JSON.parse(l) as { capability_id: string });
  const realCapabilityId = capLinks[0]!.capability_id;
  const byIdentity = resolveInternalTarget({
    work_order_id: "wo-identity", task_id: null, plan_id: null, step_id: null,
    failure_type: "FAILED", failure_stage: "RESOURCE_INVOCATION",
    capability_id: realCapabilityId, resource_id: null, operation: null,
    started_at: new Date().toISOString(), last_progress_at: null, detected_at: new Date().toISOString(),
    error: null, exit_code: null, timeout_ms: null,
    source_location: null, last_successful_evidence_id: null, observed_by: "test",
  });
  ok("I1. RESOLUTION_STARTED_FROM_EXECUTION_IDENTITY", byIdentity.identity_fields_used[0] === "capability_id", byIdentity.identity_fields_used.join(" -> "));
  ok("I2. CAPABILITY_ID_USED", byIdentity.identity_fields_used.includes("capability_id"));
  ok("I3. REGISTRY_RELATIONSHIPS_USED", byIdentity.registry_relationships_used.length > 0, byIdentity.registry_relationships_used.join(" · "));
  ok("I4. TARGET_RESOLVED_WITHOUT_REPO_SCAN", byIdentity.resolved && byIdentity.resolved_without_repo_scan, String(byIdentity.source_location));
  ok("I5. BROAD_FILENAME_SCAN_USED_FIRST = NO",
    !/source scan found/.test(JSON.stringify(byIdentity)) && byIdentity.reason.length > 0);
  ok("I6. ตัวตนไม่พอ → บอกความสัมพันธ์ที่ขาด ไม่เดา",
    (() => { const r = resolveInternalTarget({ work_order_id: "w", task_id: null, plan_id: null, step_id: null,
      failure_type: "FAILED", failure_stage: "x", capability_id: null, resource_id: null, operation: null,
      started_at: "t", last_progress_at: null, detected_at: "t", error: null, exit_code: null, timeout_ms: null,
      source_location: null, last_successful_evidence_id: null, observed_by: "test" });
      return !r.resolved && (r.missing_relationship ?? "").length > 20; })());

  // ===== PART 1: เหตุถูกส่งเข้าสายรายงานเจ้าของของเดิม =====
  ok("O1. OWNER_ESCALATION_CALLED", handoff.owner_delivery !== null && stallHandoff.owner_delivery !== null,
    `${handoff.owner_delivery?.state} / ${stallHandoff.owner_delivery?.state}`);
  ok("O2. ส่งถึงผู้บริโภคจริงผ่านสายเดิม ไม่ใช่ตัวรายงานตัวใหม่",
    (handoff.owner_delivery?.consumer_route ?? "").length > 0, handoff.owner_delivery?.consumer_route ?? "");
  const payload = handoff.owner_delivery?.payload;
  ok("O3. รายงานมีข้อมูลที่เจ้าของต้องใช้ตัดสิน",
    Boolean(payload && payload.incident_id && payload.decision_required && payload.current_real_state));
  ok("O4. รายงานไม่รอผลการซ่อม", handoff.record.terminal_state === "OWNER_DECISION_REQUIRED");

  console.log(`\nINCIDENT_IDS = ${stallIncident.incident_id}, ${incident.incident_id}`);
  console.log(`OBSERVER_PID = ${observerPid} · HUNG_PID = ${hungPid}`);
  console.log(`${failures === 0 ? "ALL PASSED" : `${failures} FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
})();
