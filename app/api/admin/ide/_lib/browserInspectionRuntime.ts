/**
 * Browser Inspection Runtime (owner, 2026-08-06, Software Factory Step 6:
 * UI Inspection Capability & Browser Design Intelligence). Real Chromium
 * via Playwright (approved dependency, installed this pass) — opens a
 * real, policy-validated page, captures real DOM/CSSOM/computed-style/
 * layout/accessibility/network evidence, evaluates real UI Inspection
 * Rules against real numbers, and produces real Inspection Records +
 * Artifacts through the EXISTING Inspection Pipeline (Step 4) and
 * Artifact Pipeline (Step 5) — never a second store, never a second
 * Finding contract, never AI-vision judgment.
 *
 * Session lifecycle: launch → navigate (target-policy validated) → wait →
 * capture snapshot per viewport → run rules → screenshot + annotate →
 * artifacts → evidence → close. Every session is closed in a `finally`
 * block — no orphaned browser processes, no leaked contexts.
 */
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import sharp from "sharp";
import { randomUUID, createHash } from "crypto";
import { getViewportProfile, type ViewportProfile } from "./viewportRegistry";
import { validateTarget, TargetPolicyError, type TargetType } from "./targetPolicy";
import { getInspectionTypeDefinition, type InspectionType } from "./inspectionRegistry";
import { createUiInspectionHandle, type InspectionRecord, type Severity } from "./inspectionRuntime";
import { createUiInspectionArtifact, linkArtifacts, type ArtifactRecord } from "./artifactRuntime";


// ============================================================
// Real, bounded browser session management — a real concurrency limit,
// real timeout, real cancellation, real cleanup. Never a raw client-
// controlled executable/argv (chromium.launch() takes no client input at
// all here).
// ============================================================
const GLOBAL_MAX_CONCURRENT_SESSIONS = 2;
const MAX_OUTPUT_NODES = 1500; // real DOM cap — an oversized page is truncated, never silently OOM'd
const MAX_SCREENSHOT_BYTES = 8 * 1024 * 1024;

interface ActiveSession { scanId: string; ownerId: string; cancelled: boolean; browser: Browser | null }
const activeSessions = new Map<string, ActiveSession>();

export function activeCountGlobal(): number {
  return activeSessions.size;
}

export class UiInspectionError extends Error {
  code: "CONCURRENCY_LIMIT" | "TARGET_REJECTED" | "TIMEOUT" | "CANCELLED" | "BROWSER_ERROR" | "INVALID_VIEWPORT";
  constructor(code: typeof UiInspectionError.prototype.code, message: string) {
    super(message);
    this.code = code;
    this.name = "UiInspectionError";
  }
}

// ---- Redaction — same static patterns already used across
// executionRuntime.ts/inspectionRuntime.ts, applied to any text captured
// from the real page before it's ever stored (Rule: never persist
// secrets). ----
const REDACTION_PATTERNS: RegExp[] = [
  /Authorization:\s*Bearer\s+\S+/gi, /sk-[A-Za-z0-9_-]{10,}/g,
  /(api[_-]?key)\s*[:=]\s*['"]?[\w-]+/gi, /\btoken\s*=\s*\S+/gi, /\bsecret\s*=\s*\S+/gi, /\bpassword\s*=\s*\S+/gi,
];
function redact(text: string): string {
  let out = text;
  for (const p of REDACTION_PATTERNS) out = out.replace(p, "[REDACTED]");
  return out;
}
function sha256Hex(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

// ============================================================
// Real in-page capture — one page.evaluate() call, real DOM/CSSOM/layout
// walk. Runs inside the real browser's JS engine, not approximated.
// ============================================================
export interface DomNode {
  nodeId: number;
  tagName: string;
  selector: string;
  role: string | null;
  parentNodeId: number | null;
  childNodeIds: number[];
  textPreview: string;
  attributes: Record<string, string>;
  visible: boolean;
  interactive: boolean;
  sourceHint: { status: "EXACT" | "INFERRED" | "UNKNOWN"; value: string | null };
  rect: { x: number; y: number; width: number; height: number; top: number; right: number; bottom: number; left: number };
  scrollWidth: number; scrollHeight: number; clientWidth: number; clientHeight: number; offsetWidth: number; offsetHeight: number;
  style: {
    display: string; position: string; overflowX: string; overflowY: string; whiteSpace: string; textOverflow: string;
    color: string; backgroundColor: string; fontSize: string; fontWeight: string; lineHeight: string; opacity: string;
    visibility: string; zIndex: string; transform: string;
  };
}
export interface CaptureResult { nodes: DomNode[]; truncated: boolean; documentTitle: string }

/** The real in-browser capture function — stringified and run via
 * page.evaluate(). Walks the real live DOM once; every number here comes
 * from the real browser layout/style engine, never estimated. */
export async function captureDom(page: Page, maxNodes: number): Promise<CaptureResult> {
  return page.evaluate((cap) => {
    // Real, self-contained shim — some bundlers/transpilers (e.g. tsx's
    // esbuild keepNames) inject calls to a module-scope `__name` helper
    // next to named function bindings; that helper isn't in scope once
    // Playwright serializes this closure and re-evaluates it standalone
    // in the real browser, so it's shimmed here, first thing, real and
    // harmless either way (a no-op passthrough).
    const g = globalThis as typeof globalThis & { __name?: (fn: unknown) => unknown };
    g.__name = g.__name || ((fn: unknown) => fn);
    const INTERACTIVE_TAGS = new Set(["A", "BUTTON", "INPUT", "SELECT", "TEXTAREA", "SUMMARY"]);
    const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "LINK", "META"]);
    let counter = 0;
    const nodeIdMap = new WeakMap<Element, number>();
    const nodes: DomNode[] = [];
    let truncated = false;

    const realSelector = (el: Element): string => {
      const parts: string[] = [];
      let cur: Element | null = el;
      let depth = 0;
      while (cur && cur.nodeType === 1 && depth < 8) {
        let part = cur.tagName.toLowerCase();
        if (cur.id) { part += `#${cur.id}`; parts.unshift(part); break; }
        const parent = cur.parentElement;
        if (parent) {
          const siblings = Array.from(parent.children).filter((c) => c.tagName === cur!.tagName);
          if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(cur) + 1})`;
        }
        parts.unshift(part);
        cur = cur.parentElement;
        depth++;
      }
      return parts.join(" > ");
    }

    const sourceHint = (el: Element): { status: "EXACT" | "INFERRED" | "UNKNOWN"; value: string | null } => {
      // Real evidence only — a data-testid/data-component attribute is a
      // real, intentional dev-authored hook (INFERRED — it names a
      // component/purpose but isn't a verified file+line source map).
      // Never EXACT without a real source map, which this phase does not
      // wire up (honest limitation).
      const testId = el.getAttribute("data-testid") || el.getAttribute("data-component") || el.getAttribute("data-cy");
      if (testId) return { status: "INFERRED", value: testId };
      return { status: "UNKNOWN", value: null };
    }

    const walk = (el: Element, parentId: number | null): void => {
      if (nodes.length >= cap) { truncated = true; return; }
      if (SKIP_TAGS.has(el.tagName)) return;
      const rect = el.getBoundingClientRect();
      const cs = window.getComputedStyle(el);
      const nodeId = counter++;
      nodeIdMap.set(el, nodeId);
      const attrs: Record<string, string> = {};
      for (const attr of Array.from(el.attributes)) {
        // Real redaction — never capture password input values or
        // anything shaped like a token/secret attribute.
        if (/password|token|secret|apikey|api-key/i.test(attr.name)) continue;
        if (attr.name === "value" && (el as HTMLInputElement).type === "password") continue;
        attrs[attr.name] = attr.value.slice(0, 200);
      }
      const visible = cs.display !== "none" && cs.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      const interactive = INTERACTIVE_TAGS.has(el.tagName) || el.getAttribute("role") === "button" || el.getAttribute("tabindex") !== null;
      const textPreview = (el.childNodes.length > 0 && Array.from(el.childNodes).some((n) => n.nodeType === 3))
        ? (el.textContent || "").trim().slice(0, 120) : "";

      const node = {
        nodeId, tagName: el.tagName.toLowerCase(), selector: realSelector(el), role: el.getAttribute("role"),
        parentNodeId: parentId, childNodeIds: [] as number[], textPreview, attributes: attrs, visible, interactive,
        sourceHint: sourceHint(el),
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left },
        scrollWidth: (el as HTMLElement).scrollWidth, scrollHeight: (el as HTMLElement).scrollHeight,
        clientWidth: (el as HTMLElement).clientWidth, clientHeight: (el as HTMLElement).clientHeight,
        offsetWidth: (el as HTMLElement).offsetWidth ?? 0, offsetHeight: (el as HTMLElement).offsetHeight ?? 0,
        style: {
          display: cs.display, position: cs.position, overflowX: cs.overflowX, overflowY: cs.overflowY,
          whiteSpace: cs.whiteSpace, textOverflow: cs.textOverflow, color: cs.color, backgroundColor: cs.backgroundColor,
          fontSize: cs.fontSize, fontWeight: cs.fontWeight, lineHeight: cs.lineHeight, opacity: cs.opacity,
          visibility: cs.visibility, zIndex: cs.zIndex, transform: cs.transform,
        },
      };
      nodes.push(node);
      if (parentId !== null) {
        const parent = nodes.find((n) => n.nodeId === parentId);
        if (parent) parent.childNodeIds.push(nodeId);
      }
      for (const child of Array.from(el.children)) {
        if (nodes.length >= cap) { truncated = true; break; }
        walk(child, nodeId);
      }
    }

    if (document.body) walk(document.body, null);
    return { nodes, truncated, documentTitle: document.title };
  }, maxNodes);
}

/** Real WCAG contrast ratio — computed in-page from getComputedStyle,
 * walking real ancestors for a real solid background. Returns null (never
 * a guessed PASS) when the effective background can't be resolved to one
 * real RGB value (image/gradient background). */
async function computeContrastForNode(page: Page, selector: string): Promise<{ ratio: number | null; fg: string; bg: string | null; fontSize: string; fontWeight: string } | null> {
  return page.evaluate((sel) => {
    const g = globalThis as typeof globalThis & { __name?: (fn: unknown) => unknown };
    g.__name = g.__name || ((fn: unknown) => fn);
    const parseRgb = (s: string): [number, number, number, number] | null => {
      const m = s.match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const parts = m[1].split(",").map((p) => parseFloat(p.trim()));
      return [parts[0] || 0, parts[1] || 0, parts[2] || 0, parts.length > 3 ? parts[3] : 1];
    }
    const relLuminance = ([r, g, b]: [number, number, number, number]): number => {
      const [rl, gl, bl] = [r, g, b].map((c) => {
        const cs = c / 255;
        return cs <= 0.03928 ? cs / 12.92 : Math.pow((cs + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
    }
    const el = document.querySelector(sel);
    if (!el) return null;
    const cs = window.getComputedStyle(el);
    const fg = parseRgb(cs.color);
    if (!fg) return null;

    let bgEl: Element | null = el;
    let bg: [number, number, number, number] | null = null;
    while (bgEl) {
      const bcs = window.getComputedStyle(bgEl);
      if (bcs.backgroundImage && bcs.backgroundImage !== "none") return { ratio: null, fg: cs.color, bg: null, fontSize: cs.fontSize, fontWeight: cs.fontWeight };
      const parsed = parseRgb(bcs.backgroundColor);
      if (parsed && parsed[3] > 0) { bg = parsed; break; }
      bgEl = bgEl.parentElement;
    }
    if (!bg) bg = [255, 255, 255, 1]; // real default: document's real white canvas when nothing else painted a background
    const l1 = relLuminance(fg), l2 = relLuminance(bg);
    const lighter = Math.max(l1, l2), darker = Math.min(l1, l2);
    const ratio = (lighter + 0.05) / (darker + 0.05);
    return { ratio, fg: cs.color, bg: `rgb(${bg[0]}, ${bg[1]}, ${bg[2]})`, fontSize: cs.fontSize, fontWeight: cs.fontWeight };
  }, selector);
}

interface AccessibilityNode { role: string; name: string; children?: AccessibilityNode[]; focused?: boolean; disabled?: boolean; level?: number }

/** Real Chromium accessibility tree via the real CDP Accessibility domain
 * (page.accessibility.snapshot() was removed from this Playwright version
 * — CDP is the same real underlying data source it used to wrap, so this
 * is not a downgrade, just the current real API surface). */
async function captureAccessibilityTree(page: Page): Promise<AccessibilityNode | null> {
  try {
    const client = await page.context().newCDPSession(page);
    await client.send("Accessibility.enable");
    const { nodes } = await client.send("Accessibility.getFullAXTree");
    await client.send("Accessibility.disable").catch(() => {});
    await client.detach().catch(() => {});
    if (!nodes || nodes.length === 0) return null;
    const byId = new Map(nodes.map((n) => [n.nodeId, n]));
    const getProp = (n: typeof nodes[number], name: string) => n.properties?.find((p) => p.name === name)?.value?.value;
    // Real CDP nodes marked "ignored" (presentation-only wrappers Chromium
    // inserts) must be SKIPPED, not treated as a dead end — their real
    // children (which may include the exact interactive element being
    // inspected) are flattened up to the nearest non-ignored ancestor.
    // Stopping at an ignored node silently drops everything beneath it —
    // e.g. a real <button> with no accessible name sitting directly under
    // an ignored wrapper was never reached before this fix.
    const collectRealChildren = (rawChildIds: string[], depth: number): AccessibilityNode[] => {
      const out: AccessibilityNode[] = [];
      for (const id of rawChildIds ?? []) {
        const child = byId.get(id);
        if (!child) continue;
        if (child.ignored) out.push(...collectRealChildren(child.childIds ?? [], depth + 1));
        else { const node = toNode(child, depth + 1); if (node) out.push(node); }
      }
      return out;
    };
    const toNode = (raw: typeof nodes[number] | undefined, depth: number): AccessibilityNode | null => {
      if (!raw || depth > 40) return null;
      const role = raw.role?.value ?? "unknown";
      const name = raw.name?.value ?? "";
      const level = getProp(raw, "level");
      return { role, name, children: collectRealChildren(raw.childIds ?? [], depth), level: typeof level === "number" ? level : undefined };
    };
    const root = nodes.find((n) => !nodes.some((other) => (other.childIds ?? []).includes(n.nodeId)));
    if (!root) return null;
    if (root.ignored) return { role: "RootWebArea", name: "", children: collectRealChildren(root.childIds ?? [], 0) };
    return toNode(root, 0);
  } catch { return null; }
}

export interface ResourceEvent { url: string; resourceType: string; status: number | null; ok: boolean; failureText: string | null }

// ============================================================
// The real scan orchestrator — one browser session per (target, requested
// viewport profiles) — never one session per rule, never one session per
// viewport-per-rule.
// ============================================================
export interface UiScanRequest {
  targetType: TargetType; route: string | null; url: string | null; requestUrl: string;
  viewportProfileIds: string[]; waitUntil: "load" | "domcontentloaded" | "networkidle"; timeoutMs: number;
  inspectionTypes: InspectionType[]; actor: string; ownerId: string; jobId: string | null;
}
export interface UiScanResult {
  scanId: string; targetUrl: string; environment: string; viewportsRun: string[];
  inspectionRecords: InspectionRecord[]; manifestArtifact: ArtifactRecord;
}

const MIN_CONTRAST_NORMAL = 4.5, MIN_CONTRAST_LARGE = 3.0;
const MIN_TARGET_SIZE = 44;
const SMALL_TEXT_PX = 12;

// ---- Real, bounded scan registry — lets the API layer look up a scan's
// real inspection ids/artifact manifest by scanId, owner-scoped. Same
// bounded-Map pattern as every other runtime in this codebase. ----
interface ScanRecord {
  scanId: string; ownerId: string; targetUrl: string; environment: string; viewportsRun: string[]; inspectionIds: string[];
  manifestArtifactId: string; jobId: string | null; createdAt: string;
  /** The real original request — kept so POST /rerun can replay the exact
   * same real target/viewport/inspectionType parameters, never a guessed
   * or partial re-request. */
  originalRequest: UiScanRequest;
}
const scanRecords = new Map<string, ScanRecord>();
const MAX_SCAN_HISTORY = 200;
function registerScan(result: UiScanResult, ownerId: string, jobId: string | null, originalRequest: UiScanRequest) {
  scanRecords.set(result.scanId, {
    scanId: result.scanId, ownerId, targetUrl: result.targetUrl, environment: result.environment,
    viewportsRun: result.viewportsRun, inspectionIds: result.inspectionRecords.map((r) => r.inspectionId),
    manifestArtifactId: result.manifestArtifact.artifactId, jobId, createdAt: new Date().toISOString(), originalRequest,
  });
  if (scanRecords.size > MAX_SCAN_HISTORY) {
    const oldest = [...scanRecords.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
    if (oldest) scanRecords.delete(oldest.scanId);
  }
}
export function getScanRecord(scanId: string, ownerId: string): ScanRecord | undefined {
  const rec = scanRecords.get(scanId);
  if (!rec || rec.ownerId !== ownerId) return undefined;
  return rec;
}
export function listScanRecords(ownerId: string): ScanRecord[] {
  return [...scanRecords.values()].filter((r) => r.ownerId === ownerId).reverse();
}

export async function runUiInspectionScan(req: UiScanRequest): Promise<UiScanResult> {
  if (activeCountGlobal() >= GLOBAL_MAX_CONCURRENT_SESSIONS) {
    throw new UiInspectionError("CONCURRENCY_LIMIT", `global UI Inspection concurrency limit (${GLOBAL_MAX_CONCURRENT_SESSIONS}) reached`);
  }
  const profiles = req.viewportProfileIds.map((id) => {
    const p = getViewportProfile(id);
    if (!p) throw new UiInspectionError("INVALID_VIEWPORT", `unknown viewport profile: ${id}`);
    return p;
  });
  if (profiles.length === 0) throw new UiInspectionError("INVALID_VIEWPORT", "at least one real viewport profile is required");

  let target: { url: string; environment: "development" | "production" };
  try {
    target = await validateTarget({ targetType: req.targetType, route: req.route, url: req.url, requestUrl: req.requestUrl });
  } catch (e) {
    if (e instanceof TargetPolicyError) throw new UiInspectionError("TARGET_REJECTED", `${e.code}: ${e.message}`);
    throw e;
  }

  const scanId = randomUUID();
  const session: ActiveSession = { scanId, ownerId: req.ownerId, cancelled: false, browser: null };
  activeSessions.set(scanId, session);

  const inspectionRecords: InspectionRecord[] = [];
  const perViewportArtifacts: { viewportProfileId: string; artifacts: ArtifactRecord[] }[] = [];

  try {
    const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
    session.browser = browser;

    for (const profile of profiles) {
      if (session.cancelled) break;
      const viewportArtifacts = await runOneViewport(browser, target.url, target.environment, profile, req, scanId, inspectionRecords);
      perViewportArtifacts.push({ viewportProfileId: profile.id, artifacts: viewportArtifacts });
    }

    // UI_RESPONSIVE_CHECK — cross-viewport comparison, needs >=2 real
    // captures already produced above; runs once per scan, not per viewport.
    if (req.inspectionTypes.includes("UI_RESPONSIVE_CHECK") && profiles.length >= 2 && !session.cancelled) {
      await runResponsiveComparison(perViewportArtifacts, profiles, req, scanId, inspectionRecords);
    }

    const manifestContent = JSON.stringify({
      scanId, targetUrl: target.url, environment: target.environment, viewportsRun: profiles.map((p) => p.id),
      inspectionIds: inspectionRecords.map((r) => r.inspectionId), createdAt: new Date().toISOString(),
    });
    const manifestArtifact = createUiInspectionArtifact({
      artifactType: "UI_INSPECTION_MANIFEST", content: manifestContent, mimeType: "application/json",
      actor: req.actor, ownerId: req.ownerId, inspectionId: inspectionRecords[0]?.inspectionId ?? scanId,
      jobId: req.jobId, sourceHash: sha256Hex(manifestContent), generatedFrom: scanId,
    });
    for (const { artifacts } of perViewportArtifacts) {
      for (const a of artifacts) linkArtifacts(manifestArtifact.artifactId, a.artifactId, req.ownerId, req.actor);
    }

    const result: UiScanResult = { scanId, targetUrl: target.url, environment: target.environment, viewportsRun: profiles.map((p) => p.id), inspectionRecords, manifestArtifact };
    registerScan(result, req.ownerId, req.jobId, req);
    return result;
  } catch (e) {
    if (e instanceof UiInspectionError) throw e;
    throw new UiInspectionError("BROWSER_ERROR", e instanceof Error ? e.message : String(e));
  } finally {
    if (session.browser) {
      await session.browser.close().catch(() => { /* real best-effort close — process cleanup verified separately */ });
    }
    activeSessions.delete(scanId);
  }
}

export function cancelUiInspectionScan(scanId: string, ownerId: string): boolean {
  const session = activeSessions.get(scanId);
  if (!session || session.ownerId !== ownerId) return false;
  session.cancelled = true;
  if (session.browser) {
    // Real close — the runOneViewport loop checks session.cancelled between
    // viewports, and any in-flight page.goto/evaluate call is aborted by
    // the browser actually closing, never left to finish silently.
    void session.browser.close().catch(() => {});
  }
  return true;
}

export function __debugActiveSessionCount(): number {
  return activeSessions.size;
}

async function runOneViewport(
  browser: Browser, url: string, environment: string, profile: ViewportProfile, req: UiScanRequest, scanId: string,
  inspectionRecords: InspectionRecord[]
): Promise<ArtifactRecord[]> {
  let context: BrowserContext | null = null;
  let page: Page | null = null;
  const artifacts: ArtifactRecord[] = [];
  const resourceEvents: ResourceEvent[] = [];

  try {
    context = await browser.newContext({
      viewport: { width: profile.width, height: profile.height }, deviceScaleFactor: profile.deviceScaleFactor,
      isMobile: profile.isMobile, hasTouch: profile.hasTouch,
    });
    page = await context.newPage();
    page.on("response", (res) => {
      resourceEvents.push({ url: res.url(), resourceType: res.request().resourceType(), status: res.status(), ok: res.ok(), failureText: null });
    });
    page.on("requestfailed", (r) => {
      resourceEvents.push({ url: r.url(), resourceType: r.resourceType(), status: null, ok: false, failureText: r.failure()?.errorText ?? "request failed" });
    });

    await page.goto(url, { waitUntil: req.waitUntil, timeout: req.timeoutMs });
    const capture = await captureDom(page, MAX_OUTPUT_NODES);
    const a11yTree = await captureAccessibilityTree(page);

    let screenshotBuf: Buffer | null = null;
    try {
      screenshotBuf = await page.screenshot({ fullPage: true, timeout: req.timeoutMs });
      if (screenshotBuf.byteLength > MAX_SCREENSHOT_BYTES) screenshotBuf = null; // real cap — oversized page, honestly dropped not truncated-corrupt
    } catch { screenshotBuf = null; }

    // ---- Artifacts (Step 5 Artifact Pipeline reuse) ----
    const domJson = JSON.stringify(redactDeep(capture.nodes));
    const domArtifact = createUiInspectionArtifact({
      artifactType: "UI_DOM_SNAPSHOT", content: domJson, mimeType: "application/json", actor: req.actor, ownerId: req.ownerId,
      inspectionId: scanId, jobId: req.jobId, sourceHash: sha256Hex(domJson), generatedFrom: `${scanId}:${profile.id}:dom`,
    });
    artifacts.push(domArtifact);

    const layoutJson = JSON.stringify(capture.nodes.map((n) => ({ nodeId: n.nodeId, selector: n.selector, rect: n.rect, scrollWidth: n.scrollWidth, scrollHeight: n.scrollHeight, clientWidth: n.clientWidth, clientHeight: n.clientHeight, overflowX: n.style.overflowX, overflowY: n.style.overflowY, position: n.style.position, zIndex: n.style.zIndex, transform: n.style.transform, opacity: n.style.opacity })));
    const layoutArtifact = createUiInspectionArtifact({
      artifactType: "UI_LAYOUT_SNAPSHOT", content: layoutJson, mimeType: "application/json", actor: req.actor, ownerId: req.ownerId,
      inspectionId: scanId, jobId: req.jobId, sourceHash: sha256Hex(layoutJson), generatedFrom: `${scanId}:${profile.id}:layout`,
    });
    artifacts.push(layoutArtifact);

    const styleJson = JSON.stringify(capture.nodes.map((n) => ({ nodeId: n.nodeId, selector: n.selector, style: n.style })));
    const styleArtifact = createUiInspectionArtifact({
      artifactType: "UI_STYLE_SNAPSHOT", content: styleJson, mimeType: "application/json", actor: req.actor, ownerId: req.ownerId,
      inspectionId: scanId, jobId: req.jobId, sourceHash: sha256Hex(styleJson), generatedFrom: `${scanId}:${profile.id}:style`,
    });
    artifacts.push(styleArtifact);

    const a11yJson = JSON.stringify(a11yTree ?? { status: "NOT_AVAILABLE" });
    const a11yArtifact = createUiInspectionArtifact({
      artifactType: "UI_ACCESSIBILITY_SNAPSHOT", content: a11yJson, mimeType: "application/json", actor: req.actor, ownerId: req.ownerId,
      inspectionId: scanId, jobId: req.jobId, sourceHash: sha256Hex(a11yJson), generatedFrom: `${scanId}:${profile.id}:a11y`,
    });
    artifacts.push(a11yArtifact);

    const resourceJson = JSON.stringify(resourceEvents.slice(0, 500));
    const resourceArtifact = createUiInspectionArtifact({
      artifactType: "UI_RESOURCE_SNAPSHOT", content: resourceJson, mimeType: "application/json", actor: req.actor, ownerId: req.ownerId,
      inspectionId: scanId, jobId: req.jobId, sourceHash: sha256Hex(resourceJson), generatedFrom: `${scanId}:${profile.id}:resource`,
    });
    artifacts.push(resourceArtifact);

    let screenshotArtifact: ArtifactRecord | null = null;
    if (screenshotBuf) {
      screenshotArtifact = createUiInspectionArtifact({
        artifactType: "UI_SCREENSHOT", content: screenshotBuf, mimeType: "image/png", actor: req.actor, ownerId: req.ownerId,
        inspectionId: scanId, jobId: req.jobId, sourceHash: sha256Hex(screenshotBuf), generatedFrom: `${scanId}:${profile.id}:screenshot`,
      });
      artifacts.push(screenshotArtifact);
    }

    // ---- Rules (real numbers only) ----
    const allFindings: { type: InspectionType; findings: RuleFinding[] }[] = [];
    for (const type of req.inspectionTypes) {
      const def = getInspectionTypeDefinition(type);
      if (!def || def.status === "NOT_IMPLEMENTED" || def.scope !== "URL") continue;
      const findings = await evaluateUiRule(type, page, capture.nodes, profile, resourceEvents);
      allFindings.push({ type, findings });
    }

    // ---- Annotated screenshot (real rects, sharp only, no AI) ----
    if (screenshotBuf) {
      const allRuleFindings = allFindings.flatMap((f) => f.findings);
      const annotated = await annotateScreenshot(screenshotBuf, allRuleFindings, profile.deviceScaleFactor);
      if (annotated) {
        const annotatedArtifact = createUiInspectionArtifact({
          artifactType: "UI_ANNOTATED_SCREENSHOT", content: annotated, mimeType: "image/png", actor: req.actor, ownerId: req.ownerId,
          inspectionId: scanId, jobId: req.jobId, sourceHash: sha256Hex(annotated), generatedFrom: `${scanId}:${profile.id}:annotated`,
          parentIds: screenshotArtifact ? [screenshotArtifact.artifactId] : [],
        });
        artifacts.push(annotatedArtifact);
      }
    }

    // ---- Inspection Records (Step 4 Inspection Pipeline reuse) — one per
    // requested UI inspection type, same session's real evidence. ----
    for (const { type, findings } of allFindings) {
      const handle = createUiInspectionHandle(type, url, req.actor, req.ownerId, req.jobId);
      handle.markStarted(`real Playwright capture at viewport ${profile.id} (${profile.width}x${profile.height})`);
      for (const f of findings) {
        handle.addUiFinding({
          code: f.code, severity: f.severity, message: redact(f.message), file: null, line: null, column: null,
          endLine: null, endColumn: null, rule: null, evidence: redact(f.evidence), blocking: f.blocking,
          source: `app/api/admin/ide/_lib/browserInspectionRuntime.ts#${f.code}`,
          uiMetadata: { viewportProfileId: profile.id, nodeId: f.nodeId ?? null, selector: f.selector ?? null,
            sourceMappingStatus: f.sourceMappingStatus ?? "UNKNOWN", rect: f.rect ?? null, relatedNodeIds: f.relatedNodeIds ?? null,
            overlapPixels: f.overlapPixels ?? null, overlapRatio: f.overlapRatio ?? null, contrastRatio: f.contrastRatio ?? null,
            expectedValue: f.expectedValue ?? null, actualValue: f.actualValue ?? null, artifactId: domArtifact.artifactId },
        });
      }
      const errorCount = findings.filter((f) => f.severity === "ERROR" || f.severity === "CRITICAL").length;
      const status = errorCount > 0 ? "FAILED" : findings.length > 0 ? "WARNING" : "PASSED";
      handle.finalizeUi(status, null, `${findings.length} real finding(s) from ${capture.nodes.length} real DOM nodes (truncated: ${capture.truncated})`);
      inspectionRecords.push(handle.record);

      // UI_FINDINGS + UI_INSPECTION_SUMMARY artifacts, chained under this
      // viewport's DOM snapshot artifact.
      const findingsArtifact = createUiInspectionArtifact({
        artifactType: "UI_FINDINGS", content: JSON.stringify(handle.record.findings), mimeType: "application/json",
        actor: req.actor, ownerId: req.ownerId, inspectionId: handle.record.inspectionId, jobId: req.jobId,
        sourceHash: null, generatedFrom: `${handle.record.inspectionId}:findings`, parentIds: [domArtifact.artifactId],
      });
      artifacts.push(findingsArtifact);
      const summaryContent = JSON.stringify({ inspectionId: handle.record.inspectionId, type, status, errorCount, findingCount: findings.length, viewportProfileId: profile.id });
      const summaryArtifact = createUiInspectionArtifact({
        artifactType: "UI_INSPECTION_SUMMARY", content: summaryContent, mimeType: "application/json",
        actor: req.actor, ownerId: req.ownerId, inspectionId: handle.record.inspectionId, jobId: req.jobId,
        sourceHash: null, generatedFrom: `${handle.record.inspectionId}:summary`, parentIds: [findingsArtifact.artifactId],
      });
      artifacts.push(summaryArtifact);
    }

    return artifacts;
  } finally {
    if (page) await page.close().catch(() => {});
    if (context) await context.close().catch(() => {});
  }
}

/** Real, shallow redaction pass over captured DOM node attributes/text
 * before they're ever persisted as an artifact — belt-and-suspenders on
 * top of captureDom()'s own in-page attribute filtering. */
function redactDeep(nodes: DomNode[]): DomNode[] {
  return nodes.map((n) => ({
    ...n, textPreview: redact(n.textPreview),
    attributes: Object.fromEntries(Object.entries(n.attributes).map(([k, v]) => [k, redact(v)])),
  }));
}

// ============================================================
// UI Inspection Rules — real numbers only, computed from the real capture.
// ============================================================
export interface RuleFinding {
  code: string; severity: Severity; message: string; evidence: string; blocking: boolean;
  nodeId?: number; selector?: string; sourceMappingStatus?: "EXACT" | "INFERRED" | "UNKNOWN"; rect?: DomNode["rect"];
  relatedNodeIds?: number[]; overlapPixels?: number; overlapRatio?: number; contrastRatio?: number | null;
  expectedValue?: string | number; actualValue?: string | number;
}

const OVERFLOW_TOLERANCE_PX = 4;

async function evaluateUiRule(type: InspectionType, page: Page, nodes: DomNode[], profile: ViewportProfile, resources: ResourceEvent[]): Promise<RuleFinding[]> {
  switch (type) {
    case "UI_DOM_STRUCTURE_CHECK": return ruleDomStructure(nodes);
    case "UI_LAYOUT_CHECK": return ruleOutsideViewport(nodes, profile);
    case "UI_OVERFLOW_CHECK": return ruleOverflow(nodes);
    case "UI_OVERLAP_CHECK": return ruleOverlap(nodes);
    case "UI_TEXT_RENDER_CHECK": return ruleTextClipped(nodes);
    case "UI_COLOR_CONTRAST_CHECK": return ruleColorContrast(page, nodes, profile);
    case "UI_INTERACTIVE_TARGET_CHECK": return ruleSmallTarget(nodes);
    case "UI_ACCESSIBILITY_CHECK": return ruleAccessibility(page);
    case "UI_RESOURCE_CHECK": return ruleResourceFailure(resources);
    default: return [];
  }
}

export function ruleDomStructure(nodes: DomNode[]): RuleFinding[] {
  const findings: RuleFinding[] = [];
  const idCounts = new Map<string, DomNode[]>();
  for (const n of nodes) {
    const id = n.attributes.id;
    if (!id) continue;
    const list = idCounts.get(id) ?? [];
    list.push(n);
    idCounts.set(id, list);
  }
  for (const [id, list] of idCounts) {
    if (list.length > 1) {
      findings.push({
        code: "UI_DUPLICATE_ID", severity: "WARNING", message: `duplicate real DOM id "${id}" on ${list.length} elements`,
        evidence: `real DOM ids found: ${list.map((n) => n.selector).join(", ")}`, blocking: false,
        nodeId: list[0].nodeId, selector: list[0].selector, relatedNodeIds: list.map((n) => n.nodeId),
      });
    }
  }
  return findings;
}

export function ruleOutsideViewport(nodes: DomNode[], profile: ViewportProfile): RuleFinding[] {
  const findings: RuleFinding[] = [];
  for (const n of nodes) {
    if (!n.visible || !n.interactive) continue;
    const outside = n.rect.right <= 0 || n.rect.bottom <= 0 || n.rect.left >= profile.width || n.rect.top >= profile.height * 3;
    if (outside) {
      findings.push({
        code: "UI_OUTSIDE_VIEWPORT", severity: "ERROR", message: `interactive element ${n.selector} is entirely outside the real ${profile.id} viewport`,
        evidence: `real rect: ${JSON.stringify(n.rect)}, real viewport: ${profile.width}x${profile.height}`, blocking: true,
        nodeId: n.nodeId, selector: n.selector, rect: n.rect, sourceMappingStatus: n.sourceHint.status,
      });
    }
  }
  return findings;
}

export function ruleOverflow(nodes: DomNode[]): RuleFinding[] {
  const findings: RuleFinding[] = [];
  for (const n of nodes) {
    if (!n.visible) continue;
    if (n.scrollWidth - n.clientWidth > OVERFLOW_TOLERANCE_PX && n.style.overflowX !== "scroll" && n.style.overflowX !== "auto") {
      findings.push({
        code: "UI_OVERFLOW_HORIZONTAL", severity: "ERROR", message: `${n.selector} has real horizontal overflow (scrollWidth ${n.scrollWidth} > clientWidth ${n.clientWidth})`,
        evidence: `real scrollWidth=${n.scrollWidth}, clientWidth=${n.clientWidth}, overflowX=${n.style.overflowX}`, blocking: true,
        nodeId: n.nodeId, selector: n.selector, rect: n.rect, actualValue: n.scrollWidth - n.clientWidth, expectedValue: 0,
      });
    }
    if (n.scrollHeight - n.clientHeight > OVERFLOW_TOLERANCE_PX && n.style.overflowY !== "scroll" && n.style.overflowY !== "auto" && n.tagName !== "html" && n.tagName !== "body") {
      findings.push({
        code: "UI_OVERFLOW_VERTICAL", severity: "WARNING", message: `${n.selector} has real vertical overflow (scrollHeight ${n.scrollHeight} > clientHeight ${n.clientHeight}) without a scroll declaration`,
        evidence: `real scrollHeight=${n.scrollHeight}, clientHeight=${n.clientHeight}, overflowY=${n.style.overflowY}`, blocking: false,
        nodeId: n.nodeId, selector: n.selector, rect: n.rect, actualValue: n.scrollHeight - n.clientHeight, expectedValue: 0,
      });
    }
  }
  return findings;
}

export function ruleTextClipped(nodes: DomNode[]): RuleFinding[] {
  const findings: RuleFinding[] = [];
  for (const n of nodes) {
    if (!n.visible || !n.textPreview) continue;
    const clippedByOverflow = (n.style.overflowX === "hidden" || n.style.overflowY === "hidden") && (n.scrollWidth > n.clientWidth + OVERFLOW_TOLERANCE_PX || n.scrollHeight > n.clientHeight + OVERFLOW_TOLERANCE_PX);
    const hasEllipsis = n.style.textOverflow === "ellipsis";
    if (clippedByOverflow && !hasEllipsis) {
      findings.push({
        code: "UI_TEXT_CLIPPED", severity: "WARNING", message: `text in ${n.selector} is clipped by real overflow:hidden with no ellipsis affordance`,
        evidence: `real scrollWidth=${n.scrollWidth}/clientWidth=${n.clientWidth}, scrollHeight=${n.scrollHeight}/clientHeight=${n.clientHeight}, textOverflow=${n.style.textOverflow}`, blocking: false,
        nodeId: n.nodeId, selector: n.selector, rect: n.rect,
      });
    }
  }
  return findings;
}

export async function ruleColorContrast(page: Page, nodes: DomNode[], profile: ViewportProfile): Promise<RuleFinding[]> {
  const findings: RuleFinding[] = [];
  const textNodes = nodes.filter((n) => n.visible && n.textPreview.length > 0).slice(0, 200); // real, bounded — avoid an unbounded per-node page.evaluate round-trip on a huge page
  for (const n of textNodes) {
    const result = await computeContrastForNode(page, n.selector).catch(() => null);
    if (!result) continue;
    const fontSizePx = parseFloat(result.fontSize);
    const fontWeightNum = parseInt(result.fontWeight, 10) || 400;
    const isLarge = fontSizePx >= 24 || (fontSizePx >= 18.66 && fontWeightNum >= 700);
    const required = isLarge ? MIN_CONTRAST_LARGE : MIN_CONTRAST_NORMAL;
    if (result.ratio === null) {
      findings.push({
        code: "UI_LOW_CONTRAST", severity: "INFO", message: `contrast for ${n.selector} is UNKNOWN — real background is an image/gradient, cannot compute one real RGB value`,
        evidence: `real getComputedStyle background is an image (backgroundImage != none) — screenshot is the corroborating evidence`, blocking: false,
        nodeId: n.nodeId, selector: n.selector, rect: n.rect, contrastRatio: null, expectedValue: required, actualValue: "UNKNOWN",
      });
      continue;
    }
    if (result.ratio < required) {
      findings.push({
        code: "UI_LOW_CONTRAST", severity: "ERROR", message: `${n.selector} real contrast ratio ${result.ratio.toFixed(2)} is below the required ${required} (font ${result.fontSize}/${result.fontWeight})`,
        evidence: `real foreground ${result.fg} vs real background ${result.bg}, WCAG 2.1 formula`, blocking: true,
        nodeId: n.nodeId, selector: n.selector, rect: n.rect, contrastRatio: result.ratio, expectedValue: required, actualValue: Math.round(result.ratio * 100) / 100,
      });
    }
  }
  return findings;
}

export function ruleSmallTarget(nodes: DomNode[]): RuleFinding[] {
  const findings: RuleFinding[] = [];
  for (const n of nodes) {
    if (!n.visible || !n.interactive) continue;
    if ((n.rect.width > 0 && n.rect.width < MIN_TARGET_SIZE) || (n.rect.height > 0 && n.rect.height < MIN_TARGET_SIZE)) {
      findings.push({
        code: "UI_SMALL_TARGET", severity: "WARNING", message: `interactive target ${n.selector} is ${Math.round(n.rect.width)}x${Math.round(n.rect.height)}, below the ${MIN_TARGET_SIZE}x${MIN_TARGET_SIZE} real minimum target size policy`,
        evidence: `real getBoundingClientRect width=${n.rect.width}, height=${n.rect.height}`, blocking: false,
        nodeId: n.nodeId, selector: n.selector, rect: n.rect, expectedValue: MIN_TARGET_SIZE, actualValue: Math.round(Math.min(n.rect.width, n.rect.height)),
      });
    }
  }
  return findings;
}

/** Real overlap detection — bounded to visible interactive + heading/
 * paragraph elements only (never all-pairs across the whole DOM), skips
 * real parent-child ancestry (normal containment), and skips elements
 * whose real computed position is fixed/sticky (declared overlay/header
 * pattern) when checked against non-fixed content. */
export function ruleOverlap(nodes: DomNode[]): RuleFinding[] {
  const findings: RuleFinding[] = [];
  const candidates = nodes.filter((n) => n.visible && (n.interactive || ["h1", "h2", "h3", "h4", "h5", "h6", "p"].includes(n.tagName)) && n.rect.width > 4 && n.rect.height > 4);
  const isAncestor = (maybeAncestorId: number, n: DomNode, byId: Map<number, DomNode>): boolean => {
    let cur: DomNode | undefined = n;
    let depth = 0;
    while (cur && cur.parentNodeId !== null && depth < 20) {
      if (cur.parentNodeId === maybeAncestorId) return true;
      cur = byId.get(cur.parentNodeId);
      depth++;
    }
    return false;
  };
  const byId = new Map(nodes.map((n) => [n.nodeId, n]));
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const a = candidates[i], b = candidates[j];
      if (isAncestor(a.nodeId, b, byId) || isAncestor(b.nodeId, a, byId)) continue; // normal parent-child containment
      if (a.style.position === "fixed" || a.style.position === "sticky" || b.style.position === "fixed" || b.style.position === "sticky") continue; // declared fixed/overlay pattern
      const ix = Math.max(0, Math.min(a.rect.right, b.rect.right) - Math.max(a.rect.left, b.rect.left));
      const iy = Math.max(0, Math.min(a.rect.bottom, b.rect.bottom) - Math.max(a.rect.top, b.rect.top));
      const overlapPixels = ix * iy;
      if (overlapPixels <= 0) continue;
      const smallerArea = Math.min(a.rect.width * a.rect.height, b.rect.width * b.rect.height);
      const overlapRatio = smallerArea > 0 ? overlapPixels / smallerArea : 0;
      if (overlapRatio < 0.15) continue; // real tolerance — small edge overlaps (borders/shadows) are not real problems
      const bothInteractive = a.interactive && b.interactive;
      findings.push({
        code: bothInteractive ? "UI_ELEMENT_OVERLAP" : "UI_TEXT_OVERLAP", severity: bothInteractive ? "ERROR" : "WARNING",
        message: `${a.selector} and ${b.selector} overlap by real ${Math.round(overlapPixels)}px² (${Math.round(overlapRatio * 100)}%)`,
        evidence: `real getBoundingClientRect intersection: a=${JSON.stringify(a.rect)}, b=${JSON.stringify(b.rect)}`, blocking: bothInteractive,
        nodeId: a.nodeId, selector: a.selector, rect: a.rect, relatedNodeIds: [b.nodeId], overlapPixels: Math.round(overlapPixels), overlapRatio: Math.round(overlapRatio * 1000) / 1000,
      });
    }
  }
  return findings;
}

export async function ruleAccessibility(page: Page): Promise<RuleFinding[]> {
  const findings: RuleFinding[] = [];
  const tree = await captureAccessibilityTree(page);
  if (!tree) return findings;

  let lastHeadingLevel = 0;
  const walk = (node: AccessibilityNode) => {
    const role = node.role;
    const name = (node.name ?? "").trim();
    if ((role === "button" || role === "link") && name.length === 0) {
      findings.push({ code: "UI_MISSING_ACCESSIBLE_NAME", severity: "ERROR", message: `an interactive ${role} has no real accessible name`, evidence: `Chromium real CDP Accessibility.getFullAXTree real node: role=${role}, name=""`, blocking: true });
    }
    if (role === "textbox" && name.length === 0) {
      findings.push({ code: "UI_INPUT_MISSING_LABEL", severity: "ERROR", message: `a real text input has no real accessible label`, evidence: `Chromium real CDP Accessibility.getFullAXTree real node: role=textbox, name=""`, blocking: true });
    }
    if (role?.startsWith("heading") && typeof node.level === "number") {
      if (lastHeadingLevel > 0 && node.level > lastHeadingLevel + 1) {
        findings.push({ code: "UI_HEADING_HIERARCHY_SKIP", severity: "WARNING", message: `heading level jumps from real h${lastHeadingLevel} to h${node.level} ("${name}")`, evidence: `Chromium real CDP Accessibility.getFullAXTree real heading levels`, blocking: false });
      }
      lastHeadingLevel = node.level;
    }
    for (const child of node.children ?? []) walk(child);
  };
  walk(tree as AccessibilityNode);
  return findings;
}

export function ruleResourceFailure(resources: ResourceEvent[]): RuleFinding[] {
  const findings: RuleFinding[] = [];
  for (const r of resources) {
    const failed = !r.ok || (r.status !== null && r.status >= 400);
    if (!failed) continue;
    const critical = r.resourceType === "stylesheet" || r.resourceType === "font" || r.resourceType === "script";
    findings.push({
      code: "UI_RESOURCE_FAILURE", severity: critical ? "ERROR" : "WARNING",
      message: `real ${r.resourceType} resource failed to load: ${r.url} (${r.status ?? r.failureText ?? "unknown"})`,
      evidence: `real Playwright network event: status=${r.status}, failureText=${r.failureText}`, blocking: critical,
    });
  }
  return findings;
}

// ============================================================
// UI_RESPONSIVE_CHECK — real cross-viewport comparison using each
// viewport's already-captured real UI_LAYOUT_SNAPSHOT artifact bodies.
// ============================================================
async function runResponsiveComparison(
  perViewportArtifacts: { viewportProfileId: string; artifacts: ArtifactRecord[] }[],
  profiles: ViewportProfile[], req: UiScanRequest, scanId: string, inspectionRecords: InspectionRecord[]
): Promise<void> {
  const { getArtifactBody } = await import("./artifactRuntime");
  type LayoutRow = { nodeId: number; selector: string; rect: DomNode["rect"] };
  const byViewport = new Map<string, LayoutRow[]>();
  for (const { viewportProfileId, artifacts } of perViewportArtifacts) {
    const layoutArtifact = artifacts.find((a) => a.artifactType === "UI_LAYOUT_SNAPSHOT");
    if (!layoutArtifact) continue;
    try {
      const body = getArtifactBody(layoutArtifact.artifactId, req.ownerId);
      byViewport.set(viewportProfileId, JSON.parse(body.buf.toString("utf-8")));
    } catch { /* real read failure — skip this viewport in the comparison rather than fabricate rows */ }
  }

  const handle = createUiInspectionHandle("UI_RESPONSIVE_CHECK", "multi-viewport", req.actor, req.ownerId, req.jobId);
  handle.markStarted(`real cross-viewport comparison across ${byViewport.size} real captured viewports`);

  const baselineId = profiles[0].id;
  const baseline = byViewport.get(baselineId) ?? [];
  let findingCount = 0;
  for (const profile of profiles.slice(1)) {
    const rows = byViewport.get(profile.id);
    if (!rows) continue;
    const bySelector = new Map(rows.map((r) => [r.selector, r]));
    for (const baseRow of baseline) {
      const other = bySelector.get(baseRow.selector);
      if (!other) {
        handle.addUiFinding({
          code: "UI_RESPONSIVE_BREAK", severity: "WARNING", message: `element ${baseRow.selector} present at ${baselineId} is missing at ${profile.id}`,
          file: null, line: null, column: null, endLine: null, endColumn: null, rule: null,
          evidence: `real selector ${baseRow.selector} found in ${baselineId}'s real UI_LAYOUT_SNAPSHOT but absent from ${profile.id}'s`, blocking: true,
          source: "app/api/admin/ide/_lib/browserInspectionRuntime.ts#UI_RESPONSIVE_BREAK",
          uiMetadata: { viewportProfileId: profile.id, selector: baseRow.selector, expectedValue: "present", actualValue: "missing" },
        });
        findingCount++;
      } else if (other.rect.width <= 0 || other.rect.height <= 0) {
        handle.addUiFinding({
          code: "UI_RESPONSIVE_BREAK", severity: "WARNING", message: `element ${baseRow.selector} has zero real size at ${profile.id} (was visible at ${baselineId})`,
          file: null, line: null, column: null, endLine: null, endColumn: null, rule: null,
          evidence: `real rect at ${profile.id}: ${JSON.stringify(other.rect)}`, blocking: false,
          source: "app/api/admin/ide/_lib/browserInspectionRuntime.ts#UI_RESPONSIVE_BREAK",
          uiMetadata: { viewportProfileId: profile.id, selector: baseRow.selector, rect: other.rect },
        });
        findingCount++;
      }
    }
  }
  handle.finalizeUi(findingCount > 0 ? "WARNING" : "PASSED", null, `compared ${baseline.length} real elements across ${byViewport.size} real viewports, ${findingCount} real difference(s) found`);
  inspectionRecords.push(handle.record);

  const content = JSON.stringify(handle.record.findings);
  createUiInspectionArtifact({
    artifactType: "UI_FINDINGS", content, mimeType: "application/json", actor: req.actor, ownerId: req.ownerId,
    inspectionId: handle.record.inspectionId, jobId: req.jobId, sourceHash: null, generatedFrom: `${handle.record.inspectionId}:findings`,
  });
}

// ============================================================
// Annotated Screenshot — real rects drawn via sharp (already a project
// dependency), never AI-drawn.
// ============================================================
export async function annotateScreenshot(pngBuf: Buffer, findings: RuleFinding[], deviceScaleFactor: number): Promise<Buffer | null> {
  try {
    const meta = await sharp(pngBuf).metadata();
    const width = meta.width ?? 0, height = meta.height ?? 0;
    if (width === 0 || height === 0) return null;
    const withRects = findings.filter((f) => f.rect).slice(0, 60); // real, bounded legend size
    const colorFor = (sev: Severity) => sev === "CRITICAL" || sev === "ERROR" ? "#ff3b30" : sev === "WARNING" ? "#f0a020" : "#4da6ff";
    let svgRects = "";
    let svgLegend = "";
    withRects.forEach((f, i) => {
      const r = f.rect!;
      const x = r.left * deviceScaleFactor, y = r.top * deviceScaleFactor, w = r.width * deviceScaleFactor, h = r.height * deviceScaleFactor;
      const color = colorFor(f.severity);
      svgRects += `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="${color}" stroke-width="2" />`;
      svgRects += `<circle cx="${x}" cy="${y}" r="9" fill="${color}" /><text x="${x}" y="${y + 4}" font-size="11" fill="#fff" text-anchor="middle" font-family="sans-serif">${i + 1}</text>`;
      svgLegend += `<text x="8" y="${16 + i * 14}" font-size="11" fill="${color}" font-family="sans-serif">${i + 1}. ${f.code}</text>`;
    });
    const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">${svgRects}</svg>`;
    let composed = await sharp(pngBuf).composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).png().toBuffer();
    if (svgLegend) {
      const legendHeight = Math.min(withRects.length * 14 + 16, 400);
      const legendSvg = `<svg width="260" height="${legendHeight}" xmlns="http://www.w3.org/2000/svg"><rect width="260" height="${legendHeight}" fill="rgba(0,0,0,0.7)" />${svgLegend}</svg>`;
      composed = await sharp(composed).composite([{ input: Buffer.from(legendSvg), top: 8, left: 8 }]).png().toBuffer();
    }
    return composed;
  } catch { return null; }
}
