/**
 * Authorization Resume test (Phase 4) — OFFLINE. No DB, no network, no secrets.
 */
import assert from "node:assert/strict";
import {
  validateCapabilityAuthorizationRequest,
  buildCapabilityAuthorizationRow,
  requestCapabilityAuthorization,
  decideCapabilityAuthorization,
  resumeDecisionFromGrant,
  resumeCapabilityJob,
  type AuthorizationResumeDeps,
  type CapabilityAuthorizationRequest,
} from "@/engines/jobs/authorization-resume";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? " — " + detail : ""}`); }
}

const nowIso = () => "2026-10-17T00:00:00.000Z";
const REQUEST: CapabilityAuthorizationRequest = {
  capability: "document.send",
  resource: "line:customer:abc",
  subjectType: "tool",
  subjectId: "tool:sales-ai",
  scope: { provider: "line", account: "main" },
  jobId: "job-123",
  expiresAt: "2026-10-17T01:00:00.000Z",
  requestDescription: "AI Sales ขอส่งเอกสารให้ลูกค้า",
};

// ── pure validation + row shape ─────────────────────────────────────────────
check("valid request has no violations", validateCapabilityAuthorizationRequest(REQUEST).length === 0);
check("missing capability is refused", validateCapabilityAuthorizationRequest({ ...REQUEST, capability: "" }).includes("capability_required"));

const row = buildCapabilityAuthorizationRow(REQUEST, nowIso);
check("row carries capability/resource/subject/scope/job binding", row.capability === "document.send" && row.resource === "line:customer:abc" && row.subject_type === "tool" && row.job_id === "job-123" && row.status === "pending");
check("row leaves LINE columns absent", !("claimant_line_user_id" in row));

type MockDb = AuthorizationResumeDeps["db"];
function mkDeps(db?: MockDb, rpc?: AuthorizationResumeDeps["rpc"]): AuthorizationResumeDeps {
  return { db: db ?? ({} as MockDb), rpc, nowIso };
}
function insertDb(): MockDb {
  return { from: () => ({ insert: (r: Record<string, unknown>) => ({ select: () => ({ single: async () => ({ data: { id: "req-1", status: r.status }, error: null }) }) }), select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: "x" } }) }) }) }) as never };
}

async function main() {
  const req = await requestCapabilityAuthorization(mkDeps(insertDb()), REQUEST);
  check("request inserts and returns requestId", req.ok && req.requestId === "req-1");

  const approve = await decideCapabilityAuthorization(mkDeps(undefined, async (_f, a) => ({ data: { decision: "approved", request_id: a.p_request_id, grant_id: "grant-9" }, error: null })), { requestId: "req-1", decision: "approve", actorId: "owner-1" });
  check("decide approve returns grant_id", approve.ok && approve.decision === "approved" && approve.grantId === "grant-9");

  const deny = await decideCapabilityAuthorization(mkDeps(undefined, async () => ({ data: { decision: "denied", request_id: "req-1" }, error: null })), { requestId: "req-1", decision: "deny", actorId: "owner-1" });
  check("decide deny returns denied + no grant", deny.ok && deny.decision === "denied" && !deny.grantId);

  const replay = await decideCapabilityAuthorization(mkDeps(undefined, async () => ({ data: null, error: { message: "already_decided" } })), { requestId: "req-1", decision: "approve", actorId: "owner-1" });
  check("replay decide is refused", replay.ok === false && replay.error === "already_decided");

  const future = new Date(Date.now() + 3600_000).toISOString();
  const past = new Date(Date.now() - 3600_000).toISOString();
  const now = new Date();
  check("resume: approved + live + matching job → OK", resumeDecisionFromGrant({ requestStatus: "approved", grant: { id: "g1", expires_at: future }, jobId: "job-123" }).ok);
  check("resume: denied → NOT_APPROVED", resumeDecisionFromGrant({ requestStatus: "denied", grant: null }).code === "NOT_APPROVED");
  check("resume: expired → GRANT_EXPIRED", resumeDecisionFromGrant({ requestStatus: "approved", grant: { id: "g1", expires_at: past }, now }).code === "GRANT_EXPIRED");
  check("resume: revoked → GRANT_REVOKED", resumeDecisionFromGrant({ requestStatus: "approved", grant: { id: "g1", revoked_at: future } }).code === "GRANT_REVOKED");
  check("resume: job mismatch → JOB_MISMATCH", resumeDecisionFromGrant({ requestStatus: "approved", grant: { id: "g1", job_id: "other" }, jobId: "job-123" }).code === "JOB_MISMATCH");
  check("resume: no grant → NO_GRANT", resumeDecisionFromGrant({ requestStatus: "approved", grant: null }).code === "NO_GRANT");

  const resumeDb: MockDb = { from: (t: string) => (t === "pending_authorizations"
    ? { insert: () => ({} as never), select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { status: "approved", grant_id: "g1", job_id: "job-123" }, error: null }) }) }) } as never
    : { insert: () => ({} as never), select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: "g1", expires_at: future }, error: null }) }) }) } as never) };
  const resumed = await resumeCapabilityJob(mkDeps(resumeDb), { requestId: "req-1", jobId: "job-123" });
  check("resumeCapabilityJob returns OK", resumed.ok && resumed.grantId === "g1");

  console.log(`\nauthorization-resume: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });

