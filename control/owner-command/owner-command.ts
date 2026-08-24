/**
 * หน้าที่: the Owner's one command surface — turns Owner intent text into
 * a `CommandEnvelope`, hands it to `../command-router/`'s
 * `routeOwnerCommand` (the only capability boundary it is allowed to
 * cross), tracks the resulting `CommandLifecycleState`
 * (`../command-status/lifecycle.ts`), and renders the combined
 * `OwnerSurfaceState`. Never scans files, never reasons about permissions
 * itself, never executes a shell command, never touches a business DB —
 * matches ./README.md's stated boundary and this round's Owner spec
 * verbatim (`OWNER → owner-command → command-router → capability →
 * result → owner-command → OWNER`).
 *
 * Input: Owner command text + the Owner's `EnvelopeIdentity`
 * (`kind: "human"` — asserted, not trusted from elsewhere), optionally an
 * explicit multi-worker plan / execution-policy context to pass through
 * to the router unchanged.
 * Output: `OwnerSurfaceState` (see ./types.ts), the underlying
 * `CommandLifecycleState` for anything that wants the raw history,
 * `output_contract` — the SYSTEM_STATE/WORK_ITEM Output Contract lane
 * (`../../contracts/command/output-contract.ts`) this result belongs to
 * — and `output_routing` — which REGISTERED consumer(s), if any, claimed
 * it (`../output-routing/contract.ts`; never a hardcoded/guessed
 * destination).
 * Dependency ที่อนุญาต: `../../contracts/command/`,
 * `../command-router/contract.ts`, `../command-status/lifecycle.ts`,
 * `../output-routing/contract.ts`, `./types.ts`, `./host-runtime.ts`.
 * สิ่งที่ห้ามแตะ: never call `../command-router/router.ts` or
 * `../command-router/capability-registry.ts` directly — only
 * `../command-router/contract.ts`. Never let `issued_by.kind` be anything
 * other than `"human"` here — a non-human caller does not come through
 * this folder (matches ./README.md's own stated boundary).
 *
 * NOT_YET_BUILT: no runtime transport (CLI/HTTP/etc.) wires Owner input
 * into `submitOwnerCommand` yet — see ./tests/owner-command.test.ts,
 * which drives this module directly by hand.
 */

import type { CommandEnvelope } from "../../contracts/command/command-envelope";
import type { EnvelopeIdentity } from "../../contracts/identity/envelope-identity";
import type { CapabilityResult } from "../../contracts/command/capability-result";
import type { DnaOsOutput } from "../../contracts/command/output-contract";
import { classifyCommand, classifyOutput, listCapabilities, routeOwnerCommand } from "../command-router/contract";
import { resolveOutputConsumers } from "../output-routing/contract";
import type { OutputRoutingResult } from "../output-routing/contract";
import type { RouteOptions } from "../command-router/contract";
import type { CommandLifecycleStage, CommandLifecycleState } from "../command-status/lifecycle";
import { hostNowIso, hostRandomId } from "./host-runtime";
import type { OwnerCapabilityStatus, OwnerSurfaceState } from "./types";

function pushStage(state: CommandLifecycleState, stage: CommandLifecycleStage, note?: string): void {
  state.stage = stage;
  state.history.push({ stage, at: hostNowIso(), note });
}

/**
 * Builds the command's lifecycle strictly along `LEGAL_TRANSITIONS`
 * (`../command-status/lifecycle.ts`) — never skips `evidenced` before
 * `responded`, and a policy stop (`BLOCKED`/`OWNER_REVIEW`) always ends at
 * `rejected` with the router's own reason as the note, never fabricated
 * as a success.
 */
function deriveLifecycle(commandId: string, result: CapabilityResult): CommandLifecycleState {
  const state: CommandLifecycleState = { command_id: commandId, stage: "received", history: [{ stage: "received", at: hostNowIso() }] };

  pushStage(state, "authenticated");
  pushStage(state, "authorized");
  pushStage(state, "classified");

  if (result.status === "BLOCKED" || result.status === "OWNER_REVIEW") {
    pushStage(state, "rejected", result.summary);
    return state;
  }

  pushStage(state, "routed");
  pushStage(state, "executing");

  if (result.status === "PENDING" || result.status === "RUNNING") {
    return state; // still in flight — no responded/rejected yet
  }
  if (result.status === "FAILED") {
    pushStage(state, "failed", result.summary);
    pushStage(state, "responded");
    return state;
  }

  // COMPLETED
  pushStage(state, "evidenced", `${result.evidence.length} evidence item(s) recorded before responding`);
  pushStage(state, "responded");
  return state;
}

function toProgress(stage: CommandLifecycleStage): OwnerSurfaceState["progress"] {
  if (stage === "responded" || stage === "rejected") return "DONE";
  if (stage === "received") return "PENDING";
  return "IN_PROGRESS";
}

function availableCapabilities(): readonly OwnerCapabilityStatus[] {
  return listCapabilities().map((cap) => ({ capability_id: cap.capability_id, connected: cap.health_status === "CONNECTED" }));
}

export interface SubmitOwnerCommandOutcome {
  envelope: CommandEnvelope;
  lifecycle: CommandLifecycleState;
  result: CapabilityResult;
  surface: OwnerSurfaceState;
  /** SYSTEM_STATE (read straight by a UI, no AI mediation) or WORK_ITEM (dispatched to a Worker/Agent, comes back only through DNA OS's own Verify/Register/Next Decision path) — see ../../contracts/command/output-contract.ts. */
  output_contract: DnaOsOutput;
  /** Which REGISTERED consumer(s) — if any — claimed this output's lane+capability_id. Never a guessed destination — see ../output-routing/. */
  output_routing: OutputRoutingResult;
}

/**
 * The single public entry point of `control/owner-command/`. Builds the
 * envelope, routes it, tracks lifecycle, and returns the rendered
 * surface — one call, one Owner-visible task, regardless of how many
 * capabilities it took to answer.
 */
export async function submitOwnerCommand(commandText: string, ownerIdentity: EnvelopeIdentity, options: RouteOptions = {}): Promise<SubmitOwnerCommandOutcome> {
  if (ownerIdentity.kind !== "human") {
    throw new Error(`control/owner-command/ only accepts issued_by.kind "human", got "${ownerIdentity.kind}"`);
  }

  const envelope: CommandEnvelope = {
    command_id: `cmd_${hostRandomId()}`,
    issued_by: ownerIdentity,
    intent: commandText,
    payload: {},
    issued_at: hostNowIso(),
  };

  const result = await routeOwnerCommand(envelope, commandText, options);
  const lifecycle = deriveLifecycle(envelope.command_id, result);

  const surface: OwnerSurfaceState = {
    current_command: commandText,
    current_worker: result.capability_id,
    current_status: lifecycle.stage,
    progress: toProgress(lifecycle.stage),
    result,
    evidence: result.evidence,
    warnings: result.warnings,
    available_capabilities: availableCapabilities(),
  };

  const output_contract = classifyOutput(result);
  return { envelope, lifecycle, result, surface, output_contract, output_routing: resolveOutputConsumers(output_contract) };
}

/** Read-only preview — classifies without routing, so a caller (or a confirmation prompt) can show the Owner which capability a command WOULD go to before it actually runs. */
export function previewOwnerCommand(commandText: string) {
  return classifyCommand(commandText);
}

/** Minimal print/render function — a formatted string, never a UI component (see ./types.ts's header). */
export function renderOwnerSurface(surface: OwnerSurfaceState): string {
  const lines = [
    `Current Command : ${surface.current_command}`,
    `Current Worker  : ${surface.current_worker}`,
    `Current Status  : ${surface.current_status}`,
    `Progress        : ${surface.progress}`,
    `Result          : ${surface.result ? `${surface.result.status} — ${surface.result.summary}` : "(none yet)"}`,
    `Evidence        : ${surface.evidence.length === 0 ? "(none)" : surface.evidence.map((e) => `[${e.source}] ${e.note}`).join(" | ")}`,
    `Warnings        : ${surface.warnings.length === 0 ? "(none)" : surface.warnings.join(" | ")}`,
    `Capabilities    : ${surface.available_capabilities.map((c) => `${c.capability_id}=${c.connected ? "CONNECTED" : "OFFLINE"}`).join(", ")}`,
  ];
  return lines.join("\n");
}
