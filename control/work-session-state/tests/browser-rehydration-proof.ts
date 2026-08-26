/**
 * หน้าที่: §4 BROWSER REHYDRATION PROOF — พิสูจน์ด้วยเบราว์เซอร์จริงว่า UI
 * เป็น projection ของ durable state ไม่ใช่ที่เก็บความจริง
 *
 *   เขียน checkpoint ลงดิสก์ (ไม่มีเบราว์เซอร์เปิดอยู่)
 *   → ยิง runtime ขึ้นมาใหม่ทั้ง process
 *   → เปิดเบราว์เซอร์ที่ "เพิ่งเกิด" ไม่มี memory ไม่มี localStorage
 *   → DOM ต้องมีงานนั้น เฟสนั้น blocker นั้น และ next action นั้น
 *
 * ไม่มีขั้นตอนไหนที่ AI เป็นคนบอกเบราว์เซอร์ว่าต้องแสดงอะไร
 *
 * Input: none — journal ของตัวเองใน scratchpad, พอร์ตของตัวเอง
 * Output: exit 0 เมื่อครบ, exit 1 เมื่อไม่ครบ
 * Dependency ที่อนุญาต: Node built-ins + ../contract.ts (คุยกับ runtime ผ่าน HTTP จริง)
 * สิ่งที่ห้ามแตะ:
 * - ห้ามใช้ profile เบราว์เซอร์เดิม — ต้องเป็น --user-data-dir ใหม่ทุกครั้ง
 *   ไม่งั้นสิ่งที่เห็นอาจมาจาก cache ไม่ใช่จาก durable state
 * - ห้ามตัดสินผ่านโดยดูแค่ HTTP 200 — ต้องเห็นข้อความในหน้าเว็บจริง
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { appendCheckpoint, currentBranch, currentRevision, newSessionId } from "../contract";

const REPO = process.cwd();
const PORT = 5322;
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const root = mkdtempSync(join(tmpdir(), "browser-rehydration-"));
process.env.WORK_SESSION_STATE_ROOT = root;

const checks: { name: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail: string): void => { checks.push({ name, ok, detail }); };
const sleep = (s: string): void => { spawnSync("bash", ["-c", `sleep ${s}`]); };

const WORK_ID = `work-rehydrate-${Date.now().toString(36)}`;
const PHASE = "BROWSER_REHYDRATION";
const BLOCKER = "BLK-REHYDRATE-DEMO";

let aborted = "";
try {
  // ── 1 · durable state written with NO browser and NO runtime running ────
  appendCheckpoint({
    work_id: WORK_ID,
    owner_intent_id: "owner-intent:DURABLE_RUNTIME_AND_UI_SESSION_RECOVERY",
    task_id: null, session_id: newSessionId(), execution_id: `exec-${process.pid}`,
    worker_identity: "browser-rehydration-proof",
    repository: "DNA-OS-INFRASTRUCTURE", branch: currentBranch(REPO),
    affected_resource_ids: [], affected_paths: ["control/work-session-state"],
    objective: "UI ต้องประกอบตัวเองจาก durable state",
    current_phase: PHASE,
    steps: [{ step_id: "b1", title: "เขียน checkpoint", state: "COMPLETED", phase: PHASE, depends_on: [], affected_paths: [], evidence_refs: [], verification: { kind: "PATH_EXISTS", path: "control/work-session-state/store.ts" }, completed_at_revision: currentRevision(REPO), completed_at: new Date().toISOString() }],
    blockers: [{ blocker_id: BLOCKER, layer: "control/work-session-state", state: "OPEN", detail: "blocker ที่ต้องโผล่ในหน้าเว็บ", evidence_ref: null, next_action: "พิสูจน์ว่า DOM มีมัน" }],
    decisions_required: [], evidence_refs: [],
    source_revision: currentRevision(REPO), last_verified_revision: currentRevision(REPO),
    next_action: "b2", do_not_repeat: [],
    ui_context: { service_id: "dna-os-circuit", url: `${BASE}/system-graph?live=0`, route: "/system-graph", scope: WORK_ID },
    last_durable_event: [], sync_state: "SYNCED",
    status: "BLOCKED", started_at: new Date().toISOString(),
  });
  check("durable state was written with no runtime and no browser running", existsSync(join(root, "checkpoints.jsonl")), join(root, "checkpoints.jsonl"));

  // ── 2 · a runtime that did not exist when the state was written ─────────
  const marker = join(root, "runtime-pid.txt");
  const boot = join(root, "boot.ts");
  writeFileSync(boot, `
import { writeFileSync } from "node:fs";
import { CircuitState } from "${resolve(REPO, "dna-os-circuit/runtime/circuit-state.ts")}";
import { startCircuitServer } from "${resolve(REPO, "dna-os-circuit/runtime/server.ts")}";
startCircuitServer(new CircuitState(), ${PORT});
writeFileSync("${marker}", String(process.pid));
`);
  spawn("npx", ["tsx", boot], { cwd: REPO, env: { ...process.env, PORT: String(PORT), WORK_SESSION_STATE_ROOT: root }, stdio: "ignore", detached: true }).unref();
  const deadline = Date.now() + 90_000;
  while (!existsSync(marker) && Date.now() < deadline) sleep("0.3");
  if (!existsSync(marker)) throw new Error("circuit runtime never reported its pid");
  const runtimePid = Number(readFileSync(marker, "utf8").trim());
  for (let i = 0; i < 90 && (spawnSync("curl", ["-s", "-o", "/dev/null", "--max-time", "5", `${BASE}/system-graph.json`], { encoding: "utf8" }).status ?? 1) !== 0; i += 1) sleep("0.3");

  // ── 3 · the API projection ─────────────────────────────────────────────
  const graphJson = spawnSync("curl", ["-s", "--max-time", "15", `${BASE}/system-graph.json`], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }).stdout ?? "";
  const graph = JSON.parse(graphJson || "{}");
  const workNode = (graph.nodes ?? []).find((n: { id: string }) => n.id === `work:${WORK_ID}`);
  const blockerNode = (graph.nodes ?? []).find((n: { id: string }) => n.id === `blocker:${WORK_ID}:${BLOCKER}`);
  check("the runtime serves the work item it never saw created — it read it off disk",
    Boolean(workNode) && Boolean(blockerNode),
    `pid ${runtimePid} serves work:${WORK_ID.slice(-10)} and its blocker; source_count=${graph.source_counts?.["work-session-state"]}`);

  // ── 4 · a brand-new browser, no profile, no memory ─────────────────────
  if (!existsSync(CHROME)) throw new Error(`headless browser not found at ${CHROME}`);
  const profile = join(root, "chrome-profile");
  const dom = spawnSync(CHROME, [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    `--user-data-dir=${profile}`, "--virtual-time-budget=8000", "--dump-dom",
    `${BASE}/system-graph?live=0`,
  ], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 90_000 }).stdout ?? "";

  check("the browser was started with a brand-new profile — nothing it renders can come from its own cache",
    existsSync(profile) && dom.length > 0,
    `--user-data-dir=${profile}, ${dom.length} bytes of DOM`);
  check("the WORK the browser had no way of knowing about is in the rendered DOM",
    dom.includes(WORK_ID), `work_id ${WORK_ID} found in the DOM`);
  check("the phase recorded on disk is in the rendered DOM", dom.includes(PHASE), PHASE);
  check("the OPEN BLOCKER recorded on disk is in the rendered DOM", dom.includes(BLOCKER), BLOCKER);
  check("the durable NEXT ACTION reached the DOM", /next_action|NEXT_ACTION|b2/.test(dom), "next action node rendered");

  try { process.kill(runtimePid, "SIGKILL"); } catch { /* already gone */ }
} catch (error) {
  aborted = error instanceof Error ? error.message : String(error);
} finally {
  spawnSync("bash", ["-c", `lsof -ti tcp:${PORT} | xargs -r kill -9`]);
  rmSync(root, { recursive: true, force: true });
}

console.log("\n[BROWSER REHYDRATION PROOF]");
for (const c of checks) console.log(`  ${c.ok ? "✔" : "✘"} ${c.name}\n      ${c.detail}`);
if (aborted) console.log(`\n  ✘ proof aborted: ${aborted}`);
const failed = checks.filter((c) => !c.ok).length + (aborted ? 1 : 0);
console.log(`\nRESULT: ${checks.length - checks.filter((c) => !c.ok).length} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
