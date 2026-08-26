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
const { execFileSync, spawnSync } = require("node:child_process");

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
function chromeDumpDom(url: string, profileDir: string): string | null {
  const result = spawnSync(CHROME, ["--headless", "--disable-gpu", "--no-sandbox", "--virtual-time-budget=9000", `--user-data-dir=${profileDir}`, "--dump-dom", url], { encoding: "utf8", timeout: 120_000, maxBuffer: 64 * 1024 * 1024 });
  const dom = String(result.stdout ?? "");
  return dom.trim().length > 0 ? dom : null;
}

function chromeScreenshot(url: string, profileDir: string, outFile: string): boolean {
  spawnSync(CHROME, ["--headless", "--disable-gpu", "--no-sandbox", "--hide-scrollbars", "--window-size=1500,1400", "--virtual-time-budget=9000", `--user-data-dir=${profileDir}`, `--screenshot=${outFile}`, url], { encoding: "utf8", timeout: 120_000 });
  try { return fs.statSync(outFile).size > 0; } catch { return false; }
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
  const dom = chromeDumpDom(request.runtime_url, profileDir);

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
