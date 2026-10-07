/**
 * CROSS_REPOSITORY_OWNERSHIP — ตัวตนต้องไม่ขึ้นกับตำแหน่งบนเครื่อง
 */
import { normalizeSourceLocation, covers, KNOWN_REPOSITORIES, bindFailureEvidence } from "../contract";
import type { OwnerConsoleItem } from "../contract";
let pass = 0, fail = 0;
const check = (n: string, ok: boolean, d?: unknown): void => {
  if (ok) { pass += 1; console.log(`PASS  ${n}`); }
  else { fail += 1; console.log(`FAIL  ${n}`); if (d !== undefined) console.log(`      ${JSON.stringify(d)}`); }
};
const mk = (fp: string): OwnerConsoleItem => ({
  origin_kind: "SYSTEM_ERROR_COMMAND", owner_visible: true, origin_event_id: "e", command_id: "c",
  task_id: "t", work_id: "work-x", parent_work_id: null, error_kind: "TEST_FAILED",
  raw_command_text: "p", status: "B", current_action: "", evidence: { file_path: fp },
  auto_dispatch: null, recorded_at: "2026-08-30T00:00:00.000Z",
});

// 4: path เดียวกันคนละรีโป ต้องไม่ชนกัน
const a = { repository_id: "repo:dna-os-infrastructure", repo_relative_path: "server/server.mjs" };
const b = { repository_id: "repo:dna-os-control-workspace", repo_relative_path: "server/server.mjs" };
check("4  path เดียวกันคนละรีโป = คนละตัวตน ไม่ครอบกัน",
  !covers({ ...a, repo_relative_path: "server/" }, b) && covers({ ...a, repo_relative_path: "server/" }, a));

// 5/6: ย้ายตำแหน่งเช็คเอาต์ ตัวตนไม่เปลี่ยน + ไม่ต้องใช้ absolute path
const w1 = normalizeSourceLocation("~/Desktop/dna-os-control-workspace/server/server.mjs");
const w2 = normalizeSourceLocation("/Volumes/Backup/projects/dna-os-control-workspace/server/server.mjs");
check("5  ย้ายโฟลเดอร์เช็คเอาต์ -> repository_id และ path เดิม",
  w1 !== null && w2 !== null && w1.repository_id === w2.repository_id
  && w1.repo_relative_path === w2.repo_relative_path && w1.repository_id === "repo:dna-os-control-workspace",
  { w1, w2 });
check("6  ค้นเจ้าของได้โดยไม่ต้องใช้ absolute path",
  normalizeSourceLocation("software/system-graph/")?.repository_id === "repo:dna-os-infrastructure");
check("6  absolute path ที่ไม่มีเบาะแสรีโป -> แปลไม่ได้ ไม่เดา",
  normalizeSourceLocation("/opt/somewhere/else/x.ts") === null);

// 7: รูปเดิมทั้งสี่ยังอ่านได้
const forms = ["control/agent-gateway/", "control/runtime-control/contract.ts",
  "control/runtime-control/ (boot-orchestrator.ts, host-runtime.ts SERVICES)",
  "~/Desktop/dna-os-control-workspace/ (features/resilience"];
check("7  source_location รูปเดิมทั้งสี่ยังแปลได้",
  forms.every((f) => normalizeSourceLocation(f) !== null), forms.map((f) => normalizeSourceLocation(f)));

// 8: ความล้มเหลวของ workspace ผูกได้เฉพาะจากความเป็นเจ้าของของ workspace
const ws = bindFailureEvidence(mk("server/server.mjs"));
check("8  server/server.mjs (ตีความเป็นของ infrastructure) ไม่ถูกจับคู่กับ resource ของ workspace",
  ws.bound_capability === null || !JSON.stringify(ws.registry_refs).includes("control-workspace"),
  { cap: ws.bound_capability, refs: ws.registry_refs });

// 9: ไม่เดา
check("9  path ที่ไม่มีเจ้าของ ยังเป็น UNRESOLVED", bindFailureEvidence(mk("app/main.mjs")).binding_status === "UNRESOLVED");

// 10: ตัวผูกใช้ตัวตนที่รู้รีโป และเห็น capability ที่เพิ่งลงทะเบียน
const sg = bindFailureEvidence(mk("software/system-graph/projection.ts"));
check("10 ตัวผูกเห็น capability ที่ลงทะเบียนผ่านไปป์ไลน์",
  sg.binding_status === "EXACT" && sg.bound_capability !== null, { s: sg.binding_status, c: sg.bound_capability });
check("   ทะเบียนรีโปประกาศตัวตนจาก remote ไม่ใช่ชื่อโฟลเดอร์",
  KNOWN_REPOSITORIES.every((r) => r.canonical_remote_identity !== null && r.checkout_location === null));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
