/**
 * หน้าที่: the UI Work Order schema for `connections/os-ui/` — a richer,
 * structured request shape for the SAME `os-ui` capability already
 * registered in `control/command-router/capability-registry.ts` and
 * already reachable from Owner Console via
 * `owner-command-http:8791` -> `owner-command` -> `command-router` ->
 * `os-ui`. This is NOT a parallel system: `openOsUi()` (single fixed
 * target, no schema) still works unchanged for the original callers;
 * `runUiWorkOrder()` (this file's real entry point, wired into the SAME
 * `runOsUiStep` in router.ts) is the richer path for `open_url`/
 * `open_path`/`screenshot` — the three new allowlist targets the Owner
 * asked for this round (2026-08-20).
 *
 * `WorkOrder` (control/agent-gateway/types.ts) already exists for file
 * writes — deliberately NOT reused here: that type is FILE-shaped
 * (operation/content/required_tests), this one is UI-action-shaped
 * (ui_action/target/timeout/dry_run). Same safety posture (admission
 * before execute, evidence after, fail-closed), different domain — same
 * pattern `permissions/write-gate/` and `connections/os-login/` already
 * each keep their own domain-specific validation, never a shared one.
 *
 * Input: `UiWorkOrder`.
 * Output: `UiWorkOrderOutcome`, `validateUiWorkOrder`.
 * Dependency ที่อนุญาต: none — pure validation, no OS ambient (that stays
 * in ./adapter-contract.ts, same isolation convention as every
 * host-runtime.ts in this repo).
 * สิ่งที่ห้ามแตะ: never let this validator pass a target that touches a
 * credential surface (Keychain, password/passkey panes, any app whose
 * name suggests credential storage) — CREDENTIAL_SURFACE_DENIED is
 * unconditional, `risk_confirmed` cannot override it. Never widen
 * `open_path`'s allowed roots beyond the two real repo checkouts already
 * allowlisted in ./adapter-contract.ts's TARGETS.
 *
 * Window Presentation Policy (Owner Work Order, 2026-08-20): `foreground`
 * controls whether `open_app`/`open_url`/`open_path` brings the target to
 * the front (`true`, default) or lets it run/open without stealing focus
 * (`false`, macOS `open -g`). `restore_focus` (default false) re-activates
 * whichever app was frontmost right before this Work Order ran — best
 * effort at the APPLICATION level only (there is no OS API this adapter
 * uses that can target a specific browser TAB back into focus, so if
 * Owner Console is a browser tab, "restore focus" means the browser
 * app regains focus, not necessarily that exact tab — documented here so
 * a caller never assumes tab-level precision that does not exist).
 * `presentation` on the outcome reports which of five real, distinct
 * things happened: `OPENED` (fresh process launch, now front), `REUSED`
 * (already-running process brought back to front), `FOCUSED` (was
 * already frontmost — no launch/refocus needed), `BACKGROUND_RUNNING`
 * (foreground=false — real, running, deliberately not brought forward),
 * `BLOCKED` (admission denied, mirrors `status`). LINE (open_app) and
 * facebook.com (open_url, already covered by the existing HIGH-risk
 * https allowlist rule — no special-case needed) are the two new
 * targets this round.
 *
 * Screen Reading + Summary + Speech (Owner Work Order, 2026-08-20):
 * `read_screen` and `speak`, implemented in ./screen-reader.ts. Real
 * mechanism, Owner-decided: the macOS Accessibility API (via System
 * Events UI scripting), NOT screenshot+OCR — the OS itself refuses to
 * expose a genuinely secure text field's typed value through this API,
 * and this adapter goes further and redacts EVERY text-field value
 * uniformly (not just ones it can detect as "secure") — see
 * ./screen-reader.ts's own header for the full redaction argument. Both
 * actions are always HIGH risk (screen content / audible speech are
 * inherently sensitive) — `risk_confirmed` is required unconditionally,
 * same as screenshot/open_url. If the Owner has not granted this
 * process Accessibility permission in System Settings, `read_screen`
 * returns `OWNER_ACTION_REQUIRED` and opens the real, official
 * Privacy > Accessibility pane — it never asks for or bypasses that
 * permission.
 */

/**
 * 2026-08-20 (VS Code Agent Session Controller Work Order): adds
 * discover_agent_sessions (read-only Accessibility scan, no mutation —
 * see ../agent-session-discovery.ts, the one IMPLEMENTED action from this
 * group), plus create_agent_session/select_agent_session/
 * submit_work_order/read_agent_result — contract/validation ONLY this
 * round. Execution for those four is intentionally NOT wired into
 * ./adapter-contract.ts: each would require typing/clicking into a LIVE,
 * currently-open VS Code chat panel this process cannot yet distinguish
 * from a session with real, in-progress human work (a stuck/awaiting-
 * confirmation session was flagged in this exact repo two Work Orders
 * ago) — doing so blind would risk violating the standing "ห้าม cancel/
 * restart/overwrite งานเดิม" rule from that same round. Real execution
 * requires the Owner to designate a specific, confirmed-idle target
 * window first.
 */
export type UiActionKind = "open_url" | "open_path" | "open_app" | "screenshot" | "read_screen" | "speak" | "click" | "type" | "key" | "focus" | "wait" | "discover_agent_sessions" | "create_agent_session" | "select_agent_session" | "submit_work_order" | "read_agent_result" | "browser_eval" | "pointer_move" | "double_click" | "scroll" | "drag";

export interface UiWorkOrder {
  ui_action: UiActionKind;
  /** URL string (open_url), absolute path (open_path), allowlisted app key (open_app), app name to read/frontmost if empty (read_screen), or plain text to speak, max 500 chars (speak). Ignored for screenshot. */
  target: string;
  /** Which allowlist scope this target is claimed to fall under — checked, not trusted (e.g. "https-url", "repo-path", "known-app"). */
  scope: string;
  timeout_ms: number;
  /** When true, only validates + reports the plan — no real OS call is ever made. */
  dry_run: boolean;
  /** Owner approval flag for HIGH-risk actions (screenshot, open_url to a host outside the known-safe set). Ignored for LOW-risk actions. Never overrides a credential-surface denial. */
  risk_confirmed: boolean;
  /** Optional caller-supplied dedupe key — a retried request with the same key replays the first real outcome instead of executing twice (the practical equivalent of "recovery" for a synchronous action; see ./adapter-contract.ts's header for why no crash-recovery state machine applies here). */
  idempotency_key?: string;
  /** true (default when omitted) = bring the target to the front (`open`); false = open/run without stealing focus (`open -g`). See this file's header, "Window Presentation Policy". */
  foreground?: boolean;
  /** When true, re-activate whichever app was frontmost before this Work Order ran, after it completes. Best-effort, application-level only — see this file's header. */
  restore_focus?: boolean;
  /** Allowlisted app key for Accessibility actions; never an arbitrary process name. */
  app?: string;
  /** Visible control label used for Accessibility lookup; never a raw selector or script. */
  control_label?: string;
  /** Bounded screen coordinate for click fallback, only when explicitly supplied. */
  coordinate?: { x: number; y: number };
  /** ปลายทางของ drag (drag เท่านั้น) */
  coordinate2?: { x: number; y: number };
  /** ระยะ scroll เป็น pixel (scroll เท่านั้น) — dy ลบ = เลื่อนลง ตาม CGEvent */
  delta?: { dx: number; dy: number };
  /** Text for `type`; never accepted on credential surfaces and limited by admission. */
  text?: string;
  /** Allowlisted key chord for `key` (for example `COMMAND+S`). */
  key?: string;
  /**
   * JavaScript to run in Chrome's active tab (browser_eval only). This is a
   * DOM-level executor — canonical browser control (read/fill form, select,
   * scroll, set file input via DataTransfer) that does not depend on fragile
   * screen coordinates. HIGH risk, Owner-lane only (never in
   * AGENT_REQUESTABLE_UI_ACTIONS), and never runnable on a credential surface
   * (the `target` host is checked by isCredentialSurface). The script must
   * never read back a secret value into its return — the caller is
   * responsible, same discipline as `type` on credential fields.
   */
  script?: string;
}

export type RiskLevel = "LOW" | "HIGH";

export type WindowPresentationState = "OPENED" | "FOCUSED" | "REUSED" | "BACKGROUND_RUNNING" | "BLOCKED";

export interface UiWorkOrderOutcome {
  ok: boolean;
  status: "COMPLETED" | "OWNER_ACTION_REQUIRED" | "BLOCKED" | "FAILED" | "DRY_RUN_OK";
  summary: string;
  evidence: string[];
  artifacts: { kind: string; ref: string }[];
  next_action: string | null;
  idempotent_replay: boolean;
  /** Which of the five real Window Presentation states applied — null only for screenshot (no window is opened/focused) and BLOCKED-before-classification cases. */
  presentation: WindowPresentationState | null;
  /** Whether restore_focus was requested AND actually verified to have restored the prior frontmost app — never true unless independently re-verified after the restore attempt. */
  focus_restored: boolean | null;
}

export interface ValidationResult {
  ok: boolean;
  reason_codes: string[];
  risk: RiskLevel;
  evidence: string[];
}

/**
 * The real, structured, ALREADY-REDACTED output of `read_screen` (see
 * ./screen-reader.ts). Never a raw accessibility-tree dump — every field
 * here is either a real structural fact (app/title/role/label) or a
 * deliberately redacted placeholder. `visible_text_redacted` never
 * contains a text field's typed value, regardless of what kind of field
 * it is.
 */
export interface ScreenReadResult {
  app: string | null;
  title: string | null;
  state: "window_active" | "no_window" | "permission_denied" | "read_error";
  /** Static text / button / label content actually read — a text field's VALUE is never included here, only its presence is noted via `controls`. */
  visible_text_redacted: string[];
  controls: { role: string; label: string; redacted: boolean }[];
  warnings: string[];
  suggested_next_action: string | null;
  /** Real ratio of UI elements successfully read vs. attempted — never a fabricated confidence score. */
  confidence: number;
  evidence_timestamp: string;
}

const HTTPS_URL_PATTERN = /^https?:\/\/[a-zA-Z0-9.-]+(:\d+)?(\/[^\s]*)?$/;
const ALLOWED_PATH_ROOTS = ["/Users/tam/Desktop/DNA-OS-INFRASTRUCTURE", "/Users/tam/Desktop/dna-os-deadboard"];
const ALLOWED_APP_KEYS = ["vscode", "chrome", "terminal", "line"];

// Unconditional denial — never overridable by risk_confirmed. Matches
// substrings against target text AND scope text so a caller cannot dodge
// this by mislabeling scope.
const CREDENTIAL_SURFACE_PATTERNS = [/keychain/i, /1password/i, /password/i, /passkey/i, /touch\s*id/i, /face\s*id/i, /wallet/i, /apple\s*id/i, /itunes\s*store/i, /screen\s*time/i];

/** Exported for reuse by other capabilities that need the SAME credential-surface check (e.g. ../../control/agent-gateway/voice-bridge.ts) — never re-implement this pattern list a second time. */
export function isCredentialSurface(target: string, scope: string): boolean {
  return CREDENTIAL_SURFACE_PATTERNS.some((p) => p.test(target) || p.test(scope));
}

function classifyRisk(order: UiWorkOrder): RiskLevel {
  if (order.ui_action === "screenshot") return "HIGH"; // can capture arbitrary on-screen content
  if (order.ui_action === "open_url") return "HIGH"; // arbitrary host, not a fixed known destination
  if (order.ui_action === "read_screen") return "HIGH"; // reads arbitrary on-screen content, even if redacted after
  if (order.ui_action === "speak") return "HIGH"; // audible disclosure — anyone nearby can hear it
  if (["click", "type", "key"].includes(order.ui_action)) return "HIGH"; // direct UI mutation requires explicit Owner review
  if (order.ui_action === "discover_agent_sessions") return "LOW"; // read-only Accessibility scan, no mutation — see ../agent-session-discovery.ts
  if (["create_agent_session", "select_agent_session", "submit_work_order", "read_agent_result"].includes(order.ui_action)) return "HIGH"; // mutates/reads a live agent chat session — same review bar as click/type/key
  if (order.ui_action === "browser_eval") return "HIGH"; // runs arbitrary JS in the browser DOM — mutates page state
  return "LOW"; // open_path (allowlisted roots only), open_app (allowlisted keys only)
}

const SPEAK_MAX_LENGTH = 500;
const TYPE_MAX_LENGTH = 500;
const ALLOWED_KEYS = new Set(["COMMAND+S", "COMMAND+F", "COMMAND+1", "COMMAND+TAB", "VOLUME_UP", "VOLUME_DOWN", "VOLUME_MUTE", "ESCAPE", "ENTER", "TAB", "SPACE", "ARROWDOWN", "ARROWUP", "ARROWLEFT", "ARROWRIGHT"]);

/**
 * Admission — runs BEFORE any real OS call, same "validate before execute"
 * discipline `control/agent-gateway/work-order-validator.ts` already uses
 * for file-write Work Orders. Returns BLOCKED reasons, never throws.
 */
export function validateUiWorkOrder(order: UiWorkOrder): ValidationResult {
  const reasons: string[] = [];
  const evidence: string[] = [`ui_action=${order.ui_action}`, `scope=${order.scope}`];

  if (isCredentialSurface(order.target, order.scope)) {
    reasons.push("CREDENTIAL_SURFACE_DENIED");
  }
  if (!Number.isFinite(order.timeout_ms) || order.timeout_ms < 1000 || order.timeout_ms > 30_000) {
    reasons.push("INVALID_TIMEOUT_MS");
  }

  if (order.ui_action === "open_url") {
    if (!HTTPS_URL_PATTERN.test(order.target)) reasons.push("URL_SCHEME_NOT_ALLOWED");
  } else if (order.ui_action === "open_path") {
    const normalized = order.target.replace(/\/+$/, "");
    const inAllowedRoot = ALLOWED_PATH_ROOTS.some((root) => normalized === root || normalized.startsWith(`${root}/`));
    const hasTraversal = order.target.includes("..");
    if (!inAllowedRoot || hasTraversal) reasons.push("PATH_OUT_OF_SCOPE");
  } else if (order.ui_action === "open_app") {
    if (!ALLOWED_APP_KEYS.includes(order.target)) reasons.push("APP_NOT_ALLOWLISTED");
  } else if (order.ui_action === "read_screen") {
    // target is optional (empty = read whatever is frontmost) or one of
    // the allowlisted app keys — never an arbitrary app name, so a
    // caller cannot direct a read at, say, a password manager by name.
    if (order.target.length > 0 && !ALLOWED_APP_KEYS.includes(order.target)) reasons.push("APP_NOT_ALLOWLISTED");
  } else if (order.ui_action === "speak") {
    if (order.target.length === 0) reasons.push("EMPTY_SPEAK_TEXT");
    if (order.target.length > SPEAK_MAX_LENGTH) reasons.push("SPEAK_TEXT_TOO_LONG");
  } else if (["click", "type", "key", "focus"].includes(order.ui_action)) {
    if (!order.app || !ALLOWED_APP_KEYS.includes(order.app)) reasons.push("APP_NOT_ALLOWLISTED");
    if (order.ui_action === "click" && !order.control_label && !order.coordinate) reasons.push("CONTROL_TARGET_REQUIRED");
    if (order.control_label && order.control_label.length > 200) reasons.push("CONTROL_LABEL_TOO_LONG");
    if (order.coordinate && (!Number.isSafeInteger(order.coordinate.x) || !Number.isSafeInteger(order.coordinate.y) || order.coordinate.x < 0 || order.coordinate.y < 0 || order.coordinate.x > 10000 || order.coordinate.y > 10000)) reasons.push("COORDINATE_OUT_OF_BOUNDS");
    if (order.ui_action === "type") {
      if (typeof order.text !== "string" || order.text.length === 0) reasons.push("TYPE_TEXT_REQUIRED");
      else if (order.text.length > TYPE_MAX_LENGTH) reasons.push("TYPE_TEXT_TOO_LONG");
      if (isCredentialSurface(order.text ?? "", order.scope)) reasons.push("CREDENTIAL_SURFACE_DENIED");
    }
    if (order.ui_action === "key" && (!order.key || !ALLOWED_KEYS.has(order.key.toUpperCase()))) reasons.push("KEY_NOT_ALLOWLISTED");
  } else if (["pointer_move", "double_click", "scroll", "drag"].includes(order.ui_action)) {
    // pointer primitives (CGEvent ผ่าน mouse-helper) — screen-coordinate ล้วน
    const boundedPoint = (c?: { x: number; y: number }) => c && Number.isSafeInteger(c.x) && Number.isSafeInteger(c.y) && c.x >= 0 && c.y >= 0 && c.x <= 20000 && c.y <= 20000;
    if (order.ui_action === "scroll") {
      if (!order.delta || !Number.isSafeInteger(order.delta.dx) || !Number.isSafeInteger(order.delta.dy) || Math.abs(order.delta.dx) > 20000 || Math.abs(order.delta.dy) > 20000) reasons.push("SCROLL_DELTA_REQUIRED");
    } else if (order.ui_action === "drag") {
      if (!boundedPoint(order.coordinate) || !boundedPoint(order.coordinate2)) reasons.push("DRAG_REQUIRES_TWO_COORDINATES");
    } else {
      if (!boundedPoint(order.coordinate)) reasons.push("COORDINATE_OUT_OF_BOUNDS");
    }
  } else if (order.ui_action === "browser_eval") {
    // DOM executor — Chrome only, script required + bounded. The
    // credential-surface denial at the top already runs on target/scope,
    // so a browser_eval aimed at a login/credential host is refused.
    if (order.app !== "chrome") reasons.push("APP_NOT_ALLOWLISTED");
    if (typeof order.script !== "string" || order.script.length === 0) reasons.push("SCRIPT_REQUIRED");
    else if (order.script.length > 200_000) reasons.push("SCRIPT_TOO_LONG");
  } else if (order.ui_action === "wait") {
    if (order.target && !ALLOWED_APP_KEYS.includes(order.target)) reasons.push("APP_NOT_ALLOWLISTED");
  } else if (order.ui_action === "discover_agent_sessions") {
    if (order.target && !ALLOWED_APP_KEYS.includes(order.target)) reasons.push("APP_NOT_ALLOWLISTED");
  } else if (["create_agent_session", "select_agent_session", "submit_work_order", "read_agent_result"].includes(order.ui_action)) {
    // Contract/validation only this round — see this file's UiActionKind
    // header for why execution is intentionally not wired in yet.
    reasons.push("ACTION_NOT_YET_EXECUTABLE");
  }
  // screenshot: no target validation needed — always full-screen, see adapter-contract.ts

  const risk = classifyRisk(order);
  if (risk === "HIGH" && !order.risk_confirmed && !reasons.includes("CREDENTIAL_SURFACE_DENIED")) {
    reasons.push("RISK_CONFIRMATION_REQUIRED");
  }

  evidence.push(`risk=${risk}`, `reasons=${reasons.length === 0 ? "none" : reasons.join(",")}`);
  return { ok: reasons.length === 0, reason_codes: reasons, risk, evidence };
}
