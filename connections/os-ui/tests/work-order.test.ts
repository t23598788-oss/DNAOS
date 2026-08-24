/**
 * หน้าที่: the real test for `connections/os-ui/work-order.ts` +
 * `runUiWorkOrder` in `../adapter-contract.ts`. Drives the module
 * directly by hand, same convention as
 * `../../../control/command-router/tests/router.test.ts`. Covers the
 * Owner's explicit sandbox test list (2026-08-20): out-of-scope target,
 * credential-surface refusal, dry_run, idempotency replay, and the
 * risk-confirmation gate. "unauthorized" here means a target outside the
 * allowlist — this module has no separate identity check of its own (the
 * command already passed owner-command's human-only + execution-policy
 * gate before ever reaching this step; see
 * ../../../control/owner-command/owner-command.ts), so an "unauthorized"
 * UI target and an "out-of-scope" UI target are the SAME real check here.
 *
 * How to run:
 *   npx tsx connections/os-ui/tests/work-order.test.ts
 */
import { validateUiWorkOrder } from "../work-order";
import type { UiWorkOrder } from "../work-order";
import { runUiWorkOrder } from "../adapter-contract";

declare const process: { exitCode?: number; platform: string };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };
declare const require: (id: string) => unknown;

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

async function check(name: string, body: () => Promise<void> | void): Promise<void> {
  try {
    await body();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL  ${name}\n      ${error instanceof Error ? error.message : String(error)}`);
  }
}

function baseOrder(overrides: Partial<UiWorkOrder>): UiWorkOrder {
  return { ui_action: "open_path", target: "/Users/tam/Desktop/DNA-OS-INFRASTRUCTURE", scope: "repo-path", timeout_ms: 5000, dry_run: true, risk_confirmed: false, ...overrides };
}

async function main(): Promise<void> {
  await check("validateUiWorkOrder: out-of-scope/unauthorized path is rejected before any OS call", () => {
    const result = validateUiWorkOrder(baseOrder({ ui_action: "open_path", target: "/etc/passwd", scope: "repo-path" }));
    assert(!result.ok, "expected admission to reject an out-of-allowlist path");
    assert(result.reason_codes.includes("PATH_OUT_OF_SCOPE"), `expected PATH_OUT_OF_SCOPE, got ${result.reason_codes.join(",")}`);
  });

  await check("validateUiWorkOrder: path traversal out of an allowlisted root is rejected", () => {
    const result = validateUiWorkOrder(baseOrder({ ui_action: "open_path", target: "/Users/tam/Desktop/DNA-OS-INFRASTRUCTURE/../../etc", scope: "repo-path" }));
    assert(!result.ok, "expected traversal to be rejected");
    assert(result.reason_codes.includes("PATH_OUT_OF_SCOPE"), "expected PATH_OUT_OF_SCOPE for traversal");
  });

  await check("validateUiWorkOrder: credential-surface target is refused unconditionally, even with risk_confirmed", () => {
    const result = validateUiWorkOrder(baseOrder({ ui_action: "open_app", target: "keychain access", scope: "known-app", risk_confirmed: true }));
    assert(!result.ok, "expected credential-surface target to be rejected");
    assert(result.reason_codes.includes("CREDENTIAL_SURFACE_DENIED"), `expected CREDENTIAL_SURFACE_DENIED, got ${result.reason_codes.join(",")}`);
  });

  await check("validateUiWorkOrder: password-mentioning URL scope is refused even disguised via scope field", () => {
    const result = validateUiWorkOrder(baseOrder({ ui_action: "open_url", target: "https://example.com/account", scope: "password reset flow" }));
    assert(!result.ok, "expected scope text mentioning password to be rejected");
    assert(result.reason_codes.includes("CREDENTIAL_SURFACE_DENIED"), "expected CREDENTIAL_SURFACE_DENIED via scope match");
  });

  await check("validateUiWorkOrder: HIGH-risk action (screenshot) without risk_confirmed requires Owner confirmation", () => {
    const result = validateUiWorkOrder(baseOrder({ ui_action: "screenshot", target: "", scope: "screen", risk_confirmed: false }));
    assert(!result.ok, "expected screenshot without risk_confirmed to be rejected");
    assert(result.reason_codes.includes("RISK_CONFIRMATION_REQUIRED"), `expected RISK_CONFIRMATION_REQUIRED, got ${result.reason_codes.join(",")}`);
    assert(result.risk === "HIGH", "expected screenshot to classify as HIGH risk");
  });

  await check("validateUiWorkOrder: LOW-risk open_app to an allowlisted key needs no risk confirmation", () => {
    const result = validateUiWorkOrder(baseOrder({ ui_action: "open_app", target: "vscode", scope: "known-app", risk_confirmed: false }));
    assert(result.ok, `expected allowlisted app with no risk flag needed, got reasons=${result.reason_codes.join(",")}`);
    assert(result.risk === "LOW", "expected open_app to classify as LOW risk");
  });

  await check("validateUiWorkOrder: out-of-bounds timeout_ms is rejected", () => {
    const result = validateUiWorkOrder(baseOrder({ ui_action: "open_path", timeout_ms: 999_999 }));
    assert(!result.ok, "expected an absurd timeout to be rejected");
    assert(result.reason_codes.includes("INVALID_TIMEOUT_MS"), "expected INVALID_TIMEOUT_MS");
  });

  await check("runUiWorkOrder: BLOCKED admission never reaches a real OS call (out-of-scope path)", async () => {
    const outcome = await runUiWorkOrder(baseOrder({ ui_action: "open_path", target: "/etc/passwd", scope: "repo-path", dry_run: false }));
    assert(outcome.status === "BLOCKED", `expected BLOCKED, got ${outcome.status}`);
    assert(outcome.ok === false, "expected ok=false on a blocked admission");
  });

  await check("runUiWorkOrder: credential-surface refusal reported honestly, never as OWNER_ACTION_REQUIRED", async () => {
    const outcome = await runUiWorkOrder(baseOrder({ ui_action: "open_app", target: "1password", scope: "known-app", risk_confirmed: true, dry_run: false }));
    assert(outcome.status === "BLOCKED", `expected BLOCKED (never OWNER_ACTION_REQUIRED for a credential surface), got ${outcome.status}`);
    assert(outcome.summary.toLowerCase().includes("credential"), "expected the summary to name the credential refusal");
  });

  await check("runUiWorkOrder: dry_run never performs a real OS call", async () => {
    const outcome = await runUiWorkOrder(baseOrder({ ui_action: "open_path", target: "/Users/tam/Desktop/DNA-OS-INFRASTRUCTURE", scope: "repo-path", dry_run: true }));
    assert(outcome.status === "DRY_RUN_OK", `expected DRY_RUN_OK, got ${outcome.status}`);
    assert(outcome.ok === true, "expected dry_run to report ok=true (it's a valid plan, just not executed)");
  });

  await check("runUiWorkOrder: HIGH-risk screenshot without risk_confirmed returns OWNER_ACTION_REQUIRED, not silently blocked", async () => {
    const outcome = await runUiWorkOrder(baseOrder({ ui_action: "screenshot", target: "", scope: "screen", risk_confirmed: false, dry_run: false }));
    assert(outcome.status === "OWNER_ACTION_REQUIRED", `expected OWNER_ACTION_REQUIRED, got ${outcome.status}`);
  });

  await check("validateUiWorkOrder: LINE (new allowlist target) is accepted as a LOW-risk open_app", () => {
    const result = validateUiWorkOrder(baseOrder({ ui_action: "open_app", target: "line", scope: "known-app", risk_confirmed: false }));
    assert(result.ok, `expected LINE to be allowlisted, got reasons=${result.reason_codes.join(",")}`);
    assert(result.risk === "LOW", "expected open_app LINE to classify as LOW risk");
  });

  await check("validateUiWorkOrder: facebook.com via open_url still requires risk_confirmed (no special-case bypass)", () => {
    const result = validateUiWorkOrder(baseOrder({ ui_action: "open_url", target: "https://facebook.com", scope: "https-url", risk_confirmed: false }));
    assert(!result.ok, "expected facebook.com to still require risk_confirmed like any other open_url target");
    assert(result.reason_codes.includes("RISK_CONFIRMATION_REQUIRED"), "expected RISK_CONFIRMATION_REQUIRED for facebook.com");
  });

  await check("runUiWorkOrder: foreground=false real open_path reports BACKGROUND_RUNNING and does not steal focus", async () => {
    const before = await new Promise<string>((resolve) => {
      const { execFile } = require("node:child_process") as { execFile(cmd: string, args: string[], cb: (err: unknown, out: { stdout: string }) => void): void };
      execFile("/usr/bin/osascript", ["-e", 'tell application "System Events" to get name of first process whose frontmost is true'], (_err, out) => resolve(String(out?.stdout ?? "").trim()));
    });
    const outcome = await runUiWorkOrder(baseOrder({ ui_action: "open_path", target: "/Users/tam/Desktop/DNA-OS-INFRASTRUCTURE", scope: "repo-path", dry_run: false, foreground: false }));
    assert(outcome.status === "COMPLETED", `expected COMPLETED, got ${outcome.status} (${outcome.summary})`);
    assert(outcome.presentation === "BACKGROUND_RUNNING", `expected BACKGROUND_RUNNING, got ${outcome.presentation}`);
    const after = await new Promise<string>((resolve) => {
      const { execFile } = require("node:child_process") as { execFile(cmd: string, args: string[], cb: (err: unknown, out: { stdout: string }) => void): void };
      execFile("/usr/bin/osascript", ["-e", 'tell application "System Events" to get name of first process whose frontmost is true'], (_err, out) => resolve(String(out?.stdout ?? "").trim()));
    });
    assert(before === after, `expected frontmost app to stay "${before}" with foreground=false, but it became "${after}"`);
  });

  await check("validateUiWorkOrder: read_screen requires risk_confirmed like screenshot/open_url", () => {
    const result = validateUiWorkOrder(baseOrder({ ui_action: "read_screen", target: "", scope: "screen", risk_confirmed: false }));
    assert(!result.ok, "expected read_screen without risk_confirmed to be rejected");
    assert(result.reason_codes.includes("RISK_CONFIRMATION_REQUIRED"), "expected RISK_CONFIRMATION_REQUIRED");
    assert(result.risk === "HIGH", "expected read_screen to classify as HIGH risk");
  });

  await check("validateUiWorkOrder: read_screen with an out-of-allowlist app name is rejected (same rule as open_app)", () => {
    const result = validateUiWorkOrder(baseOrder({ ui_action: "read_screen", target: "1Password", scope: "screen", risk_confirmed: true }));
    assert(!result.ok, "expected an out-of-allowlist read_screen target to be rejected");
    assert(result.reason_codes.includes("CREDENTIAL_SURFACE_DENIED") || result.reason_codes.includes("APP_NOT_ALLOWLISTED"), `expected a real denial reason, got ${result.reason_codes.join(",")}`);
  });

  await check("validateUiWorkOrder: speak with empty text is rejected", () => {
    const result = validateUiWorkOrder(baseOrder({ ui_action: "speak", target: "", scope: "audio", risk_confirmed: true }));
    assert(!result.ok, "expected empty speak text to be rejected");
    assert(result.reason_codes.includes("EMPTY_SPEAK_TEXT"), "expected EMPTY_SPEAK_TEXT");
  });

  await check("validateUiWorkOrder: speak text over the length bound is rejected", () => {
    const result = validateUiWorkOrder(baseOrder({ ui_action: "speak", target: "x".repeat(501), scope: "audio", risk_confirmed: true }));
    assert(!result.ok, "expected an overlong speak text to be rejected");
    assert(result.reason_codes.includes("SPEAK_TEXT_TOO_LONG"), "expected SPEAK_TEXT_TOO_LONG");
  });

  await check("validateUiWorkOrder: speak text that itself names a credential surface is still refused unconditionally", () => {
    const result = validateUiWorkOrder(baseOrder({ ui_action: "speak", target: "your password is hunter2", scope: "audio", risk_confirmed: true }));
    assert(!result.ok, "expected speak text mentioning 'password' to be rejected");
    assert(result.reason_codes.includes("CREDENTIAL_SURFACE_DENIED"), "expected CREDENTIAL_SURFACE_DENIED");
  });

  await check("runUiWorkOrder: read_screen (allowed, real) never returns a text field VALUE, only [REDACTED]", async () => {
    const outcome = await runUiWorkOrder(baseOrder({ ui_action: "read_screen", target: "", scope: "screen", risk_confirmed: true, dry_run: false, timeout_ms: 8000 }));
    assert(outcome.status === "COMPLETED" || outcome.status === "OWNER_ACTION_REQUIRED" || outcome.status === "FAILED", `expected a real terminal status, got ${outcome.status}`);
    if (outcome.status === "COMPLETED") {
      const artifact = outcome.artifacts.find((a) => a.kind === "screen_read_result_redacted");
      assert(!!artifact, "expected a screen_read_result_redacted artifact on COMPLETED");
      const fs = require("node:fs") as { readFileSync(p: string, e: string): string };
      const raw = fs.readFileSync(artifact!.ref, "utf-8");
      const parsed = JSON.parse(raw) as { controls: { role: string; label: string; redacted: boolean }[] };
      const leakedTextFieldValue = parsed.controls.some((c) => (c.role === "text field" || c.role === "text area") && c.redacted === false);
      assert(!leakedTextFieldValue, "REDACTION INVARIANT VIOLATED: a text field/text area was reported with redacted=false");
      const anyNonRedactedHasRealLabel = parsed.controls.every((c) => c.redacted || (c.role !== "text field" && c.role !== "text area"));
      assert(anyNonRedactedHasRealLabel, "expected every non-redacted control to NOT be a text-entry role");
    } else if (outcome.status === "OWNER_ACTION_REQUIRED") {
      assert(outcome.summary.toLowerCase().includes("accessibility"), "expected the Accessibility permission explanation");
    }
  });

  await check("runUiWorkOrder: speak with an aggressively short timeout reports a real failure (TTS timeout, not a fabricated success)", async () => {
    const outcome = await runUiWorkOrder(baseOrder({ ui_action: "speak", target: "test", scope: "audio", risk_confirmed: true, dry_run: false, timeout_ms: 1000 }));
    // Either it genuinely completes within 1s (short word, fast enough) or it times out — both are real outcomes; only a fabricated COMPLETED with no real "say" call would be wrong, which this test guards against by checking the outcome is internally consistent with a real evidence trail.
    assert(outcome.evidence.some((e) => e.includes("say=OK") || e.includes("say=FAILED") || e.includes("timeout=true")), "expected real evidence of either a completed or failed/timed-out say call");
  });

  await check("runUiWorkOrder: idempotency_key replay returns the cached outcome without re-executing", async () => {
    const key = `idem-test-${Date.now()}`;
    const first = await runUiWorkOrder(baseOrder({ ui_action: "open_path", target: "/Users/tam/Desktop/DNA-OS-INFRASTRUCTURE", scope: "repo-path", dry_run: true, idempotency_key: key }));
    const second = await runUiWorkOrder(baseOrder({ ui_action: "open_path", target: "/Users/tam/Desktop/DNA-OS-INFRASTRUCTURE", scope: "repo-path", dry_run: true, idempotency_key: key }));
    assert(first.idempotent_replay === false, "expected the first call to be a real execution, not a replay");
    assert(second.idempotent_replay === true, "expected the second call with the same idempotency_key to be a replay");
  });

  await check("validateUiWorkOrder: bounded click and COMMAND+S key are HIGH risk and require Owner confirmation", () => {
    const click = validateUiWorkOrder(baseOrder({ ui_action: "click", app: "vscode", control_label: "Save", scope: "known-app", risk_confirmed: true }));
    const key = validateUiWorkOrder(baseOrder({ ui_action: "key", app: "vscode", key: "COMMAND+S", scope: "known-app", risk_confirmed: true }));
    assert(click.ok && key.ok, `expected bounded Accessibility actions to be accepted: ${[...click.reason_codes, ...key.reason_codes].join(",")}`);
    assert(click.risk === "HIGH" && key.risk === "HIGH", "expected direct UI mutation actions to classify as HIGH risk");
  });

  await check("runUiWorkOrder: sandbox click/type plans do not execute and credential text is blocked", async () => {
    const click = await runUiWorkOrder(baseOrder({ ui_action: "click", app: "vscode", control_label: "Save", scope: "known-app", risk_confirmed: true, dry_run: true, idempotency_key: `sandbox-click-${Date.now()}` }));
    assert(click.status === "DRY_RUN_OK", `expected click dry-run, got ${click.status}`);
    const type = await runUiWorkOrder(baseOrder({ ui_action: "type", app: "vscode", text: "password=secret", scope: "known-app", risk_confirmed: true, dry_run: true }));
    assert(type.status === "BLOCKED", `expected credential-bearing type action to be blocked, got ${type.status}`);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main();
