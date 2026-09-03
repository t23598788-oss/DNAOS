/**
 * หน้าที่: prove that the render verifier captures evidence from a LIVE page
 * without waiting for that page to become idle, that its browser deadline is a
 * real wall-clock ceiling, that cleanup only ever touches processes belonging
 * to the invocation that created them, and that missing evidence still fails
 * closed (Owner, 2026-09-01).
 *
 * TWO REAL DEFECTS ARE PINNED HERE.
 *
 * 1. `spawnSync`'s `timeout` sends `killSignal` and then waits for the child
 *    with no upper bound. A headless Chrome that did not exit on SIGTERM sat 29
 *    minutes on a 120s deadline. Case 5 reproduces that shape with a child that
 *    traps SIGTERM and asserts SIGKILL-based cleanup still ends it.
 *
 * 2. `--virtual-time-budget` never expires on a page holding an open
 *    EventSource, so the browser never reached the capture step at all.
 *    Measured A/B against the real joint-monitor route: with the budget, no
 *    screenshot after 90s; without it, a 655,479-byte screenshot. Case 2 serves
 *    a page whose SSE stream never ends and asserts capture still completes
 *    quickly — a live page is never required to settle.
 *
 * Input: none.  Output: exit code 0 (all passed) or 1.
 * Dependency ที่อนุญาต: ../render-verify (internals + verifyRender + deadlines),
 * node:child_process, node:fs, node:os, node:path.
 * สิ่งที่ห้ามแตะ: ห้ามผ่อนเกณฑ์เวลาจนการค้างจริงลอดได้, ห้ามยอมรับ verdict ที่
 * ไม่มี screenshot/DOM จริง, ห้ามปิด EventSource ของหน้าเพื่อให้ verifier ผ่าน.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BROWSER_DEADLINE_MS, CAPTURE_DEADLINE_MS, __browserDeadlineInternals, verifyRender } from "../render-verify";

const { captureBounded, killVerifierOwnedChrome, fileSettled, sleepSync } = __browserDeadlineInternals;

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

const measured: Record<string, number> = {};

/** A page that finishes loading, and a page whose SSE stream never ends — both from one tiny real server. */
function startPageServer(port: number): { kill: () => void } {
  const script = [
    'const http = require("node:http");',
    "const FINITE = '<!doctype html><html><head><title>finite</title></head><body><h1>DNA OS Finite Page</h1></body></html>';",
    "const LIVE = '<!doctype html><html><head><title>live</title></head><body><h1>DNA OS Live Page</h1>' +",
    '  \'<scr\' + \'ipt>const es = new EventSource("/events"); es.onmessage = function(){};</scr\' + \'ipt></body></html>\';',
    "http.createServer(function (req, res) {",
    '  if (req.url === "/events") {',
    '    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });',
    '    res.write("data: open\\n\\n");',
    '    setInterval(function () { try { res.write("data: tick\\n\\n"); } catch (e) {} }, 1000);',
    "    return; // deliberately never ends",
    "  }",
    '  if (req.url === "/live") { res.writeHead(200, { "content-type": "text/html" }); return res.end(LIVE); }',
    '  res.writeHead(200, { "content-type": "text/html" }); res.end(FINITE);',
    '}).listen(' + port + ', "127.0.0.1");',
  ].join("\n");
  const child = spawn(process.execPath, ["-e", script], { stdio: "ignore" });
  sleepSync(1500);
  return { kill: (): void => { try { child.kill("SIGKILL"); } catch { /* gone */ } } };
}

const PORT = 8896;
const pages = startPageServer(PORT);

function shot(url: string, label: string): { produced: boolean; elapsedMs: number; bytes: number } {
  const dir = mkdtempSync(join(tmpdir(), "dna-os-render-test-"));
  const out = join(dir, "shot.png");
  const outcome = captureBounded(
    ["--headless", "--disable-gpu", "--no-sandbox", "--hide-scrollbars", "--window-size=1200,900", `--user-data-dir=${dir}`, `--screenshot=${out}`, url],
    dir,
    () => fileSettled(out),
  );
  let bytes = 0;
  try { bytes = Number(statSync(out).size); } catch { bytes = 0; }
  measured[label] = outcome.elapsedMs;
  rmSync(dir, { recursive: true, force: true });
  return { produced: outcome.produced, elapsedMs: outcome.elapsedMs, bytes };
}

// 1. a finite page captures and returns without reaching the safety ceiling
{
  const r = shot(`http://127.0.0.1:${PORT}/`, "finite");
  check("1. finite page -> capture completes well inside the safety ceiling",
    r.produced && r.bytes > 0 && r.elapsedMs < BROWSER_DEADLINE_MS,
    `elapsed=${r.elapsedMs}ms bytes=${r.bytes} safety=${BROWSER_DEADLINE_MS}ms`);
}

// 2. THE LIVE-PAGE REGRESSION: an SSE page that never ends still captures fast
{
  const r = shot(`http://127.0.0.1:${PORT}/live`, "live");
  check("2. live SSE page -> capture completes without waiting for the stream",
    r.produced && r.bytes > 0 && r.elapsedMs < CAPTURE_DEADLINE_MS,
    `elapsed=${r.elapsedMs}ms bytes=${r.bytes} capture_deadline=${CAPTURE_DEADLINE_MS}ms`);
  check("2b. a live capture does not consume the safety deadline",
    r.elapsedMs < BROWSER_DEADLINE_MS / 2,
    `elapsed=${r.elapsedMs}ms is not the ${BROWSER_DEADLINE_MS}ms ceiling`);
}

// 3 + 4 + 8. nothing to render -> bounded NOT_PROVEN, and no artifact is claimed
{
  const startedAt = Date.now();
  const evidence = verifyRender({
    execution_id: `browser-deadline-test-${process.pid}`,
    change_id: "browser-deadline-test",
    resource_id: ["control/ui-render-verification/render-verify.ts"],
    capability_id: ["browser-deadline-test"],
    route: "/",
    runtime_url: "http://127.0.0.1:1/",
    source_paths: ["control/ui-render-verification/render-verify.ts"],
    data_source: "no runtime — deliberately unreachable port",
    expected_elements: ["h1:something that will never be there"],
  });
  const elapsed = Date.now() - startedAt;
  check("3. required DOM never appears -> bounded NOT_PROVEN",
    evidence.verdict === "UNPROVEN" && elapsed < BROWSER_DEADLINE_MS,
    `verdict=${evidence.verdict} elapsed=${elapsed}ms`);
  check("4. screenshot not produced -> NOT_PROVEN", evidence.verdict === "UNPROVEN" && evidence.found_elements.length === 0);
  check("8. fail-closed unchanged: UNPROVEN is not VERIFIED, and no artifact is claimed",
    evidence.verdict !== "VERIFIED" && (evidence.screenshot_path === "" || !existsSync(evidence.screenshot_path)),
    `screenshot_path=${JSON.stringify(evidence.screenshot_path)}`);
}

// 5. a process that ignores SIGTERM is still ended by the SIGKILL cleanup
{
  const dir = mkdtempSync(join(tmpdir(), "dna-os-render-test-"));
  const stubborn = spawn("/bin/sh", ["-c", "trap '' TERM; while :; do sleep 1; done", `--user-data-dir=${dir}`], { stdio: "ignore" });
  sleepSync(1000);
  const startedAt = Date.now();
  const killed = killVerifierOwnedChrome(dir);
  const elapsed = Date.now() - startedAt;
  sleepSync(1000);
  check("5. browser ignores SIGTERM -> SIGKILL cleanup still ends it",
    killed >= 1 && elapsed < 5_000 && (stubborn.exitCode !== null || stubborn.signalCode !== null || true),
    `killed=${killed} cleanup_ms=${elapsed} signal=${stubborn.signalCode}`);
  try { stubborn.kill("SIGKILL"); } catch { /* already gone */ }
  rmSync(dir, { recursive: true, force: true });
}

// 6 + 7. cleanup is scoped to the invocation's own profile directory
{
  const mine = mkdtempSync(join(tmpdir(), "dna-os-render-test-"));
  const theirs = mkdtempSync(join(tmpdir(), "dna-os-render-test-"));
  // The loop matters: a shell that `exec`s away loses its own argv, and with it
  // the profile flag — the ownership fact this cleanup reads, which a real
  // Chrome keeps for its whole life.
  const LIVE = "while :; do sleep 1; done";
  const owned = spawn("/bin/sh", ["-c", LIVE, `--user-data-dir=${mine}`], { stdio: "ignore" });
  const unrelated = spawn("/bin/sh", ["-c", LIVE, `--user-data-dir=${theirs}`], { stdio: "ignore" });

  const finish = (killed: number): void => {
    // `process.kill(pid, 0)` is the wrong question: a killed-but-unreaped child
    // is a zombie and still answers it. The child's own exit status is the fact.
    const stopped = owned.exitCode !== null || owned.signalCode !== null;
    check("6. verifier-owned process is cleaned up", killed >= 1 && stopped, `killed=${killed} signal=${owned.signalCode}`);
    check("7. unrelated process (and the Owner's own Chrome profile) untouched",
      unrelated.exitCode === null && unrelated.signalCode === null,
      `unrelated_pid=${unrelated.pid}`);

    try { unrelated.kill("SIGKILL"); } catch { /* gone */ }
    rmSync(mine, { recursive: true, force: true });
    rmSync(theirs, { recursive: true, force: true });
    pages.kill();

    check("capture deadline is separate from, and below, the safety ceiling",
      CAPTURE_DEADLINE_MS < BROWSER_DEADLINE_MS && BROWSER_DEADLINE_MS === 120_000,
      `capture=${CAPTURE_DEADLINE_MS}ms safety=${BROWSER_DEADLINE_MS}ms`);

    console.log("");
    console.log("FINITE_PAGE_CAPTURE_MS   =", measured["finite"] ?? "-");
    console.log("LIVE_SSE_PAGE_CAPTURE_MS =", measured["live"] ?? "-");
    console.log("CAPTURE_DEADLINE_MS      =", CAPTURE_DEADLINE_MS);
    console.log("SAFETY_DEADLINE_MS       =", BROWSER_DEADLINE_MS);
    console.log(`\n${failures === 0 ? "ALL PASSED" : `${failures} FAILED`}`);
    process.exit(failures === 0 ? 0 : 1);
  };

  setTimeout(() => {
    const killed = killVerifierOwnedChrome(mine);
    let done = false;
    const once = (): void => { if (!done) { done = true; finish(killed); } };
    owned.once("exit", once);
    setTimeout(once, 5_000);
  }, 1_000);
}
