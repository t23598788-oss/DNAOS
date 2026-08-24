/**
 * OS login/permission handoff adapter.
 *
 * This adapter never receives, stores, types, or returns credentials. It asks
 * the operating system for a bounded status and, when requested, opens the
 * official OS/vendor surface for the Owner to complete authentication.
 * The result is intentionally OWNER_ACTION_REQUIRED until the OS reports the
 * requested condition as ready.
 */

export type OsLoginTarget = "macos-firewall" | "tailscale";

export interface OsLoginRequest {
  target: OsLoginTarget;
  action?: "status" | "request_access";
}

export interface OsLoginOutcome {
  ok: boolean;
  status: "READY" | "OWNER_ACTION_REQUIRED" | "DENIED" | "FAILED" | "UNKNOWN";
  target: OsLoginTarget;
  summary: string;
  evidence: string[];
  nextAction: string | null;
}

export function parseOsLoginTarget(text: string, payload: unknown): OsLoginTarget | null {
  const candidate = payload && typeof payload === "object" && "target" in payload
    ? String((payload as { target?: unknown }).target ?? "")
    : "";
  const input = `${candidate} ${text}`.toLowerCase();
  if (input.includes("tailscale")) return "tailscale";
  if (input.includes("firewall") || input.includes("ไฟร์วอลล์")) return "macos-firewall";
  return null;
}

export async function requestOsLogin(request: OsLoginRequest): Promise<OsLoginOutcome> {
  if (process.platform !== "darwin") {
    return {
      ok: false,
      status: "UNKNOWN",
      target: request.target,
      summary: "OS login handoff is only implemented for macOS in this adapter",
      evidence: [`platform=${process.platform}`],
      nextAction: "OWNER_REVIEW",
    };
  }

  if (request.target === "macos-firewall") {
    const status = await runBounded("/usr/libexec/ApplicationFirewall/socketfilterfw", ["--getglobalstate"]);
    const nodeRules = await runBounded("/usr/libexec/ApplicationFirewall/socketfilterfw", ["--listapps"]);
    const nodeBlocked = nodeRules.stdout.split("\n").some((line) => /\/node\s*$/.test(line));
    const state = `${status.stdout} ${status.stderr}`.includes("State = 2") ? "BLOCKING_ALL_NON_ESSENTIAL" : "NOT_BLOCKING_ALL";
    const evidence = [`firewall_state=${state}`, `node_rule=${nodeBlocked ? "PRESENT_STATUS_REQUIRES_OWNER_CONFIRMATION" : "NOT_FOUND"}`];
    if (request.action !== "request_access" || !nodeBlocked) {
      return {
        ok: !nodeBlocked,
        status: nodeBlocked ? "OWNER_ACTION_REQUIRED" : "READY",
        target: request.target,
        summary: nodeBlocked ? "macOS Firewall still requires Owner authorization for Node" : "macOS Firewall does not report Node as blocked",
        evidence,
        nextAction: nodeBlocked ? "Open macOS Firewall options and allow /usr/local/bin/node, then resume this Work Order" : null,
      };
    }

    const opened = await runBounded("/usr/bin/open", ["x-apple.systempreferences:com.apple.Network-Settings.extension?Firewall"]);
    return {
      ok: false,
      status: "OWNER_ACTION_REQUIRED",
      target: request.target,
      summary: "macOS Firewall settings opened; Owner authorization is required",
      evidence: [...evidence, `os_surface_open=${opened.exitCode === 0 ? "OK" : "FAILED"}`],
      nextAction: "Allow Node in macOS Firewall, then submit the same Work Order again",
    };
  }

  const status = await runBounded("/opt/homebrew/bin/tailscale", ["status", "--json"]);
  const loggedOut = /logged out|needslogin|NeedsLogin/i.test(`${status.stdout} ${status.stderr}`) || status.exitCode !== 0;
  if (request.action === "request_access" && loggedOut) {
    const opened = await runBounded("/usr/bin/open", ["-a", "Tailscale"]);
    const loginCli = opened.exitCode === 0 ? null : await runBounded("/opt/homebrew/bin/tailscale", ["login", "--timeout=2s"]);
    return {
      ok: false,
      status: "OWNER_ACTION_REQUIRED",
      target: request.target,
      summary: "Tailscale is not authenticated; the official Tailscale app was opened",
      evidence: [`tailscale_status=${status.exitCode === 0 ? "REACHABLE" : "NOT_AUTHENTICATED"}`, `os_surface_open=${opened.exitCode === 0 ? "OK" : loginCli && loginCli.stdout.length > 0 ? "CLI_LOGIN_URL_OR_HANDOFF_RETURNED" : "FAILED"}`],
      nextAction: "Complete Tailscale sign-in in the official app or the official CLI handoff, then submit the same Work Order again",
    };
  }
  return {
    ok: !loggedOut,
    status: loggedOut ? "OWNER_ACTION_REQUIRED" : "READY",
    target: request.target,
    summary: loggedOut ? "Tailscale requires Owner sign-in" : "Tailscale reports an authenticated session",
    evidence: [`tailscale_status=${loggedOut ? "NOT_AUTHENTICATED" : "AUTHENTICATED"}`],
    nextAction: loggedOut ? "Complete Tailscale sign-in in the official app, then resume this Work Order" : null,
  };
}

async function runBounded(command: string, args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  try {
    const result = await promisify(execFile)(command, args, { timeout: 10_000, maxBuffer: 64 * 1024 });
    return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string; code?: number | string };
    return { stdout: e.stdout ?? "", stderr: e.stderr ?? "", exitCode: typeof e.code === "number" ? e.code : 1 };
  }
}
