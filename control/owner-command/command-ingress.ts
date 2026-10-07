/**
 * หน้าที่: Command Ingress (Owner, 2026-08-20) — the ONE standard entry
 * shape for commands arriving from outside DNA OS (a local AI, an
 * external AI, Owner UI, a generic API caller, or a system-internal
 * source). This file does exactly three things: receive -> validate ->
 * normalize into the EXISTING `./input-gateway.ts`'s `CommandEnvelope`,
 * then calls the EXISTING `ingestCommandEnvelope` unchanged. It is NOT a
 * Decision Engine, NOT a Dispatcher, and NEVER picks an agent, credential,
 * policy, or worker — every one of those decisions still happens entirely
 * inside `./input-gateway.ts` and `../agent-gateway/*`, exactly as before
 * this file existed. `input-gateway.ts` itself is not modified by this
 * Work Order.
 *
 * Intent -> WorkOrder normalization is INTENTIONALLY a tiny, explicit
 * allowlist (today: only "check_runtime_status") — an unknown intent is
 * BLOCKED at normalization, never guessed into some improvised WorkOrder.
 * Growing this allowlist is a future, separate, Owner-scoped change; this
 * file does not invent a general-purpose intent compiler.
 *
 * Input: ExternalCommand.
 * Output: CommandIngressOutcome{command_id, task_id, decision_id, status,
 * work_order, next_action}.
 * Dependency ที่อนุญาต: ./input-gateway.ts (ingestCommandEnvelope,
 * CommandEnvelope — unchanged), ../agent-gateway/contract.ts
 * (loadHandoffsForTask, read-only), ../../contracts/identity/
 * envelope-identity.ts, ../agent-gateway/types.ts (WorkOrder, type only).
 * สิ่งที่ห้ามแตะ: never call dispatchTask/submitTask/any adapter directly
 * — this file only ever calls ingestCommandEnvelope, so every admission/
 * policy/credential/worker/next-decision rule already enforced there
 * applies unchanged to every command that arrives here.
 */
import type { EnvelopeIdentity } from "../../contracts/identity/envelope-identity";
import { ingestCommandEnvelope, type CommandEnvelope } from "./input-gateway";
import { loadHandoffsForTask } from "../agent-gateway/contract";
import type { WorkOrder } from "../agent-gateway/types";

export const EXTERNAL_COMMAND_SOURCES = ["local_ai", "external_ai", "owner_ui", "api", "system"] as const;
export type ExternalCommandSource = (typeof EXTERNAL_COMMAND_SOURCES)[number];

export interface ExternalCommand {
  command_id: string;
  source: ExternalCommandSource;
  intent: string;
  context: Readonly<Record<string, unknown>>;
  requested_outcome: string;
  timestamp: string;
}

export interface CommandIngressOutcome {
  command_id: string;
  status: "admitted" | "rejected";
  reason: string;
  task_id: string | null;
  decision_id: string | null;
  work_order: WorkOrder | null;
  next_action: string | null;
}

function validateExternalCommand(command: ExternalCommand): { ok: true } | { ok: false; reason: string } {
  if (!command.command_id?.trim()) return { ok: false, reason: "SCHEMA_INVALID — command_id is required" };
  if (!EXTERNAL_COMMAND_SOURCES.includes(command.source)) return { ok: false, reason: `SCHEMA_INVALID — source must be one of ${EXTERNAL_COMMAND_SOURCES.join(", ")}` };
  if (!command.intent?.trim()) return { ok: false, reason: "SCHEMA_INVALID — intent is required" };
  if (!command.requested_outcome?.trim()) return { ok: false, reason: "SCHEMA_INVALID — requested_outcome is required" };
  if (!command.timestamp || Number.isNaN(new Date(command.timestamp).getTime())) return { ok: false, reason: "SCHEMA_INVALID — timestamp must be a parseable ISO string" };
  if (typeof command.context !== "object" || command.context === null) return { ok: false, reason: "SCHEMA_INVALID — context must be an object" };
  return { ok: true };
}

/**
 * The one, explicit, allowlisted intent -> WorkOrder mapping. Returns
 * null for anything not on this list — Ingress never fabricates a
 * WorkOrder for an intent it does not recognize. Every produced
 * WorkOrder targets the same sandbox root every WorkOrder in this repo
 * already uses (tests/__sandbox__/) — this file introduces no new
 * write surface.
 */
function normalizeToWorkOrder(command: ExternalCommand): WorkOrder | null {
  if (command.intent === "check_runtime_status") {
    return {
      operation: "CREATE",
      target_type: "FILE",
      target_path: `tests/__sandbox__/runtime-status-check-${command.command_id}.txt`,
      requested_change: `record a runtime status check requested via Command Ingress (source=${command.source}, requested_outcome=${command.requested_outcome})`,
      content: `command_id=${command.command_id} source=${command.source} requested_outcome=${command.requested_outcome} timestamp=${command.timestamp}`,
      workspace_scope: "tests/__sandbox__/",
      mode: "sandbox",
      required_tests: ["sandbox.write", "sandbox.readback"],
      forbidden_files: [],
      evidence: [{ source: "command-ingress", note: `command_id=${command.command_id}` }],
    };
  }
  return null;
}

/**
 * The one real entry point: receive -> validate -> normalize -> hand off
 * unchanged to the EXISTING Input Gateway (ingestCommandEnvelope). No
 * agent/credential/policy/worker/next-decision choice is made in this
 * function.
 */
export async function ingestExternalCommand(command: ExternalCommand, identity: EnvelopeIdentity, clientId: string): Promise<CommandIngressOutcome> {
  const validation = validateExternalCommand(command);
  if (!validation.ok) {
    return { command_id: command.command_id, status: "rejected", reason: validation.reason, task_id: null, decision_id: null, work_order: null, next_action: null };
  }

  const workOrder = normalizeToWorkOrder(command);
  if (!workOrder) {
    return { command_id: command.command_id, status: "rejected", reason: `UNSUPPORTED_INTENT — "${command.intent}" is not on Command Ingress's allowlist`, task_id: null, decision_id: null, work_order: null, next_action: null };
  }

  const envelope: CommandEnvelope = {
    envelope_id: `envelope-ingress-${command.command_id}`,
    identity,
    intent_text: `${command.intent}: ${command.requested_outcome}`,
    work_order: workOrder,
    submitted_at: command.timestamp,
    expires_at: new Date(new Date(command.timestamp).getTime() + 5 * 60_000).toISOString(),
    idempotency_key: `ingress:${command.command_id}`,
  };

  const outcome = await ingestCommandEnvelope(envelope, clientId);

  // decision_id: the handoff_id DNA OS's own Decision Engine produced for
  // this task (control/agent-gateway/handoff.ts's confirmDnaOsDecision,
  // agent_id="owner-console") — read fresh, never computed here.
  const dnaOsHandoff = loadHandoffsForTask(outcome.task_id).find((h) => h.agent_id === "owner-console");

  return {
    command_id: command.command_id,
    status: "admitted",
    reason: `ingested via existing Input Gateway, terminal stage=${outcome.status}`,
    task_id: outcome.task_id,
    decision_id: dnaOsHandoff?.handoff_id ?? null,
    work_order: workOrder,
    next_action: outcome.next_action,
  };
}
