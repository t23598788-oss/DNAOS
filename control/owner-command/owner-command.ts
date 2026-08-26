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
import { resolveOwnerCommandSemantics, type SemanticDeps } from "../owner-command-semantics/contract";
import { resolveEntryContext } from "../entry-context/contract";
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

/** How the semantic layer is run for this submission. `enabled: false` is for suites that must not spawn a model — the pre-2026-08-26 behavior, unchanged. */
export interface SemanticOptions {
  enabled?: boolean;
  deps?: SemanticDeps;
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
export async function submitOwnerCommand(commandText: string, ownerIdentity: EnvelopeIdentity, options: RouteOptions = {}, semanticOptions: SemanticOptions = {}): Promise<SubmitOwnerCommandOutcome> {
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

  // SEMANTIC RESOLUTION (Owner, 2026-08-26) — sits here, between this
  // envelope and ../entry-context/, because this is the first point where a
  // real command_id exists and the last point before the router is asked to
  // do anything. The model only labels the Owner's words; every id below was
  // proven by ../owner-command-semantics/resolver.ts against a real registry.
  //
  // Fail-open by design: if the model process cannot run (not installed, no
  // weights, sandbox refused), the command still goes through on exactly the
  // path it took before this layer existed. A translation aid must never be
  // the reason an Owner command cannot be issued.
  let routeOptions = options;
  const semantics = semanticOptions.enabled === false
    ? undefined
    : resolveOwnerCommandSemantics(envelope.command_id, commandText, { identity_id: ownerIdentity.identity_id, kind: ownerIdentity.kind }, semanticOptions.deps ?? {});

  if (semantics && semantics.ok) {
    let context = semantics.context;

    // Requirement 6/7: ../entry-context/ is called for real, with the real
    // registered command_id this command resolved to — never the literal
    // "unknown" a caller used to hand in. Only when a descriptor actually
    // matched; an unproven command_id would defeat the point.
    //
    // The call is recorded in `source_trace` rather than left to be inferred:
    // "the entry context ran" is a claim about runtime, and a reader of the
    // resulting payload should be able to see it happened without reading
    // this file.
    if (context.policy_command_id && options.executionRequestBase) {
      const resolution = resolveEntryContext({
        identity_id: options.executionRequestBase.identity_id,
        account_id: options.executionRequestBase.account_id,
        workspace_id: options.executionRequestBase.workspace_id,
        command_id: context.policy_command_id,
      });
      routeOptions = { ...options, executionPolicyContext: resolution.context };
      context = {
        ...context,
        source_trace: [
          ...context.source_trace,
          {
            field: "execution_policy_context",
            provenance: "RUNTIME",
            detail: `control/entry-context/contract.ts#resolveEntryContext command_id=${context.policy_command_id} identity_resolved=${resolution.context.identity !== undefined} account_resolved=${resolution.account !== undefined} workspace_resolved=${resolution.workspace !== undefined} memberships=${resolution.context.memberships.length}`,
          },
        ],
      };
    }

    // Requirement 8/9: the router no longer receives a bare string. The
    // structured context rides on the envelope's own payload, which
    // ../command-router/ already forwards verbatim into every RouterStep.
    envelope.payload = { structured_owner_context: context };
  }

  const result = await routeOwnerCommand(envelope, commandText, routeOptions);
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
