/**
 * AUTHORIZATION RESUME (Phase 4) — the connection layer between the existing
 * business-job adapter (PENDING_APPROVAL), the existing approval-evidence
 * normalizer, and the existing scoped_grants capability lease.
 *
 * NO new authority, NO new queue, NO new vault. This module only wires the
 * pieces that already exist:
 *
 *   AI request → business-job-adapter → PENDING_APPROVAL
 *     → requestCapabilityAuthorization()   (public.pending_authorizations)
 *     → owner approve via decideCapabilityAuthorization()
 *         (atomic RPC: approve ⇒ scoped_grants + status, deny ⇒ status)
 *     → resumeCapabilityJob()              (checks grant → resume)
 *     → re-run the original job with approval.ref
 *
 * AI never sees a secret: this module only ever references the GRANT and the
 * APPROVAL request; credentials are resolved behind the existing Credential
 * Authority (Vault / Keychain) inside the executor, never passed through here.
 */

export type AuthorizationSubjectType = "account" | "device" | "tool";
export type AuthorizationDecision = "approve" | "deny";
export type AuthorizationStatus = "pending" | "approved" | "denied" | "expired";

export interface CapabilityAuthorizationRequest {
  capability: string;
  resource: string;
  subjectType: AuthorizationSubjectType;
  subjectId: string;
  scope?: Record<string, unknown>;
  jobId?: string | null;
  expiresAt?: string | null;
  requestDescription: string;
  claimantDescription?: string | null;
}

/** Structural DB surface (matches the canonical writer injected-deps pattern). */
export interface AuthorizationResumeDeps {
  db: {
    from(table: string): {
      insert(row: Record<string, unknown>): {
        select(columns?: string): { single(): Promise<{ data: Record<string, unknown> | null; error: { message: string } | null }> };
      };
      select(columns?: string): {
        eq(column: string, value: string): { maybeSingle(): Promise<{ data: Record<string, unknown> | null; error: { message: string } | null }> };
      };
    };
  };
  rpc?: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
  nowIso?: () => string;
}

export interface RequestResult {
  ok: boolean;
  requestId?: string;
  status?: AuthorizationStatus;
  error?: string;
}

export interface DecideResult {
  ok: boolean;
  decision?: "approved" | "denied" | "expired";
  requestId?: string;
  grantId?: string | null;
  error?: string;
}

export interface ResumeDecision {
  ok: boolean;
  reason: string;
  grantId?: string | null;
  code?: "NO_GRANT" | "GRANT_EXPIRED" | "GRANT_REVOKED" | "JOB_MISMATCH" | "NOT_APPROVED" | "OK";
}

const SUBJECT_TYPES: readonly AuthorizationSubjectType[] = ["account", "device", "tool"];

/** Pure validation — a request that cannot name a real subject/capability is refused. */
export function validateCapabilityAuthorizationRequest(input: CapabilityAuthorizationRequest): string[] {
  const v: string[] = [];
  if (!input.capability?.trim()) v.push("capability_required");
  if (!input.resource?.trim()) v.push("resource_required");
  if (!SUBJECT_TYPES.includes(input.subjectType)) v.push("subject_type_invalid");
  if (!input.subjectId?.trim()) v.push("subject_id_required");
  if (!input.requestDescription?.trim()) v.push("request_description_required");
  if (input.expiresAt && Number.isNaN(Date.parse(input.expiresAt))) v.push("expires_at_invalid");
  return v;
}

/** Build the row shape written to public.pending_authorizations (LINE columns untouched). */
export function buildCapabilityAuthorizationRow(
  input: CapabilityAuthorizationRequest,
  nowIso: () => string,
): Record<string, unknown> {
  return {
    capability: input.capability,
    resource: input.resource,
    subject_type: input.subjectType,
    subject_id: input.subjectId,
    scope: input.scope ?? {},
    job_id: input.jobId ?? null,
    expires_at: input.expiresAt ?? null,
    request_description: input.requestDescription,
    claimant_description: input.claimantDescription ?? null,
    status: "pending",
    created_at: nowIso(),
  };
}

export async function requestCapabilityAuthorization(
  deps: AuthorizationResumeDeps,
  input: CapabilityAuthorizationRequest,
): Promise<RequestResult> {
  const violations = validateCapabilityAuthorizationRequest(input);
  if (violations.length) return { ok: false, error: violations.join("; ") };

  const now = deps.nowIso ?? (() => new Date().toISOString());
  const row = buildCapabilityAuthorizationRow(input, now);
  const { data, error } = await deps.db.from("pending_authorizations").insert(row).select("id, status").single();
  if (error || !data) return { ok: false, error: error?.message ?? "insert_failed" };
  return { ok: true, requestId: String(data.id), status: (data.status as AuthorizationStatus) ?? "pending" };
}

export async function decideCapabilityAuthorization(
  deps: AuthorizationResumeDeps,
  input: { requestId: string; decision: AuthorizationDecision; actorId: string; expiresAt?: string | null },
): Promise<DecideResult> {
  if (input.decision !== "approve" && input.decision !== "deny") {
    return { ok: false, error: "decision_invalid" };
  }
  // Atomic path: the DB function serializes concurrent decides (no duplicate
  // grant, no approved-without-grant). Tests inject a mock rpc.
  if (deps.rpc) {
    const { data, error } = await deps.rpc("decide_capability_authorization", {
      p_request_id: input.requestId,
      p_decision: input.decision,
      p_actor: input.actorId,
      p_expires_at: input.expiresAt ?? null,
    });
    if (error) return { ok: false, error: error.message };
    const d = (data ?? {}) as Record<string, unknown>;
    return {
      ok: true,
      decision: d.decision as DecideResult["decision"],
      requestId: input.requestId,
      grantId: (d.grant_id as string) ?? null,
    };
  }
  return { ok: false, error: "rpc_required" };
}

/** Decide whether the original job may resume, from the real grant row. */
export function resumeDecisionFromGrant(input: {
  requestStatus: AuthorizationStatus | null;
  grant: { id?: string; revoked_at?: string | null; expires_at?: string | null; job_id?: string | null } | null;
  jobId?: string | null;
  now?: Date;
}): ResumeDecision {
  const now = input.now ?? new Date();
  if (input.requestStatus !== "approved") {
    return { ok: false, code: "NOT_APPROVED", reason: `request status=${input.requestStatus ?? "unknown"}` };
  }
  if (!input.grant) return { ok: false, code: "NO_GRANT", reason: "no grant issued" };
  if (input.grant.revoked_at) return { ok: false, code: "GRANT_REVOKED", reason: "grant revoked" };
  if (input.grant.expires_at && new Date(input.grant.expires_at).getTime() <= now.getTime()) {
    return { ok: false, code: "GRANT_EXPIRED", reason: "grant expired" };
  }
  if (input.grant.job_id && input.grant.job_id !== (input.jobId ?? null)) {
    return { ok: false, code: "JOB_MISMATCH", reason: "grant bound to another job" };
  }
  return { ok: true, reason: "grant live — resume", grantId: input.grant.id ?? null };
}

export async function resumeCapabilityJob(
  deps: AuthorizationResumeDeps,
  input: { requestId: string; jobId?: string | null },
): Promise<ResumeDecision> {
  const { data: req } = await deps.db
    .from("pending_authorizations")
    .select("status, grant_id, job_id")
    .eq("id", input.requestId)
    .maybeSingle();
  if (!req) return { ok: false, code: "NOT_APPROVED", reason: "request not found" };

  let grant: { id?: string; revoked_at?: string | null; expires_at?: string | null; job_id?: string | null } | null = null;
  if (req.grant_id) {
    const { data: g } = await deps.db
      .from("scoped_grants")
      .select("id, revoked_at, expires_at, job_id")
      .eq("id", String(req.grant_id))
      .maybeSingle();
    grant = g ? (g as unknown as typeof grant) : null;
  }
  return resumeDecisionFromGrant({
    requestStatus: (req.status as AuthorizationStatus) ?? null,
    grant,
    jobId: input.jobId ?? null,
  });
}

