/**
 * หน้าที่: ตรวจเกณฑ์ Phase 1 ทั้งหมดแบบ deterministic (Owner, ข้อ 10).
 *
 * เกณฑ์ที่สำคัญที่สุดสองข้อและเหตุผลที่มันอยู่ในเทสต์ ไม่ใช่ในคอมเมนต์:
 *   - ชั้นนี้ต้องไม่กลายเป็นทะเบียนที่สอง: ทุก profile ต้องอ้าง resource_id ที่มีอยู่
 *     จริงใน canonical และซอร์สของชั้นนี้ต้องไม่มีการเขียนไฟล์ canonical เลย
 *   - ค่าที่ไม่รู้ต้องไม่ถูกเดา: billing/subscription/cost ต้องเป็น UNKNOWN ทุกแถว
 *     เพราะไม่มีคำประกาศใดในระบบบอกค่าพวกนี้ และการติดตั้ง/ยืนยันตัวตนสำเร็จ
 *     ไม่ใช่หลักฐานของมัน
 *
 * Input: none.  Output: exit 0 เมื่อผ่านทั้งหมด.
 * Dependency ที่อนุญาต: ../contract.ts, node built-ins.
 * สิ่งที่ห้ามแตะ: ห้ามผ่อนเกณฑ์ NO_SECOND_REGISTRY หรือ UNKNOWN_NOT_GUESSED
 * ด้วยการเปลี่ยนสิ่งที่วัด.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  buildProfiles, decideEligibility, describeExecutionResources,
  discoverExecutionResources, latestProfiles, resolveAccountingRequirement,
} from "../contract";

let failures = 0;
function ok(name: string, condition: boolean, detail = ""): void {
  console.log(`${condition ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!condition) failures += 1;
}

const canonicalIds = new Set<string>();
for (const line of readFileSync(join(process.cwd(), "software/registry-database/data/canonical/resources.jsonl"), "utf8").split("\n")) {
  if (line.trim() === "") continue;
  try { canonicalIds.add((JSON.parse(line) as { resource_id: string }).resource_id); } catch { /* ข้าม */ }
}

const profiles = latestProfiles();
const { unregistered } = buildProfiles();

// ---------- NO SECOND REGISTRY ----------
const sources = readdirSync(join(process.cwd(), "software/execution-profile"))
  .filter((f) => f.endsWith(".ts"))
  .map((f) => readFileSync(join(process.cwd(), "software/execution-profile", f), "utf8"))
  .join("\n");
ok("R1. NO_SECOND_REGISTRY — ไม่มีการเขียนไฟล์ canonical จากชั้นนี้",
  !/appendFileSync\([^)]*canonical|writeFileSync\([^)]*canonical/.test(sources));
ok("R2. ชั้นนี้ไม่ออก resource_id ของตัวเอง",
  !/resource_id:\s*`?(res-|resource-)\$\{/.test(sources) && !/randomUUID\(\)/.test(sources));
ok("R3. ALL_EXECUTION_PROFILES_REFERENCE_CANONICAL_RESOURCE_ID",
  profiles.length > 0 && profiles.every((p) => canonicalIds.has(p.resource_id)),
  `${profiles.length} profile`);
ok("R4. ORPHAN_EXECUTION_PROFILE = 0",
  profiles.filter((p) => !canonicalIds.has(p.resource_id)).length === 0);
ok("R5. resource ที่ยังไม่มีตัวตนถูกรายงานแยก ไม่ถูกสร้าง id ให้เอง",
  unregistered.every((u) => u.reason === "NO_CANONICAL_RESOURCE_ROW"), `${unregistered.length} รายการ`);

// ---------- UNKNOWN ต้องไม่ถูกเดา ----------
const billingUnknown = profiles.filter((p) =>
  p.billing_status.state === "UNKNOWN" && p.subscription_required.state === "UNKNOWN" && p.cost_policy.state === "UNKNOWN");
ok("U1. UNKNOWN_VALUES_NOT_GUESSED — billing/subscription/cost เป็น UNKNOWN ทุกแถว",
  billingUnknown.length === profiles.length, `${billingUnknown.length}/${profiles.length}`);
ok("U2. ทุกค่าที่ UNKNOWN มีเหตุผลกำกับ ไม่ใช่ null เปล่า",
  profiles.every((p) => [p.billing_status, p.subscription_required, p.cost_policy, p.workspace_policy]
    .every((f) => f.state !== "UNKNOWN" || (f.source ?? "").length > 10)));
ok("U3. ค่าที่ KNOWN ทุกตัวมี source",
  profiles.every((p) => Object.values(p).every((v) =>
    typeof v !== "object" || v === null || !("state" in (v as object)) ||
    (v as { state: string; source: string | null }).state !== "KNOWN" ||
    ((v as { source: string | null }).source ?? "").length > 0)));

// ---------- แยกชนิดข้อเท็จจริง ----------
const installedKnown = profiles.filter((p) => p.facts.installed.state === "KNOWN");
ok("F1. INSTALLED กับ BILLING เป็นคนละข้อเท็จจริง (ติดตั้งแล้วแต่ billing ยัง UNKNOWN ได้)",
  installedKnown.length > 0 && installedKnown.every((p) => p.facts.billing_active.state === "UNKNOWN"),
  `${installedKnown.length} ตัวติดตั้งแล้ว billing ยังไม่ทราบ`);
ok("F2. AUTH_AVAILABLE ไม่ถูกอนุมานจาก INSTALLED",
  profiles.every((p) => !(p.facts.installed.value === true && p.facts.auth_available.state === "KNOWN" && p.facts.auth_available.source === p.facts.installed.source)));

// ---------- eligibility ต้องรู้จัก dependency ----------
const sample = profiles[0]!;
const freeJob = decideEligibility(sample, { required_capability_ids: [], requires_paid_service: false, needs_workspace: false });
const paidJob = decideEligibility(sample, { required_capability_ids: [], requires_paid_service: true, needs_workspace: false });
ok("E1. งานที่ไม่ต้องจ่ายเงิน — billing ถูกข้ามเป็น NOT_APPLICABLE",
  freeJob.checks.find((c) => c.check === "BILLING_ACTIVE")?.reason_code === "NOT_APPLICABLE");
ok("E2. งานที่ต้องจ่ายเงิน + billing UNKNOWN → ผลเป็น UNKNOWN ไม่ใช่ ELIGIBLE",
  paidJob.checks.find((c) => c.check === "BILLING_ACTIVE")?.verdict === "UNKNOWN" && paidJob.verdict !== "ELIGIBLE");
ok("E3. UNKNOWN ไม่ถูกยุบเป็น NOT_ELIGIBLE",
  paidJob.verdict === "UNKNOWN", paidJob.blocking_reason ?? "");
ok("E4. ทุกผลมี reason code อธิบายได้",
  paidJob.checks.every((c) => c.reason_code.length > 0));
ok("E5. capability ที่ไม่ตรง → NOT_ELIGIBLE (คนละอย่างกับ UNKNOWN)",
  decideEligibility(sample, { required_capability_ids: ["capability-does-not-exist"], requires_paid_service: false, needs_workspace: false }).verdict === "NOT_ELIGIBLE");

// ---------- ไม่ต้องรู้ชื่อ provider ----------
const genericSources = ["types.ts", "eligibility.ts", "store.ts", "readback.ts"]
  .map((f) => readFileSync(join(process.cwd(), "software/execution-profile", f), "utf8")).join("\n")
  .replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !l.trimStart().startsWith("*") && !l.trimStart().startsWith("//")).join("\n");
ok("P1. PROVIDER_NAME_REQUIRED_FOR_GENERIC_PROFILE = NO",
  !/\bclaude\b|\bcodex\b|\bgemini\b|anthropic|openai/i.test(genericSources),
  "types/eligibility/store/readback ไม่มีชื่อ provider");

// ---------- readback ----------
const answers = describeExecutionResources();
ok("B1. CAPABILITY_RELATIONSHIP_READBACK", answers.every((a) => Array.isArray(a.what_can_it_do)));
ok("B2. EXECUTION_BOUNDARY_READBACK", answers.every((a) => a.which_boundary.length > 0));
ok("B3. AUTHORITY_READBACK", answers.every((a) => a.what_authority.includes("เจ้าของอำนาจ")));
ok("B4. AVAILABILITY_READBACK", answers.every((a) => a.is_available.includes("ติดตั้ง")));
ok("B5. VERIFICATION_READBACK", answers.every((a) => a.how_verified.length > 0));
ok("B6. ตอบได้ครบทุก resource ที่มี profile", answers.length === profiles.length, `${answers.length}`);

// ---------- accounting ----------
const accounting = resolveAccountingRequirement();
ok("A1. ACCOUNTING_MISSING_RESOURCE_READBACK — ระบุความต้องการโดยไม่เอ่ยชื่อผู้ให้บริการ",
  accounting.required_capability === "business_database_read"
  && accounting.required_properties.includes("READ_ONLY")
  && !/postgres|supabase|mysql|sqlite|mongo/i.test(JSON.stringify(accounting)));
ok("A2. ตอบได้ว่าขาดอะไร ไม่ใช่เงียบ",
  accounting.matching_resource_ids.length === 0 ? (accounting.blocker ?? "").length > 20 : true,
  accounting.blocker ? "มี blocker อธิบายไว้" : "มี resource ที่ตรง");

// ---------- ไม่แตะของเดิม ----------
const routerSrc = readFileSync(join(process.cwd(), "control/command-router/router.ts"), "utf8");
ok("C1. CURRENT_ROUTER_BEHAVIOR_CHANGED = NO", routerSrc.includes('if (normalized.includes("codex")) return "CODEX";'));
ok("C2. CURRENT_WORKORDER_CONTRACT_CHANGED = NO",
  readFileSync(join(process.cwd(), "control/agent-gateway/types.ts"), "utf8").includes('worker_kind: "CLAUDE" | "CODEX" | "GEMINI" | "LOCAL"'));
ok("C3. ชั้นนี้ยังไม่ถูกต่อเข้า routing",
  !routerSrc.includes("execution-profile"));

console.log(`\nEXECUTION_RESOURCE_CENSUS = ${discoverExecutionResources().length}`);
console.log(`${failures === 0 ? "ALL PASSED" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
