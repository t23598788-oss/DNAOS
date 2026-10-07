/**
 * Owner macOS commands enter the queue, then native Launch Services / inspect / existing gateway.
 */

import { createActionPreview } from "../canonical-view/contract";
import { emitLocalResourceEvent, evaluateOwnerCapabilityBinding, invokeLocalCapability } from "../local-resource-access/contract";
import { listMacosBridges, macosBridgeOwnerEnabled, refreshMacosBridge } from "./bridge";
import { correlateMacosEvent } from "./correlate";
import { sudoAndShellClosed } from "./conflict";
import {
  getDefaultApplication,
  getResourceDisplayMetadata,
  nativeOpenUsesShell,
  observeRegisteredApplicationProcess,
  openRegisteredApplication,
  openRegisteredDocument,
  revealRegisteredResource,
} from "./launch-services";
import { enqueueOwnerCommand, getCommandStatus, listCommandQueue, updateCommand } from "./queue";
import { nativeFailureFallback, resolveMacosNativeRoute } from "./route";
import type { NativeInterfaceType, OwnerCommandV1, VerificationResult } from "./types";

const SIDE_EFFECT = new Set(["OPEN_APPLICATION", "OPEN_DOCUMENT", "REVEAL_RESOURCE", "COPY", "MOVE", "DELETE", "WRITE"]);

function expectedEvents(action: string): readonly string[] {
  if (action === "OPEN_APPLICATION") return ["APPLICATION_LAUNCH", "PROCESS_EXEC"];
  if (action === "OPEN_DOCUMENT") return ["APPLICATION_LAUNCH", "FILE_OPEN", "PROCESS_EXEC"];
  if (action === "REVEAL_RESOURCE") return ["FILE_OPEN"];
  if (action === "COPY" || action === "WRITE") return ["FILE_WRITE"];
  return [];
}

export async function submitOwnerMacosCommand(input: {
  readonly ai_client_id: string;
  readonly session_id: string;
  readonly work_id: string;
  readonly canonical_action: string;
  readonly resource_id: string;
  readonly payload?: Record<string, unknown>;
  readonly requested_by?: string;
}): Promise<Record<string, unknown>> {
  sudoAndShellClosed();
  refreshMacosBridge(input.work_id, input.session_id, input.ai_client_id);
  if (/sudo|shell|applescript|osascript|axuielement/i.test(input.canonical_action) || input.requested_by === "ai-enforcement") {
    emitLocalResourceEvent("COMMAND_REJECTED", input.work_id, "FORBIDDEN", undefined, { session_id: input.session_id, authority_decision: "DENY", locality: "LOCAL" });
    return { ok: false, reason_code: "FORBIDDEN", ARBITRARY_SHELL_ACCESS: false, AI_HAS_SYSTEM_ENFORCEMENT_AUTHORITY: false };
  }
  const bind = evaluateOwnerCapabilityBinding({
    ai_identity: input.ai_client_id,
    session_id: input.session_id,
    binding_id: "macos://bridge/this-machine",
    action: input.canonical_action === "GET_DEFAULT_APPLICATION" || input.canonical_action === "GET_RESOURCE_DISPLAY_METADATA" ? "READ" : "READ",
    remote: false,
  });
  const enabled = macosBridgeOwnerEnabled(input.ai_client_id, input.session_id)
    || (bind.reason_code !== "NO_BINDING_POLICY" && bind.decision === "ALLOW");
  const preview = createActionPreview({
    work_id: input.work_id,
    action: SIDE_EFFECT.has(input.canonical_action) ? "COPY" : "READ",
    resource_id: input.resource_id,
    input: input.payload ?? {},
  });
  const route = resolveMacosNativeRoute(input.canonical_action);
  const command = enqueueOwnerCommand({
    work_id: input.work_id,
    canonical_action: input.canonical_action,
    resources: [input.resource_id],
    requested_by: input.requested_by ?? input.ai_client_id,
    authority_state: enabled ? (SIDE_EFFECT.has(input.canonical_action) && input.payload?.preview_approved !== true ? "OWNER_APPROVAL_REQUIRED" : "ALLOW") : "DENY",
    priority: 100,
    dependencies: [],
    preconditions: ["OWNER_POLICY", "VERIFIED_CAPABILITY"],
    preview_ref: preview.preview_id,
    native_route: route.selected,
    session_id: input.session_id,
    payload: {
      ...(input.payload ?? {}),
      NATIVE_ROUTE: route.selected,
      EXPECTED_SYSTEM_EVENTS: expectedEvents(input.canonical_action),
      IMPACT: SIDE_EFFECT.has(input.canonical_action) ? "OPENS_OR_MUTATES_LOCAL" : "READ_ONLY",
      NETWORK: "LOCAL_ONLY",
      REVERSIBILITY: input.canonical_action.startsWith("OPEN") ? "PROCESS_MAY_REMAIN" : "UNKNOWN",
      AUTHORITY: enabled ? "OWNER_GRANT" : "DENY",
    },
    expected_events: expectedEvents(input.canonical_action),
    execution_state: !enabled ? "REJECTED" : (SIDE_EFFECT.has(input.canonical_action) && input.payload?.preview_approved !== true ? "WAITING_FOR_APPROVAL" : (input.payload?.execute_now === false ? "QUEUED" : "VALIDATED")),
  });
  if (command.conflict_resolution === "SERIALIZE") {
    updateCommand(command.command_id, { execution_state: "QUEUED" });
    return { ok: true, executed: false, reason_code: "SERIALIZED", command: getCommandStatus(command.command_id), CLIENT_CAN_BYPASS_QUEUE: false };
  }
  if (command.execution_state === "BLOCKED") {
    return { ok: false, reason_code: "COMMAND_CONFLICT", command, CLIENT_CAN_BYPASS_QUEUE: false };
  }
  if (command.execution_state === "REJECTED") {
    return { ok: false, reason_code: "OWNER_DISABLED", command, OWNER_ENABLED_REQUIRED: true };
  }
  if (command.execution_state === "WAITING_FOR_APPROVAL") {
    return {
      ok: true, executed: false, SIDE_EFFECT_PREVIEW_REQUIRED: true, command, preview,
      owner_facing: { WHAT: input.canonical_action, SOURCE: input.resource_id, DESTINATION: input.payload?.logical_path ?? null, NATIVE_ROUTE: route.selected, EXPECTED_SYSTEM_EVENTS: command.expected_events, NETWORK: "LOCAL_ONLY" },
    };
  }
  if (command.execution_state === "QUEUED") {
    return { ok: true, executed: false, reason_code: "QUEUED", command, CLIENT_CAN_BYPASS_QUEUE: false };
  }
  return executeQueuedCommand(command.command_id, input.ai_client_id);
}

export async function executeQueuedCommand(command_id: string, ai_client_id: string): Promise<Record<string, unknown>> {
  const command = getCommandStatus(command_id);
  if (!command) return { ok: false, reason_code: "UNKNOWN_COMMAND" };
  if (command.execution_state === "BLOCKED" || command.execution_state === "REJECTED") {
    return { ok: false, reason_code: command.execution_state, command, CLIENT_CAN_BYPASS_QUEUE: false };
  }
  const blockedByDep = command.dependencies.some((id) => {
    const dep = getCommandStatus(id);
    return dep && dep.execution_state !== "COMPLETED" && dep.execution_state !== "REJECTED" && dep.execution_state !== "BLOCKED";
  });
  if (blockedByDep) {
    updateCommand(command_id, { execution_state: "QUEUED" });
    return { ok: true, executed: false, reason_code: "SERIALIZED", command: getCommandStatus(command_id), CLIENT_CAN_BYPASS_QUEUE: false };
  }
  updateCommand(command_id, { execution_state: "EXECUTING" });
  emitLocalResourceEvent("COMMAND_STARTED", command.work_id, command.canonical_action, command.command_id, {
    session_id: command.session_id, resource_id: command.resources[0], locality: "LOCAL",
  });
  const ran = await dispatchNative(command, ai_client_id);
  const observed = await correlateAfter(command, ran);
  const verification = verifyCommand(command, observed, ran.ok);
  const next = updateCommand(command_id, {
    execution_state: ran.ok ? "COMPLETED" : "BLOCKED",
    observed_events: observed.map((row) => row.event_type),
    verification,
    result_ref: command.command_id,
  });
  emitLocalResourceEvent(ran.ok ? "COMMAND_COMPLETED" : "COMMAND_BLOCKED", command.work_id, verification ?? "BLOCKED", command.command_id, {
    session_id: command.session_id, resource_id: command.resources[0], locality: "LOCAL", result_status: ran.ok ? "COMPLETED" : "DENIED",
  });
  return { ok: ran.ok, command: next, result: ran.result, verification, native: ran.native, CLIENT_CAN_BYPASS_QUEUE: false, ARBITRARY_SHELL_ACCESS: nativeOpenUsesShell() };
}

async function dispatchNative(command: OwnerCommandV1, ai_client_id: string): Promise<{ ok: boolean; result: Record<string, unknown>; native: Record<string, unknown> }> {
  const action = command.canonical_action;
  const resource_id = command.resources[0] ?? "";
  const logical = String(command.payload.logical_path ?? command.payload.source_logical ?? "notes.txt");
  if (action === "GET_DEFAULT_APPLICATION") {
    return { ok: true, result: getDefaultApplication(logical), native: { route: "LAUNCH_SERVICES" } };
  }
  if (action === "GET_RESOURCE_DISPLAY_METADATA") {
    return { ok: true, result: getResourceDisplayMetadata(resource_id, logical), native: { route: "LAUNCH_SERVICES" } };
  }
  if (action === "OPEN_APPLICATION") {
    if (command.native_route && command.native_route !== "LAUNCH_SERVICES" && command.native_route !== "NSWORKSPACE") {
      return { ok: false, result: nativeFailureFallback(command.native_route), native: { silent_downgrade: false } };
    }
    const opened = await openRegisteredApplication();
    if ("ok" in opened && opened.ok === false) return { ok: false, result: opened, native: nativeFailureFallback("LAUNCH_SERVICES") };
    return { ok: true, result: opened as Record<string, unknown>, native: { route: "LAUNCH_SERVICES", shell: false } };
  }
  if (action === "OPEN_DOCUMENT") {
    const opened = await openRegisteredDocument(resource_id, logical);
    if ("ok" in opened && opened.ok === false) return { ok: false, result: opened, native: nativeFailureFallback("LAUNCH_SERVICES") };
    return { ok: true, result: opened as Record<string, unknown>, native: { route: "LAUNCH_SERVICES", shell: false } };
  }
  if (action === "REVEAL_RESOURCE") {
    const revealed = await revealRegisteredResource(resource_id, logical);
    if ("ok" in revealed && revealed.ok === false) return { ok: false, result: revealed, native: nativeFailureFallback("LAUNCH_SERVICES") };
    return { ok: true, result: revealed as Record<string, unknown>, native: { route: "LAUNCH_SERVICES", shell: false } };
  }
  if (action === "COPY" || action === "READ" || action === "SEARCH" || action === "EXTRACT") {
    const capability = action === "COPY" ? "local.file.copy" : action === "SEARCH" ? "local.files.search" : action === "EXTRACT" ? "local.document.extract_text" : "local.file.read";
    const invoked = await invokeLocalCapability({
      ai_client_id,
      session_id: command.session_id,
      work_id: command.work_id,
      capability: capability as never,
      resource_id,
      input: command.payload,
    });
    return { ok: invoked.ok, result: invoked.result, native: { route: "OS_SERVICE", envelope: invoked.envelope } };
  }
  if (action === "APP_INTENT") {
    return { ok: false, result: nativeFailureFallback("APP_INTENTS"), native: { silent_downgrade: false } };
  }
  return { ok: false, result: { reason_code: "UNKNOWN_NATIVE_ACTION" }, native: {} };
}

async function correlateAfter(command: OwnerCommandV1, ran: { ok: boolean; result: Record<string, unknown> }): Promise<ReturnType<typeof correlateMacosEvent>[]> {
  const proc = ran.ok ? await observeRegisteredApplicationProcess() : { seen: false, process: null };
  const rows = [];
  for (const event_type of command.expected_events) {
    rows.push(correlateMacosEvent({
      event_type,
      command_id: command.command_id,
      work_id: command.work_id,
      execution_id: command.command_id,
      process: proc.process ?? (ran.ok ? "launch-services" : null),
      resource: command.resources[0] ?? null,
      application: "app://macos/textedit",
      expected: ran.ok,
    }));
  }
  rows.push(correlateMacosEvent({
    event_type: "PROCESS_EXEC",
    command_id: null,
    work_id: command.work_id,
    process: "kernel_task",
    expected: false,
  }));
  return rows;
}

function verifyCommand(command: OwnerCommandV1, observed: ReturnType<typeof correlateMacosEvent>[], api_ok: boolean): VerificationResult {
  if (!api_ok) return "BLOCKED";
  const expectedHit = command.expected_events.every((event) => observed.some((row) => row.event_type === event && row.classification === "EXPECTED"));
  if (expectedHit && api_ok) return "VERIFIED";
  if (api_ok) return "PARTIALLY_VERIFIED";
  return "UNVERIFIED";
}

export function macosWorkSurfaceSlice(ai_client_id: string, session_id: string, work_id: string): Record<string, unknown> {
  const bridges = listMacosBridges().length ? listMacosBridges() : refreshMacosBridge(work_id, session_id, ai_client_id);
  const ls = bridges.find((row) => row.interface_type === "LAUNCH_SERVICES");
  const latest = listCommandQueue()[listCommandQueue().length - 1] ?? null;
  return {
    COMMAND: latest,
    RESOURCE: latest?.resources ?? [],
    APPLICATION: "app://macos/textedit",
    NATIVE_ROUTE: ls?.interface_type ?? resolveMacosNativeRoute("OPEN_DOCUMENT").selected,
    QUEUE_STATE: latest?.execution_state ?? "EMPTY",
    PERMISSION_STATE: "see dna_os.get_macos_permission_state",
    EXPECTED_IMPACT: latest?.payload.IMPACT ?? null,
    SYSTEM_EVENTS: latest?.observed_events ?? [],
    RESULT: latest?.verification ?? null,
  };
}

export type { NativeInterfaceType };
