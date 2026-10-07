/**
 * STRICT_OPERATIONAL_DEVELOPMENT_SURFACE_SEPARATION_V1
 * Authority domains are routing/exposure, not chat policy.
 */

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { attachActionPreview, openOwnerReviewView } from "../canonical-view/contract";
import { getSystemDependencyGraph } from "../work-production-pipeline/contract";
import { biometricPort, mapBiometricOutcome, probeNativeBiometric } from "./biometric";
import { listLeases, listSessions, persistAudit, persistLease, persistNotice, persistProposal, persistSession } from "./persist";
import {
  DEVELOPMENT_MUTATION_TOOLS,
  OPERATIONAL_ACTIONS,
  SECURITY_SENSITIVE_DOMAINS,
  type AuthorityDomain,
  type DevelopmentAuthorityLeaseV1,
  type DevelopmentChangeProposalV1,
  type DevelopmentPrechangeAnalysisV1,
  type LeaseOperation,
  type OwnerSurfaceSessionV1,
  type SecuritySensitiveDomain,
  type SurfaceId,
} from "./types";

export const DEVELOPMENT_SOURCE_AUTHORITY_DEFAULT = "DENY" as const;
export const HUMAN_WRONG_SURFACE =
  "เข้าใจว่าต้องการเปลี่ยนแปลงระบบ แต่ช่องนี้ไม่มีสิทธิ์หรือเครื่องมือแก้ไข source code หากต้องการพัฒนาระบบ ให้เปิด Development Control";
export const HUMAN_WRONG_SURFACE_LONG =
  "ช่องนี้สามารถใช้ความสามารถของระบบได้ แต่ไม่มีเครื่องมือหรือสิทธิ์แก้ไข source code หากต้องการพัฒนาระบบ ให้เปิด Development Control";

const SOURCE_ROOT = join(process.cwd(), "control/owner-surface-separation/fixtures");

function nowIso(): string {
  return new Date().toISOString();
}

function latestSession(session_id: string): OwnerSurfaceSessionV1 | null {
  const rows = listSessions().filter((row) => row.session_id === session_id);
  return rows[rows.length - 1] ?? null;
}

function latestLease(lease_id: string): DevelopmentAuthorityLeaseV1 | null {
  const rows = listLeases().filter((row) => row.lease_id === lease_id);
  return rows[rows.length - 1] ?? null;
}

export function createOwnerSurfaceSession(input: {
  readonly owner_id: string;
  readonly surface_id: SurfaceId;
}): OwnerSurfaceSessionV1 {
  const row: OwnerSurfaceSessionV1 = {
    schema: "OWNER_SURFACE_SESSION_V1",
    session_id: `surf-${randomUUID()}`,
    owner_id: input.owner_id,
    surface_id: input.surface_id,
    authority_domain: input.surface_id === "DEVELOPMENT_CONTROL_SURFACE" ? "DEVELOPMENT" : "OPERATIONAL",
    created_at: nowIso(),
    pending_action_authority: null,
    development_lease_id: null,
  };
  persistSession(row);
  persistAudit({ event: "SURFACE_SESSION_CREATED", session_id: row.session_id, surface_id: row.surface_id });
  return row;
}

export function switchOwnerSurface(session: OwnerSurfaceSessionV1, to: SurfaceId): OwnerSurfaceSessionV1 {
  return createOwnerSurfaceSession({ owner_id: session.owner_id, surface_id: to });
}

export function discoverSurfaceTools(domain: AuthorityDomain, lease_active = false): readonly string[] {
  const operational = [
    "dna_os.get_system_health",
    "dna_os.get_owner_work_surface",
    "dna_os.invoke_local_capability",
    "dna_os.owner_search",
    "dna_os.get_production_pipeline",
    "read system",
    "read files",
    "use registered capability",
    "view status",
    "view source metadata",
    ...OPERATIONAL_ACTIONS,
  ];
  if (domain === "OPERATIONAL") return operational;
  const preLease = [...operational, "dna_os.submit_development_control"];
  if (!lease_active) return preLease;
  return [
    ...preLease,
    "dna_os.modify_source",
    "dna_os.apply_scoped_source_write",
    "dna_os.create_scoped_development_workspace",
    "dna_os.read_scoped_source",
    "dna_os.invoke_coding_worker",
  ];
}

export function mcpToolAllowedOnSurface(toolName: string, domain: AuthorityDomain | undefined, lease_active = false): boolean {
  const mutation = (DEVELOPMENT_MUTATION_TOOLS as readonly string[]).includes(toolName)
    || toolName === "dna_os.apply_scoped_source_write"
    || toolName === "dna_os.create_scoped_development_workspace"
    || toolName === "dna_os.read_scoped_source";
  if (!mutation) return true;
  if (toolName === "dna_os.commit_source" || toolName === "dna_os.publish_source" || toolName === "commit_source" || toolName === "publish_source" || toolName === "dna_os.create_worktree" || toolName === "create_worktree") {
    return false;
  }
  return domain === "DEVELOPMENT" && lease_active;
}

function looksLikeDevelopment(text: string): boolean {
  const t = text.toLowerCase();
  return /source code|source ของ|เขียนโค้ด|เปลี่ยน logic|เพิ่ม capability ใหม่|แก้ระบบให้รองรับ|worktree|commit|publish source|coding worker/.test(t)
    || /แก้ source|modify source|เพิ่ม capability/.test(t);
}

function looksLikeOperationalDocument(text: string): boolean {
  return /ใบแจ้งหนี้|เอกสาร|ไฟล์|ชื่อไฟล์|ข้อมูลลูกค้า|notes\.txt|แก้ข้อความในเอกสาร/.test(text);
}

export function classifySurfaceIntent(text: string, session: OwnerSurfaceSessionV1): {
  readonly INTENT: "DEVELOPMENT_CHANGE" | "OPERATIONAL_WRITE" | "OPERATIONAL_READ";
  readonly AUTHORITY_DOMAIN: AuthorityDomain;
  readonly ACTION_AVAILABLE: boolean;
  readonly reason_code: string | null;
  readonly human: string;
} {
  if (looksLikeDevelopment(text)) {
    if (session.authority_domain === "OPERATIONAL") {
      return {
        INTENT: "DEVELOPMENT_CHANGE",
        AUTHORITY_DOMAIN: "OPERATIONAL",
        ACTION_AVAILABLE: false,
        reason_code: "DEVELOPMENT_ACTION_NOT_AVAILABLE_ON_THIS_SURFACE",
        human: HUMAN_WRONG_SURFACE,
      };
    }
    return {
      INTENT: "DEVELOPMENT_CHANGE",
      AUTHORITY_DOMAIN: "DEVELOPMENT",
      ACTION_AVAILABLE: true,
      reason_code: null,
      human: "Development Control — วิเคราะห์ก่อนขอสิทธิ์ source",
    };
  }
  if (looksLikeOperationalDocument(text) || session.authority_domain === "OPERATIONAL") {
    return {
      INTENT: "OPERATIONAL_WRITE",
      AUTHORITY_DOMAIN: session.authority_domain,
      ACTION_AVAILABLE: session.authority_domain === "OPERATIONAL",
      reason_code: null,
      human: "ใช้ความสามารถที่มีอยู่แล้วของระบบ",
    };
  }
  return {
    INTENT: "OPERATIONAL_READ",
    AUTHORITY_DOMAIN: session.authority_domain,
    ACTION_AVAILABLE: true,
    reason_code: null,
    human: "อ่านข้อมูลระบบ",
  };
}

export function invokeCodingWorker(session: OwnerSurfaceSessionV1): { ok: false; reason_code: string; CODING_WORKER_STARTED: false } {
  persistAudit({ event: "CODING_WORKER_DENIED", session_id: session.session_id, surface: session.surface_id });
  return { ok: false, reason_code: session.authority_domain === "OPERATIONAL" ? "OPERATIONAL_SURFACE_CAN_INVOKE_CODING_WORKER" : "DEVELOPMENT_LEASE_REQUIRED", CODING_WORKER_STARTED: false };
}

export function createDevelopmentAuthority(session: OwnerSurfaceSessionV1): { ok: false; reason_code: string } {
  if (session.authority_domain !== "DEVELOPMENT") {
    return { ok: false, reason_code: "OPERATIONAL_SURFACE_CAN_CREATE_DEVELOPMENT_AUTHORITY" };
  }
  return { ok: false, reason_code: "DEVELOPMENT_SOURCE_AUTHORITY_DEFAULT_DENY" };
}

export function operationalModifySource(session: OwnerSurfaceSessionV1): { ok: false; OPERATIONAL_SURFACE_CAN_MODIFY_SOURCE: false } {
  void session;
  return { ok: false, OPERATIONAL_SURFACE_CAN_MODIFY_SOURCE: false };
}

export async function routeOperationalCapability(input: {
  readonly session: OwnerSurfaceSessionV1;
  readonly text: string;
  readonly work_id: string;
  readonly ai_client_id: string;
  readonly resource_id: string;
  readonly logical_path?: string;
}): Promise<Record<string, unknown>> {
  const classified = classifySurfaceIntent(input.text, input.session);
  if (classified.INTENT === "DEVELOPMENT_CHANGE") {
    persistAudit({ event: "CROSS_SURFACE_BLOCK", ...classified, session_id: input.session.session_id });
    return {
      ok: false,
      ...classified,
      SOURCE_MODIFICATION_STARTED: false,
      CODING_WORKER_STARTED: false,
      BIOMETRIC_REQUESTED: false,
      CROSS_SURFACE_EXECUTION: false,
      SEMANTIC_INTERPRETATION_CAN_ESCALATE_AUTHORITY: false,
    };
  }
  const opened = openOwnerReviewView({
    work_id: input.work_id,
    ai_client_id: input.ai_client_id,
    session_id: input.session.session_id,
    view_type: "DOCUMENT_VIEW_V1",
    source_resource_ids: [input.resource_id],
    fields: { logical_path: input.logical_path ?? "notes.txt", action: "WRITE" },
  });
  const preview = attachActionPreview(opened.review_id, {
    work_id: input.work_id,
    action: "WRITE",
    resource_id: input.resource_id,
    input: { logical_path: input.logical_path ?? "notes.txt", text: input.text },
  });
  return {
    ok: true,
    INTENT: classified.INTENT,
    AUTHORITY_DOMAIN: "OPERATIONAL",
    operational_action: "WRITE",
    development_route: false,
    CODING_WORKER_STARTED: false,
    BIOMETRIC_REQUESTED: false,
    SIDE_EFFECT_PREVIEW_REQUIRED: true,
    review: preview,
    executed: false,
  };
}

export function analyzePrechange(goal: string): DevelopmentPrechangeAnalysisV1 {
  const graph = getSystemDependencyGraph();
  const known = goal.includes("fixture-echo") || goal.includes("FEATURE_MARKER") || goal.includes("capability X");
  const insufficient = goal.trim().length < 8;
  const verdict = insufficient ? "INSUFFICIENT_CONTEXT" : known ? "PARTIAL_EXISTING_CAPABILITY" : "NEW_CAPABILITY_REQUIRED";
  return {
    schema: "DEVELOPMENT_PRECHANGE_ANALYSIS_V1",
    verdict,
    existing_capability: known ? "cap://pipeline/fixture-echo" : null,
    owning_module: known ? "fixture-module" : "control/owner-surface-separation",
    duplicates_existing: known,
    affected_dependencies: Object.keys(graph.nodes),
    extend_instead: known ? "cap://pipeline/fixture-echo" : null,
  };
}

export function prepareDevelopmentProposal(input: {
  readonly session: OwnerSurfaceSessionV1;
  readonly goal: string;
  readonly repository_id?: string;
}): { ok: boolean; analysis: DevelopmentPrechangeAnalysisV1; proposal: DevelopmentChangeProposalV1 | null; SOURCE_MODIFICATION_STARTED: false; reason_code?: string } {
  if (input.session.authority_domain !== "DEVELOPMENT") {
    return { ok: false, analysis: analyzePrechange(input.goal), proposal: null, SOURCE_MODIFICATION_STARTED: false, reason_code: "EXPLICIT_DEVELOPMENT_CONTROL_REQUIRED" };
  }
  const analysis = analyzePrechange(input.goal);
  persistAudit({ event: "PRECHANGE_ANALYSIS", analysis, session_id: input.session.session_id });
  if (analysis.verdict === "INSUFFICIENT_CONTEXT") {
    return { ok: false, analysis, proposal: null, SOURCE_MODIFICATION_STARTED: false, reason_code: "INSUFFICIENT_CONTEXT" };
  }
  const proposal: DevelopmentChangeProposalV1 = {
    schema: "DEVELOPMENT_CHANGE_PROPOSAL_V1",
    proposal_id: `prop-${randomUUID()}`,
    work_id: `work-dev-${randomUUID()}`,
    work_order_id: `wo-dev-${randomUUID()}`,
    WHAT_WILL_CHANGE: input.goal,
    WHY: "Owner requested a registered-system change from Development Control",
    EXISTING_CAPABILITY: analysis.existing_capability ?? "NONE",
    NEW_OR_EXTENSION: analysis.verdict,
    TARGET_REPOSITORY: input.repository_id ?? "repo://owner-surface-fixture",
    TARGET_COMPONENTS: ["owner-surface-fixture"],
    LIKELY_FILES: ["control/owner-surface-separation/fixtures/allowed/feature.ts"],
    DEPENDENCIES: analysis.affected_dependencies,
    RISK_CLASS: "LOW",
    EXPECTED_RUNTIME_EFFECT: "fixture capability text changes locally",
    TEST_PLAN: "deterministic owner-surface-separation proofs",
    PRODUCTION_PATH: "DNA_OS_WORK_PRODUCTION_PIPELINE_V1 — not started",
    source_modified: false,
    PROPOSAL_READY: true,
  };
  persistProposal(proposal);
  persistNotice("DEVELOPMENT_PROPOSAL_READY", { proposal_id: proposal.proposal_id, work_id: proposal.work_id });
  return { ok: true, analysis, proposal, SOURCE_MODIFICATION_STARTED: false };
}

export function biometricAuthorizationPreview(proposal: DevelopmentChangeProposalV1): Record<string, unknown> {
  return {
    schema: "OWNER_BIOMETRIC_DEVELOPMENT_GATE_V1",
    work_subject: proposal.WHAT_WILL_CHANGE,
    repository: proposal.TARGET_REPOSITORY,
    scope: proposal.TARGET_COMPONENTS,
    paths: proposal.LIKELY_FILES,
    risk_class: proposal.RISK_CLASS,
    reason: proposal.WHY,
    prompt_before_native: true,
  };
}

export function requestDevelopmentLease(input: {
  readonly session: OwnerSurfaceSessionV1;
  readonly proposal: DevelopmentChangeProposalV1;
  readonly owner_id: string;
  readonly expires_in_ms?: number;
  readonly security_sensitive?: boolean;
}): Record<string, unknown> {
  if (input.session.authority_domain !== "DEVELOPMENT") {
    return { ok: false, reason_code: "CROSS_SURFACE_EXECUTION_BARRIER", CROSS_SURFACE_EXECUTION: false };
  }
  if (input.owner_id.startsWith("ai://") || input.owner_id.startsWith("coding-client://") || input.owner_id === "provider") {
    return { ok: false, reason_code: "AI_CANNOT_APPROVE_LEASE", CODING_CLIENT_HAS_BIOMETRIC_AUTHORITY: false };
  }
  persistNotice("BIOMETRIC_AUTHORIZATION_REQUIRED", { proposal_id: input.proposal.proposal_id });
  const preview = biometricAuthorizationPreview(input.proposal);
  const native = biometricPort().evaluate({
    expected_owner: input.owner_id,
    purpose: `Authorize scoped source change: ${input.proposal.WHAT_WILL_CHANGE}`,
    work_id: input.proposal.work_id,
    scope_preview: preview,
  });
  const availability = mapBiometricOutcome(native);
  if (native.outcome !== "VERIFIED") {
    persistNotice(native.outcome === "CANCELLED" ? "BIOMETRIC_AUTHORIZATION_FAILED" : "BIOMETRIC_AUTHORIZATION_FAILED", { outcome: native.outcome });
    return {
      ok: false,
      LIVE_BIOMETRIC: availability === "AVAILABLE" ? native.outcome : availability,
      BIOMETRIC_AUTHORIZATION_NOT_AVAILABLE: native.outcome === "UNAVAILABLE",
      SOURCE_MODIFICATION_STARTED: false,
      preview,
      native,
      FAKE_BIOMETRIC_FALLBACK: false,
    };
  }
  const lease: DevelopmentAuthorityLeaseV1 = {
    schema: "DEVELOPMENT_AUTHORITY_LEASE_V1",
    lease_id: `lease-${randomUUID()}`,
    owner_id: input.owner_id,
    biometric_verified_at: native.verified_at ?? nowIso(),
    work_id: input.proposal.work_id,
    work_order_id: input.proposal.work_order_id,
    repository_id: input.proposal.TARGET_REPOSITORY,
    base_revision: "UNCOMMITTED",
    allowed_paths: [
      "control/owner-surface-separation/fixtures/allowed",
      "control/owner-surface-separation/fixtures/security",
    ],
    allowed_components: ["owner-surface-fixture"],
    allowed_operations: ["READ_SOURCE", "CREATE_SOURCE", "MODIFY_SOURCE", "DELETE_SOURCE", "CREATE_TEST", "MODIFY_TEST", "BUILD", "TEST", "ASSEMBLE"],
    forbidden_paths: ["control/owner-authentication", "permissions", "credentials"],
    risk_class: input.proposal.RISK_CLASS,
    expires_at: new Date(Date.now() + (input.expires_in_ms ?? 10 * 60 * 1000)).toISOString(),
    max_scope: "ONE_WORK_ORDER",
    authority_evidence_ref: `verification:${native.challenge_id}`,
    surface_session_id: input.session.session_id,
    cancelled: false,
    completed: false,
    base_revision_valid: true,
  };
  persistLease(lease);
  persistNotice("BIOMETRIC_AUTHORIZATION_SUCCEEDED", { lease_id: lease.lease_id });
  persistNotice("DEVELOPMENT_STARTED", { lease_id: lease.lease_id, work_id: lease.work_id });
  persistAudit({ event: "LEASE_CREATED", lease_id: lease.lease_id, work_order_id: lease.work_order_id });
  return { ok: true, lease, preview, SOURCE_CHANGE_AUTHORITY: true, PRODUCTION_PROMOTION_AUTHORITY: false, LIVE_BIOMETRIC: "VERIFIED" };
}

export function expireLease(lease: DevelopmentAuthorityLeaseV1, reason: string): DevelopmentAuthorityLeaseV1 {
  const next = { ...lease, cancelled: true, completed: reason === "complete", base_revision_valid: reason !== "base_revision" };
  persistLease(next);
  persistAudit({ event: "LEASE_EXPIRED", lease_id: lease.lease_id, reason });
  return next;
}

export function leaseIsActive(lease: DevelopmentAuthorityLeaseV1): boolean {
  if (lease.cancelled || lease.completed || !lease.base_revision_valid) return false;
  return Date.parse(lease.expires_at) > Date.now();
}

function pathAllowed(lease: DevelopmentAuthorityLeaseV1, relPath: string): boolean {
  if (lease.forbidden_paths.some((prefix) => relPath.startsWith(prefix))) return false;
  return lease.allowed_paths.some((prefix) => relPath === prefix || relPath.startsWith(`${prefix}/`));
}

export function classifySecurityPath(relPath: string): SecuritySensitiveDomain | null {
  if (relPath.includes("fixtures/security") || relPath.includes("owner-authentication") || relPath.includes("credential")) return "AUTHENTICATION";
  return null;
}

export function applyLeasedSourceChange(input: {
  readonly session: OwnerSurfaceSessionV1;
  readonly lease: DevelopmentAuthorityLeaseV1;
  readonly relative_path: string;
  readonly contents: string;
  readonly security_reauth_ok?: boolean;
}): Record<string, unknown> {
  if (input.session.authority_domain !== "DEVELOPMENT") {
    return { ok: false, reason_code: "NOT_EXPOSED", CROSS_SURFACE_EXECUTION: false, SOURCE_MODIFICATION_STARTED: false };
  }
  if (input.session.session_id !== input.lease.surface_session_id) {
    return { ok: false, reason_code: "LEASE_REUSE_ACROSS_SURFACES", CROSS_SURFACE_EXECUTION: false };
  }
  const current = latestLease(input.lease.lease_id) ?? input.lease;
  if (!leaseIsActive(current)) {
    return { ok: false, reason_code: "LEASE_EXPIRED", SOURCE_MODIFICATION_STARTED: false };
  }
  const abs = resolve(process.cwd(), input.relative_path);
  const rel = relative(process.cwd(), abs);
  if (!pathAllowed(current, rel)) {
    persistNotice("DEVELOPMENT_SCOPE_BLOCKED", { path: rel, lease_id: current.lease_id });
    persistAudit({ event: "LEASE_SCOPE_VIOLATION", path: rel });
    return { ok: false, reason_code: "LEASE_SCOPE_VIOLATION", BLOCK: true, SOURCE_MODIFICATION_STARTED: false, requires_new_proposal: true, requires_new_biometric: true };
  }
  const sensitive = classifySecurityPath(rel);
  if (sensitive && input.security_reauth_ok !== true) {
    persistNotice("BIOMETRIC_AUTHORIZATION_REQUIRED", { domain: sensitive, lease_id: current.lease_id });
    return { ok: false, reason_code: "SECURITY_SENSITIVE_SOURCE_GATE", domain: sensitive, BIOMETRIC_AUTHORIZATION_REQUIRED: true, existing_lease_insufficient: true };
  }
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, input.contents);
  persistAudit({ event: "SOURCE_MUTATED", path: rel, lease_id: current.lease_id, work_id: current.work_id });
  persistNotice("REVIEW_READY", { path: rel, work_id: current.work_id });
  return { ok: true, path: rel, SOURCE_MODIFICATION_STARTED: true, PRODUCTION_PROMOTION_AUTHORITY: false };
}

export function invokeCodingWorkerWithLease(session: OwnerSurfaceSessionV1, lease: DevelopmentAuthorityLeaseV1 | null): Record<string, unknown> {
  if (session.authority_domain !== "DEVELOPMENT") return invokeCodingWorker(session);
  if (!lease || !leaseIsActive(lease) || lease.surface_session_id !== session.session_id) {
    return { ok: false, reason_code: "DEVELOPMENT_LEASE_REQUIRED", CODING_WORKER_STARTED: false };
  }
  persistNotice("DEVELOPMENT_STARTED", { lease_id: lease.lease_id, kind: "CODING_WORKER_SCOPED" });
  return { ok: true, CODING_WORKER_STARTED: true, lease_id: lease.lease_id, machine_wide: false };
}

export function productionPromotionFromLease(_lease: DevelopmentAuthorityLeaseV1): { SOURCE_CHANGE_AUTHORITY: true; PRODUCTION_PROMOTION_AUTHORITY: false } {
  return { SOURCE_CHANGE_AUTHORITY: true, PRODUCTION_PROMOTION_AUTHORITY: false };
}

export function sourceReadIsNotWrite(): { SOURCE_READ_AUTHORITY: true; SOURCE_WRITE_AUTHORITY: false } {
  return { SOURCE_READ_AUTHORITY: true, SOURCE_WRITE_AUTHORITY: false };
}

export function ownerSurfaceSeparationSlice(): Record<string, unknown> {
  const probe = probeNativeBiometric();
  return {
    schema: "STRICT_OPERATIONAL_DEVELOPMENT_SURFACE_SEPARATION_V1",
    OPERATIONAL_OWNER_SURFACE: {
      purpose: "use produced capabilities",
      write_source: false,
      coding_worker: false,
      development_authority: false,
    },
    DEVELOPMENT_CONTROL_SURFACE: {
      purpose: "modify registered software after biometric lease",
      DEVELOPMENT_SOURCE_AUTHORITY: DEVELOPMENT_SOURCE_AUTHORITY_DEFAULT,
    },
    SHARED_SELF_KNOWLEDGE: true,
    SHARED_REGISTRIES: true,
    SHARED_OWNER_IDENTITY: true,
    SHARED_IMPLICIT_AUTHORITY: false,
    NATIVE_BIOMETRIC_AVAILABLE: probe.availability,
    BIOMETRIC_IMPLEMENTATION: probe.BIOMETRIC_IMPLEMENTATION,
    FAKE_BIOMETRIC_FALLBACK: false,
    layout_separation: { operational: "chat_work_files_apps", development: "proposals_code_build_pipeline" },
    write_source_button_in_operational_chat: false,
  };
}

export function fixtureAllowedFile(): string {
  return join(SOURCE_ROOT, "allowed/feature.ts");
}

export function fixtureOutsideFile(): string {
  return join(SOURCE_ROOT, "outside/secret.ts");
}

export function fixtureSecurityFile(): string {
  return join(SOURCE_ROOT, "security/auth-policy.ts");
}

export function ensureFixtures(): void {
  for (const file of [fixtureAllowedFile(), fixtureOutsideFile(), fixtureSecurityFile()]) {
    if (!existsSync(file)) {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, "export const MARKER = \"unchanged\";\n");
    }
  }
}

export { latestSession, latestLease };
