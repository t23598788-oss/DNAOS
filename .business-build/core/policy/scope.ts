/**
 * Tool Scope Policy — the ONE deny-by-default evaluator for "may this subject
 * perform this action on this resource right now?" (owner directive
 * 2026-09-26: AI/Cline/Amp/CLI/MCP/providers are REQUESTERS; only the owner
 * grants; texts from AI/documents are never approval).
 *
 * Layers: (1) identity — must name a real subject; (2) role ceiling — the
 * account's role comes from registry/permissions.json at request time (a
 * removed profile falls out immediately), ai_service may be a SUBJECT but
 * never a grantor — grants are created only via ADMIN_TIER routes
 * (granted_by = that session's account); (3) explicit grant — allow ONLY on a
 * live scoped_grants row matching subject+action+resource (+job, +not expired,
 * +not revoked). No grant = deny with a reason code.
 *
 * Enforcer placement (honest boundary): evaluated SERVER-side at command
 * create/ack; the installed runner keeps its own compiled executable
 * allowlist; grants DATA is writable only through owner-session admin routes —
 * an AI inside this repo has no runtime path to mint grants. This is NOT
 * whole-machine control (paths that bypass DNA OS entirely:
 * scripts/access-path-survey-test.ts).
 */
import permissions from "@/registry/permissions.json";

export type ScopeAction = "read" | "write" | "delete" | "run" | "install" | "send" | "secret";
export const SCOPE_ACTIONS: readonly ScopeAction[] = ["read", "write", "delete", "run", "install", "send", "secret"];

export interface ScopeSubject {
  account?: { id: string; role: string };
  deviceId?: string;
  toolId?: string;
}

export interface ScopeRequest {
  subject: ScopeSubject;
  action: ScopeAction;
  resource: string;
  jobId?: string;
  at?: Date;
}

export interface GrantRow {
  subject_type: "account" | "device" | "tool";
  subject_id: string;
  action: string;
  resource: string;
  job_id?: string | null;
  expires_at?: string | null;
  revoked_at?: string | null;
}

export type ScopeDecision =
  | { allow: true; reason: string; grant: GrantRow }
  | { allow: false; code: "NO_SUBJECT" | "ROLE_UNKNOWN" | "NO_GRANT" | "GRANT_EXPIRED" | "GRANT_REVOKED" | "JOB_MISMATCH" | "ACTION_UNKNOWN"; reason: string };

const ANY_AUTHENTICATED = permissions.role_tiers.any_authenticated as string[];

/** Resource match: exact, grant prefix ending '*', or grant prefix ending '/'. */
function resourceMatches(grantResource: string, resource: string): boolean {
  if (grantResource === resource || grantResource === "*") return true;
  if (grantResource.endsWith("*")) return resource.startsWith(grantResource.slice(0, -1));
  if (grantResource.endsWith("/")) return resource.startsWith(grantResource);
  return false;
}

function subjectMatches(grant: GrantRow, subject: ScopeSubject): boolean {
  if (grant.subject_type === "account") return subject.account?.id === grant.subject_id;
  if (grant.subject_type === "device") return subject.deviceId === grant.subject_id;
  if (grant.subject_type === "tool") return subject.toolId === grant.subject_id;
  return false;
}

/** Deny-by-default evaluation over the live grant rows (DB reads happen in routes). */
export function evaluateScope(req: ScopeRequest, grants: GrantRow[], now: Date = new Date()): ScopeDecision {
  const hasIdentity = Boolean(req.subject.account || req.subject.deviceId || req.subject.toolId);
  if (!hasIdentity) return { allow: false, code: "NO_SUBJECT", reason: "ไม่มี subject ที่ระบุตัวตนได้ (account/device/tool)" };
  if (!(SCOPE_ACTIONS as readonly string[]).includes(req.action)) {
    return { allow: false, code: "ACTION_UNKNOWN", reason: `action ไม่อยู่ในชุดที่รู้จัก: ${req.action}` };
  }
  if (req.subject.account && !ANY_AUTHENTICATED.includes(req.subject.account.role)) {
    return { allow: false, code: "ROLE_UNKNOWN", reason: `บทบาท '${req.subject.account.role}' ไม่อยู่ใน any_authenticated ของ registry` };
  }

  const candidates = grants.filter((g) => subjectMatches(g, req.subject) && g.action === req.action);
  if (candidates.length === 0) {
    return { allow: false, code: "NO_GRANT", reason: "ไม่มี grant ที่ครอบคลู่ subject+action นี้ — ปิดเป็นค่าเริ่มต้น" };
  }
  for (const g of candidates) {
    if (g.revoked_at) continue;
    if (g.expires_at && new Date(g.expires_at).getTime() <= now.getTime()) continue;
    if (g.job_id && g.job_id !== (req.jobId ?? null)) continue;
    if (!resourceMatches(g.resource, req.resource)) continue;
    return { allow: true, reason: "มี grant สดที่ครอบคลู่ subject+action+resource", grant: g };
  }
  const first = candidates[0];
  if (first.revoked_at) return { allow: false, code: "GRANT_REVOKED", reason: "grant ถูกเพิกถอนแล้ว" };
  if (first.expires_at && new Date(first.expires_at).getTime() <= now.getTime()) {
    return { allow: false, code: "GRANT_EXPIRED", reason: "grant หมดอายุแล้ว" };
  }
  if (first.job_id && first.job_id !== (req.jobId ?? null)) {
    return { allow: false, code: "JOB_MISMATCH", reason: "grant ผูกกับงานอื่น (job binding)" };
  }
  return { allow: false, code: "NO_GRANT", reason: "ไม่มี grant ที่ครอบคลู่ resource นี้" };
}

/** True only for roles the registry lists as allowed to GRANT (never AI). */
export function isGrantorRole(role: string): boolean {
  return (permissions.role_tiers.admin_tier as string[]).includes(role);
}

