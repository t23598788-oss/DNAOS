/**
 * AI Access Gateway — Owner policy then scoped local adapters.
 * Not a second control plane: routes through existing MCP, workspace, and process-gate contracts.
 */

import { randomUUID } from "node:crypto";
import { getLocalCapability, listLocalCapabilities } from "./capability-catalog";
import { evaluateLocalAuthority, resourcesVisibleToSession } from "./authority";
import { emitLocalResourceEvent } from "./events";
import { persistLocalExecution, getLocalExecution, listLocalExecutions } from "./evidence-store";
import { classifyEgressPayload, recordDataEgress } from "./egress";
import {
  fileCopy,
  fileCreate,
  fileDelete,
  fileMove,
  fileRename,
  filesMetadata,
  filesReadRange,
  filesSearch,
  folderCreate,
  folderList,
} from "./filesystem-adapter";
import { convertRegistered, documentMetadata, extractDocumentText, imageMetadata, summarizeDocument } from "./document-adapter";
import { gitDiff, gitSearch, gitStatus } from "./git-adapter";
import { decideLocalFirst } from "./local-first";
import { evaluateProcessJobRequest, listRegisteredJobs, runRegisteredJob } from "./process-adapter";
import { classifyAnomaly } from "./anomaly";
import {
  osDiskSummary,
  osMountList,
  osNetworkSummary,
  osPortList,
  osProcessInspect,
  osProcessList,
  osResourceUsage,
  osServiceStatus,
} from "./os-inspect-adapter";
import { discoverInstalledApplications, invokeRegisteredApplicationAction, listRegisteredApplications, mapEverydayApplicationAction } from "./application-adapter";
import { evaluateOwnerMachinePolicy } from "./machine-policy";
import { evaluateOwnerCapabilityBinding } from "./owner-capability-policy";
import { listApplicationInventory, listPersistedInventory, refreshMachineInventory } from "./machine-inventory";
import { resolveCapabilityBindings } from "./capability-route";
import { readGithubIdentity } from "./github-identity-adapter";
import { getRegisteredLocalResource, listRegisteredLocalResources, publicResourceView } from "./resource-registry";
import { createScopedLocalWorkspace, listScopedWorkspaces } from "./workspace-scope";
import { nowIso } from "./host-runtime";
import type {
  InvokeLocalCapabilityInput,
  InvokeLocalCapabilityResult,
  LocalExecutionEnvelope,
  NetworkEgressPolicy,
} from "./types";

declare const process: { pid: number };

function utf8Bytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function envelopeOf(input: InvokeLocalCapabilityInput, extra: Partial<LocalExecutionEnvelope> & Pick<LocalExecutionEnvelope, "authority_decision" | "result_status" | "started_at">): LocalExecutionEnvelope {
  return {
    envelope: "DNA_OS_LOCAL_EXECUTION",
    source: "DNA_OS_RUNTIME",
    work_id: input.work_id,
    execution_id: extra.execution_id ?? `lex-${randomUUID()}`,
    ai_client_id: input.ai_client_id,
    capability: input.capability,
    resource_id: input.resource_id,
    authority_decision: extra.authority_decision,
    execution_locality: extra.execution_locality ?? "LOCAL",
    files_read_count: extra.files_read_count ?? 0,
    files_written_count: extra.files_written_count ?? 0,
    network_egress_bytes: extra.network_egress_bytes ?? 0,
    external_ai_bytes_sent: extra.external_ai_bytes_sent ?? 0,
    started_at: extra.started_at,
    completed_at: extra.completed_at ?? nowIso(),
    result_status: extra.result_status,
  };
}

function finish(
  input: InvokeLocalCapabilityInput,
  authority: InvokeLocalCapabilityResult["authority"],
  result: Record<string, unknown>,
  extra: Partial<LocalExecutionEnvelope> & Pick<LocalExecutionEnvelope, "authority_decision" | "result_status" | "started_at">,
  egressPolicy: NetworkEgressPolicy,
  sourceBytes: number,
): InvokeLocalCapabilityResult {
  const sent = extra.result_status === "COMPLETED" ? utf8Bytes(result) : 0;
  const classification = classifyEgressPayload(result);
  const egress = recordDataEgress({
    provider: input.ai_client_id,
    work_id: input.work_id,
    source_resource: input.resource_id,
    data_classification: classification,
    bytes_proposed: sourceBytes,
    bytes_actually_sent: classification === "SECRET" || classification === "CREDENTIAL" ? 0 : sent,
    reason: extra.result_status,
    authority_decision: classification === "SECRET" || classification === "CREDENTIAL" ? "DENY" : extra.authority_decision,
    policy_state: classification === "SECRET" || classification === "CREDENTIAL" ? "DENIED" : egressPolicy,
    redaction_applied: classification === "SECRET" || classification === "CREDENTIAL",
    minimization_applied: sourceBytes > sent,
  });
  const blockedSecret = egress.policy_state === "DENIED" && extra.result_status === "COMPLETED";
  const env = envelopeOf(input, {
    ...extra,
    result_status: blockedSecret ? "DENIED" : extra.result_status,
    authority_decision: blockedSecret ? "DENY" : extra.authority_decision,
    external_ai_bytes_sent: egress.bytes_actually_sent,
    network_egress_bytes: egress.bytes_actually_sent,
  });
  persistLocalExecution(env);
  emitLocalResourceEvent(env.result_status === "COMPLETED" ? "WORK_COMPLETED" : "WORK_BLOCKED", input.work_id, env.result_status, env.execution_id);
  emitLocalResourceEvent("AI_DATA_SENT", input.work_id, `bytes=${egress.bytes_actually_sent}`, env.execution_id);
  return {
    ok: env.result_status === "COMPLETED",
    authority,
    envelope: env,
    result: blockedSecret ? { denied: true, reason_code: "SECRET_EGRESS_DENIED" } : result,
    egress,
  };
}

export function listLocalResourcesForSession(ai_client_id: string, session_id: string): readonly Record<string, unknown>[] {
  const allowed = new Set(resourcesVisibleToSession(ai_client_id, session_id));
  return listRegisteredLocalResources().filter((row) => allowed.has(row.resource_id)).map(publicResourceView);
}

export function getLocalResourceForSession(ai_client_id: string, session_id: string, resource_id: string): Record<string, unknown> | null {
  return listLocalResourcesForSession(ai_client_id, session_id).find((row) => row.resource_id === resource_id) ?? null;
}

export async function invokeLocalCapability(input: InvokeLocalCapabilityInput): Promise<InvokeLocalCapabilityResult> {
  const started_at = nowIso();
  const execution_id = `lex-${randomUUID()}`;
  emitLocalResourceEvent("WORK_RECEIVED", input.work_id, input.capability, execution_id);
  emitLocalResourceEvent("AI_REQUEST_RECEIVED", input.work_id, input.ai_client_id, execution_id);
  emitLocalResourceEvent("CAPABILITY_REQUESTED", input.work_id, input.capability, execution_id);

  const descriptor = getLocalCapability(input.capability);
  const resource = getRegisteredLocalResource(input.resource_id);
  const authority = evaluateLocalAuthority({
    ai_identity: input.ai_client_id,
    session_id: input.session_id,
    work_id: input.work_id,
    capability: input.capability,
    resource_id: input.resource_id,
    data_scope: resource?.read_scope ?? [],
    access: descriptor?.access_class ?? "READ",
    network_egress: "LOCAL_ONLY",
  });
  emitLocalResourceEvent("AUTHORITY_CHECKED", input.work_id, authority.reason_code, execution_id, {
    session_id: input.session_id, resource_id: input.resource_id, authority_decision: authority.decision, locality: "LOCAL",
  });

  const deny = (reason: string, decision: LocalExecutionEnvelope["authority_decision"] = "DENY") =>
    finish(input, authority, { denied: true, reason_code: reason }, {
      execution_id, started_at, authority_decision: decision, result_status: decision === "OWNER_APPROVAL_REQUIRED" ? "OWNER_APPROVAL_REQUIRED" : "DENIED",
    }, "DENIED", 0);

  if (!descriptor) {
    classifyAnomaly("BLOCKED_CAPABILITY", input.capability, input.work_id, input.session_id, input.resource_id);
    return deny("UNKNOWN_CAPABILITY");
  }
  if (!resource) return deny("UNKNOWN_RESOURCE");
  if (authority.decision === "DENY") {
    classifyAnomaly("BLOCKED_CAPABILITY", authority.reason_code, input.work_id, input.session_id, input.resource_id);
    return deny(authority.reason_code);
  }
  if (authority.decision === "OWNER_APPROVAL_REQUIRED") {
    emitLocalResourceEvent("OWNER_APPROVAL_REQUIRED", input.work_id, input.capability, execution_id, {
      session_id: input.session_id, resource_id: input.resource_id, authority_decision: "OWNER_APPROVAL_REQUIRED",
      locality: "LOCAL", action: input.capability, result_status: "OWNER_APPROVAL_REQUIRED",
    });
    return deny("OWNER_APPROVAL_REQUIRED", "OWNER_APPROVAL_REQUIRED");
  }
  if (!resource.capabilities.includes(input.capability)) return deny("CAPABILITY_NOT_ON_RESOURCE");
  if (!descriptor.allowed_resource_types.includes(resource.resource_type)) return deny("RESOURCE_TYPE_NOT_ALLOWED");

  if (resource.workspace_required && listScopedWorkspaces(input.work_id).length === 0
      && input.capability !== "local.workspace.create") {
    const created = await createScopedLocalWorkspace({ work_id: input.work_id, resource_ids: [input.resource_id] });
    if (!created.ok) return deny(created.reason_code);
    emitLocalResourceEvent("WORKSPACE_CREATED", input.work_id, created.binding?.workspace_ref, execution_id);
  }

  const routing = decideLocalFirst(input.capability, 0);
  emitLocalResourceEvent("LOCAL_EXECUTION_STARTED", input.work_id, routing.reason, execution_id);

  let result: Record<string, unknown> = {};
  let files_read_count = 0;
  let files_written_count = 0;
  let sourceBytes = 0;
  const actionCtx = {
    session_id: input.session_id,
    resource_id: input.resource_id,
    authority_decision: authority.decision,
    locality: "LOCAL" as const,
    action: input.capability,
  };

  if (input.capability === "local.files.search") {
    const query = String(input.input.query ?? "");
    const found = filesSearch(resource, query, Number(input.input.max_matches ?? 20));
    if (!found.ok) return deny(found.reason_code);
    emitLocalResourceEvent("FILE_READ", input.work_id, `count=${found.files_read_count}`, execution_id, actionCtx);
    emitLocalResourceEvent("RESOURCE_SEARCHED", input.work_id, input.capability, execution_id, { ...actionCtx, result_status: "COMPLETED" });
    files_read_count = found.files_read_count;
    sourceBytes = files_read_count * 1024;
    result = { matches: found.matches, locality: "LOCAL" };
  } else if (input.capability === "local.files.metadata") {
    const meta = filesMetadata(resource, String(input.input.logical_path ?? ""));
    if (!meta.ok) {
      if (meta.reason_code === "PATH_OUT_OF_SCOPE") classifyAnomaly("WORKSPACE_ESCAPE", String(input.input.logical_path ?? ""), input.work_id, input.session_id, input.resource_id);
      if (meta.reason_code === "PATH_OUT_OF_SCOPE") classifyAnomaly("UNAUTHORIZED_FILE_ACCESS", String(input.input.logical_path ?? ""), input.work_id, input.session_id, input.resource_id);
      return deny(meta.reason_code);
    }
    emitLocalResourceEvent("FILE_READ", input.work_id, "metadata", execution_id);
    files_read_count = 1;
    sourceBytes = Number(meta.metadata.bytes ?? 0);
    result = meta.metadata;
  } else if (input.capability === "local.files.read_range") {
    const range = filesReadRange(resource, String(input.input.logical_path ?? ""), Number(input.input.start ?? 0), Number(input.input.length ?? 4096));
    if (!range.ok) return deny(range.reason_code);
    emitLocalResourceEvent("FILE_READ", input.work_id, "read_range", execution_id);
    files_read_count = 1;
    sourceBytes = Number(range.payload.source_bytes ?? 0);
    result = { ...range.payload, locality: "LOCAL" };
  } else if (input.capability === "local.workspace.create") {
    const ids = Array.isArray(input.input.resource_ids) ? input.input.resource_ids.map(String) : [input.resource_id];
    const created = await createScopedLocalWorkspace({ work_id: input.work_id, resource_ids: ids });
    if (!created.ok || !created.binding) return deny(created.reason_code);
    emitLocalResourceEvent("WORKSPACE_CREATED", input.work_id, created.binding.workspace_ref, execution_id);
    result = { workspace_ref: created.binding.workspace_ref, attached_resource_ids: created.binding.attached_resource_ids };
  } else if (input.capability === "local.workspace.inspect") {
    result = { workspaces: listScopedWorkspaces(input.work_id) };
  } else if (input.capability === "local.workspace.list_results") {
    result = { executions: listLocalExecutions(input.work_id).map((row) => row.execution_id) };
  } else if (input.capability === "local.git.status") {
    const status = await gitStatus(resource, input.work_id);
    if (!status.ok) return deny(status.reason_code ?? "GIT_STATUS_FAILED");
    result = { items: status.items, locality: "LOCAL" };
  } else if (input.capability === "local.git.diff") {
    const diff = await gitDiff(resource, input.work_id);
    if (!diff.ok) return deny(diff.reason_code ?? "GIT_DIFF_FAILED");
    result = { items: diff.items, locality: "LOCAL" };
  } else if (input.capability === "local.git.search") {
    const search = await gitSearch(resource, input.work_id, String(input.input.query ?? ""));
    if (!search.ok) return deny(search.reason_code ?? "GIT_SEARCH_FAILED");
    result = { items: search.items, locality: "LOCAL" };
  } else if (input.capability === "local.compute.run_registered_job") {
    emitLocalResourceEvent("PROCESS_JOB_REQUESTED", input.work_id, String(input.input.job_id ?? ""), execution_id, {
      session_id: input.session_id, resource_id: input.resource_id, locality: "LOCAL",
    });
    const extras = {
      cwd: typeof input.input.cwd === "string" ? input.input.cwd : undefined,
      env: input.input.env && typeof input.input.env === "object" ? input.input.env as Record<string, string> : undefined,
      argv: Array.isArray(input.input.argv) ? input.input.argv.map(String) : undefined,
      network: typeof input.input.network === "string" ? input.input.network : undefined,
    };
    const gate = evaluateProcessJobRequest({ job_id: String(input.input.job_id ?? ""), ...extras });
    if (!gate.ok) {
      if (gate.reason_code === "CWD_ESCAPE_REJECTED") classifyAnomaly("WORKSPACE_ESCAPE", extras.cwd ?? "", input.work_id, input.session_id, input.resource_id);
      if (gate.reason_code === "ARBITRARY_SHELL_REJECTED") classifyAnomaly("UNEXPECTED_SPAWN", String(input.input.job_id ?? ""), input.work_id, input.session_id, input.resource_id);
      return deny(gate.reason_code);
    }
    emitLocalResourceEvent("PROCESS_JOB_STARTED", input.work_id, String(input.input.job_id ?? ""), execution_id, {
      session_id: input.session_id, resource_id: input.resource_id, locality: "LOCAL",
    });
    const job = await runRegisteredJob(resource, String(input.input.job_id ?? ""), input.work_id, extras);
    emitLocalResourceEvent("PROCESS_JOB_COMPLETED", input.work_id, job.reason_code, execution_id, {
      session_id: input.session_id, resource_id: input.resource_id, locality: "LOCAL",
    });
    if (!job.ok) return deny(job.reason_code);
    result = { job_id: input.input.job_id, exit_code: job.exit_code, locality: "LOCAL" };
  } else if (input.capability === "local.app.list_registered") {
    result = { applications: listRegisteredApplications().map((app) => ({ application_id: app.application_id, bundle_id: app.bundle_id, usage_authorized: app.usage_authorized })) };
  } else if (input.capability === "local.app.discover_installed") {
    result = { applications: discoverInstalledApplications(input.work_id, input.session_id), usage_authorized: false };
  } else if (input.capability === "local.app.invoke_registered_action") {
    let actionId = String(input.input.action_id ?? "");
    const applicationId = String(input.input.application_id ?? "app://macos/textedit");
    if (typeof input.input.everyday_action === "string" && input.input.everyday_action) {
      const mapped = mapEverydayApplicationAction(applicationId, input.input.everyday_action);
      if (!mapped.ok) return deny(mapped.reason_code);
      actionId = mapped.action_id;
    }
    const policy = evaluateOwnerMachinePolicy({
      ai_identity: input.ai_client_id,
      session_id: input.session_id,
      resource_id: input.resource_id,
      capability: input.capability,
      access: "EXECUTE",
      network_egress: "LOCAL_ONLY",
      application_action_id: actionId,
    });
    if (policy.decision === "DENY") return deny(policy.reason_code);
    const bind = evaluateOwnerCapabilityBinding({
      ai_identity: input.ai_client_id,
      session_id: input.session_id,
      binding_id: applicationId,
      action: String(input.input.everyday_action ?? "READ"),
      remote: false,
    });
    if (bind.reason_code !== "NO_BINDING_POLICY" && bind.decision !== "ALLOW") {
      emitLocalResourceEvent("CAPABILITY_BLOCKED", input.work_id, bind.reason_code, execution_id, {
        ...actionCtx, authority_decision: bind.decision, result_status: "DENIED",
      });
      return deny(bind.reason_code, bind.decision === "OWNER_APPROVAL_REQUIRED" ? "OWNER_APPROVAL_REQUIRED" : "DENY");
    }
    if (bind.owner_enabled) {
      emitLocalResourceEvent("OWNER_CAPABILITY_ENABLED", input.work_id, applicationId, execution_id, {
        ...actionCtx, authority_decision: "ALLOW",
      });
    }
    const invoked = invokeRegisteredApplicationAction({
      application_id: applicationId,
      action_id: actionId,
      work_id: input.work_id,
      session_id: input.session_id,
    });
    if (!invoked.ok) return deny(invoked.reason_code);
    emitLocalResourceEvent("APPLICATION_ACTION_EXECUTED", input.work_id, actionId, execution_id, {
      ...actionCtx, result_status: "COMPLETED",
    });
    result = { ...invoked.result, everyday_action: input.input.everyday_action ?? null };
  } else if (input.capability === "local.system.process.list") {
    const listed = await osProcessList(resource, input.work_id, input.session_id);
    if (!listed.ok) return deny(listed.reason_code ?? "OS_INSPECT_FAILED");
    result = listed.result;
  } else if (input.capability === "local.system.process.inspect") {
    const inspected = await osProcessInspect(resource, input.work_id, input.session_id, String(input.input.pid ?? String(process.pid)));
    if (!inspected.ok) return deny(inspected.reason_code ?? "OS_INSPECT_FAILED");
    result = inspected.result;
  } else if (input.capability === "local.system.port.list") {
    const ports = await osPortList(resource, input.work_id, input.session_id);
    if (!ports.ok) return deny(ports.reason_code ?? "OS_INSPECT_FAILED");
    result = ports.result;
  } else if (input.capability === "local.system.network.summary") {
    result = osNetworkSummary(resource, input.work_id, input.session_id);
  } else if (input.capability === "local.system.disk.summary") {
    const disk = await osDiskSummary(resource, input.work_id);
    if (!disk.ok) return deny(disk.reason_code ?? "OS_INSPECT_FAILED");
    result = disk.result;
  } else if (input.capability === "local.system.mount.list") {
    const mounts = await osMountList(resource, input.work_id);
    if (!mounts.ok) return deny(mounts.reason_code ?? "OS_INSPECT_FAILED");
    result = mounts.result;
  } else if (input.capability === "local.system.service.status") {
    result = osServiceStatus(resource);
  } else if (input.capability === "local.system.resource_usage") {
    result = osResourceUsage(resource, input.work_id, input.session_id);
  } else if (input.capability === "local.resource.list") {
    result = { resources: listLocalResourcesForSession(input.ai_client_id, input.session_id) };
  } else if (input.capability === "local.resource.capabilities") {
    result = { capabilities: resource.capabilities };
  } else if (input.capability === "local.resource.status") {
    result = { availability: resource.availability, resource_id: resource.resource_id };
  } else if (input.capability === "local.file.read") {
    const range = filesReadRange(resource, String(input.input.logical_path ?? ""), Number(input.input.start ?? 0), Number(input.input.length ?? 4096));
    if (!range.ok) return deny(range.reason_code);
    emitLocalResourceEvent("RESOURCE_READ", input.work_id, String(input.input.logical_path ?? ""), execution_id, {
      ...actionCtx, bytes: Number(range.payload.source_bytes ?? 0), result_status: "COMPLETED",
    });
    files_read_count = 1;
    sourceBytes = Number(range.payload.source_bytes ?? 0);
    result = { ...range.payload, locality: "LOCAL" };
  } else if (input.capability === "local.folder.search") {
    const found = filesSearch(resource, String(input.input.query ?? ""), Number(input.input.max_matches ?? 20));
    if (!found.ok) return deny(found.reason_code);
    emitLocalResourceEvent("RESOURCE_SEARCHED", input.work_id, "SEARCH", execution_id, { ...actionCtx, result_status: "COMPLETED" });
    files_read_count = found.files_read_count;
    result = { matches: found.matches, locality: "LOCAL" };
  } else if (input.capability === "local.folder.list") {
    const listed = folderList(resource, String(input.input.logical_path ?? ""));
    if (!listed.ok) return deny(listed.reason_code);
    emitLocalResourceEvent("RESOURCE_READ", input.work_id, "FOLDER", execution_id, { ...actionCtx, result_status: "COMPLETED" });
    result = { items: listed.items, locality: "LOCAL" };
  } else if (input.capability === "local.file.create") {
    const created = fileCreate(resource, String(input.input.logical_path ?? ""), String(input.input.content ?? ""));
    if (!created.ok) return deny(created.reason_code);
    emitLocalResourceEvent("RESOURCE_CREATED", input.work_id, String(input.input.logical_path ?? ""), execution_id, {
      ...actionCtx, bytes: Number(created.payload.bytes ?? 0), result_status: "COMPLETED",
    });
    files_written_count = 1;
    result = { ...created.payload, locality: "LOCAL" };
  } else if (input.capability === "local.folder.create") {
    const created = folderCreate(resource, String(input.input.logical_path ?? ""));
    if (!created.ok) return deny(created.reason_code);
    emitLocalResourceEvent("RESOURCE_CREATED", input.work_id, String(input.input.logical_path ?? ""), execution_id, {
      ...actionCtx, result_status: "COMPLETED",
    });
    files_written_count = 1;
    result = { ...created.payload, locality: "LOCAL" };
  } else if (input.capability === "local.file.copy" || input.capability === "local.file.move") {
    const destId = String(input.input.destination_resource_id ?? input.resource_id);
    const destResource = getRegisteredLocalResource(destId);
    if (!destResource) return deny("UNKNOWN_RESOURCE");
    if (!destResource.capabilities.includes(input.capability)) return deny("CAPABILITY_NOT_ON_RESOURCE");
    const destAuth = evaluateLocalAuthority({
      ai_identity: input.ai_client_id,
      session_id: input.session_id,
      work_id: input.work_id,
      capability: input.capability,
      resource_id: destId,
      data_scope: destResource.read_scope,
      access: input.capability === "local.file.move" ? "MOVE" : "CREATE",
      network_egress: "LOCAL_ONLY",
    });
    if (destAuth.decision === "DENY") return deny(destAuth.reason_code);
    if (destAuth.decision === "OWNER_APPROVAL_REQUIRED") {
      emitLocalResourceEvent("OWNER_APPROVAL_REQUIRED", input.work_id, input.capability, execution_id, {
        ...actionCtx, resource_id: destId, authority_decision: "OWNER_APPROVAL_REQUIRED", result_status: "OWNER_APPROVAL_REQUIRED",
      });
      return deny("OWNER_APPROVAL_REQUIRED", "OWNER_APPROVAL_REQUIRED");
    }
    const srcLogical = String(input.input.source_logical ?? "");
    const dstLogical = String(input.input.destination_logical ?? "");
    const transferred = input.capability === "local.file.copy"
      ? fileCopy(resource, destResource, srcLogical, dstLogical)
      : fileMove(resource, destResource, srcLogical, dstLogical);
    if (!transferred.ok) return deny(transferred.reason_code);
    emitLocalResourceEvent(input.capability === "local.file.copy" ? "RESOURCE_COPIED" : "RESOURCE_MOVED", input.work_id, dstLogical, execution_id, {
      ...actionCtx, bytes: transferred.record.bytes_transferred, result_status: "COMPLETED",
    });
    emitLocalResourceEvent("TRANSFER_VERIFIED", input.work_id, transferred.record.destination_hash ?? "", execution_id, {
      ...actionCtx, bytes: transferred.record.bytes_transferred, result_status: "COMPLETED",
    });
    files_read_count = 1;
    files_written_count = 1;
    result = { transfer: transferred.record, locality: "LOCAL" };
  } else if (input.capability === "local.file.rename") {
    const renamed = fileRename(resource, String(input.input.source_logical ?? ""), String(input.input.destination_logical ?? ""));
    if (!renamed.ok) return deny(renamed.reason_code);
    emitLocalResourceEvent("RESOURCE_RENAMED", input.work_id, String(input.input.destination_logical ?? ""), execution_id, {
      ...actionCtx, bytes: renamed.record.bytes_transferred, result_status: "COMPLETED",
    });
    emitLocalResourceEvent("TRANSFER_VERIFIED", input.work_id, renamed.record.destination_hash ?? "", execution_id, {
      ...actionCtx, result_status: "COMPLETED",
    });
    files_written_count = 1;
    result = { transfer: renamed.record, locality: "LOCAL" };
  } else if (input.capability === "local.file.delete") {
    emitLocalResourceEvent("RESOURCE_DELETE_REQUESTED", input.work_id, String(input.input.logical_path ?? ""), execution_id, actionCtx);
    const deleted = fileDelete(resource, String(input.input.logical_path ?? ""));
    if (!deleted.ok) return deny(deleted.reason_code);
    emitLocalResourceEvent("RESOURCE_DELETED", input.work_id, String(input.input.logical_path ?? ""), execution_id, {
      ...actionCtx, result_status: "COMPLETED",
    });
    files_written_count = 1;
    result = { ...deleted.payload, locality: "LOCAL" };
  } else if (input.capability === "local.document.extract_text" || input.capability === "local.pdf.extract_text") {
    const extracted = extractDocumentText(resource, String(input.input.logical_path ?? ""));
    if (!extracted.ok) return deny(extracted.reason_code);
    emitLocalResourceEvent("DOCUMENT_EXTRACTED", input.work_id, input.capability, execution_id, {
      ...actionCtx, bytes: Number(extracted.payload.source_bytes ?? 0), result_status: "COMPLETED",
    });
    files_read_count = 1;
    sourceBytes = Number(extracted.payload.source_bytes ?? 0);
    result = extracted.payload;
  } else if (input.capability === "local.document.metadata" || input.capability === "local.pdf.metadata") {
    const meta = documentMetadata(resource, String(input.input.logical_path ?? ""));
    if (!meta.ok) return deny(meta.reason_code);
    result = meta.payload;
  } else if (input.capability === "local.image.metadata") {
    const meta = imageMetadata(resource, String(input.input.logical_path ?? ""));
    if (!meta.ok) return deny(meta.reason_code);
    result = meta.payload;
  } else if (input.capability === "local.image.convert_registered" || input.capability === "local.document.convert_registered") {
    const converted = convertRegistered();
    return deny(converted.reason_code);
  } else if (input.capability === "local.document.summarize") {
    const summarized = summarizeDocument(resource, String(input.input.logical_path ?? ""));
    if (!summarized.ok) return deny(summarized.reason_code);
    emitLocalResourceEvent("SUMMARY_LOCAL_PREPROCESS", input.work_id, String(summarized.evidence.LOCAL_BYTES_PROCESSED), execution_id, {
      ...actionCtx, bytes: summarized.evidence.LOCAL_BYTES_PROCESSED, result_status: "COMPLETED",
    });
    emitLocalResourceEvent("SUMMARY_EXTERNAL_DATA_SENT", input.work_id, String(summarized.evidence.RESULT_BYTES_RETURNED), execution_id, {
      ...actionCtx, bytes: summarized.evidence.RESULT_BYTES_RETURNED, result_status: "COMPLETED",
    });
    files_read_count = 1;
    sourceBytes = summarized.evidence.SOURCE_BYTES;
    result = summarized.payload;
  } else if (input.capability === "local.file.share_external" || input.capability === "local.file.publish_external") {
    result = {
      implemented: false,
      reason_code: "REMOTE_RESOURCE_ACTION_NOT_IMPLEMENTED",
      network_egress: "DENIED",
      locality: "LOCAL",
    };
  } else if (input.capability === "local.inventory.refresh") {
    const rows = refreshMachineInventory(input.work_id, input.session_id, input.ai_client_id);
    result = { inventory: rows, count: rows.length, locality: "LOCAL", discovery_grants_authority: false };
  } else if (input.capability === "local.inventory.get") {
    result = { inventory: listPersistedInventory(), applications: listApplicationInventory(input.ai_client_id, input.session_id), locality: "LOCAL" };
  } else if (input.capability === "local.capability.route") {
    const ranked = resolveCapabilityBindings({
      action: String(input.input.action ?? "READ") as never,
      required_locality: (input.input.required_locality === "LOCAL" || input.input.required_locality === "REMOTE" || input.input.required_locality === "ANY") ? input.input.required_locality : "ANY",
      ai_identity: input.ai_client_id,
      session_id: input.session_id,
      work_id: input.work_id,
    });
    result = { bindings: ranked, autonomous_execution: false, locality: "LOCAL" };
  } else if (input.capability === "local.remote.github.read_identity") {
    const bind = evaluateOwnerCapabilityBinding({
      ai_identity: input.ai_client_id,
      session_id: input.session_id,
      binding_id: "service://github/source-authority",
      action: "READ",
      remote: true,
    });
    if (bind.decision !== "ALLOW") {
      emitLocalResourceEvent("CAPABILITY_BLOCKED", input.work_id, bind.reason_code, execution_id, {
        ...actionCtx, authority_decision: bind.decision, result_status: "DENIED",
      });
      return deny(bind.reason_code, bind.decision === "OWNER_APPROVAL_REQUIRED" ? "OWNER_APPROVAL_REQUIRED" : "DENY");
    }
    const identity = await readGithubIdentity();
    result = identity;
  } else {
    return deny("UNKNOWN_CAPABILITY");
  }

  emitLocalResourceEvent("AI_RESULT_RECEIVED", input.work_id, input.capability, execution_id);
  const routed = decideLocalFirst(input.capability, sourceBytes);
  return finish(input, authority, result, {
    execution_id,
    started_at,
    authority_decision: "ALLOW",
    result_status: "COMPLETED",
    execution_locality: routed.locality,
    files_read_count,
    files_written_count,
  }, routed.egress_policy === "DENIED" ? "LOCAL_ONLY" : routed.egress_policy, sourceBytes);
}

export function getLocalExecutionStatus(work_id: string, execution_id?: string): Record<string, unknown> {
  if (execution_id) {
    const row = getLocalExecution(execution_id);
    return row ? { ...row } : { found: false };
  }
  const rows = listLocalExecutions(work_id);
  return { work_id, latest: rows[rows.length - 1] ?? null, count: rows.length };
}

export function getLocalExecutionEvidence(work_id: string, execution_id?: string): Record<string, unknown> {
  const rows = listLocalExecutions(work_id).filter((row) => !execution_id || row.execution_id === execution_id);
  return { source: "DNA_OS_RUNTIME", envelope: "DNA_OS_LOCAL_EXECUTION", work_id, executions: rows };
}

export function capabilitiesPublicView(): readonly Record<string, unknown>[] {
  return listLocalCapabilities().map((row) => ({
    capability: row.capability,
    required_authority: row.required_authority,
    allowed_resource_types: row.allowed_resource_types,
    execution_classification: row.execution_classification,
    possible_network_egress: row.possible_network_egress,
    evidence_produced: row.evidence_produced,
    input_schema: row.input_schema,
    output_schema: row.output_schema,
  }));
}

export { listRegisteredJobs };
