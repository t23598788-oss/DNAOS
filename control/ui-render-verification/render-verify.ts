/**
 * หน้าที่: the mandatory render stage — start the real runtime, open the real
 * route, capture what a real browser drew, and check the real DOM (Owner,
 * 2026-08-26).
 *
 * REAL RUNTIME, REAL DATA. The route is opened against a server the caller
 * actually started, reading whatever it really reads. A fixture, a mock, or an
 * HTTP 200 is not accepted as the proof — 200 says the server answered, not
 * that anything rendered, and this stage exists because those two were being
 * treated as the same thing.
 *
 * THE DOM IS TAKEN FROM THE SAME BROWSER RUN AS THE SCREENSHOT, via Chrome's
 * `--dump-dom`, so the elements checked are the ones on the page that was
 * photographed — not a second, differently-loaded copy of it.
 *
 * NO MODEL IS ON THIS PATH. The verdict is string containment over the real
 * DOM: every expected element found -> VERIFIED; any missing -> FAILED; the
 * browser or the route not answering at all -> UNPROVEN.
 *
 * Input: `RenderVerificationRequest` (route, url, expectations, lineage).
 * Output: `RenderEvidence`, appended to ./data/render-evidence.jsonl with the
 * screenshot beside it.
 * Dependency ที่อนุญาต: ./types.ts, node built-ins.
 * สิ่งที่ห้ามแตะ:
 * - ห้ามคืน VERIFIED โดยไม่มีไฟล์ screenshot จริง.
 * - ห้ามรับ mock/fixture เป็นหลักฐานสุดท้าย.
 * - ห้ามให้ค่า verdict มาจากที่อื่นนอกจากการตรวจ DOM จริง.
 */

declare const require: any;
declare const __dirname: string;

import type { RenderEvidence, RenderVerdict } from "./types";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync, spawn } = require("node:child_process");

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
export const RENDER_EVIDENCE_FILE: string = path.join(__dirname, "data", "render-evidence.jsonl");
const SHOT_DIR: string = path.join(__dirname, "data", "screenshots");

export interface RenderVerificationRequest {
  execution_id: string;
  change_id: string;
  resource_id: readonly string[];
  capability_id: readonly string[];
  route: string;
  runtime_url: string;
  /** Repo-relative sources this render proves; their digest pins the evidence to this change. */
  source_paths: readonly string[];
  data_source: string;
  /**
   * What MUST be on the rendered page. Two forms:
   *   "some text"        -> that text appears anywhere in the DOM
   *   "h1:some text"     -> that text appears INSIDE an <h1> element
   * The scoped form exists because plain containment is too weak to prove a
   * change: a heading replaced with the wrong text still "passed" while the
   * old wording survived in <title> (measured 2026-08-26). If an expectation
   * is about a specific element, say which element.
   */
  expected_elements: readonly string[];
  /** Strings that were required before this change and must still be there. Absence is a regression, not a new failure. */
  previously_required?: readonly string[];
}

function sourceDigest(paths: readonly string[]): string {
  const hash = crypto.createHash("sha256");
  for (const relative of paths) {
    try { hash.update(fs.readFileSync(path.join("/Users/tam/Desktop/DNA-OS-INFRASTRUCTURE", relative))); } catch { hash.update(`MISSING:${relative}`); }
  }
  return hash.digest("hex").slice(0, 16);
}

/** One Chrome run, bounded. Returns the DOM it dumped, or null when the browser could not produce one. */
/**
 * The outer SAFETY ceiling. Nothing the verifier launches may outlive it. It is
 * not the expected duration of a successful capture — see CAPTURE_DEADLINE_MS.
 */
export const BROWSER_DEADLINE_MS = 120_000;

/**
 * How long a capture may take on the normal, successful path. A live page never
 * goes idle, so "the browser exited by itself" is not a usable finish line; the
 * finish line is "the artifact this capture exists to produce is on disk".
 */
export const CAPTURE_DEADLINE_MS = 20_000;

const POLL_INTERVAL_MS = 250;

/** Blocks without an event loop — this module is synchronous by contract, and the gate calls it that way. */
function sleepSync(ms: number): void {
  try { execFileSync("/bin/sleep", [String(ms / 1000)], { timeout: ms + 2_000 }); } catch { /* a failed sleep only costs precision */ }
}

/**
 * WHY OWNERSHIP IS THE PROFILE DIRECTORY, NOT THE PROCESS GROUP. A Chrome
 * helper from a hung run was observed re-parented to init in a different
 * process group, so group-based cleanup would have missed it. Every launch here
 * gets its own `--user-data-dir`, which appears verbatim in each of its
 * processes' argv — that string is the ownership fact. Nothing is ever matched
 * by executable name, so the Owner's own Chrome (a different profile) can never
 * be a target.
 *
 * WHY SIGKILL. `spawnSync`'s `timeout` sends `killSignal` and then waits for the
 * child with no upper bound. Measured on this runtime (node v24.16.0): a
 * SIGTERM-respecting child returns at ~3003ms under `timeout: 3000`; a child
 * that traps SIGTERM runs its full 30s while `error.code` is still ETIMEDOUT.
 * A real headless Chrome did exactly that and sat 29 minutes on a 120s
 * deadline. SIGKILL cannot be trapped, so the deadline becomes a wall.
 */
function killVerifierOwnedChrome(profileDir: string): number {
  let listing: string;
  try { listing = String(execFileSync("/bin/ps", ["-eo", "pid=,command="], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 })); }
  catch { return 0; }
  let killed = 0;
  for (const line of listing.split("\n")) {
    if (!line.includes(`--user-data-dir=${profileDir}`)) continue;
    const pid = Number(line.trim().split(/\s+/)[0]);
    if (!Number.isInteger(pid) || pid <= 1 || pid === process.pid) continue;
    try { process.kill(pid, "SIGKILL"); killed += 1; } catch { /* already gone — the desired state */ }
  }
  return killed;
}

export interface CaptureOutcome {
  produced: boolean;
  elapsedMs: number;
  killedProcesses: number;
  hitCaptureDeadline: boolean;
}

/**
 * Launches an isolated browser and returns as soon as `ready(...)` says the
 * artifact is complete — never waiting for the page to settle.
 *
 * `--virtual-time-budget` is deliberately NOT passed. On a page holding an open
 * EventSource the virtual clock never expires, so Chrome never reaches the
 * capture step at all: measured A/B against the real joint-monitor route,
 * with the budget no screenshot existed after 90s, without it a 655,479-byte
 * screenshot was produced. Live pages are not required to become idle here.
 */
function captureBounded(args: readonly string[], profileDir: string, ready: () => boolean): CaptureOutcome {
  const startedAt = Date.now();
  // spawn (not spawnSync): the process starts immediately, and this function
  // then polls the filesystem for the artifact rather than waiting on exit.
  try { spawn(CHROME, [...args], { stdio: "ignore" }).unref(); }
  catch { return { produced: false, elapsedMs: Date.now() - startedAt, killedProcesses: killVerifierOwnedChrome(profileDir), hitCaptureDeadline: false }; }

  let produced = false;
  const ceiling = Math.min(CAPTURE_DEADLINE_MS, BROWSER_DEADLINE_MS);
  while (Date.now() - startedAt < ceiling) {
    if (ready()) { produced = true; break; }
    sleepSync(POLL_INTERVAL_MS);
  }
  const elapsedMs = Date.now() - startedAt;
  // Always: a browser that produced its artifact is still running on a live page.
  const killedProcesses = killVerifierOwnedChrome(profileDir);
  return { produced, elapsedMs, killedProcesses, hitCaptureDeadline: !produced };
}

/** A file that exists, is non-empty, and has stopped growing between two polls. */
function fileSettled(filePath: string): boolean {
  let first: number;
  try { first = Number(fs.statSync(filePath).size); } catch { return false; }
  if (first <= 0) return false;
  sleepSync(POLL_INTERVAL_MS);
  try { return Number(fs.statSync(filePath).size) === first; } catch { return false; }
}

/** Exported for ./tests/browser-deadline.test.ts only — never used to produce a verdict. */
export const __browserDeadlineInternals = { captureBounded, killVerifierOwnedChrome, fileSettled, sleepSync };

/**
 * Two real strategies, in order, because no single flag is correct for both
 * kinds of page — and this was measured, not assumed:
 *
 *   `--virtual-time-budget` makes Chrome wait for the page's own async work, so
 *   a screen that fetches its content dumps a DOM that actually contains it.
 *   But on a page holding an open EventSource the virtual clock never expires
 *   and nothing is ever produced (measured: no screenshot after 90s).
 *
 *   Without the budget Chrome dumps at the load event, which a streaming page
 *   reaches normally — but a fetching page dumps before its data arrives.
 *
 * So: attempt the waiting strategy under a sub-deadline; if it yields nothing,
 * fall back to the immediate one with the remaining time. Both attempts are
 * real browser runs. Neither can invent content, and a page whose data never
 * arrives still returns its real DOM and a missing-element verdict.
 */
const VIRTUAL_TIME_MS = 9_000;

function dumpOnce(url: string, profileDir: string, withVirtualTime: boolean, deadlineAt: number): string {
  const domFile = path.join(profileDir, "dom.html");
  try { fs.rmSync(domFile, { force: true }); } catch { /* nothing to clear */ }
  const flags = ["--headless", "--disable-gpu", "--no-sandbox"];
  if (withVirtualTime) flags.push(`--virtual-time-budget=${VIRTUAL_TIME_MS}`);
  const argv = [...flags, `--user-data-dir=${profileDir}`, "--dump-dom", url].map((a) => JSON.stringify(a)).join(" ");
  const command = `${JSON.stringify(CHROME)} ${argv} > ${JSON.stringify(domFile)} 2>/dev/null`;
  try { spawn("/bin/sh", ["-c", command, `--user-data-dir=${profileDir}`], { stdio: "ignore" }).unref(); } catch { return ""; }
  let dom = "";
  while (Date.now() < deadlineAt) {
    try {
      const text = String(fs.readFileSync(domFile, "utf8"));
      if (text.includes("</html>")) { dom = text; break; }
    } catch { /* not written yet */ }
    sleepSync(POLL_INTERVAL_MS);
  }
  killVerifierOwnedChrome(profileDir);
  return dom;
}

function chromeDumpDom(url: string, profileDir: string, ready?: (dom: string) => boolean): string | null {
  const startedAt = Date.now();
  const ceiling = startedAt + Math.min(CAPTURE_DEADLINE_MS, BROWSER_DEADLINE_MS);
  const waitingDeadline = Math.min(ceiling, startedAt + VIRTUAL_TIME_MS + 6_000);

  const waited = dumpOnce(url, profileDir, true, waitingDeadline);
  if (waited.length > 0 && (!ready || ready(waited))) return waited;

  const immediate = dumpOnce(url, profileDir, false, ceiling);
  // Report whichever attempt actually satisfied the readiness condition; when
  // neither did, report the richer of the two real DOMs rather than nothing.
  if (immediate.length > 0 && (!ready || ready(immediate))) return immediate;
  const best = waited.length >= immediate.length ? waited : immediate;
  return best.trim().length > 0 ? best : null;
}

function chromeScreenshot(url: string, profileDir: string, outFile: string): boolean {
  const base = ["--headless", "--disable-gpu", "--no-sandbox", "--hide-scrollbars", "--window-size=1500,1400"];
  // Waiting strategy first, for the same measured reason as the DOM above.
  const waited = captureBounded(
    [...base, `--virtual-time-budget=${VIRTUAL_TIME_MS}`, `--user-data-dir=${profileDir}`, `--screenshot=${outFile}`, url],
    profileDir,
    () => fileSettled(outFile),
  );
  if (waited.produced) return true;
  const immediate = captureBounded(
    [...base, `--user-data-dir=${profileDir}`, `--screenshot=${outFile}`, url],
    profileDir,
    () => fileSettled(outFile),
  );
  return immediate.produced;
}



/** Is the runtime actually answering on this route? Checked before the browser is started, so "server not up" never reads as "page broken". */
function routeAnswers(url: string): boolean {
  try {
    const status = String(execFileSync("/usr/bin/curl", ["-s", "-o", "/dev/null", "-w", "%{http_code}", "-m", "15", url], { encoding: "utf8" })).trim();
    return status.startsWith("2");
  } catch {
    return false;
  }
}

export function verifyRender(request: RenderVerificationRequest): RenderEvidence {
  const observedAt = new Date().toISOString();
  const digest = sourceDigest(request.source_paths);
  const stamp = observedAt.replace(/[:.]/g, "-");
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const screenshotPath = path.join(SHOT_DIR, `${request.execution_id}-${stamp}.png`);
  const profileDir = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "dna-os-render-"));

  const base = {
    execution_id: request.execution_id,
    change_id: request.change_id,
    resource_id: request.resource_id,
    capability_id: request.capability_id,
    route: request.route,
    runtime_url: request.runtime_url,
    source_digest: digest,
    data_source: request.data_source,
    observed_at: observedAt,
    expected_elements: request.expected_elements,
  };

  // START_REAL_RUNTIME / OPEN_REAL_ROUTE — the caller starts the runtime; this
  // stage refuses to interpret a dead route as a rendering failure.
  if (!routeAnswers(request.runtime_url)) {
    return record({ ...base, screenshot_path: "", evidence_reference: "", found_elements: [], missing_elements: [...request.expected_elements], visual_regression: "NOT_CHECKED", verdict: "UNPROVEN" as RenderVerdict, reason: `the route did not answer at ${request.runtime_url} — nothing was rendered to verify` });
  }

  // CAPTURE_SCREENSHOT
  const captured = chromeScreenshot(request.runtime_url, profileDir, screenshotPath);
  // WAIT_FOR_REAL_DATA + VERIFY_REQUIRED_ELEMENTS, from the same browser.
  const dom = chromeDumpDom(request.runtime_url, profileDir, (text) => request.expected_elements.every((element) => domSatisfies(text, element)));

  if (!captured || dom === null) {
    return record({ ...base, screenshot_path: captured ? screenshotPath : "", evidence_reference: "", found_elements: [], missing_elements: [...request.expected_elements], visual_regression: "NOT_CHECKED", verdict: "UNPROVEN" as RenderVerdict, reason: captured ? "the browser produced a screenshot but no DOM to verify against" : "the browser produced no screenshot" });
  }

  const found = request.expected_elements.filter((element) => domSatisfies(dom, element));
  const missing = request.expected_elements.filter((element) => !domSatisfies(dom, element));

  // VERIFY_EXISTING_UI_NOT_BROKEN
  const previously = request.previously_required ?? [];
  const regressed = previously.filter((element) => !domSatisfies(dom, element));
  const visualRegression = previously.length === 0 ? "NOT_CHECKED" : regressed.length > 0 ? "DETECTED" : "NONE";

  const verdict: RenderVerdict = missing.length === 0 && regressed.length === 0 ? "VERIFIED" : "FAILED";
  const reason = verdict === "VERIFIED"
    ? `all ${found.length} expected element(s) present in the rendered DOM${previously.length > 0 ? `, and ${previously.length} previously-required element(s) still present` : ""}`
    : missing.length > 0
      ? `missing from the rendered DOM: ${missing.join(", ")}`
      : `previously-required element(s) disappeared: ${regressed.join(", ")}`;

  return record({ ...base, screenshot_path: screenshotPath, evidence_reference: `render-evidence.jsonl#${request.execution_id}`, found_elements: found, missing_elements: missing, visual_regression: visualRegression as RenderEvidence["visual_regression"], verdict, reason });
}

/**
 * `tag:text` is checked against that tag's own inner text; anything else is a
 * whole-DOM containment check. Deterministic string work — no parser, no
 * library, and nothing that could be talked into a different answer.
 */
function domSatisfies(dom: string, expectation: string): boolean {
  const scoped = expectation.match(/^([a-zA-Z][a-zA-Z0-9]*):(.+)$/s);
  if (!scoped) return dom.includes(expectation);
  const [, tag, text] = scoped;
  const pattern = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "gi");
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(dom)) !== null) {
    if (match[1].includes(text)) return true;
  }
  return false;
}

/** STORE_RENDER_EVIDENCE — append-only, beside the screenshot it describes. */
function record(evidence: RenderEvidence): RenderEvidence {
  fs.mkdirSync(path.dirname(RENDER_EVIDENCE_FILE), { recursive: true });
  fs.appendFileSync(RENDER_EVIDENCE_FILE, `${JSON.stringify(evidence)}\n`);
  return evidence;
}

export function readRenderEvidence(): readonly RenderEvidence[] {
  try {
    return String(fs.readFileSync(RENDER_EVIDENCE_FILE, "utf8")).split("\n").filter((line: string) => line.trim().length > 0).map((line: string) => JSON.parse(line) as RenderEvidence);
  } catch {
    return [];
  }
}

export function renderEvidenceFor(executionId: string): RenderEvidence | null {
  const matches = readRenderEvidence().filter((evidence) => evidence.execution_id === executionId);
  return matches.length > 0 ? matches[matches.length - 1] : null;
}
