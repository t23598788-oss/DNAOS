/**
 * RAILWAY_MCP_PROVIDER_RESOURCE_V1 — provider interface behind DNA OS.
 * Railway MCP/CLI are not an AI-client control plane.
 */

import { execFileSync } from "node:child_process";
import { getConnectorInvoker } from "../../control/connector-execution-boundary/registry";
import { describeOwnerEnablementState, getRailwayDeployCapabilityStatus } from "../../control/production-checkpoint/contract";

declare const process: { env: Record<string, string | undefined> };

export const RAILWAY_MCP_BEHIND_DNA_OS = "RAILWAY_MCP_BEHIND_DNA_OS_V1" as const;
export const RAILWAY_MCP_PROVIDER_RESOURCE = "RAILWAY_MCP_PROVIDER_RESOURCE_V1" as const;

function redactProviderText(value: string): string {
  return value
    .replace(/\b(railway[_-]?token|RAILWAY_TOKEN)\s*[:=]\s*\S+/gi, "$1=<redacted>")
    .replace(/\b[A-Za-z0-9_-]{40,}\b/g, "<redacted>");
}

function runRailway(args: readonly string[]): { ok: boolean; stdout: string; code: number } {
  try {
    const stdout = execFileSync("railway", [...args], {
      encoding: "utf8",
      timeout: 8000,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, RAILWAY_TOKEN: undefined },
    });
    return { ok: true, stdout: redactProviderText(String(stdout).slice(0, 4000)), code: 0 };
  } catch (error) {
    const err = error as { status?: number; stdout?: string; stderr?: string; message?: string };
    const text = redactProviderText(`${err.stdout ?? ""} ${err.stderr ?? err.message ?? ""}`.slice(0, 4000));
    return { ok: false, stdout: text, code: typeof err.status === "number" ? err.status : 1 };
  }
}

export function discoverRailwayMcpProvider(input?: { readonly fixture_unavailable?: boolean }): {
  readonly schema: typeof RAILWAY_MCP_PROVIDER_RESOURCE;
  readonly RAILWAY_CLI_PRESENT: boolean;
  readonly RAILWAY_CLI_VERSION: string | "NOT_AVAILABLE";
  readonly RAILWAY_MCP_REMOTE_AVAILABLE: boolean | "DECLARED_NOT_PROBED";
  readonly RAILWAY_MCP_LOCAL_AVAILABLE: boolean;
  readonly RAILWAY_LOGIN_READY: boolean;
  readonly RAILWAY_MCP_DIRECT_AI_PRODUCTION_ACCESS: false;
  readonly RAILWAY_MCP_IS_PROVIDER_INTERFACE: true;
  readonly RAILWAY_MCP_IS_CONTROL_PLANE: false;
  readonly RAILWAY_SECRET_VISIBLE_TO_AI_QUEEN: false;
  readonly RAILWAY_SECRET_VISIBLE_TO_CURSOR: false;
  readonly RAILWAY_SECRET_IN_MCP_CONTEXT: false;
  readonly installed_into_editor: false;
  readonly capability: "AVAILABLE" | "UNAVAILABLE";
  readonly projected: Record<string, boolean>;
} {
  if (input?.fixture_unavailable === true || process.env.RAILWAY_PROVIDER_FIXTURE_UNAVAILABLE === "1") {
    return {
      schema: RAILWAY_MCP_PROVIDER_RESOURCE,
      RAILWAY_CLI_PRESENT: false,
      RAILWAY_CLI_VERSION: "NOT_AVAILABLE",
      RAILWAY_MCP_REMOTE_AVAILABLE: false,
      RAILWAY_MCP_LOCAL_AVAILABLE: false,
      RAILWAY_LOGIN_READY: false,
      RAILWAY_MCP_DIRECT_AI_PRODUCTION_ACCESS: false,
      RAILWAY_MCP_IS_PROVIDER_INTERFACE: true,
      RAILWAY_MCP_IS_CONTROL_PLANE: false,
      RAILWAY_SECRET_VISIBLE_TO_AI_QUEEN: false,
      RAILWAY_SECRET_VISIBLE_TO_CURSOR: false,
      RAILWAY_SECRET_IN_MCP_CONTEXT: false,
      installed_into_editor: false,
      capability: "UNAVAILABLE",
      projected: {
        RAILWAY_READ_PROJECT_STATUS: false,
        RAILWAY_READ_SERVICE_STATUS: false,
        RAILWAY_READ_DEPLOYMENT: false,
        RAILWAY_READ_LOGS: false,
        RAILWAY_DEPLOY_APPROVED_REVISION: false,
        RAILWAY_REDEPLOY_APPROVED_DEPLOYMENT: false,
        RAILWAY_RUNTIME_VERIFY: false,
      },
    };
  }
  const version = runRailway(["--version"]);
  const help = runRailway(["mcp", "--help"]);
  const whoami = runRailway(["whoami"]);
  const invoker = getConnectorInvoker("railway");
  const deploy = getRailwayDeployCapabilityStatus();
  const cliPresent = version.ok || /railway/i.test(version.stdout);
  const versionMatch = version.stdout.match(/(\d+\.\d+\.\d+)/);
  const mcpLocal = help.ok || /mcp/i.test(help.stdout);
  const loginReady = whoami.ok && !/not logged|unauthorized|login required/i.test(whoami.stdout);
  return {
    schema: RAILWAY_MCP_PROVIDER_RESOURCE,
    RAILWAY_CLI_PRESENT: cliPresent,
    RAILWAY_CLI_VERSION: versionMatch?.[1] ?? (cliPresent ? redactProviderText(version.stdout.trim().split("\n")[0] ?? "NOT_AVAILABLE") : "NOT_AVAILABLE"),
    RAILWAY_MCP_REMOTE_AVAILABLE: mcpLocal ? true : "DECLARED_NOT_PROBED",
    RAILWAY_MCP_LOCAL_AVAILABLE: mcpLocal,
    RAILWAY_LOGIN_READY: loginReady,
    RAILWAY_MCP_DIRECT_AI_PRODUCTION_ACCESS: false,
    RAILWAY_MCP_IS_PROVIDER_INTERFACE: true,
    RAILWAY_MCP_IS_CONTROL_PLANE: false,
    RAILWAY_SECRET_VISIBLE_TO_AI_QUEEN: false,
    RAILWAY_SECRET_VISIBLE_TO_CURSOR: false,
    RAILWAY_SECRET_IN_MCP_CONTEXT: false,
    installed_into_editor: false,
    capability: invoker ? "AVAILABLE" : "UNAVAILABLE",
    projected: {
      RAILWAY_READ_PROJECT_STATUS: Boolean(invoker),
      RAILWAY_READ_SERVICE_STATUS: Boolean(invoker),
      RAILWAY_READ_DEPLOYMENT: Boolean(invoker),
      RAILWAY_READ_LOGS: false,
      RAILWAY_DEPLOY_APPROVED_REVISION: Boolean(deploy && typeof deploy === "object"),
      RAILWAY_REDEPLOY_APPROVED_DEPLOYMENT: Boolean(invoker),
      RAILWAY_RUNTIME_VERIFY: true,
    },
  };
}

export function railwayMcpBehindDnaOs(): {
  readonly schema: typeof RAILWAY_MCP_BEHIND_DNA_OS;
  readonly path: "AI_CLIENT -> DNA_OS_MCP -> POLICY -> RAILWAY_ADAPTER -> RAILWAY_MCP_OR_CLI";
  readonly RAILWAY_MCP_DIRECT_AI_PRODUCTION_ACCESS: false;
  readonly REMOTE_REAL_TARGET_OWNER_ENABLED: boolean;
  readonly PROVIDER_DOWN_BLOCKS_DNA_OS: false;
  readonly discovery: ReturnType<typeof discoverRailwayMcpProvider>;
} {
  return {
    schema: RAILWAY_MCP_BEHIND_DNA_OS,
    path: "AI_CLIENT -> DNA_OS_MCP -> POLICY -> RAILWAY_ADAPTER -> RAILWAY_MCP_OR_CLI",
    RAILWAY_MCP_DIRECT_AI_PRODUCTION_ACCESS: false,
    REMOTE_REAL_TARGET_OWNER_ENABLED: describeOwnerEnablementState().REMOTE_REAL_TARGET_OWNER_ENABLED,
    PROVIDER_DOWN_BLOCKS_DNA_OS: false,
    discovery: discoverRailwayMcpProvider(),
  };
}

export function normalizeRailwayProviderResult(raw: Record<string, unknown>): {
  readonly schema: "CANONICAL_EVENT_V1";
  readonly event_type: "RAILWAY_PROVIDER_RESULT";
  readonly RAW_PROVIDER_PROSE_IS_TRUTH: false;
  readonly DEPLOYMENT_STATE: string;
  readonly RUNTIME_STATE: string;
} {
  const state = typeof raw.state === "string" ? raw.state : typeof raw.status === "string" ? raw.status : "UNKNOWN";
  return {
    schema: "CANONICAL_EVENT_V1",
    event_type: "RAILWAY_PROVIDER_RESULT",
    RAW_PROVIDER_PROSE_IS_TRUTH: false,
    DEPLOYMENT_STATE: state,
    RUNTIME_STATE: typeof raw.runtime === "string" ? raw.runtime : "UNKNOWN",
  };
}
