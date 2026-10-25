/**
 * DNA OS Remote Compute Runtime (Phase 1) — shared job contract types.
 *
 * Contract remarks (Phase-1 scope, 2026-10-16):
 * - Compute plane ONLY. This package never imports Business Runtime code,
 *   never imports Supabase, and never reads Production credentials. Its own
 *   tsconfig is excluded from the root (Business) type-check on purpose —
 *   same boundary style as supabase/functions.
 * - Command naming follows the same discipline as
 *   app/api/admin/devices/_lib/deviceCommands.ts (closed command_kind set,
 *   deny-by-default) but is deliberately a SEPARATE, phase-1-local contract
 *   so the Business plane owns no runtime authority here and the Device
 *   Commands relay can adopt this shape later without renaming anything
 *   remote.
 * - AI inference goes through exactly one configured local inference
 *   endpoint (same shape the AI Gateway's ollama adapter/device runtime
 *   already speaks: POST {endpoint}/api/generate). No second gateway lives
 *   here — this package only FORWARDS a request to the endpoint DNA OS
 *   configured.
 */

/** Closed command set (Phase 1) — mirroring deviceCommands.ts's closed-kind rule. */
export const COMMAND_KINDS = ["ai.infer", "code.read", "build.run", "test.run"] as const;
export type CommandKind = (typeof COMMAND_KINDS)[number];

/** Read-only code file request — path MUST be inside the granted workspace root. */
export interface CodeReadPayload {
  path: string;
  startLine?: number;
  maxBytes?: number;
}

/** AI inference request — forwarded verbatim to the configured endpoint. */
export interface InferPayload {
  system?: string;
  prompt: string;
  /** Optional model name; never a hard-coded default credit to a vendor. */
  model?: string;
  maxTokens?: number;
}

/** Build/test request — script must be on the static allowlist for the kind. */
export interface RunPayload {
  script: string;
}

export type CommandPayload = CodeReadPayload | InferPayload | RunPayload;

/** One remote compute command as it arrives at the daemon. */
export interface RemoteCommand {
  /** Opaque id from the Business plane (device_commands.command_id style). */
  commandId: string;
  kind: CommandKind;
  payload: CommandPayload;
  /** Workspace root granted for THIS command (absolute path or null for ai.infer). */
  workspaceRoot?: string | null;
  createdAt: string;
}

/** Result contract — honest status, never a fabricated success. */
export type RemoteResultStatus =
  | "SUCCEEDED"
  | "FAILED"
  | "NOT_CONFIGURED"
  | "SCOPE_DENIED"
  | "KIND_UNKNOWN";

export interface RemoteResult {
  commandId: string;
  status: RemoteResultStatus;
  output: string | null;
  error: string | null;
  durationMs: number;
  /** Structured extra result fields (e.g. bytes read, exit code). */
  meta?: Record<string, unknown>;
  finishedAt: string;
}

/** Capability surface the daemon advertises (no command is callable off-list). */
export interface DaemonCapabilities {
  aiInfer: boolean; // true only when an inference endpoint is configured
  codeRead: boolean;
  buildRun: boolean;
  testRun: boolean;
}

/** Heartbeat payload — remote runtime registration/health (device registry style). */
export interface RemoteHeartbeat {
  deviceId: string | null;
  status: "UP" | "DOWN";
  runtime: "dna-os-compute" | string;
  version: string;
  capabilities: DaemonCapabilities;
  startedAt: string;
  lastCommandAt: string | null;
}

/** Static build/test script allowlist — Phase 1 keeps this closed. */
export const BUILD_SCRIPTS = ["build", "type-check"] as const;
export const TEST_SCRIPTS = ["test", "type-check"] as const;
