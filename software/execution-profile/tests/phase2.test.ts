/**
 * หน้าที่: ตรวจเกณฑ์ Phase 2 และรัน shadow test กับชนิดงานจริง (Owner, ข้อ 7 และ 9).
 *
 * เกณฑ์ที่สำคัญที่สุดคือสองข้อที่วัดว่า "คำศัพท์ความสามารถ" ไม่ได้กลายเป็นชื่ออื่น
 * ของสิ่งเดิม: ห้ามมี capability ที่ชื่อตรงกับชื่อโมดูล และห้ามมีชื่อผู้ให้บริการ
 * ปรากฏในตัวเลือกทรัพยากรเลย ถ้าสองข้อนี้หลุด งานทั้ง Phase ก็ไม่มีความหมาย
 *
 * Input: none.  Output: exit 0 เมื่อผ่านทั้งหมด.
 * Dependency ที่อนุญาต: ../contract.ts, ../shadow-resolver.ts, ../task-capability.ts, node built-ins.
 * สิ่งที่ห้ามแตะ: ห้ามผ่อนเกณฑ์ด้วยการเปลี่ยนสิ่งที่วัด.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { latestProfiles, resolveAccountingRequirement } from "../contract";
import { resolveResources } from "../shadow-resolver";
import { TASK_CAPABILITIES, UNPROVIDED_TASK_CAPABILITIES } from "../task-capability";

let failures = 0;
const ok = (name: string, condition: boolean, detail = ""): void => {
  console.log(`${condition ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!condition) failures += 1;
};
const read = (p: string): string => readFileSync(join(process.cwd(), p), "utf8");

// ชื่อโมดูลทั้งหมดที่ทะเบียนรู้จัก — ใช้ตรวจว่า capability ไม่ได้ตั้งชื่อตามโมดูล
const moduleNames = new Set<string>();
for (const line of read("software/registry-database/data/canonical/resources.jsonl").split("\n")) {
  if (line.trim() === "") continue;
  try {
    const location = (JSON.parse(line) as { source_location?: string }).source_location ?? "";
    const last = location.replace(/\/+$/, "").split("/").at(-1);
    if (last) moduleNames.add(last);
  } catch { /* ข้าม */ }
}

// ---------- คำศัพท์ ----------
ok("V1. TASK_CAPABILITY_VOCAB — มีคำศัพท์ที่ประกาศแล้ว", TASK_CAPABILITIES.length > 0, `${TASK_CAPABILITIES.length} ตัว`);
ok("V2. CAPABILITIES_BASED_ON_REAL_BEHAVIOR — ทุกตัวมีผู้ให้บริการพร้อมหลักฐาน",
  TASK_CAPABILITIES.every((c) => c.provided_by.length > 0 && c.provided_by.every((p) => p.proof.source.length > 10 && p.proof.detail.length > 10)));
ok("V3. ทุกตัวมี input/output contract", TASK_CAPABILITIES.every((c) => c.input_contract.length > 0 && c.output_contract.length > 0));
ok("V4. MODULE_NAME_USED_AS_TASK_CAPABILITY = 0",
  TASK_CAPABILITIES.filter((c) => moduleNames.has(c.canonical_name)).length === 0,
  TASK_CAPABILITIES.filter((c) => moduleNames.has(c.canonical_name)).map((c) => c.canonical_name).join(",") || "ไม่มี");
ok("V5. PROVIDER_NAME_USED_AS_TASK_CAPABILITY = 0",
  !TASK_CAPABILITIES.some((c) => /claude|codex|gemini|anthropic|openai/i.test(c.canonical_name)));
ok("V6. ความสามารถที่ยังไม่มีผู้ให้บริการถูกประกาศไว้ว่าไม่มี ไม่ใช่ปลอมว่ามี",
  UNPROVIDED_TASK_CAPABILITIES.length > 0 && UNPROVIDED_TASK_CAPABILITIES.every((c) => c.provided_by.length === 0));

// ---------- ตัวเลือกไม่รู้จักชื่อผู้ให้บริการ ----------
const selectionSources = ["shadow-resolver.ts", "eligibility.ts", "types.ts", "store.ts"]
  .map((f) => read(`software/execution-profile/${f}`))
  .join("\n").replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n").filter((l) => !l.trimStart().startsWith("*") && !l.trimStart().startsWith("//")).join("\n");
ok("S1. PROVIDER_NAME_USED_IN_GENERIC_SELECTION = 0",
  !/claude|codex|gemini|anthropic|openai/i.test(selectionSources));

// ---------- resource ↔ capability links ----------
const profiles = latestProfiles();
const capNames = new Map<string, string>();
for (const line of read("software/registry-database/data/canonical/capabilities.jsonl").split("\n")) {
  if (line.trim() === "") continue;
  try { const row = JSON.parse(line) as { capability_id: string; canonical_name?: string }; if (row.canonical_name) capNames.set(row.capability_id, row.canonical_name); }
  catch { /* ข้าม */ }
}
const taskCapNames = new Set(TASK_CAPABILITIES.map((c) => c.canonical_name));
const linked = profiles.filter((p) => p.capability_ids.some((id) => taskCapNames.has(capNames.get(id) ?? "")));
ok("L1. RESOURCE_CAPABILITY_LINKS — มี resource ที่ผูกกับคำศัพท์งานแล้ว",
  linked.length > 0, `${linked.length}/${profiles.length} resource`);
ok("L2. ทุก task capability ที่ลงทะเบียนแล้วถูกผูกกับ resource อย่างน้อยหนึ่งตัว",
  TASK_CAPABILITIES.every((c) => profiles.some((p) => p.capability_ids.some((id) => capNames.get(id) === c.canonical_name))),
  TASK_CAPABILITIES.filter((c) => !profiles.some((p) => p.capability_ids.some((id) => capNames.get(id) === c.canonical_name))).map((c) => c.canonical_name).join(",") || "ครบ");

// ---------- SHADOW TESTS A–F ----------
console.log("\n--- SHADOW TESTS ---");
const scenarios: readonly { id: string; label: string; caps: readonly string[]; paid: boolean; ws: boolean }[] = [
  { id: "A", label: "ตรวจซอร์สอย่างเดียว", caps: ["source_analysis"], paid: false, ws: true },
  { id: "B", label: "แก้โค้ดแล้วรันเทสต์", caps: ["code_modification", "test_execution"], paid: false, ws: true },
  { id: "C", label: "เขียนกลับ repository", caps: ["repository_write"], paid: false, ws: true },
  { id: "D", label: "โต้ตอบเบราว์เซอร์", caps: ["browser_interaction"], paid: false, ws: false },
  { id: "E", label: "อ่านฐานข้อมูลธุรกิจ", caps: ["business_database_read"], paid: false, ws: false },
  { id: "F", label: "สำมะโนบัญชีแบบ LIVE", caps: ["business_database_read", "evidence_generation"], paid: false, ws: false },
];
for (const s of scenarios) {
  const outcome = resolveResources({ required_capabilities: s.caps, requires_paid_service: s.paid, needs_workspace: s.ws });
  console.log(`  ${s.id}. ${s.label}`);
  console.log(`     ต้องการ=${s.caps.join(",")} | ตรง=${outcome.matching.length} ใช้ได้=${outcome.eligible.length} ไม่แน่=${outcome.unknown.length} ใช้ไม่ได้=${outcome.not_eligible.length}`);
  if (outcome.unprovided_capabilities.length > 0) console.log(`     ยังไม่มีผู้ให้บริการ: ${outcome.unprovided_capabilities.join(", ")}`);
  ok(`T${s.id}. ตอบได้พร้อมเหตุผล ไม่เงียบ`, outcome.explanation.length > 40);
}

const aOutcome = resolveResources({ required_capabilities: ["source_analysis"], requires_paid_service: false, needs_workspace: true });
ok("TA2. งานตรวจซอร์สหา resource ที่ตรงได้จริง", aOutcome.matching.length >= 1, `${aOutcome.matching.length}`);
const bOutcome = resolveResources({ required_capabilities: ["code_modification", "test_execution"], requires_paid_service: false, needs_workspace: true });
ok("TB2. งานแก้โค้ดยังไม่มี resource ที่ครบ และระบบบอกได้ว่าขาดอะไร",
  bOutcome.matching.length === 0 && bOutcome.unprovided_capabilities.includes("code_modification"));

// ---------- accounting ----------
const acc = resolveAccountingRequirement();
const eOutcome = resolveResources({ required_capabilities: ["business_database_read"], requires_paid_service: false, needs_workspace: false });
ok("A1. ACCOUNTING_REQUIRED_CAPABILITY_RESOLVES = business_database_read", acc.required_capability === "business_database_read");
ok("A2. ACCOUNTING_MATCHING_RESOURCE = 0 (สถานะจริงที่ถูกต้อง)", eOutcome.matching.length === 0 && acc.matching_resource_ids.length === 0);
ok("A3. อธิบายได้โดยไม่เอ่ยชื่อผู้ให้บริการ", !/postgres|supabase|mysql|mongo|claude|codex/i.test(eOutcome.explanation));

// ---------- ไม่แตะของเดิม ----------
const routerSrc = read("control/command-router/router.ts");
ok("C1. PRODUCTION_ROUTER_CHANGED = NO", routerSrc.includes('if (normalized.includes("codex")) return "CODEX";') && !routerSrc.includes("execution-profile"));
ok("C2. WORKORDER_CONTRACT_CHANGED = NO", read("control/agent-gateway/types.ts").includes('worker_kind: "CLAUDE" | "CODEX" | "GEMINI" | "LOCAL"'));
ok("C3. shadow resolver ไม่ถูก import จาก production routing",
  !readFileSync(join(process.cwd(), "control/agent-gateway/agent-host-dispatch.ts"), "utf8").includes("shadow-resolver"));

console.log(`\n${failures === 0 ? "ALL PASSED" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
