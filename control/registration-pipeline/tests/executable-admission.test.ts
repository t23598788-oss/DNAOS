/**
 * หน้าที่: พิสูจน์ EXECUTABLE_CONTRACT_REQUIRED — candidate ใหม่ที่ประกาศเจตนา
 * executable ต้องประกาศ contract ครบ ไม่งั้นถูกปฏิเสธก่อนถึง fingerprint
 *
 * ไม่แตะทะเบียนจริง: เคสที่ต้องถูกปฏิเสธจะหยุดก่อนเขียนอยู่แล้ว
 * และเคสที่ผ่านจะใช้ store จำลอง ไม่ใช่ persistent store
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { checkExecutableAdmission, declaresExecutableIntent } from "../executable-admission";
import { runRegistrationPipeline } from "../contract";
import { createLocalFileStore } from "../../../software/registry-database/adapters/local-file-store";
import type { RegistrationCandidate } from "../../event-pipeline/contract";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => {
  if (c) { pass++; console.log("  PASS  " + n); } else { fail++; console.log("  FAIL  " + n + (d ? "  -> " + d : "")); }
};

const CANON = join(__dirname, "..", "..", "..", "software", "registry-database", "data", "canonical");
const digest = () => ["capabilities", "resources", "relationships", "evidence", "versions"]
  .map((f) => createHash("sha256").update(readFileSync(join(CANON, `${f}.jsonl`), "utf8")).digest("hex")).join("|");
const before = digest();

const base = (over: Partial<RegistrationCandidate> = {}): RegistrationCandidate => ({
  candidate_id: `cand-admission-${Math.abs(hash(JSON.stringify(over)))}`,
  name: "admission-test-capability", kind: "capability",
  source_location: "control/registration-pipeline/executable-admission.ts",
  owner: "admission-test", input: [], output: [], side_effects: [], dependencies: [],
  behavior: "test candidate for the executable admission gate", version: "1.0.0",
  evidence_refs: ["control/registration-pipeline/executable-admission.ts"],
  domain: "SOFTWARE_CONTROL_PLANE", resource_type: "CAPABILITY",
  data_classification: "INTERNAL", source_system: "dna-os-infrastructure",
  scope: "test/admission", ...over,
} as RegistrationCandidate);
function hash(s: string): number { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return h; }

const BINDING = [{ to_type: "API", to_id: "route:admission-test", relationship_kind: "CAPABILITY_TO_API" }];

console.log("\nขอบเขต — candidate ที่ไม่ประกาศเจตนา ต้องไม่ถูกแตะ");
{
  const plain = base();
  ok("candidate ธรรมดา -> ไม่เข้าเงื่อนไข gate", declaresExecutableIntent(plain) === false);
  const r = checkExecutableAdmission(plain);
  ok("applicable=false และผ่าน", r.applicable === false && r.ok === true);
}

console.log("\nเจตนา executable อ่านได้สองทาง");
{
  ok("ประกาศผ่าน relationships", declaresExecutableIntent(base({ relationships: BINDING } as never)) === true);
  ok("ประกาศผ่าน intended_executable", declaresExecutableIntent(base({ intended_executable: true } as never)) === true);
  ok("CAPABILITY_TO_WORKER ก็นับเป็น binding",
    declaresExecutableIntent(base({ relationships: [{ to_type: "WORKER", to_id: "w:1", relationship_kind: "CAPABILITY_TO_WORKER" }] } as never)) === true);
}

console.log("\nINCOMPLETE EXECUTABLE -> REJECTED");
{
  const noIn = checkExecutableAdmission(base({ relationships: BINDING, output: ["Outcome"] } as never));
  ok("ขาด input -> MISSING_INPUT_CONTRACT", !noIn.ok && noIn.reasons.includes("MISSING_INPUT_CONTRACT"));
  const noOut = checkExecutableAdmission(base({ relationships: BINDING, input: ["Request"] } as never));
  ok("ขาด output -> MISSING_OUTPUT_CONTRACT", !noOut.ok && noOut.reasons.includes("MISSING_OUTPUT_CONTRACT"));
  const noBind = checkExecutableAdmission(base({ intended_executable: true, input: ["Request"], output: ["Outcome"] } as never));
  ok("ประกาศเจตนาแต่ไม่มี binding -> MISSING_EXECUTION_BINDING", !noBind.ok && noBind.reasons.includes("MISSING_EXECUTION_BINDING"));
  const noProv = checkExecutableAdmission(base({ relationships: BINDING, input: ["Request"], output: ["Outcome"], evidence_refs: ["เขียนบรรยายลอย ๆ"] } as never));
  ok("evidence ไม่ชี้ source/test -> MISSING_CONTRACT_PROVENANCE", !noProv.ok && noProv.reasons.includes("MISSING_CONTRACT_PROVENANCE"));
}

console.log("\nผ่าน pipeline จริง — REJECTED ก่อนถึง fingerprint");
{
  const store = createLocalFileStore();
  const result = runRegistrationPipeline(
    base({ relationships: BINDING, output: ["Outcome"] } as never), store, "admission-test-incomplete");
  ok("pipeline ปฏิเสธ", result.status === "REJECTED", result.status);
  ok("reason_code เป็น EXECUTABLE_CONTRACT_REQUIRED",
    "reason_code" in result && String(result.reason_code).startsWith("EXECUTABLE_CONTRACT_REQUIRED"),
    "reason_code" in result ? String(result.reason_code) : "-");
  ok("failed_stage = VALIDATION (ก่อน DUPLICATE/fingerprint)",
    "failed_stage" in result && result.failed_stage === "VALIDATION");
}

console.log("\nCOMPLETE EXECUTABLE -> ACCEPTED");
{
  const complete = base({
    name: `admission-complete-${Date.now()}`,
    relationships: BINDING, input: ["AdmissionRequest"], output: ["AdmissionOutcome"],
    evidence_refs: ["control/registration-pipeline/executable-admission.ts", "control/registration-pipeline/tests/executable-admission.test.ts"],
  } as never);
  const check = checkExecutableAdmission(complete);
  ok("ผ่าน admission check", check.ok === true, JSON.stringify(check.reasons));
  const store = createLocalFileStore();
  const result = runRegistrationPipeline(complete, store, "admission-test-complete");
  ok("pipeline ไม่ปฏิเสธด้วยเหตุ contract",
    !("reason_code" in result && String(result.reason_code).startsWith("EXECUTABLE_CONTRACT_REQUIRED")),
    "reason_code" in result ? String(result.reason_code) : result.status);
}

console.log("\nไม่แตะทะเบียนจริง");
ok("canonical ไม่เปลี่ยนตลอดการทดสอบ", digest() === before);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
