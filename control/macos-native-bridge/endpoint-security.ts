import { existsSync } from "node:fs";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { emitLocalResourceEvent } from "../local-resource-access/contract";
import { isDarwin, process } from "./host-runtime";

const execFile = promisify(execFileCb);

export async function probeEndpointSecurity(): Promise<Record<string, unknown>> {
  const framework = existsSync("/System/Library/Frameworks/EndpointSecurity.framework");
  let entitlements = "";
  try {
    const ran = await execFile("/usr/bin/codesign", ["-d", "--entitlements", ":-", process.execPath], { timeout: 5_000 });
    entitlements = `${ran.stdout}${ran.stderr}`;
  } catch {
    entitlements = "";
  }
  const entitled = /endpoint-security/i.test(entitlements);
  const available = framework && entitled && isDarwin();
  emitLocalResourceEvent("ENDPOINT_SECURITY_PROBED", null, available ? "AVAILABLE" : "NOT_AVAILABLE", undefined, { locality: "LOCAL" });
  return {
    schema: "ENDPOINT_SECURITY_BRIDGE_V1",
    ENDPOINT_SECURITY_AVAILABLE: available,
    ENDPOINT_SECURITY_MODE: available ? "NOTIFY_ONLY" : "NONE",
    ENDPOINT_SECURITY: available ? "AVAILABLE" : "NOT_AVAILABLE",
    ENFORCEMENT_ENABLED: false,
    observe_blocks_system_activity: false,
    AI_HAS_SYSTEM_ENFORCEMENT_AUTHORITY: false,
    maturity: "OBSERVE",
    AUTH_DESIGN: {
      path: ["OS event", "DNA OS policy", "existing Owner authority", "ALLOW/DENY"],
      forbidden_path: ["OS event", "AI/provider decision"],
      enabled: false,
    },
  };
}

export function evaluateEndpointSecurityAuth(): {
  readonly decision: "NOT_ENFORCED";
  readonly ENFORCEMENT_ENABLED: false;
  readonly AI_HAS_SYSTEM_ENFORCEMENT_AUTHORITY: false;
} {
  return { decision: "NOT_ENFORCED", ENFORCEMENT_ENABLED: false, AI_HAS_SYSTEM_ENFORCEMENT_AUTHORITY: false };
}
