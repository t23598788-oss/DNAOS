/**
 * หน้าที่: พิสูจน์ว่า adapter ไม่เดาแม้แต่ฟิลด์เดียว — เจ็ดกรณีตามที่ Owner กำหนด
 * ทุกกรณีตรวจสิ่งที่ "ไม่ควรเกิด" ด้วย ไม่ใช่แค่สิ่งที่ควรเกิด
 */
import { adaptAgentResult } from "../contract";
import type { AdaptContext } from "../contract";
import type { DnaOsAgentResult } from "../../agent-gateway/agent-execution-contract";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${detail}`); }
};
const ROOT = "/Users/tam/Desktop/DNA-OS-INFRASTRUCTURE";
const base = (over: Partial<DnaOsAgentResult> = {}): DnaOsAgentResult => ({
  protocol: "DNA_OS_AGENT_RESULT_V1" as DnaOsAgentResult["protocol"],
  work_order_id: "wo-1", workspace_id: "ws-1", launch_id: "lx-1", result_id: "res-1",
  verification_id: "ver-1", task_id: "task-1", worker_id: "LOCAL",
  status: "PASS", summary: "s", error_code: null, severity: null,
  artifacts: [], evidence_refs: ["ev-1"], requested_actions: [], errors: [],
  verification: { verified: true, method: "exit_code_and_protocol_shape",
                  checked_against: ["work_order_id_match"] } as DnaOsAgentResult["verification"],
  runtime: {} as DnaOsAgentResult["runtime"], exit_code: 0, ...over,
});
const ctx = (over: Partial<AdaptContext> = {}): AdaptContext => ({
  role: "worker", repo_root: ROOT, allowed_write_paths: ["tests/__sandbox__"], ...over,
});

console.log("\nA. artifact ที่มีหลักฐานว่าเปลี่ยนจริง -> files_changed");
{
  const r = base({ artifacts: [`artifact://${ROOT}/tests/__sandbox__/a.txt`] });
  const o = adaptAgentResult(r, ctx({ verified_file_changes: [
    { repo_relative_path: "tests/__sandbox__/a.txt", sha256_before: "x", sha256_after: "y", measured_by: "harness" }] }));
  ok("ไฟล์เข้า files_changed", o.work_result.files_changed.join() === "tests/__sandbox__/a.txt");
  ok("ไม่มี UNRESOLVED_ARTIFACT", !o.unresolved.some((u) => u.kind === "UNRESOLVED_ARTIFACT"));
  ok("provenance เป็น MEASURED_EVIDENCE",
     o.provenance.find((p) => p.field === "files_changed")?.kind === "MEASURED_EVIDENCE");
}

console.log("\nB. artifact ที่ไม่ใช่ไฟล์");
{
  const o = adaptAgentResult(base({ artifacts: ["urn:something:opaque"] }), ctx());
  ok("ไม่ถูกแปลงเป็นไฟล์", o.work_result.files_changed.length === 0);
  ok("ถูกบันทึกเป็น UNRESOLVED_ARTIFACT",
     o.unresolved.some((u) => u.kind === "UNRESOLVED_ARTIFACT" && u.original === "urn:something:opaque"));
}

console.log("\nC. artifact ชี้ไฟล์จริงแต่ไม่มีหลักฐานว่าเปลี่ยน (กรณีที่เกิดจริง 40 รอบ)");
{
  const o = adaptAgentResult(base({ artifacts: [`artifact://${ROOT}/tests/__sandbox__/chip-flow/agent-input.txt`] }), ctx());
  ok("files_changed ว่าง", o.work_result.files_changed.length === 0);
  ok("รายงานเหตุผลตรงว่าไม่มีหลักฐานการเปลี่ยน",
     o.unresolved.some((u) => u.reason.includes("ไม่มีหลักฐานว่าไฟล์นั้นเปลี่ยน")));
  ok("provenance = EMPTY_NO_EVIDENCE",
     o.provenance.find((p) => p.field === "files_changed")?.kind === "EMPTY_NO_EVIDENCE");
}

console.log("\nD. Agent BLOCKED");
{
  const o = adaptAgentResult(base({ status: "BLOCKED", error_code: "EXEC_DENIED" }), ctx());
  ok("status -> BLOCKED", o.work_result.status === "BLOCKED");
  ok("blocker เก็บ error_code เดิม", o.work_result.blockers.some((b) => b.includes("EXEC_DENIED")));
}

console.log("\nE. Agent PASS");
{
  const o = adaptAgentResult(base({ status: "PASS" }), ctx());
  ok("PASS -> RECEIVED ไม่ใช่ VERIFIED", o.work_result.status === "RECEIVED");
  ok("บันทึกเหตุผลไว้ใน provenance",
     (o.provenance.find((p) => p.field === "status")?.note ?? "").includes("ไม่ใช่ผู้ตัดสิน"));
}

console.log("\nF. ผลที่มี errors");
{
  const o = adaptAgentResult(base({ status: "FAIL",
    errors: [{ error_code: "E1", severity: "HIGH", retryable: true, required_capability: null }] as unknown as DnaOsAgentResult["errors"] }), ctx());
  ok("status -> FAILED", o.work_result.status === "FAILED");
  ok("เก็บ severity/retryable เดิมไว้",
     o.work_result.blockers[0].includes("severity=HIGH") && o.work_result.blockers[0].includes("retryable=true"));
}

console.log("\nG. ผลที่ไม่มีการแก้ source เลย + มี requested_actions");
{
  const o = adaptAgentResult(base({ requested_actions:
    [{ operation: "WRITE_FILE", artifact_ref: "a", target: "src/x.ts" }] as unknown as DnaOsAgentResult["requested_actions"] }), ctx());
  ok("files_changed ว่าง", o.work_result.files_changed.length === 0);
  ok("next_action ไม่ถูกเดาจาก requested_actions", o.work_result.next_action === null);
  ok("requested_action ถูกบันทึกว่ายังไม่ถูกแปลง",
     o.unresolved.some((u) => u.kind === "UNCONVERTED_REQUESTED_ACTION"));
  ok("tests_run ว่างเมื่อไม่มีหลักฐานการรันเทสต์", o.work_result.tests_run.length === 0);
}

console.log("\nกฎรวม");
{
  const o = adaptAgentResult(base(), ctx());
  ok("ADAPTER_GUESSED_FIELD_COUNT = 0", o.guessed_field_count === 0);
  ok("ทุกฟิลด์ที่คืนมามี provenance",
     ["status", "task_id", "agent_id", "role", "input_reference", "evidence_refs",
      "files_changed", "files_read", "tests_run", "blockers", "next_action"]
       .every((f) => o.provenance.some((p) => p.field === f)));
  ok("อ้างผลเดิมกลับได้", o.original_result_ref === "res-1");
  const outside = adaptAgentResult(base(), ctx({ verified_file_changes: [
    { repo_relative_path: "control/agent-gateway/gateway.ts", sha256_before: "a", sha256_after: "b", measured_by: "h" }] }));
  ok("ไฟล์ที่เปลี่ยนนอก allowed_write_paths ไม่ถูกนับเป็นผลงาน",
     outside.work_result.files_changed.length === 0
     && outside.unresolved.some((u) => u.reason.includes("นอก allowed_write_paths")));
}

console.log(`\nPASS ${pass}  FAIL ${fail}`);
if (fail) process.exit(1);
