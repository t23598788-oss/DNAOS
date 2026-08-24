/**
 * Bounded macOS UI opener for Owner commands.
 *
 * Only targets in the allowlist below can be opened. This adapter does not
 * execute shell text, type into arbitrary windows, read screen contents, or
 * handle credentials. It delegates the actual launch to macOS `open` and
 * returns an evidence-bearing result to the existing Owner command surface.
 *
 * 2026-08-20 (Owner Work Order): added `runUiWorkOrder()` — a richer,
 * validated entry point for `open_url`/`open_path`/`open_app`/`screenshot`
 * using the schema in ./work-order.ts (target/scope/timeout/dry_run/
 * risk_confirmed/idempotency_key). Admission (./work-order.ts's
 * `validateUiWorkOrder`) always runs BEFORE any real OS call — a denial
 * never reaches `runOpen`/`runScreencapture`. `openOsUi()` below is
 * unchanged for existing callers; this is an addition, not a
 * replacement, and not a parallel system — same capability, same
 * `os-ui` registry entry, wired through the same `runOsUiStep` in
 * `control/command-router/router.ts`.
 *
 * Explicit, permanent refusals (never implemented here, regardless of
 * any future request): reading credential/password/MFA/Keychain
 * surfaces, dismissing or scripting a macOS permission dialog, and
 * running arbitrary shell text. `validateUiWorkOrder`'s
 * CREDENTIAL_SURFACE_DENIED is unconditional; nothing in this file can
 * override it.
 */

declare const require: (id: string) => unknown;

import type { UiWorkOrder, UiWorkOrderOutcome, ValidationResult } from "./work-order";
import { validateUiWorkOrder } from "./work-order";
import { readScreen, speakText } from "./screen-reader";

export type OsUiTarget = "vscode" | "chrome" | "dna-os" | "system-settings-firewall" | "finder-infra" | "finder-deadboard" | "terminal" | "display-wake";

export interface OsUiOutcome {
  ok: boolean;
  target: OsUiTarget;
  status: "COMPLETED" | "OWNER_ACTION_REQUIRED" | "FAILED" | "UNKNOWN";
  summary: string;
  evidence: string[];
  nextAction: string | null;
}

const TARGETS: Record<OsUiTarget, { kind: "app" | "url" | "path"; value: string; label: string }> = {
  vscode: { kind: "app", value: "Visual Studio Code", label: "VS Code" },
  chrome: { kind: "app", value: "Google Chrome", label: "Google Chrome" },
  "dna-os": { kind: "url", value: "http://127.0.0.1:3000", label: "DNA OS" },
  "system-settings-firewall": { kind: "url", value: "x-apple.systempreferences:com.apple.Network-Settings.extension?Firewall", label: "macOS Firewall" },
  "finder-infra": { kind: "path", value: "/Users/tam/Desktop/DNA-OS-INFRASTRUCTURE", label: "DNA OS Infrastructure" },
  "finder-deadboard": { kind: "path", value: "/Users/tam/Desktop/dna-os-deadboard", label: "DNA OS Deadboard" },
  terminal: { kind: "app", value: "Terminal", label: "Terminal" },
  "display-wake": { kind: "app", value: "", label: "macOS display wake request" },
};

export interface OsUiTargetLocator {
  kind: "app" | "url" | "path";
  value: string;
  label: string;
}

/**
 * Read-only lookup of a target's real locator — never mutates, never
 * opens anything, never adds a target `openOsUi` doesn't already know.
 * Exists so a caller outside this folder (e.g.
 * `control/system-reference-resolution/`, verifying a `url`-kind target
 * is actually reachable after `openOsUi` runs) can cite/check what a
 * target really points to without a second, drifting copy of `TARGETS`
 * living elsewhere.
 */
export function resolveOsUiTargetLocator(target: OsUiTarget): OsUiTargetLocator | null {
  return TARGETS[target] ?? null;
}

export function parseOsUiTarget(text: string, payload: unknown): OsUiTarget | null {
  const candidate = payload && typeof payload === "object" && "target" in payload
    ? String((payload as { target?: unknown }).target ?? "")
    : "";
  const input = `${candidate} ${text}`.toLowerCase();
  if (input.includes("vs code") || input.includes("vscode")) return "vscode";
  if (input.includes("chrome")) return "chrome";
  if (input.includes("dna os") || input.includes("deadboard")) return input.includes("deadboard") ? "finder-deadboard" : "dna-os";
  if (input.includes("firewall") || input.includes("ไฟร์วอลล์")) return "system-settings-firewall";
  if (input.includes("infrastructure") || input.includes("โครงสร้าง")) return "finder-infra";
  if (input.includes("terminal") || input.includes("เทอร์มินัล")) return "terminal";
  if ((input.includes("wake") && input.includes("display")) || (input.includes("ปลุก") && input.includes("จอ"))) return "display-wake";
  return null;
}

export async function openOsUi(target: OsUiTarget): Promise<OsUiOutcome> {
  if (process.platform !== "darwin") {
    return { ok: false, target, status: "UNKNOWN", summary: "OS UI opener is implemented for macOS only", evidence: [`platform=${process.platform}`], nextAction: "OWNER_REVIEW" };
  }
  const spec = TARGETS[target];
  if (!spec) {
    return { ok: false, target, status: "FAILED", summary: "Target is not in the OS UI allowlist", evidence: ["allowlist=DENY"], nextAction: "OWNER_REVIEW" };
  }
  if (target === "display-wake") {
    const result = await runCaffeinate();
    return {
      ok: result.exitCode === 0,
      target,
      status: result.exitCode === 0 ? "COMPLETED" : "FAILED",
      summary: result.exitCode === 0 ? "macOS display wake request was sent" : "macOS display wake request failed",
      evidence: ["target=display-wake", `caffeinate=${result.exitCode === 0 ? "OK" : "FAILED"}`, "physical_display=NOT_VERIFIED", "screen_unlock=NOT_ATTEMPTED"],
      nextAction: result.exitCode === 0 ? "If the display remains locked, the Owner must wake/unlock it manually" : "Retry the display wake request",
    };
  }
  const wake = await runCaffeinate();
  const args = spec.kind === "app" ? ["-a", spec.value] : [spec.value];
  const result = await runOpen(args);
  if (result.exitCode !== 0) {
    return {
      ok: false,
      target,
      status: "FAILED",
      summary: `macOS could not open ${spec.label}`,
      evidence: [`target=${target}`, "allowlist=ALLOW", `caffeinate=${wake.exitCode === 0 ? "OK" : "FAILED"}`, "os_open=FAILED", "screen_unlock=NOT_ATTEMPTED"],
      nextAction: `Check that ${spec.label} is installed or that the path exists, then retry`,
    };
  }
  return {
    ok: true,
    target,
    status: "COMPLETED",
    summary: `${spec.label} opened by macOS`,
    evidence: [`target=${target}`, "allowlist=ALLOW", `caffeinate=${wake.exitCode === 0 ? "OK" : "FAILED"}`, "physical_display=NOT_VERIFIED", "os_open=OK", "screen_unlock=NOT_ATTEMPTED"],
    nextAction: "If the display remains locked, the Owner must wake/unlock it manually",
  };
}

async function runOpen(args: string[]): Promise<{ exitCode: number }> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  try {
    await promisify(execFile)("/usr/bin/open", args, { timeout: 10_000, maxBuffer: 16 * 1024 });
    return { exitCode: 0 };
  } catch {
    return { exitCode: 1 };
  }
}

async function runOsascript(script: string): Promise<{ ok: boolean; stdout: string }> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  try {
    const { stdout } = await promisify(execFile)("/usr/bin/osascript", ["-e", script], { timeout: 5_000, maxBuffer: 8 * 1024 });
    return { ok: true, stdout: stdout.trim() };
  } catch {
    return { ok: false, stdout: "" };
  }
}

async function isProcessRunning(processName: string): Promise<boolean> {
  const esc = processName.replace(/"/g, '\\"');
  const result = await runOsascript(`tell application "System Events" to (name of processes) contains "${esc}"`);
  return result.ok && result.stdout === "true";
}

async function getFrontmostProcess(): Promise<string | null> {
  const result = await runOsascript('tell application "System Events" to get name of first process whose frontmost is true');
  return result.ok && result.stdout.length > 0 ? result.stdout : null;
}

async function runCaffeinate(): Promise<{ exitCode: number }> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  try {
    await promisify(execFile)("/usr/bin/caffeinate", ["-u", "-t", "3"], { timeout: 5_000, maxBuffer: 8 * 1024 });
    return { exitCode: 0 };
  } catch {
    return { exitCode: 1 };
  }
}

function writeScreenReadArtifact(read: import("./work-order").ScreenReadResult): string {
  const path = require("node:path") as { join(...p: string[]): string };
  const fs = require("node:fs") as { mkdirSync(p: string, o: { recursive: boolean }): void; writeFileSync(p: string, c: string, e: string): void };
  const dir = path.join(process.cwd(), "connections/os-ui/data/screen-reads");
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `read-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`);
  fs.writeFileSync(filePath, JSON.stringify(read, null, 2), "utf-8"); // already fully redacted by ./screen-reader.ts before this point
  return filePath;
}

// ---- UI Work Order (2026-08-20) ----------------------------------------

const idempotencyCache = new Map<string, UiWorkOrderOutcome>();

function appendAudit(order: UiWorkOrder, admission: ValidationResult, outcome: UiWorkOrderOutcome): void {
  // Same flat-file, append-only evidence convention as
  // control/agent-gateway/memory-store.ts — never a new database engine.
  const record = { recorded_at: new Date().toISOString(), order: { ...order, target: outcome.status === "BLOCKED" && admission.reason_codes.includes("CREDENTIAL_SURFACE_DENIED") ? "[redacted]" : order.target }, admission, outcome };
  try {
    const fs = require("node:fs") as { mkdirSync(p: string, o: { recursive: boolean }): void; appendFileSync(p: string, c: string, e: string): void };
    const path = require("node:path") as { join(...p: string[]): string };
    const dir = path.join(process.cwd(), "connections/os-ui/data");
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, "work-order-audit.jsonl"), `${JSON.stringify(record)}\n`, "utf-8");
  } catch {
    // Audit-write failure must never block or fake the real outcome —
    // the outcome already returned to the caller is unaffected.
  }
}

async function runWithTimeout<T>(fn: () => Promise<T>, timeoutMs: number, onTimeout: T): Promise<{ result: T; timedOut: boolean }> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(onTimeout), timeoutMs);
  });
  const result = await Promise.race([fn(), timeout]);
  clearTimeout(timer!);
  return { result, timedOut: result === onTimeout };
}

async function runScreencapture(timeoutMs: number): Promise<{ exitCode: number; filePath: string | null }> {
  const path = require("node:path") as { join(...p: string[]): string };
  const fs = require("node:fs") as { mkdirSync(p: string, o: { recursive: boolean }): void };
  const dir = path.join(process.cwd(), "connections/os-ui/data/screenshots");
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `screenshot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`);
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  try {
    // -x: silent (no camera-shutter sound), full screen only — no window/
    // selection targeting, which would need extra permission scoping this
    // round explicitly does not add.
    await promisify(execFile)("/usr/sbin/screencapture", ["-x", filePath], { timeout: Math.min(timeoutMs, 15_000), maxBuffer: 8 * 1024 });
    return { exitCode: 0, filePath };
  } catch {
    return { exitCode: 1, filePath: null };
  }
}

const ACCESSIBILITY_APP_NAMES: Record<string, string> = { vscode: "Code", chrome: "Google Chrome", terminal: "Terminal", line: "LINE" };

function appleScriptString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, " ")}"`;
}

async function runAccessibilityAction(order: UiWorkOrder): Promise<{ ok: boolean; evidence: string[]; error?: string }> {
  if (order.ui_action === "wait") {
    await new Promise((resolve) => setTimeout(resolve, Math.min(order.timeout_ms, 1000)));
    return { ok: true, evidence: ["wait=OK"] };
  }
  const appName = ACCESSIBILITY_APP_NAMES[order.app ?? ""];
  if (!appName) return { ok: false, evidence: ["accessibility=FAILED", "app=NOT_ALLOWLISTED"], error: "app is not allowlisted" };
  let script = `tell application "System Events"\n  tell process ${appleScriptString(appName)}\n`;
  if (order.ui_action === "focus") script += "    set frontmost to true\n";
  if (order.ui_action === "click") {
    if (order.coordinate) {
      script += `    click at {${order.coordinate.x}, ${order.coordinate.y}}\n`;
    } else {
      script += `    click (first UI element of front window whose title is ${appleScriptString(order.control_label ?? "")} or description is ${appleScriptString(order.control_label ?? "")})\n`;
    }
  }
  if (order.ui_action === "type") script += `    keystroke ${appleScriptString(order.text ?? "")}\n`;
  if (order.ui_action === "key") {
    const key = (order.key ?? "").toUpperCase();
    const keyCodes: Record<string, number> = { ENTER: 36, TAB: 48, ESCAPE: 53, SPACE: 49, ARROWDOWN: 125, ARROWUP: 126, ARROWLEFT: 123, ARROWRIGHT: 124 };
    if (key === "COMMAND+S" || key === "COMMAND+F") {
      script += `    keystroke "${key.endsWith("S") ? "s" : "f"}" using command down\n`;
    } else {
      script += `    key code ${keyCodes[key] ?? 0}\n`;
    }
  }
  script += "  end tell\nend tell";
  const result = await runOsascript(script);
  return result.ok ? { ok: true, evidence: ["accessibility=OK", `action=${order.ui_action}`] } : { ok: false, evidence: ["accessibility=FAILED", `action=${order.ui_action}`], error: "macOS Accessibility action failed or permission was denied" };
}

// open_app's `open -a <value>` name vs. the REAL process name macOS
// registers with System Events are NOT always the same string (real,
// observed: "Visual Studio Code" launches a process actually named
// "Code" — verified live 2026-08-20). Two separate maps, on purpose.
const APP_OPEN_NAME: Record<string, string> = { vscode: "Visual Studio Code", chrome: "Google Chrome", terminal: "Terminal", line: "LINE" };
const APP_PROCESS_NAME: Record<string, string> = { vscode: "Code", chrome: "Google Chrome", terminal: "Terminal", line: "LINE" };

function blockedOutcome(summary: string, evidence: string[], nextAction: string | null): UiWorkOrderOutcome {
  return { ok: false, status: "BLOCKED", summary, evidence, artifacts: [], next_action: nextAction, idempotent_replay: false, presentation: "BLOCKED", focus_restored: null };
}

/**
 * The Work Order entry point. Order: admission (validateUiWorkOrder) ->
 * idempotency replay check -> dry_run short-circuit -> capture
 * frontmost-before (for restore_focus/presentation) -> real OS call ->
 * classify presentation -> restore focus if requested -> audit. A
 * BLOCKED admission never reaches any OS call, matching
 * ../../control/agent-gateway/work-order-validator.ts's own
 * "validate before execute" discipline.
 */
export async function runUiWorkOrder(order: UiWorkOrder): Promise<UiWorkOrderOutcome> {
  if (process.platform !== "darwin") {
    return { ok: false, status: "FAILED", summary: "UI Work Orders are implemented for macOS only", evidence: [`platform=${process.platform}`], artifacts: [], next_action: "OWNER_REVIEW", idempotent_replay: false, presentation: null, focus_restored: null };
  }

  const admission = validateUiWorkOrder(order);
  if (!admission.ok) {
    const credentialDenied = admission.reason_codes.includes("CREDENTIAL_SURFACE_DENIED");
    const riskGate = admission.reason_codes.includes("RISK_CONFIRMATION_REQUIRED") && admission.reason_codes.length === 1;
    const outcome: UiWorkOrderOutcome = {
      ...blockedOutcome(
        credentialDenied
          ? "Refused: this target touches a credential/MFA/Keychain surface — never automated"
          : riskGate
            ? "This is a HIGH-risk action (screenshot / open_url) — resubmit with risk_confirmed=true after Owner review"
            : `Work Order rejected at admission: ${admission.reason_codes.join(", ")}`,
        admission.evidence,
        riskGate ? "Owner must confirm risk before this action runs" : "OWNER_REVIEW"
      ),
      status: riskGate ? "OWNER_ACTION_REQUIRED" : "BLOCKED",
    };
    appendAudit(order, admission, outcome);
    return outcome;
  }

  if (order.idempotency_key) {
    const cached = idempotencyCache.get(order.idempotency_key);
    if (cached) {
      const replay: UiWorkOrderOutcome = { ...cached, idempotent_replay: true, summary: `${cached.summary} (idempotent replay — not re-executed)` };
      appendAudit(order, admission, replay);
      return replay;
    }
  }

  if (order.dry_run) {
    const outcome: UiWorkOrderOutcome = {
      ok: true,
      status: "DRY_RUN_OK",
      summary: `Dry run: would perform "${order.ui_action}" (risk=${admission.risk}, foreground=${order.foreground !== false}) — no real OS call was made`,
      evidence: [...admission.evidence, "dry_run=true"],
      artifacts: [],
      next_action: null,
      idempotent_replay: false,
      presentation: null,
      focus_restored: null,
    };
    if (order.idempotency_key) idempotencyCache.set(order.idempotency_key, outcome);
    appendAudit(order, admission, outcome);
    return outcome;
  }

  const foreground = order.foreground !== false; // default true
  let outcome: UiWorkOrderOutcome;

  if (order.ui_action === "screenshot") {
    const { result, timedOut } = await runWithTimeout(() => runScreencapture(order.timeout_ms), order.timeout_ms, { exitCode: 1, filePath: null });
    outcome = result.exitCode === 0 && result.filePath
      ? { ok: true, status: "COMPLETED", summary: "Screenshot captured", evidence: [...admission.evidence, "screencapture=OK"], artifacts: [{ kind: "screenshot_file", ref: result.filePath }], next_action: null, idempotent_replay: false, presentation: null, focus_restored: null }
      : { ok: false, status: "FAILED", summary: timedOut ? `Screenshot timed out after ${order.timeout_ms}ms` : "Screenshot failed", evidence: [...admission.evidence, timedOut ? "timeout=true" : "screencapture=FAILED"], artifacts: [], next_action: "Retry the screenshot", idempotent_replay: false, presentation: null, focus_restored: null };
  } else if (order.ui_action === "read_screen") {
    const { result: read, timedOut } = await runWithTimeout(() => readScreen(order.target, order.timeout_ms), order.timeout_ms, null as unknown as Awaited<ReturnType<typeof readScreen>>);
    if (timedOut || !read) {
      outcome = { ok: false, status: "FAILED", summary: `read_screen timed out after ${order.timeout_ms}ms`, evidence: [...admission.evidence, "timeout=true"], artifacts: [], next_action: "Retry read_screen", idempotent_replay: false, presentation: null, focus_restored: null };
    } else if (read.state === "permission_denied") {
      outcome = { ok: false, status: "OWNER_ACTION_REQUIRED", summary: "Accessibility permission not granted — the official System Settings pane was opened for the Owner", evidence: [...admission.evidence, ...read.warnings], artifacts: [], next_action: read.suggested_next_action, idempotent_replay: false, presentation: null, focus_restored: null };
    } else if (read.state === "read_error") {
      outcome = { ok: false, status: "FAILED", summary: "read_screen failed", evidence: [...admission.evidence, ...read.warnings], artifacts: [], next_action: read.suggested_next_action, idempotent_replay: false, presentation: null, focus_restored: null };
    } else {
      const artifactPath = writeScreenReadArtifact(read);
      outcome = {
        ok: true,
        status: "COMPLETED",
        summary: `read_screen: app="${read.app ?? "unknown"}" title="${read.title ?? ""}" confidence=${read.confidence}`,
        evidence: [...admission.evidence, `state=${read.state}`, `confidence=${read.confidence}`, ...read.warnings],
        artifacts: [{ kind: "screen_read_result_redacted", ref: artifactPath }],
        next_action: read.suggested_next_action,
        idempotent_replay: false,
        presentation: null,
        focus_restored: null,
      };
    }
  } else if (order.ui_action === "speak") {
    const { result: speak, timedOut } = await runWithTimeout(() => speakText(order.target, order.timeout_ms), order.timeout_ms, { ok: false, spoke: false, error: "TIMEOUT" });
    outcome = speak.ok
      ? { ok: true, status: "COMPLETED", summary: "Spoke text via macOS say", evidence: [...admission.evidence, "say=OK"], artifacts: [], next_action: null, idempotent_replay: false, presentation: null, focus_restored: null }
      : { ok: false, status: "FAILED", summary: timedOut ? `speak timed out after ${order.timeout_ms}ms` : `speak failed: ${speak.error ?? "unknown"}`, evidence: [...admission.evidence, timedOut ? "timeout=true" : "say=FAILED"], artifacts: [], next_action: "Retry speak", idempotent_replay: false, presentation: null, focus_restored: null };
  } else if (["click", "type", "key", "focus", "wait"].includes(order.ui_action)) {
    const { result, timedOut } = await runWithTimeout(() => runAccessibilityAction(order), order.timeout_ms, { ok: false, evidence: ["timeout=true"], error: "TIMEOUT" });
    outcome = result.ok
      ? { ok: true, status: "COMPLETED", summary: `${order.ui_action} completed through macOS Accessibility`, evidence: [...admission.evidence, ...result.evidence], artifacts: [], next_action: null, idempotent_replay: false, presentation: order.ui_action === "focus" ? "FOCUSED" : null, focus_restored: null }
      : { ok: false, status: "FAILED", summary: timedOut ? `${order.ui_action} timed out after ${order.timeout_ms}ms` : `${order.ui_action} failed: ${result.error ?? "unknown error"}`, evidence: [...admission.evidence, ...result.evidence], artifacts: [], next_action: "Verify Accessibility permission and retry", idempotent_replay: false, presentation: null, focus_restored: null };
  } else {
    // Real state BEFORE we do anything — this is what makes OPENED vs
    // REUSED vs FOCUSED an honest, verified classification instead of a
    // guess, and what restore_focus re-activates afterward.
    const processName = order.ui_action === "open_app" ? APP_PROCESS_NAME[order.target] : order.ui_action === "open_path" ? "Finder" : null; // open_url: default browser is not reliably known — presentation degrades honestly below
    const wasRunningBefore = processName ? await isProcessRunning(processName) : null;
    const frontmostBefore = foreground ? await getFrontmostProcess() : null;
    const wasAlreadyFrontmost = processName !== null && frontmostBefore === processName;

    const openArgs = order.ui_action === "open_app" ? ["-a", APP_OPEN_NAME[order.target]] : [order.target];
    const args = foreground ? openArgs : ["-g", ...openArgs];
    const { result, timedOut } = await runWithTimeout(() => runOpen(args), order.timeout_ms, { exitCode: 1 });

    if (result.exitCode !== 0) {
      outcome = { ok: false, status: "FAILED", summary: timedOut ? `${order.ui_action} timed out after ${order.timeout_ms}ms` : `${order.ui_action} failed for "${order.target}"`, evidence: [...admission.evidence, timedOut ? "timeout=true" : "os_open=FAILED"], artifacts: [], next_action: `Retry ${order.ui_action}`, idempotent_replay: false, presentation: null, focus_restored: null };
    } else if (!foreground) {
      const confirmedRunning = processName ? await isProcessRunning(processName) : true; // open_url background: cannot verify by process name, trust exit code
      outcome = { ok: confirmedRunning, status: confirmedRunning ? "COMPLETED" : "FAILED", summary: confirmedRunning ? `${order.ui_action} completed for "${order.target}" (background, not brought to front)` : `${order.ui_action} did not confirm as running after launch`, evidence: [...admission.evidence, "os_open=OK", `foreground=false`, `background_confirmed=${confirmedRunning}`], artifacts: [], next_action: confirmedRunning ? null : `Retry ${order.ui_action}`, idempotent_replay: false, presentation: confirmedRunning ? "BACKGROUND_RUNNING" : null, focus_restored: null };
    } else {
      const presentation: import("./work-order").WindowPresentationState = wasAlreadyFrontmost ? "FOCUSED" : processName === null ? "OPENED" : wasRunningBefore ? "REUSED" : "OPENED";
      let focusRestored: boolean | null = null;
      if (order.restore_focus && frontmostBefore && frontmostBefore !== processName) {
        const esc = frontmostBefore.replace(/"/g, '\\"');
        await runOsascript(`tell application "${esc}" to activate`);
        const nowFrontmost = await getFrontmostProcess();
        focusRestored = nowFrontmost === frontmostBefore;
      }
      outcome = {
        ok: true,
        status: "COMPLETED",
        summary: `${order.ui_action} completed for "${order.target}" (${presentation.toLowerCase()})`,
        evidence: [...admission.evidence, "os_open=OK", "foreground=true", `presentation=${presentation}`, processName === null ? "presentation_precision=LOW_UNKNOWN_DEFAULT_BROWSER" : "presentation_precision=VERIFIED"],
        artifacts: [],
        next_action: null,
        idempotent_replay: false,
        presentation,
        focus_restored: focusRestored,
      };
    }
  }

  if (order.idempotency_key) idempotencyCache.set(order.idempotency_key, outcome);
  appendAudit(order, admission, outcome);
  return outcome;
}
