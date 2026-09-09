/**
 * AI_QUEEN_DNA_OS_CAPABILITY_CONSUMER_V1
 * AI Queen is a registered local MCP client, not trusted core.
 */

import { canInvoke, discoverableTools, type CallerContext } from "../../connections/dna-os-mcp/export-policy";
import { filterMcpTools } from "../mcp-code-knowledge/contract";
import { listActiveWork } from "../owner-notification/contract";
import {
  CIRCUIT_TARGET_ID,
  closeRegisteredWork,
  describeOwnerEnablementState,
  executeRailwayDeployRevision,
  extendedOwnerWorkNotificationSummary,
  getRealProductionLineage,
  ownerProductionReadinessSummary,
} from "../production-checkpoint/contract";
import {
  AI_QUEEN_CLIENT_ID,
  AI_QUEEN_DEFAULT_TOOLS,
  EXTERNAL_PARITY_CLIENT_ID,
  grantedToolsForAiClient,
  isRawRailwayMcpTool,
  RAW_RAILWAY_MCP_TOOLS,
} from "./ai-queen-grants";
import { enableUniversalClient, evaluateUniversalClient, getUniversalClient, registerUniversalClient } from "./clients";
import { nowIso } from "./host-runtime";
import type { UniversalClientV1 } from "./types";

export const AI_QUEEN_DNA_OS_CAPABILITY_CONSUMER = "AI_QUEEN_DNA_OS_CAPABILITY_CONSUMER_V1" as const;
export const AI_QUEEN_CLIENT = "AI_QUEEN_CLIENT_V1" as const;
export const OWNER_AI_QUEEN_PROFILE = "OWNER_AI_QUEEN_PROFILE_V1" as const;
export const AI_QUEEN_WORK_ASSISTANT = "AI_QUEEN_WORK_ASSISTANT_V1" as const;

export {
  AI_QUEEN_CLIENT_ID,
  AI_QUEEN_DEFAULT_TOOLS,
  EXTERNAL_PARITY_CLIENT_ID,
  RAW_RAILWAY_MCP_TOOLS,
  grantedToolsForAiClient,
  isRawRailwayMcpTool,
};

export interface AiQueenClientV1 {
  readonly schema: typeof AI_QUEEN_CLIENT;
  readonly client_id: typeof AI_QUEEN_CLIENT_ID;
  readonly client_type: "AI_LOCAL_ASSISTANT";
  readonly runtime_location: "LOCAL_MACHINE";
  readonly provider_model_identity: "local-ai-queen";
  readonly surface: "OPERATIONAL_OWNER_SURFACE";
  readonly owner_enabled: boolean;
  readonly allowed_resources: readonly string[];
  readonly allowed_tools: readonly string[];
  readonly data_egress_policy: "LOCAL_ONLY_DEFAULT";
  readonly authority_domain: "OPERATIONAL";
  readonly health: "AVAILABLE" | "DISCONNECTED";
  readonly last_seen_at: string;
  readonly LOCAL_RUNTIME_GRANTS_AUTHORITY: false;
  readonly LOCAL_MODEL_GRANTS_AUTHORITY: false;
  readonly AI_QUEEN_SPECIAL_ROOT_AUTHORITY: false;
  readonly PROVIDER_IDENTITY_GRANTS_AUTHORITY: false;
}

export function ownerAiQueenProfile(): {
  readonly schema: typeof OWNER_AI_QUEEN_PROFILE;
  readonly allowed_tools: readonly string[];
  readonly development_mutation_default: false;
  readonly LOCAL_PRIVACY_PREFERENCE: "LOCAL_PRIVATE_DOCUMENT_SUMMARY";
  readonly LOCAL_PRIVACY_PREFERENCE_IS_AUTHORITY: false;
  readonly CANONICAL_FACT_FIRST: true;
  readonly LOCAL_INDEX_FIRST: true;
  readonly REGISTERED_TOOL_FIRST: true;
} {
  return {
    schema: OWNER_AI_QUEEN_PROFILE,
    allowed_tools: AI_QUEEN_DEFAULT_TOOLS,
    development_mutation_default: false,
    LOCAL_PRIVACY_PREFERENCE: "LOCAL_PRIVATE_DOCUMENT_SUMMARY",
    LOCAL_PRIVACY_PREFERENCE_IS_AUTHORITY: false,
    CANONICAL_FACT_FIRST: true,
    LOCAL_INDEX_FIRST: true,
    REGISTERED_TOOL_FIRST: true,
  };
}

export function registerAiQueenClient(): AiQueenClientV1 {
  const existing = getUniversalClient(AI_QUEEN_CLIENT_ID);
  if (!existing) {
    registerUniversalClient({
      client_id: AI_QUEEN_CLIENT_ID,
      client_family: "AI_LOCAL_ASSISTANT",
      provider: "local-ai-queen",
      runtime_type: "LOCAL_MACHINE",
      session_work_scope: "operational-owner",
      capabilities_declared: AI_QUEEN_DEFAULT_TOOLS,
    });
  }
  const evald = evaluateUniversalClient(AI_QUEEN_CLIENT_ID);
  return {
    schema: AI_QUEEN_CLIENT,
    client_id: AI_QUEEN_CLIENT_ID,
    client_type: "AI_LOCAL_ASSISTANT",
    runtime_location: "LOCAL_MACHINE",
    provider_model_identity: "local-ai-queen",
    surface: "OPERATIONAL_OWNER_SURFACE",
    owner_enabled: evald.owner_enabled,
    allowed_resources: ["resource://dna-os/work", "resource://dna-os/production", "resource://dna-os/activity", "resource://local/files"],
    allowed_tools: AI_QUEEN_DEFAULT_TOOLS,
    data_egress_policy: "LOCAL_ONLY_DEFAULT",
    authority_domain: "OPERATIONAL",
    health: evald.client?.availability === "DISCONNECTED" ? "DISCONNECTED" : "AVAILABLE",
    last_seen_at: nowIso(),
    LOCAL_RUNTIME_GRANTS_AUTHORITY: false,
    LOCAL_MODEL_GRANTS_AUTHORITY: false,
    AI_QUEEN_SPECIAL_ROOT_AUTHORITY: false,
    PROVIDER_IDENTITY_GRANTS_AUTHORITY: false,
  };
}

export function registerExternalParityClient(): UniversalClientV1 {
  const existing = getUniversalClient(EXTERNAL_PARITY_CLIENT_ID);
  if (existing) return existing;
  return registerUniversalClient({
    client_id: EXTERNAL_PARITY_CLIENT_ID,
    client_family: "AI_CHAT_CLIENT",
    provider: "openai",
    runtime_type: "REMOTE_SERVICE",
    session_work_scope: "operational-owner",
    capabilities_declared: AI_QUEEN_DEFAULT_TOOLS,
  });
}

export function enableAiQueenAsOwnerClient(): UniversalClientV1 | { ok: false; reason_code: string } {
  registerAiQueenClient();
  return enableUniversalClient(AI_QUEEN_CLIENT_ID, {
    data_access_scope: ["canonical-read", "work-read", "notification-read"],
    action_scope: ["REQUEST_REGISTERED_ACTION"],
  });
}

export function queenCaller(domain: "OPERATIONAL" | "DEVELOPMENT" = "OPERATIONAL", lease_active = false): CallerContext {
  return {
    caller: AI_QUEEN_CLIENT_ID,
    caller_class: "UNAUTHENTICATED",
    channel: "EXTERNAL",
    authority_domain: domain,
    lease_active,
    client_id: AI_QUEEN_CLIENT_ID,
    surface_id: domain === "DEVELOPMENT" ? "DEVELOPMENT_CONTROL_SURFACE" : "OPERATIONAL_OWNER_SURFACE",
  };
}

export function externalParityCaller(domain: "OPERATIONAL" | "DEVELOPMENT" = "OPERATIONAL"): CallerContext {
  return {
    caller: EXTERNAL_PARITY_CLIENT_ID,
    caller_class: "UNAUTHENTICATED",
    channel: "EXTERNAL",
    authority_domain: domain,
    lease_active: false,
    client_id: EXTERNAL_PARITY_CLIENT_ID,
    granted_tools: AI_QUEEN_DEFAULT_TOOLS,
    surface_id: "OPERATIONAL_OWNER_SURFACE",
  };
}

export function toolsVisibleToAiQueen(domain: "OPERATIONAL" | "DEVELOPMENT" = "OPERATIONAL", lease_active = false): readonly string[] {
  const grants = grantedToolsForAiClient({ client_id: AI_QUEEN_CLIENT_ID, authority_domain: domain, lease_active }) ?? AI_QUEEN_DEFAULT_TOOLS;
  const surface = filterMcpTools({ authority_domain: domain, lease_active, tool_names: grants }).AVAILABLE_TOOLS;
  const visible = surface.filter((name) => !isRawRailwayMcpTool(name));
  return discoverableTools(visible, queenCaller(domain, lease_active));
}

export function aiQueenAttemptDirect(tool_name: string, domain: "OPERATIONAL" | "DEVELOPMENT" = "OPERATIONAL"): {
  readonly allowed: boolean;
  readonly reason_code: string;
  readonly AI_QUEEN_DIRECT_SOURCE_WRITE: false;
  readonly AI_QUEEN_DIRECT_CANONICAL_COMMIT: false;
  readonly AI_QUEEN_DIRECT_GITHUB_PUSH: false;
  readonly AI_QUEEN_DIRECT_DEPLOY: false;
} {
  const invoke = canInvoke(tool_name, queenCaller(domain, false));
  const visible = toolsVisibleToAiQueen(domain).includes(tool_name);
  return {
    allowed: invoke.allowed && visible,
    reason_code: visible ? invoke.reason_code : (isRawRailwayMcpTool(tool_name) ? "NOT_EXPOSED" : "NOT_EXPOSED"),
    AI_QUEEN_DIRECT_SOURCE_WRITE: false,
    AI_QUEEN_DIRECT_CANONICAL_COMMIT: false,
    AI_QUEEN_DIRECT_GITHUB_PUSH: false,
    AI_QUEEN_DIRECT_DEPLOY: false,
  };
}

export function aiQueenGrantSelfScope(): { ok: false; reason_code: "SCOPE_SELF_EXPANSION_DENIED"; AI_QUEEN_SPECIAL_ROOT_AUTHORITY: false } {
  return { ok: false, reason_code: "SCOPE_SELF_EXPANSION_DENIED", AI_QUEEN_SPECIAL_ROOT_AUTHORITY: false };
}

export function preferLocalQueenForPrivateSummary(): {
  readonly preferred_client: typeof AI_QUEEN_CLIENT_ID;
  readonly LOCAL_PRIVACY_PREFERENCE: "LOCAL_PRIVATE_DOCUMENT_SUMMARY";
  readonly LOCAL_PRIVACY_PREFERENCE_IS_AUTHORITY: false;
} {
  return {
    preferred_client: AI_QUEEN_CLIENT_ID,
    LOCAL_PRIVACY_PREFERENCE: "LOCAL_PRIVATE_DOCUMENT_SUMMARY",
    LOCAL_PRIVACY_PREFERENCE_IS_AUTHORITY: false,
  };
}

export async function aiQueenRequestRegisteredDeploy(): Promise<{
  readonly LIVE_REAL_DEPLOY: string;
  readonly AI_QUEEN_REQUEST_EQUALS_APPROVAL: false;
  readonly AI_QUEEN_REQUEST_EQUALS_AUTHORITY: false;
}> {
  const result = await executeRailwayDeployRevision({
    work_id: "work://queen-request",
    target_id: CIRCUIT_TARGET_ID,
    repository_id: "repo://dna-os-infrastructure",
    canonical_revision: "NOT_AVAILABLE",
    remote_revision: "NOT_AVAILABLE",
    requested_revision: "NOT_AVAILABLE",
    environment_id: "4d28eafa-9735-4405-a585-55ea354bafab",
    service_id: "4c04fb88-4711-4bd8-b42e-e25bb5ab909a",
    authority_ref: AI_QUEEN_CLIENT_ID,
    expected_current_deployment_revision: null,
    evidence_requirements: ["production-authority", "owner-enable"],
  });
  return {
    LIVE_REAL_DEPLOY: result.LIVE_REAL_DEPLOY,
    AI_QUEEN_REQUEST_EQUALS_APPROVAL: false,
    AI_QUEEN_REQUEST_EQUALS_AUTHORITY: false,
  };
}

export function answerOwnerWorkQuestion(question: string): {
  readonly schema: typeof AI_QUEEN_WORK_ASSISTANT;
  readonly source: "DNA_OS_MCP";
  readonly cursor_queried: false;
  readonly repo_rediscovery: false;
  readonly CANONICAL_FACT_FIRST: true;
  readonly question: string;
  readonly answer: string;
  readonly facts: Record<string, unknown>;
} {
  registerAiQueenClient();
  const q = question.trim();
  const active = listActiveWork();
  const summary = ownerProductionReadinessSummary();
  const closed = closeRegisteredWork({ includeDiskCatalog: true, catchup: false });
  const notify = extendedOwnerWorkNotificationSummary();
  const enablement = describeOwnerEnablementState();
  const lineage = getRealProductionLineage();
  let answer = "ไม่มีข้อมูล canonical ที่ใช้ตอบได้";
  const facts: Record<string, unknown> = { SOURCE_SEARCH_REQUIRED: false };
  if (/งานอะไรทำอยู่|active work|กำลังทำ/i.test(q)) {
    facts.active_work = active.map((row) => ({ work_id: row.work_id, subject: row.subject, status: row.status }));
    answer = active.length === 0
      ? "ตอนนี้ไม่มีงาน active ที่ DNA OS ลงทะเบียน"
      : `ตอนนี้มีงาน active ${active.length} รายการจาก DNA OS MCP`;
  } else if (/ค้าง|unfinished|waiting/i.test(q)) {
    facts.waiting_deployment_count = closed.counts.WAITING_FOR_DEPLOYMENT;
    facts.summary = summary;
    answer = `งานที่ค้างตาม DNA OS: WAITING_FOR_DEPLOYMENT=${String(closed.counts.WAITING_FOR_DEPLOYMENT)}`;
  } else if (/เสร็จแล้ว|completed/i.test(q)) {
    facts.completed = notify.completed_today_count;
    answer = `งานที่เสร็จตาม DNA OS: ${String(notify.completed_today_count)}`;
  } else if (/รายงานกี่|reports/i.test(q)) {
    facts.reports = notify.reports_created_count;
    answer = `มีรายงาน ${String(notify.reports_created_count)} งานตาม DNA OS`;
  } else if (/production พร้อม|พร้อมหรือยัง/i.test(q)) {
    facts.enablement = enablement;
    facts.lineage = lineage;
    facts.readiness = summary;
    answer = enablement.REMOTE_REAL_TARGET_OWNER_ENABLED
      ? "ต้องตรวจ runtime revision จากหลักฐาน DNA OS"
      : "Remote production ถูกลงทะเบียนแล้ว แต่ target ยังไม่ได้ Owner-enable และยังไม่มี runtime revision proof";
  } else if (/อนุมัติ|approve|attention/i.test(q)) {
    facts.attention = enablement.OWNER_ACTION_REQUIRED;
    answer = enablement.OWNER_ACTION_REQUIRED
      ? "มีสิ่งที่ต้องอนุมัติ: ENABLE_REMOTE_PRODUCTION_TARGET สำหรับ Railway production target"
      : "ไม่มี Owner approval ที่ DNA OS ระบุในขณะนี้";
  } else if (/connection|เชื่อม/i.test(q)) {
    facts.railway_target_enabled = enablement.REMOTE_REAL_TARGET_OWNER_ENABLED;
    answer = enablement.REMOTE_REAL_TARGET_OWNER_ENABLED
      ? "Railway target ถูก Owner-enable แล้ว"
      : "Railway production target is registered but not enabled.";
  }
  return {
    schema: AI_QUEEN_WORK_ASSISTANT,
    source: "DNA_OS_MCP",
    cursor_queried: false,
    repo_rediscovery: false,
    CANONICAL_FACT_FIRST: true,
    question: q,
    answer,
    facts,
  };
}

export function getAiQueenStatus(): Record<string, unknown> {
  const client = registerAiQueenClient();
  return {
    schema: AI_QUEEN_DNA_OS_CAPABILITY_CONSUMER,
    client,
    AI_QUEEN_USES_EXISTING_MCP: true,
    AI_QUEEN_TOOL_DISCOVERY_FILTERED: true,
    AI_QUEEN_SEES_ONLY_GRANTED_TOOLS: true,
    AI_QUEEN_REQUEST_EQUALS_APPROVAL: false,
    AI_QUEEN_REQUEST_EQUALS_AUTHORITY: false,
    LOCAL_RUNTIME_GRANTS_AUTHORITY: false,
    LOCAL_MODEL_GRANTS_AUTHORITY: false,
    AI_QUEEN_SPECIAL_ROOT_AUTHORITY: false,
    PROVIDER_IDENTITY_GRANTS_AUTHORITY: false,
  };
}

export function getAiQueenCapabilityProfile(): ReturnType<typeof ownerAiQueenProfile> & { visible_tools: readonly string[] } {
  return { ...ownerAiQueenProfile(), visible_tools: toolsVisibleToAiQueen("OPERATIONAL") };
}
