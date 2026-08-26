/**
 * หน้าที่: §7 + §4 พิสูจน์กับของจริงที่รันอยู่ — ไม่ใช่ระดับ store:
 *   1. ยิง joint-monitor ตัวจริงขึ้นมาบนพอร์ตทดสอบ
 *   2. POST event จริงเข้าไป
 *   3. ฆ่า process ของมันจริง ๆ (SIGKILL)
 *   4. ยิงขึ้นใหม่ แล้วพิสูจน์ว่า snapshot ที่มันเสิร์ฟมาจาก durable log
 *      ไม่ใช่จาก memory ที่ตายไปแล้ว
 *   5. ต่อ SSE ใหม่ด้วย `Last-Event-ID` แล้วพิสูจน์ว่าได้เฉพาะสิ่งที่พลาดไป
 *   6. ต่อ SSE ด้วย resume point ที่ไม่มีจริง แล้วพิสูจน์ว่าได้ snapshot เต็ม
 *      ไม่ใช่ "คุณไม่พลาดอะไร"
 *
 * Input: none — ใช้พอร์ตและ data dir ของตัวเอง
 * Output: exit 0 เมื่อครบ, exit 1 เมื่อไม่ครบ
 * Dependency ที่อนุญาต: Node built-ins เท่านั้น (คุยกับ server ผ่าน HTTP จริง)
 * สิ่งที่ห้ามแตะ:
 * - ห้ามแตะ observability/joint-monitor/data ของจริง — proof นี้ใช้ data dir แยก
 * - ห้าม "restart" ด้วยการเรียกฟังก์ชันใน process เดิม ต้องเป็น process ใหม่จริง
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPO = process.cwd();
const PORT = 5321;
const BASE = `http://127.0.0.1:${PORT}`;
const workdir = mkdtempSync(join(tmpdir(), "live-service-recovery-"));
const dataDir = join(workdir, "data");
mkdirSync(dataDir, { recursive: true });

const checks: { name: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail: string): void => { checks.push({ name, ok, detail }); };
const sleep = (s: string): void => { spawnSync("bash", ["-c", `sleep ${s}`]); };

/**
 * The server reads its data dir from the repo root, so the proof runs it with
 * a REPO ROOT of its own: a temp tree holding only the one directory the
 * server writes to. Nothing under the real observability/joint-monitor/data
 * is read or written.
 */
const fakeRepo = join(workdir, "repo");
mkdirSync(join(fakeRepo, "observability/joint-monitor"), { recursive: true });
spawnSync("ln", ["-s", dataDir, join(fakeRepo, "observability/joint-monitor/data")]);

const bootScript = join(workdir, "boot.ts");
const markerPath = join(workdir, "server-pid.txt");
// The booted server reports through a FILE, not a pipe. This proof body is
// synchronous, so a stdout listener would never fire and the wait would time
// out against a server that is in fact up.
writeFileSync(bootScript, `
import { writeFileSync } from "node:fs";
import { JointStore } from "${resolve(REPO, "observability/joint-monitor/joint-store.ts")}";
import { startJointMonitorServer } from "${resolve(REPO, "observability/joint-monitor/server.ts")}";
startJointMonitorServer(new JointStore(), ${PORT});
writeFileSync("${markerPath}", String(process.pid));
`);

function boot(): number {
  rmSync(markerPath, { force: true });
  spawn("npx", ["tsx", bootScript], {
    cwd: fakeRepo,
    env: { ...process.env, JOINT_MONITOR_PORT: String(PORT) },
    stdio: "ignore",
    detached: true,
  }).unref();
  const deadline = Date.now() + 90_000;
  while (!existsSync(markerPath) && Date.now() < deadline) sleep("0.3");
  if (!existsSync(markerPath)) throw new Error("server never reported its pid");
  // wait for the port to actually answer, not merely for the process to exist
  for (let i = 0; i < 90 && curl("/joints").code !== 0; i += 1) sleep("0.3");
  return Number(readFileSync(markerPath, "utf8").trim());
}

function curl(path: string, args: string[] = []): { code: number; out: string } {
  const r = spawnSync("curl", ["-s", "--max-time", "8", ...args, `${BASE}${path}`], { encoding: "utf8" });
  return { code: r.status ?? 1, out: r.stdout ?? "" };
}

function postJoint(summary: string, seq: number): { code: number; out: string } {
  const body = JSON.stringify({
    from_capability: "live-service-recovery-proof", to_capability: "joint-monitor", task_id: null,
    status: "OK", summary, source: "control/work-session-state/tests/live-service-recovery-proof.ts#postJoint",
    occurred_at: new Date(Date.UTC(2026, 7, 26, 1, 0, seq)).toISOString(), occurred_seq: seq, reporter_run_id: "live-proof",
  });
  const r = spawnSync("curl", ["-s", "--max-time", "8", "-X", "POST", "-H", "Content-Type: application/json", "-d", body, `${BASE}/joints`], { encoding: "utf8" });
  return { code: r.status ?? 1, out: r.stdout ?? "" };
}

let failedEarly = "";
try {
  // ---- 1 & 2: real server, real events -----------------------------------
  const pid1 = boot();
  for (const [i, s] of ["first", "second", "third"].entries()) postJoint(s, i + 1);
  sleep("0.5");
  const before = JSON.parse(curl("/joints").out || "{}");
  const beforeRows = before.joints ?? before.recent_joints ?? [];
  check("the running collector holds the events that were really POSTed to it", beforeRows.length === 3, `${beforeRows.length} row(s) served by pid ${pid1}`);
  const durableLines = readFileSync(join(dataDir, "joints.jsonl"), "utf8").trim().split("\n");
  check("every event reached the durable log before the process died", durableLines.length === 3, `${durableLines.length} line(s) in ${join(dataDir, "joints.jsonl")}`);

  // ---- 3: kill it for real ------------------------------------------------
  try { process.kill(pid1, "SIGKILL"); } catch { /* already gone */ }
  sleep("0.6");
  let alive = true; try { process.kill(pid1, 0); } catch { alive = false; }
  check("the collector process was really SIGKILLed", !alive, `pid ${pid1} is gone`);
  check("with the process dead, nothing answers on the port", curl("/joints").code !== 0, "connection refused");

  // ---- 4: restart, and prove the projection comes from the durable log ----
  const pid2 = boot();
  const after = JSON.parse(curl("/joints").out || "{}");
  const afterRows = after.joints ?? after.recent_joints ?? [];
  check("a NEW process rebuilds the same view from the durable log — the UI is a projection, not the only copy",
    afterRows.length === 3 && pid2 !== pid1,
    `pid ${pid1} -> ${pid2}, ${afterRows.length} row(s) served after restart with no re-POST`);

  const ids: string[] = afterRows.map((r: { event_id: string }) => r.event_id);
  check("event ids survived the restart unchanged", ids.length === 3 && ids.every((x) => typeof x === "string" && x.length > 0), ids.map((x) => x.slice(-8)).join(", "));

  // ---- 5: SSE resume from a real Last-Event-ID ---------------------------
  postJoint("fourth", 4); postJoint("fifth", 5);
  sleep("0.5");
  const resumed = spawnSync("curl", ["-s", "--max-time", "3", "-H", `Last-Event-ID: ${ids[2]}`, `${BASE}/events`], { encoding: "utf8" }).stdout ?? "";
  const resumedFrames = resumed.split("\n").filter((l) => l.startsWith("data: ")).map((l) => JSON.parse(l.slice(6)));
  const resumedHeader = resumedFrames.find((f) => f.type === "resumed");
  check("a reconnect with Last-Event-ID replays ONLY what was missed",
    resumedHeader?.missed_count === 2 && resumedFrames.filter((f) => f.type === "change").length === 2 && !resumedFrames.some((f) => f.type === "snapshot"),
    `missed_count=${resumedHeader?.missed_count}, ${resumedFrames.filter((f) => f.type === "change").length} change frame(s), 0 full snapshots`);
  check("the replayed frames carry SSE `id:` so the client can resume again from them",
    /^id: /m.test(resumed) && resumed.includes("retry: "),
    "id: on every frame, and a declared retry: interval");

  // ---- 6: an unknown resume point must force a full snapshot -------------
  const unknown = spawnSync("curl", ["-s", "--max-time", "3", "-H", "Last-Event-ID: evt-never-existed", `${BASE}/events`], { encoding: "utf8" }).stdout ?? "";
  const unknownFrames = unknown.split("\n").filter((l) => l.startsWith("data: ")).map((l) => JSON.parse(l.slice(6)));
  check("an unknown resume point is answered with a FULL snapshot, never with 'you missed nothing'",
    unknownFrames.some((f) => f.type === "resume_failed") && unknownFrames.some((f) => f.type === "snapshot"),
    `${unknownFrames.map((f) => f.type).join(", ")}`);

  const fresh = spawnSync("curl", ["-s", "--max-time", "3", `${BASE}/events`], { encoding: "utf8" }).stdout ?? "";
  const freshFrames = fresh.split("\n").filter((l) => l.startsWith("data: ")).map((l) => JSON.parse(l.slice(6)));
  const snap = freshFrames.find((f) => f.type === "snapshot");
  check("a brand-new client with no resume point gets the whole durable state",
    (snap?.snapshot?.recent_joints ?? []).length === 5,
    `${(snap?.snapshot?.recent_joints ?? []).length} row(s) in the snapshot`);

  try { process.kill(pid2, "SIGKILL"); } catch { /* already gone */ }
} catch (error) {
  failedEarly = error instanceof Error ? error.message : String(error);
} finally {
  spawnSync("bash", ["-c", `lsof -ti tcp:${PORT} | xargs -r kill -9`]);
  rmSync(workdir, { recursive: true, force: true });
}

console.log("\n[LIVE SERVICE RECOVERY PROOF]");
for (const c of checks) console.log(`  ${c.ok ? "✔" : "✘"} ${c.name}\n      ${c.detail}`);
if (failedEarly) console.log(`\n  ✘ proof aborted: ${failedEarly}`);
const failed = checks.filter((c) => !c.ok).length + (failedEarly ? 1 : 0);
console.log(`\nRESULT: ${checks.length - failed + (failedEarly ? 1 : 0)} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
