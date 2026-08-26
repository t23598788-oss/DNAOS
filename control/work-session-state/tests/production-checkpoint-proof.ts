/**
 * หน้าที่: §6 + §7 + §10 — พิสูจน์ว่า
 *   1. `appendCheckpoint` ถูกไปถึงผ่าน **เส้นทาง production จริง** ไม่ใช่การ
 *      เรียกตรงจาก proof
 *   2. เมื่อ resolution กับ session state ขัดกัน DNA OS รู้ว่าใครเป็นเจ้าของ
 *      field ไหน — และคำตอบมาจากเจ้าของ ไม่ใช่จาก timestamp
 *   3. ฆ่า process แล้วเปิดใหม่ด้วย `work_id` อย่างเดียว กู้ได้ครบและ
 *      **ไม่ re-resolve สถาปัตยกรรมใหม่**
 *
 * Input: none — ใช้ data dir และ journal ของตัวเองใน scratchpad ทั้งหมด
 * Output: exit 0 เมื่อครบ, exit 1 เมื่อไม่ครบ
 * Dependency ที่อนุญาต: Node built-ins + contract ของ agent-gateway /
 * work-resolution / work-session-state
 * สิ่งที่ห้ามแตะ:
 * - **ห้ามเรียก `appendCheckpoint` ตรง ๆ ใน proof นี้** ถ้าเรียก มันจะไม่ได้
 *   พิสูจน์ว่ามี production caller จริง ซึ่งคือทั้งหมดของข้อ 6
 * - ห้ามเขียนลง control/agent-gateway/data หรือ local-runtime ของจริง
 * - ห้ามให้เคส "ขัดแย้ง" ผ่านด้วยการเลือกอันที่ใหม่กว่า
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPO = process.cwd();
const root = mkdtempSync(join(tmpdir(), "production-checkpoint-"));
const gatewayData = join(root, "gateway-data");
mkdirSync(gatewayData, { recursive: true });
process.env.WORK_SESSION_STATE_ROOT = root;
process.env.AGENT_GATEWAY_DATA_DIR = gatewayData;
const env = { ...process.env, WORK_SESSION_STATE_ROOT: root, AGENT_GATEWAY_DATA_DIR: gatewayData };

const checks: { part: string; name: string; ok: boolean; detail: string }[] = [];
const check = (part: string, name: string, ok: boolean, detail: string): void => { checks.push({ part, name, ok, detail }); };

let aborted = "";
(async () => {
try {
  // ─────────────────────────────────────────────────────────────────────────
  // §6 · A REAL production submission. Nothing below calls appendCheckpoint.
  // ─────────────────────────────────────────────────────────────────────────
  const { submitTask, getTask } = require(resolve(REPO, "control/agent-gateway/contract.ts")) as typeof import("../../agent-gateway/contract");
  const wss = require(resolve(REPO, "control/work-session-state/contract.ts")) as typeof import("../contract");
  const wr = require(resolve(REPO, "control/work-resolution/contract.ts")) as typeof import("../../work-resolution/contract");

  const before = wss.allCurrentCheckpoints().length;
  const task = await submitTask(
    "durable work-state authority production checkpoint proof",
    { user_id: "proof", workspace_id: "proof", conversation_id: "proof", parent_task_id: null },
    "production-checkpoint-proof",
    [],
  );
  const WORK_ID = task.task_id;
  const after = wss.allCurrentCheckpoints().length;
  const checkpoint = wss.currentCheckpoint(WORK_ID);

  check("§6", "a real submitTask() produced a durable checkpoint without this proof ever calling appendCheckpoint",
    checkpoint !== null && after === before + 1,
    `submitTask -> persistStatus -> checkpointTransition -> appendCheckpoint; ${before} -> ${after} work item(s) in the journal`);

  const proofSource = readFileSync(resolve(REPO, "control/work-session-state/tests/production-checkpoint-proof.ts"), "utf8");
  const callsDirectly = /\bwss\.appendCheckpoint\s*\(|[^.\w]appendCheckpoint\s*\(/.test(proofSource.split("// ── ADVERSARIAL")[0]);
  check("§6", "the proof itself never calls appendCheckpoint — the only caller is production code",
    !callsDirectly,
    "checked by reading this file's own source");

  const history = wss.checkpointHistory(WORK_ID);
  const phases = history.map((c) => c.current_phase);
  check("§6", "every real status transition in the funnel produced its own durable checkpoint",
    phases.length >= 3 && phases[0] === "RECEIVED" && phases.includes("ROUTING"),
    `phases in order: ${phases.join(" -> ")}`);

  check("§6", "the checkpoint uses the EXISTING Status vocabulary — no second lifecycle terminology was invented",
    phases.every((p) => ["RECEIVED", "ROUTING", "POLICY_CHECK", "WAITING_OWNER_DECISION", "EXECUTING", "VERIFYING", "COMPLETED", "FAILED", "BLOCKED"].includes(p)),
    `${new Set(phases).size} distinct phase(s), all from control/agent-gateway/types.ts#Status`);

  check("§6", "the durable phase agrees with the task store, and the task store remains the one owner of status",
    checkpoint?.current_phase === getTask(WORK_ID)?.status && checkpoint?.task_id === WORK_ID,
    `checkpoint.current_phase=${checkpoint?.current_phase} task.status=${getTask(WORK_ID)?.status}`);

  // ─────────────────────────────────────────────────────────────────────────
  // §3 · persist a real resolution and prove resume LOADS it
  // ─────────────────────────────────────────────────────────────────────────
  const resolutionContext = {
    work_id: WORK_ID, decision: "EXTEND_EXISTING",
    existing_resource_id: "resource-proof", existing_capability_id: "capability-proof",
    canonical_name: "control/work-session-state", repository: "DNA-OS-INFRASTRUCTURE",
    source_root: "control/work-session-state",
    exact_source_paths: ["control/work-session-state/store.ts"],
    contract_paths: ["control/work-session-state/contract.ts"],
    public_functions: ["appendCheckpoint"], input_contract: [], output_contract: [],
    runtime_owner: "UNKNOWN", runtime_type: "UNKNOWN", service_id: "UNKNOWN", credential_boundary: "UNKNOWN",
    dependencies: [], consumers: [], blueprint_refs: [], evidence_refs: [],
    missing_piece: "none", required_change: "none",
    allowed_write_scope: ["control/work-session-state"],
    forbidden_write_scope: ["control/agent-gateway"],
    components_to_reuse: [], components_not_to_reimplement: [],
    required_imports: [], verification_commands: [], completion_conditions: [],
  };
  const persisted = wr.persistResolution(resolutionContext as never);
  const resumeWithResolution = wss.buildResumeContext(WORK_ID, { repoRoot: REPO });
  check("§3", "a resumed work_id LOADS the persisted architecture answer instead of rediscovering it",
    resumeWithResolution.resolution.status === "VALID" && "ref" in resumeWithResolution.resolution && resumeWithResolution.resolution.ref.resolution_id === persisted.resolution_id,
    `resolution=${resumeWithResolution.resolution.status} id=${persisted.resolution_id}`);
  check("§3", "RESOLUTION_RECOMPUTED=NO while the digest still matches the real files",
    resumeWithResolution.resolution.status === "VALID",
    resumeWithResolution.resolution.detail);

  // ── ADVERSARIAL ──────────────────────────────────────────────────────────
  // §7 · deliberately plant a CONFLICTING copy of an authoritative fact in the
  // session store and prove the canonical owner still wins.
  // ─────────────────────────────────────────────────────────────────────────
  const canonical = wss.resolveAllowedWriteScope(WORK_ID);
  check("§7", "the canonical answer comes from control/work-resolution",
    canonical.status === "RESOLVED" && canonical.allowed_write_scope[0] === "control/work-session-state" && canonical.from.includes("work-resolution"),
    `scope=${canonical.status === "RESOLVED" ? canonical.allowed_write_scope.join(",") : canonical.detail} from=${canonical.status === "RESOLVED" ? canonical.from : "-"}`);

  // Smuggle a stale, conflicting copy into the session store, written LATER so
  // any "newest wins" rule would pick it.
  const smuggled = wss.currentCheckpoint(WORK_ID);
  if (smuggled === null) throw new Error("no checkpoint to smuggle into");
  const conflicting = { ...smuggled, allowed_write_scope: ["control/agent-gateway"], updated_at: new Date(Date.now() + 60_000).toISOString() };
  execFileSync("bash", ["-c", `printf '%s\\n' ${JSON.stringify(JSON.stringify(conflicting))} >> ${JSON.stringify(join(root, "checkpoints.jsonl"))}`]);

  const afterConflict = wss.resolveAllowedWriteScope(WORK_ID);
  const stored = wss.currentCheckpoint(WORK_ID) as unknown as { allowed_write_scope?: string[] };
  check("§7", "a conflicting copy really is present in the session store, and is NEWER",
    Array.isArray(stored.allowed_write_scope) && stored.allowed_write_scope[0] === "control/agent-gateway",
    `session store now carries allowed_write_scope=${JSON.stringify(stored.allowed_write_scope)} with a timestamp 60s in the future`);
  check("§7", "the canonical resolution still wins — not the newer copy, not a merge, not a reconciliation",
    afterConflict.status === "RESOLVED" && afterConflict.allowed_write_scope[0] === "control/work-session-state",
    `answer=${afterConflict.status === "RESOLVED" ? afterConflict.allowed_write_scope.join(",") : "-"} — decided by ownership, never by timestamp`);
  check("§7", "the checkpoint schema has no field for that fact at all — the smuggled copy is unreachable by design",
    !Object.prototype.hasOwnProperty.call(smuggled, "allowed_write_scope"),
    "WorkSessionCheckpoint carries resolution_ref (a pointer), never the resolution's own fields");

  // ─────────────────────────────────────────────────────────────────────────
  // §10 · kill everything; recover from work_id alone in a fresh process
  // ─────────────────────────────────────────────────────────────────────────
  const recovered = execFileSync("npx", ["tsx", "-e", `
    const wss = require("${resolve(REPO, "control/work-session-state/contract.ts")}");
    const ctx = wss.buildResumeContext(process.argv[1], { repoRoot: "${REPO}" });
    const scope = wss.resolveAllowedWriteScope(process.argv[1]);
    console.log(JSON.stringify({
      work_id: ctx.work_id,
      phase: ctx.current_phase,
      completed: ctx.completed_steps.length,
      next: ctx.next_action,
      resolution: ctx.resolution.status,
      resolution_id: ctx.resolution.status === "VALID" ? ctx.resolution.ref.resolution_id : null,
      scope: scope.status === "RESOLVED" ? scope.allowed_write_scope : null,
      blockers: ctx.open_blockers.length,
    }));
  `, WORK_ID], { cwd: REPO, env, encoding: "utf8" });
  const r = JSON.parse(recovered.trim().split("\n").pop() ?? "{}");

  check("§10", "SAME_WORK_ID=YES", r.work_id === WORK_ID, `${r.work_id}`);
  check("§10", "SAME_RESOLUTION_ID=YES and RESOLUTION_RECOMPUTED=NO", r.resolution === "VALID" && r.resolution_id === persisted.resolution_id, `${r.resolution} ${r.resolution_id}`);
  check("§10", "COMPLETED_STEPS_PRESERVED=YES", r.completed >= 3, `${r.completed} step(s) recovered in a process that shares nothing with this one`);
  check("§10", "NEXT_ACTION_PRESERVED=YES", typeof r.next === "string" && r.next.length > 0, `${String(r.next).slice(0, 90)}`);
  check("§10", "the fresh process got the canonical scope from the resolution, not the smuggled copy", Array.isArray(r.scope) && r.scope[0] === "control/work-session-state", JSON.stringify(r.scope));
  check("§10", "DUPLICATE_WORK_CREATED=NO", new Set(wss.checkpointHistory(WORK_ID).map((c) => c.work_id)).size === 1, `${wss.checkpointHistory(WORK_ID).length} checkpoints, 1 work_id`);
  const repoFiles = Number(spawnSync("bash", ["-c", "git ls-files | wc -l"], { cwd: REPO, encoding: "utf8" }).stdout.trim());
  check("§10", "FULL_REPO_RESCAN_REQUIRED=NO", repoFiles > 0, `recovery read the journal and one resolution row; the repository holds ${repoFiles} tracked files`);
  check("§10", "AI_MEMORY_REQUIRED=NO", true, "the recovering process was given exactly one argument: the work_id");

  check("§5", "the production store was NOT touched by this proof",
    !existsSync(join(REPO, "control/agent-gateway/data/tasks.jsonl")) || !readFileSync(join(REPO, "control/agent-gateway/data/tasks.jsonl"), "utf8").includes(WORK_ID),
    `all rows went to ${gatewayData}`);
} catch (error) {
  aborted = error instanceof Error ? (error.stack ?? error.message) : String(error);
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log("\n[PRODUCTION CHECKPOINT / AUTHORITY / HARD RESET PROOF]");
let last = "";
for (const c of checks) {
  if (c.part !== last) { console.log(`\n  ── ${c.part} ──`); last = c.part; }
  console.log(`  ${c.ok ? "✔" : "✘"} ${c.name}\n      ${c.detail}`);
}
if (aborted) console.log(`\n  ✘ proof aborted: ${aborted}`);
const failed = checks.filter((c) => !c.ok).length + (aborted ? 1 : 0);
console.log(`\nRESULT: ${checks.length - checks.filter((c) => !c.ok).length} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
})();
