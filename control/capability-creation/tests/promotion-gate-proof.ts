/**
 * หน้าที่: §8 พิสูจน์ว่า capability-promotion เรียก GATE 2 ตัวเดิมจริง และ
 * candidate ที่ยังไม่ต่อสายถูก **ปฏิเสธพร้อมเหตุผลที่ระบุชัด** ไม่ใช่คำว่า
 * "ยังไม่สมบูรณ์"
 *
 * ประเด็นที่ต้องระวังและพิสูจน์ด้วย: ประตูนี้ **ลบได้อย่างเดียว ไม่เคยบวก**
 * REJECT ไม่มีทางกลายเป็น PROMOTE เพราะการต่อสายครบ
 *
 * Input: none
 * Output: exit 0 เมื่อครบ, exit 1 เมื่อไม่ครบ
 * Dependency ที่อนุญาต: Node built-ins + contract ของ agent-gateway / capability-creation
 * สิ่งที่ห้ามแตะ:
 * - ห้ามสร้าง promotion gate ตัวที่สอง — ต้องเป็น GATE 2 ตัวเดิม
 * - ห้ามให้ candidate ที่ต่อสายไม่ครบผ่านด้วยการอ่อนข้อ
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO = process.cwd();
const promotion = require(resolve(REPO, "control/agent-gateway/capability-promotion.ts")) as typeof import("../../agent-gateway/capability-promotion");

const checks: { name: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail: string): void => { checks.push({ name, ok, detail }); };

const pass = { ok: true, reason_codes: [] as string[] } as never;
const buildPass = { status: "PASS" } as never;
const securityPass = { ok: true } as never;
const contractPass = { ok: true, missing_contract_fields: [] as string[] } as never;

function candidateFor(integrationPoint: string, name: string, outputs: string[] = ["someExportedThing"]) {
  return {
    protocol: "CAPABILITY_CANDIDATE_V1", candidate_id: `cand-${name}`, revision_id: `rev-${name}`,
    command_id: "cmd", work_order_id: `wo-${name}`, workspace_id: "ws", result_id: "res",
    capability_name: name, capability_type: "COMPONENT",
    artifact_manifest: [], artifact_hashes: {},
    declared_inputs: ["control/command-router/router.ts"], declared_outputs: outputs,
    dependencies: [], requested_integration_point: integrationPoint,
    created_at: new Date().toISOString(), workspace_root: "/tmp/ws",
  } as never;
}

// ── the gate is the EXISTING one, called — not a copy ────────────────────────
const src = readFileSync(resolve(REPO, "control/agent-gateway/capability-promotion.ts"), "utf8");
check("capability-promotion CALLS control/capability-creation's GATE 2 rather than reimplementing it",
  src.includes('require("../capability-creation/contract")') && src.includes("evaluateCompletionGate"),
  "one gate, called from the promotion decision");
check("the connection answer can only SUBTRACT from a decision",
  src.includes("connectionBlocks") && src.indexOf("if (hardFail)") < src.indexOf("} else if (connectionBlocks)"),
  "hardFail is evaluated first, so a REJECT can never become a PROMOTE by being well connected");

// ── a REAL capability folder that nothing reaches -> held back ───────────────
const unconnected = promotion.decidePromotion(
  candidateFor("control/capability-creation", "unconnected-proof", ["thisSymbolIsReferencedNowhere"]),
  pass, buildPass, buildPass, securityPass, contractPass,
);
check("a candidate whose work is clean but which nothing can reach is NOT promoted",
  unconnected.decision !== "PROMOTE",
  `decision=${unconnected.decision}`);
check("the refusal names the EXACT missing connection, not 'incomplete'",
  unconnected.reasons.some((r) => r.startsWith("NOT_CONNECTED:")) && unconnected.reasons.some((r) => r.startsWith("INPUT:") || r.startsWith("ROUTING:") || r.startsWith("OUTPUT:")),
  unconnected.reasons.slice(0, 4).join(" · "));
check("it is CORRECTION_REQUIRED, not REJECT — the candidate's own work was fine",
  unconnected.decision === "CORRECTION_REQUIRED",
  "a missing connection is correctable work, not a rejection of the candidate");

// ── a candidate this question cannot be asked about is not blocked by it ─────
const notAssessable = promotion.decidePromotion(
  candidateFor("control/agent-gateway/tests (phase3 proof)", "not-assessable-proof"),
  pass, buildPass, buildPass, securityPass, contractPass,
);
check("a candidate whose integration point is not a real capability folder is NOT blocked by this gate",
  notAssessable.decision === "PROMOTE" && !notAssessable.reasons.some((r) => r.startsWith("NOT_CONNECTED:")),
  `decision=${notAssessable.decision} — an unanswerable question is not a failed answer`);

// ── a hard failure still wins over everything ───────────────────────────────
const rejected = promotion.decidePromotion(
  candidateFor("control/capability-creation", "hardfail-proof"),
  { ok: false, reason_codes: ["ARTIFACT_HASH_MISMATCH"] } as never, buildPass, buildPass, securityPass, contractPass,
);
check("a real hard failure still REJECTS regardless of connection state",
  rejected.decision === "REJECT" && rejected.reasons.includes("ARTIFACT_HASH_MISMATCH"),
  `decision=${rejected.decision} reasons=${rejected.reasons.join(",")}`);

console.log("\n[PROMOTION CONNECTION GATE PROOF]");
for (const c of checks) console.log(`  ${c.ok ? "✔" : "✘"} ${c.name}\n      ${c.detail}`);
const failed = checks.filter((c) => !c.ok).length;
console.log(`\nRESULT: ${checks.length - failed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
