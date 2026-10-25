/**
 * Command access decision for the external API (/api/v1/query, /api/v1/spec).
 *
 * Single authority: the policy lives in registry/permissions.json
 * (command_access.read_commands + role_tiers). This module only evaluates it.
 * Both the query route (enforce before dispatch) and the spec route (filter
 * what is listed) call decideCommandAccess, so they can never disagree.
 *
 * Default DENY: a command with no policy entry is denied.
 */
import permissions from "@/registry/permissions.json";

export type CommandTier = "any_authenticated" | "admin_tier";
export type CommandDataClass = "public" | "internal" | "tenant";

export interface CommandPolicy {
  tier: CommandTier;
  data: CommandDataClass;
}

export type CommandAccessCode =
  | "ALLOWED"
  | "UNKNOWN_COMMAND"
  | "WRITE_NOT_ALLOWED"
  | "AUTH_REQUIRED"
  | "TOKEN_SCOPE_MISSING"
  | "ROLE_NOT_ALLOWED"
  | "ORG_REQUIRED";

export interface CommandCaller {
  /** Verified profile role. null = anonymous (no verified identity). */
  role: string | null;
  /** Present only for API-token callers: the token's scopes. */
  tokenScopes?: readonly string[];
  /** true only when resolveVerifiedScope succeeded for this caller. */
  organizationVerified: boolean;
}

export interface CommandAccessDecision {
  allowed: boolean;
  code: CommandAccessCode;
  reason: string;
}

type PolicyTable = Record<string, CommandPolicy>;

const policyTable = (permissions as unknown as {
  command_access?: { read_commands?: PolicyTable };
}).command_access?.read_commands ?? {};

const roleTiers = permissions.role_tiers as Record<CommandTier, string[]>;

function hasOwn(table: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(table, key);
}

function deny(code: Exclude<CommandAccessCode, "ALLOWED">, reason: string): CommandAccessDecision {
  return { allowed: false, code, reason };
}

export function decideCommandAccess(
  command: string,
  caller: CommandCaller,
  options: { requiresConfirmation?: boolean } = {},
  policies: PolicyTable = policyTable,
): CommandAccessDecision {
  if (options.requiresConfirmation) {
    return deny("WRITE_NOT_ALLOWED", `${command}: write command ใช้ได้เฉพาะผ่าน /admin UI (Rule 72)`);
  }
  if (!hasOwn(policies, command)) {
    return deny("UNKNOWN_COMMAND", `${command}: ไม่มีนโยบายสิทธิ์ (default DENY)`);
  }
  const policy = policies[command];
  if (!caller.role) {
    return deny("AUTH_REQUIRED", "AUTH_REQUIRED: ต้องมี identity ที่ยืนยันแล้ว");
  }
  if (caller.tokenScopes && !caller.tokenScopes.includes("read")) {
    return deny("TOKEN_SCOPE_MISSING", "token นี้ไม่มี scope 'read'");
  }
  const tierRoles = hasOwn(roleTiers, policy.tier) ? roleTiers[policy.tier] : [];
  if (!tierRoles.includes(caller.role)) {
    return deny("ROLE_NOT_ALLOWED", `${command}: role '${caller.role}' ไม่มีสิทธิ์ (${policy.tier})`);
  }
  if (policy.data !== "public" && !caller.organizationVerified) {
    return deny("ORG_REQUIRED", `${command}: ต้องมี organization scope ที่ยืนยันแล้ว`);
  }
  return { allowed: true, code: "ALLOWED", reason: "allowed" };
}

/** Commands from the candidate list that this caller may use. */
export function listAccessibleCommands(
  candidates: readonly string[],
  caller: CommandCaller,
  isWriteCommand: (command: string) => boolean = () => false,
  policies: PolicyTable = policyTable,
): string[] {
  return candidates.filter(
    (name) => decideCommandAccess(name, caller, { requiresConfirmation: isWriteCommand(name) }, policies).allowed,
  );
}
