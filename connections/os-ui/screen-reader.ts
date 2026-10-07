/**
 * หน้าที่: the real implementation behind `read_screen`/`speak` in
 * ./work-order.ts. Two official macOS mechanisms only:
 * (1) System Events UI scripting (the Accessibility API) to read a
 * structural description of the frontmost/named app's window — never
 * screenshot+OCR (Owner decision, 2026-08-20: the OS itself already
 * refuses to expose a genuinely secure text field's value through this
 * API, which OCR would defeat); (2) `/usr/bin/say`, the OS's own
 * text-to-speech binary, for `speak`.
 *
 * Redaction policy (deliberately stricter than "detect secure fields"):
 * EVERY text field's typed VALUE is redacted, unconditionally — this
 * adapter never tries to cleverly tell a password field apart from a
 * search box. Only element ROLE/LABEL (static text, button names, menu
 * item titles — the app's own UI chrome, not user-typed content) is
 * ever included in `visible_text_redacted`/`controls`. This is a
 * stricter rule than the Owner's field list requires, chosen because
 * under-redacting is the one failure mode this file must never have.
 *
 * Accessibility permission: if this process has not been granted
 * Accessibility access (System Settings > Privacy & Security >
 * Accessibility), System Events UI scripting fails with a specific,
 * detectable error ("not allowed assistive access", AppleEvent error
 * -1743). `readScreen` detects exactly that and returns
 * `state: "permission_denied"` plus opens the real, official
 * Accessibility settings pane (`x-apple.systempreferences:...`) — same
 * pattern `connections/os-login/adapter-contract.ts` already uses for
 * the Firewall pane. It never asks for, stores, or bypasses this
 * permission.
 *
 * Input: optional target app name (empty = frontmost) for readScreen;
 * plain text (already length/credential-checked by
 * ./work-order.ts's validateUiWorkOrder) for speakText.
 * Output: `ScreenReadResult`, `SpeakResult`.
 * Dependency ที่อนุญาต: node:child_process only (via dynamic import, same
 * isolation convention as ./adapter-contract.ts).
 * สิ่งที่ห้ามแตะ: never add a code path that reads a text field's VALUE
 * property and includes it in the result — see the redaction policy
 * above. Never dismiss, click through, or script a macOS permission
 * dialog to obtain Accessibility access.
 */
import type { ScreenReadResult } from "./work-order";

const ACCESSIBILITY_DENIED_MARKERS = ["not allowed assistive access", "-1743", "osascript is not allowed"];
const MAX_ELEMENTS = 40;

async function execOsascript(script: string, timeoutMs: number): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  try {
    const { stdout } = await promisify(execFile)("/usr/bin/osascript", ["-e", script], { timeout: timeoutMs, maxBuffer: 64 * 1024 });
    return { ok: true, stdout: stdout.trim(), stderr: "" };
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string };
    return { ok: false, stdout: (e.stdout ?? "").trim(), stderr: (e.stderr ?? "").trim() };
  }
}

function isAccessibilityDenied(stderr: string): boolean {
  const lower = stderr.toLowerCase();
  return ACCESSIBILITY_DENIED_MARKERS.some((m) => lower.includes(m.toLowerCase()));
}

async function openAccessibilitySettings(): Promise<void> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  try {
    await promisify(execFile)("/usr/bin/open", ["x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"], { timeout: 5_000 });
  } catch {
    // Best effort — the OWNER_ACTION_REQUIRED status/summary already tells the Owner what to do manually.
  }
}

/**
 * Structural read via System Events. Redaction happens INSIDE this
 * AppleScript itself — text field values are never returned to Node in
 * the first place (fetched from the OS, then discarded before the
 * result string is built), not filtered out afterward, so there is no
 * code path where a secret string exists in this process's memory as a
 * JS value at all.
 */
function buildReadScript(appName: string | null): string {
  const targetClause = appName ? `process "${appName.replace(/"/g, '\\"')}"` : "(first process whose frontmost is true)";
  return `
set collectedLines to {}
set errCount to 0
set okCount to 0
tell application "System Events"
  set targetProcess to ${targetClause}
  set appName to name of targetProcess
  set winTitle to ""
  set hasWindow to false
  try
    set winTitle to name of front window of targetProcess
    set hasWindow to true
  end try
  tell me to set end of collectedLines to "APP=" & appName
  tell me to set end of collectedLines to "TITLE=" & winTitle
  tell me to set end of collectedLines to "HAS_WINDOW=" & hasWindow
  if hasWindow then
    try
      set uiElements to entire contents of front window of targetProcess
      set elemCount to 0
      repeat with el in uiElements
        if elemCount >= ${MAX_ELEMENTS} then exit repeat
        set elemCount to elemCount + 1
        try
          set elRole to (role of el as string)
          set elLabel to ""
          if elRole is "AXButton" or elRole is "AXMenuItem" or elRole is "AXMenuButton" or elRole is "AXStaticText" or elRole is "AXCheckBox" or elRole is "AXRadioButton" or elRole is "AXTabButton" then
            try
              set elLabel to (title of el as string)
            end try
            if elLabel is "" or elLabel is "missing value" then
              try
                set elLabel to (value of el as string)
              end try
            end if
            if elLabel is "" or elLabel is "missing value" then
              try
                set elLabel to (description of el as string)
              end try
            end if
            if elLabel is not "" and elLabel is not "missing value" then
              tell me to set end of collectedLines to "ELEM=" & elRole & "|" & elLabel & "|false"
            end if
          else if elRole is "AXTextField" or elRole is "AXTextArea" or elRole is "AXSecureTextField" or elRole is "AXComboBox" then
            -- Redacted here, in-script — the real value is never fetched into a variable that leaves this block.
            tell me to set end of collectedLines to "ELEM=" & elRole & "|[REDACTED]|true"
          end if
          set okCount to okCount + 1
        on error
          set errCount to errCount + 1
        end try
      end repeat
    on error errMsg
      tell me to set end of collectedLines to "TREE_ERROR=" & errMsg
    end try
  end if
end tell
set end of collectedLines to "OK_COUNT=" & okCount
set end of collectedLines to "ERR_COUNT=" & errCount
set AppleScript's text item delimiters to linefeed
return collectedLines as string`;
}

export async function readScreen(target: string, timeoutMs: number): Promise<ScreenReadResult> {
  const timestamp = new Date().toISOString();
  const appName = target.length > 0 ? APP_OPEN_NAME_FOR_READ[target] ?? target : null;
  const script = buildReadScript(appName);
  const result = await execOsascript(script, timeoutMs);

  if (!result.ok) {
    if (isAccessibilityDenied(result.stderr)) {
      await openAccessibilitySettings();
      return {
        app: null,
        title: null,
        state: "permission_denied",
        visible_text_redacted: [],
        controls: [],
        warnings: ["Accessibility permission is not granted to this process — the official System Settings > Privacy & Security > Accessibility pane was opened; grant access there, then retry"],
        suggested_next_action: "Owner must grant Accessibility permission in System Settings, then resubmit this Work Order",
        confidence: 0,
        evidence_timestamp: timestamp,
      };
    }
    return {
      app: null,
      title: null,
      state: "read_error",
      visible_text_redacted: [],
      controls: [],
      warnings: [`osascript failed: ${result.stderr.slice(0, 200) || "unknown error"}`],
      suggested_next_action: "Retry read_screen; if this persists, the target app may not support UI scripting",
      confidence: 0,
      evidence_timestamp: timestamp,
    };
  }

  const lines = result.stdout.split("\n").filter((l) => l.trim().length > 0);
  let app: string | null = null;
  let title: string | null = null;
  let hasWindow = false;
  let okCount = 0;
  let errCount = 0;
  const controls: { role: string; label: string; redacted: boolean }[] = [];
  const visibleTextRedacted: string[] = [];
  const warnings: string[] = [];

  for (const line of lines) {
    if (line.startsWith("APP=")) app = line.slice(4);
    else if (line.startsWith("TITLE=")) title = line.slice(6);
    else if (line.startsWith("HAS_WINDOW=")) hasWindow = line.slice(11) === "true";
    else if (line.startsWith("OK_COUNT=")) okCount = Number(line.slice(9)) || 0;
    else if (line.startsWith("ERR_COUNT=")) errCount = Number(line.slice(10)) || 0;
    else if (line.startsWith("TREE_ERROR=")) warnings.push(`partial read: ${line.slice(11)}`);
    else if (line.startsWith("ELEM=")) {
      const parts = line.slice(5).split("|");
      const role = parts[0] ?? "";
      const label = parts[1] ?? "";
      const redacted = parts[2] === "true";
      controls.push({ role, label: redacted ? "[REDACTED]" : label, redacted });
      if (!redacted && label.trim().length > 0) visibleTextRedacted.push(label);
    }
  }

  const totalAttempted = okCount + errCount;
  const confidence = totalAttempted > 0 ? Math.round((okCount / totalAttempted) * 100) / 100 : hasWindow ? 0.5 : 0;
  const redactedCount = controls.filter((c) => c.redacted).length;
  const dedupedWarnings = redactedCount > 0 ? [`${redactedCount} text field value(s) redacted — never included regardless of field type`, ...warnings] : warnings;

  return {
    app,
    title: hasWindow ? title : null,
    state: hasWindow ? "window_active" : "no_window",
    visible_text_redacted: visibleTextRedacted.slice(0, MAX_ELEMENTS),
    controls: controls.slice(0, MAX_ELEMENTS),
    warnings: dedupedWarnings,
    suggested_next_action: !hasWindow ? "No active window on this app to summarize" : redactedCount > 0 ? "Review the app directly for any field value — this summary never includes typed content" : "No further action suggested from structure alone",
    confidence,
    evidence_timestamp: timestamp,
  };
}

const APP_OPEN_NAME_FOR_READ: Record<string, string> = { vscode: "Code", chrome: "Google Chrome", terminal: "Terminal", line: "LINE" };

export interface SpeakResult {
  ok: boolean;
  spoke: boolean;
  error?: string;
}

export async function speakText(text: string, timeoutMs: number): Promise<SpeakResult> {
  const queueModulePath = "./voice-queue.mjs";
  const { speakQueued } = await import(queueModulePath);
  try {
    const spoke = await speakQueued(text, timeoutMs);
    return spoke ? { ok: true, spoke: true } : { ok: false, spoke: false, error: "say failed or voice queue timeout" };
  } catch (error) {
    const e = error as { message?: string };
    return { ok: false, spoke: false, error: e.message ?? "voice queue failed" };
  }
}
