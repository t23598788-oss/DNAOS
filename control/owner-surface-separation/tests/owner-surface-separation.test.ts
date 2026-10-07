/**
 * STRICT_OPERATIONAL_DEVELOPMENT_SURFACE_SEPARATION_V1 proofs A–X + live 1–7.
 *
 * How to run:
 *   npx tsx control/owner-surface-separation/tests/owner-surface-separation.test.ts
 */

import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { canDiscover, canInvoke } from "../../../connections/dna-os-mcp/export-policy";
import { DNA_OS_MCP_TOOLS } from "../../../connections/dna-os-mcp/contract";
import { issueLocalAccessGrant } from "../../local-resource-access/contract";
import { ownerWorkSurfaceSnapshot } from "../../owner-work-surface/contract";
import {
  applyLeasedSourceChange,
  classifySurfaceIntent,
  createDevelopmentAuthority,
  createOwnerSurfaceSession,
  discoverSurfaceTools,
  ensureFixtures,
  expireLease,
  fixtureAllowedFile,
  fixtureOutsideFile,
  fixtureSecurityFile,
  invokeCodingWorker,
  invokeCodingWorkerWithLease,
  mcpToolAllowedOnSurface,
  operationalModifySource,
  prepareDevelopmentProposal,
  productionPromotionFromLease,
  probeNativeBiometric,
  requestDevelopmentLease,
  routeOperationalCapability,
  setBiometricPort,
  sourceReadIsNotWrite,
  switchOwnerSurface,
} from "../contract";
import type { DevelopmentAuthorityLeaseV1, DevelopmentChangeProposalV1 } from "../types";

declare const process: { cwd(): string; env: Record<string, string | undefined>; exit: (code: number) => void };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

const STAMP = Date.now();
const DIR = join(process.cwd(), "control/owner-surface-separation/data");
const LRA = join(process.cwd(), "control/local-resource-access/data");
const CV = join(process.cwd(), "control/canonical-view/data");
const logs: Record<string, string> = {
  OWNER_SURFACE_SESSION_LOG: join(DIR, `sess-${STAMP}.jsonl`),
  OWNER_SURFACE_LEASE_LOG: join(DIR, `lease-${STAMP}.jsonl`),
  OWNER_SURFACE_PROPOSAL_LOG: join(DIR, `prop-${STAMP}.jsonl`),
  OWNER_SURFACE_AUDIT_LOG: join(DIR, `audit-${STAMP}.jsonl`),
  OWNER_SURFACE_NOTIFY_LOG: join(DIR, `note-${STAMP}.jsonl`),
  CANONICAL_VIEW_REVIEWS_LOG: join(CV, `surf-rev-${STAMP}.jsonl`),
  CANONICAL_VIEW_PREVIEWS_LOG: join(CV, `surf-prev-${STAMP}.jsonl`),
  LOCAL_RESOURCE_GRANTS_LOG: join(LRA, `surf-grants-${STAMP}.jsonl`),
};
for (const [key, value] of Object.entries(logs)) process.env[key] = value;

const FILE_RES = "resource://local/files/fixture-corpus";
const AI = "ai://surface-sep";
const OWNER = "owner-human-surface";
const NOTES = join(process.cwd(), "control/local-resource-access/fixtures/corpus/notes.txt");

let passed = 0;
let failed = 0;
function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}
async function check(name: string, body: () => Promise<void> | void): Promise<void> {
  try {
    await body();
    passed++;
    console.log(`PASS ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const verifiedPort = {
  probe: () => ({ availability: "AVAILABLE" as const, helper_present: true }),
  evaluate: () => ({
    challenge_id: "chal-test",
    outcome: "VERIFIED" as const,
    verification_method_class: "BIOMETRIC",
    verified_at: new Date().toISOString(),
    error_code: null,
    detail: null,
  }),
};
const cancelledPort = {
  probe: () => ({ availability: "AVAILABLE" as const, helper_present: true }),
  evaluate: () => ({
    challenge_id: "chal-cancel",
    outcome: "CANCELLED" as const,
    verification_method_class: null,
    verified_at: null,
    error_code: "LA_userCancel",
    detail: "Owner cancelled",
  }),
};
const unavailablePort = {
  probe: () => ({ availability: "NOT_AVAILABLE" as const, helper_present: false }),
  evaluate: () => ({
    challenge_id: "chal-na",
    outcome: "UNAVAILABLE" as const,
    verification_method_class: null,
    verified_at: null,
    error_code: "HELPER_NOT_BUILT",
    detail: "not available",
  }),
};

async function main(): Promise<void> {
  ensureFixtures();
  const allowedBefore = readFileSync(fixtureAllowedFile(), "utf8");
  const outsideBefore = readFileSync(fixtureOutsideFile(), "utf8");
  const securityBefore = readFileSync(fixtureSecurityFile(), "utf8");
  const notesBefore = existsSync(NOTES) ? readFileSync(NOTES, "utf8") : "";
  issueLocalAccessGrant({
    ai_identity: AI, session_id: `session-surf-${STAMP}`, work_id: null, capability: "*", resource_id: FILE_RES,
    data_scope: ["control/local-resource-access/fixtures/corpus"], access: ["READ", "WRITE"], network_egress: "LOCAL_ONLY", expires_at: null, effect: "ALLOW",
  });

  const operational = createOwnerSurfaceSession({ owner_id: OWNER, surface_id: "OPERATIONAL_OWNER_SURFACE" });
  const development = createOwnerSurfaceSession({ owner_id: OWNER, surface_id: "DEVELOPMENT_CONTROL_SURFACE" });

  await check("A. Operational and Development surfaces use separate authority domains", () => {
    assert(operational.authority_domain === "OPERATIONAL", operational.authority_domain);
    assert(development.authority_domain === "DEVELOPMENT", development.authority_domain);
    assert(operational.authority_domain !== development.authority_domain, "domains");
    assert(operational.session_id !== development.session_id, "sessions isolated");
  });

  await check("B. Operational surface cannot invoke coding worker", () => {
    const denied = invokeCodingWorker(operational);
    assert(denied.ok === false && denied.CODING_WORKER_STARTED === false, JSON.stringify(denied));
  });

  await check("C. Operational surface cannot modify source", () => {
    assert(operationalModifySource(operational).OPERATIONAL_SURFACE_CAN_MODIFY_SOURCE === false, "modify");
  });

  await check("D. Operational surface cannot create development authority", () => {
    assert(createDevelopmentAuthority(operational).reason_code === "OPERATIONAL_SURFACE_CAN_CREATE_DEVELOPMENT_AUTHORITY", "create");
  });

  await check("E. Development language on Operational is a capability boundary", () => {
    const row = classifySurfaceIntent("แก้ source code ของ fixture ให้เพิ่ม capability X", operational);
    assert(row.INTENT === "DEVELOPMENT_CHANGE", row.INTENT);
    assert(row.ACTION_AVAILABLE === false, "available");
    assert(row.reason_code === "DEVELOPMENT_ACTION_NOT_AVAILABLE_ON_THIS_SURFACE", String(row.reason_code));
    assert(row.human.includes("Development Control"), row.human);
    assert(!row.human.includes("ไม่เข้าใจคำสั่ง"), "not semantic failure");
  });

  await check("F. Operational แก้เอกสาร still uses registered WRITE", async () => {
    const row = await routeOperationalCapability({
      session: operational,
      text: "แก้ข้อความในเอกสาร notes.txt",
      work_id: `work-op-${STAMP}`,
      ai_client_id: AI,
      resource_id: FILE_RES,
      logical_path: "notes.txt",
    });
    assert(row.ok === true && row.operational_action === "WRITE", JSON.stringify(row));
    assert(row.development_route === false && row.CODING_WORKER_STARTED === false && row.BIOMETRIC_REQUESTED === false, "no dev");
  });

  await check("G. Semantic interpretation cannot escalate OPERATIONAL → DEVELOPMENT", async () => {
    const row = await routeOperationalCapability({
      session: operational,
      text: "เขียนโค้ดเพิ่ม capability ใหม่",
      work_id: `work-esc-${STAMP}`,
      ai_client_id: AI,
      resource_id: FILE_RES,
    });
    assert(row.SEMANTIC_INTERPRETATION_CAN_ESCALATE_AUTHORITY === false, "escalate");
    assert(row.CROSS_SURFACE_EXECUTION === false, "cross");
    assert(row.SOURCE_MODIFICATION_STARTED === false, "source");
  });

  await check("H. Explicit Development Control entry is required", () => {
    const blocked = prepareDevelopmentProposal({ session: operational, goal: "เพิ่ม capability X บน fixture" });
    assert(blocked.reason_code === "EXPLICIT_DEVELOPMENT_CONTROL_REQUIRED", String(blocked.reason_code));
    const switched = switchOwnerSurface(operational, "DEVELOPMENT_CONTROL_SURFACE");
    assert(switched.authority_domain === "DEVELOPMENT", switched.authority_domain);
    assert(switched.session_id !== operational.session_id, "new session");
  });

  let proposal: DevelopmentChangeProposalV1 | null = null;
  await check("I+J. Prechange self-knowledge and duplication before coding", () => {
    const prepared = prepareDevelopmentProposal({ session: development, goal: "แก้ source code ของ fixture ให้เพิ่ม capability X" });
    assert(prepared.ok === true && prepared.proposal !== null, JSON.stringify(prepared.analysis));
    assert(prepared.analysis.verdict === "PARTIAL_EXISTING_CAPABILITY" || prepared.analysis.verdict === "NEW_CAPABILITY_REQUIRED", prepared.analysis.verdict);
    assert(prepared.analysis.duplicates_existing === true, "duplication reported");
    assert(prepared.SOURCE_MODIFICATION_STARTED === false, "no code yet");
    proposal = prepared.proposal;
  });

  await check("K. Source unchanged before biometric authorization", () => {
    assert(readFileSync(fixtureAllowedFile(), "utf8") === allowedBefore, "unchanged");
  });

  let lease: DevelopmentAuthorityLeaseV1 | null = null;
  await check("L. Native biometric success creates only a scoped lease", () => {
    setBiometricPort(verifiedPort);
    assert(proposal !== null, "proposal");
    const granted = requestDevelopmentLease({ session: development, proposal: proposal as DevelopmentChangeProposalV1, owner_id: OWNER });
    assert(granted.ok === true, JSON.stringify(granted));
    lease = granted.lease as DevelopmentAuthorityLeaseV1;
    assert(lease.max_scope === "ONE_WORK_ORDER", lease.max_scope);
    assert(lease.allowed_paths.length > 0, "scoped paths");
    assert(!(granted as { PRODUCTION_PROMOTION_AUTHORITY?: boolean }).PRODUCTION_PROMOTION_AUTHORITY, "not production");
  });

  await check("M. Biometric failure/cancel leaves source unchanged", () => {
    setBiometricPort(cancelledPort);
    const prep = prepareDevelopmentProposal({ session: development, goal: "แก้ source code ของ fixture ให้เพิ่ม capability X" });
    const denied = requestDevelopmentLease({ session: development, proposal: prep.proposal as DevelopmentChangeProposalV1, owner_id: OWNER });
    assert(denied.ok === false, "cancel");
    assert(denied.SOURCE_MODIFICATION_STARTED === false, "no mutate");
    assert(readFileSync(fixtureAllowedFile(), "utf8") === allowedBefore, "still unchanged until success mutate");
    setBiometricPort(verifiedPort);
  });

  await check("N. Lease cannot modify outside allowed path", () => {
    assert(lease !== null, "lease");
    const blocked = applyLeasedSourceChange({
      session: development,
      lease: lease as DevelopmentAuthorityLeaseV1,
      relative_path: "control/owner-surface-separation/fixtures/outside/secret.ts",
      contents: "export const SECRET = \"hacked\";\n",
    });
    assert(blocked.reason_code === "LEASE_SCOPE_VIOLATION" && blocked.BLOCK === true, JSON.stringify(blocked));
    assert(readFileSync(fixtureOutsideFile(), "utf8") === outsideBefore, "outside intact");
  });

  await check("O. Scope expansion requires new Owner authorization", () => {
    assert(lease !== null, "lease");
    const blocked = applyLeasedSourceChange({
      session: development,
      lease: lease as DevelopmentAuthorityLeaseV1,
      relative_path: "control/owner-surface-separation/fixtures/outside/secret.ts",
      contents: "nope",
    });
    assert(blocked.requires_new_biometric === true && blocked.requires_new_proposal === true, JSON.stringify(blocked));
  });

  await check("P. Expired lease cannot be reused", () => {
    const prep = prepareDevelopmentProposal({ session: development, goal: "แก้ source code ของ fixture ให้เพิ่ม capability X" });
    const granted = requestDevelopmentLease({
      session: development, proposal: prep.proposal as DevelopmentChangeProposalV1, owner_id: OWNER, expires_in_ms: 1,
    });
    const short = granted.lease as DevelopmentAuthorityLeaseV1;
    expireLease(short, "timeout");
    const reuse = applyLeasedSourceChange({
      session: development, lease: short, relative_path: "control/owner-surface-separation/fixtures/allowed/feature.ts", contents: "x",
    });
    assert(reuse.reason_code === "LEASE_EXPIRED", String(reuse.reason_code));
  });

  await check("Q. Security-sensitive source changes require fresh biometric", () => {
    assert(lease !== null, "lease");
    const blocked = applyLeasedSourceChange({
      session: development,
      lease: lease as DevelopmentAuthorityLeaseV1,
      relative_path: "control/owner-surface-separation/fixtures/security/auth-policy.ts",
      contents: "export const AUTH_POLICY = \"mutated\";\n",
    });
    assert(blocked.reason_code === "SECURITY_SENSITIVE_SOURCE_GATE", String(blocked.reason_code));
    assert(blocked.BIOMETRIC_AUTHORIZATION_REQUIRED === true, "reauth");
    assert(readFileSync(fixtureSecurityFile(), "utf8") === securityBefore, "untouched");
  });

  await check("R. Source authorization does not equal production deployment authority", () => {
    assert(lease !== null, "lease");
    const split = productionPromotionFromLease(lease as DevelopmentAuthorityLeaseV1);
    assert(split.SOURCE_CHANGE_AUTHORITY === true && split.PRODUCTION_PROMOTION_AUTHORITY === false, JSON.stringify(split));
  });

  await check("S. Operational MCP discovery does not expose development mutation tools", () => {
    const tools = discoverSurfaceTools("OPERATIONAL");
    assert(!tools.some((name) => name.includes("modify_source") || name.includes("invoke_coding_worker")), tools.join(","));
    assert(mcpToolAllowedOnSurface("dna_os.modify_source", "OPERATIONAL") === false, "mcp op");
    assert(mcpToolAllowedOnSurface("dna_os.modify_source", "DEVELOPMENT") === false, "mcp dev no lease");
    assert(mcpToolAllowedOnSurface("dna_os.modify_source", "DEVELOPMENT", true) === true, "mcp dev lease");
    const op = canDiscover("dna_os.modify_source", { caller: "test", channel: "EXTERNAL", authority_domain: "OPERATIONAL" });
    assert(op.allowed === false, op.reason);
    const inv = canInvoke("dna_os.invoke_coding_worker", { caller: "test", channel: "EXTERNAL", authority_domain: "OPERATIONAL" });
    assert(inv.allowed === false && inv.reason_code === "CROSS_SURFACE_EXECUTION_BARRIER", inv.reason_code);
  });

  await check("T. Development and operational sessions do not share mutation authority", () => {
    assert(lease !== null, "lease");
    const cross = applyLeasedSourceChange({
      session: operational,
      lease: lease as DevelopmentAuthorityLeaseV1,
      relative_path: "control/owner-surface-separation/fixtures/allowed/feature.ts",
      contents: "export const MARKER = \"from-operational\";\n",
    });
    assert(cross.reason_code === "NOT_EXPOSED" || cross.reason_code === "LEASE_REUSE_ACROSS_SURFACES", String(cross.reason_code));
    assert(readFileSync(fixtureAllowedFile(), "utf8") === allowedBefore || readFileSync(fixtureAllowedFile(), "utf8").includes("unchanged") || readFileSync(fixtureAllowedFile(), "utf8").includes("leased"), "no leak");
  });

  await check("U. Source read access does not imply source write access", () => {
    const split = sourceReadIsNotWrite();
    assert(split.SOURCE_READ_AUTHORITY === true && split.SOURCE_WRITE_AUTHORITY === false, JSON.stringify(split));
  });

  await check("V. Coding client has no direct Owner biometric authority", () => {
    const prep = prepareDevelopmentProposal({ session: development, goal: "แก้ source code ของ fixture ให้เพิ่ม capability X" });
    const denied = requestDevelopmentLease({
      session: development, proposal: prep.proposal as DevelopmentChangeProposalV1, owner_id: "coding-client://local",
    });
    assert(denied.ok === false && denied.reason_code === "AI_CANNOT_APPROVE_LEASE", JSON.stringify(denied));
  });

  await check("W. AI cannot approve its own lease", () => {
    const prep = prepareDevelopmentProposal({ session: development, goal: "แก้ source code ของ fixture ให้เพิ่ม capability X" });
    const denied = requestDevelopmentLease({
      session: development, proposal: prep.proposal as DevelopmentChangeProposalV1, owner_id: "ai://provider",
    });
    assert(denied.ok === false && denied.reason_code === "AI_CANNOT_APPROVE_LEASE", JSON.stringify(denied));
  });

  await check("LIVE 1. Operational capability use", async () => {
    const row = await routeOperationalCapability({
      session: operational, text: "เปลี่ยนชื่อไฟล์นี้ notes.txt", work_id: `work-l1-${STAMP}`, ai_client_id: AI, resource_id: FILE_RES, logical_path: "notes.txt",
    });
    console.log(`LIVE_OPERATIONAL_EDIT=${String(row.operational_action)} DEV=${String(row.development_route)}`);
    assert(row.ok === true && row.CODING_WORKER_STARTED === false, JSON.stringify(row));
  });

  await check("LIVE 2. Development request in wrong surface", async () => {
    const row = await routeOperationalCapability({
      session: operational, text: "แก้ source code ของ fixture ให้เพิ่ม capability X", work_id: `work-l2-${STAMP}`, ai_client_id: AI, resource_id: FILE_RES,
    });
    console.log(`LIVE_WRONG_SURFACE_DEVELOPMENT_REQUEST=${String(row.reason_code)}`);
    assert(row.ACTION_AVAILABLE === false && row.SOURCE_MODIFICATION_STARTED === false && row.CODING_WORKER_STARTED === false, JSON.stringify(row));
    assert(String(row.human).includes("Development Control"), String(row.human));
  });

  await check("LIVE 3. Development entry produces proposal without source change", () => {
    const prep = prepareDevelopmentProposal({ session: development, goal: "แก้ source code ของ fixture ให้เพิ่ม capability X" });
    console.log(`LIVE_DEVELOPMENT_PROPOSAL=${String(prep.proposal?.PROPOSAL_READY)} VERDICT=${prep.analysis.verdict}`);
    assert(prep.ok === true && prep.proposal?.PROPOSAL_READY === true, "proposal");
    assert(prep.SOURCE_MODIFICATION_STARTED === false, "unchanged");
  });

  await check("LIVE 4. Biometric gate", () => {
    const native = probeNativeBiometric();
    setBiometricPort(unavailablePort);
    const prep = prepareDevelopmentProposal({ session: development, goal: "แก้ source code ของ fixture ให้เพิ่ม capability X" });
    const unavailable = requestDevelopmentLease({ session: development, proposal: prep.proposal as DevelopmentChangeProposalV1, owner_id: OWNER });
    console.log(`LIVE_BIOMETRIC_PROBE=${native.availability} TEST_UNAVAILABLE=${String(unavailable.LIVE_BIOMETRIC)} IMPL=${native.BIOMETRIC_IMPLEMENTATION}`);
    assert(unavailable.FAKE_BIOMETRIC_FALLBACK === false, "no fake");
    assert(unavailable.ok === false, "no fake success");
    setBiometricPort(verifiedPort);
  });

  await check("LIVE 5. Scoped source change then escape blocked", () => {
    assert(lease !== null, "lease");
    const ok = applyLeasedSourceChange({
      session: development,
      lease: lease as DevelopmentAuthorityLeaseV1,
      relative_path: "control/owner-surface-separation/fixtures/allowed/feature.ts",
      contents: "export const MARKER = \"leased\";\n",
    });
    assert(ok.ok === true, JSON.stringify(ok));
    assert(readFileSync(fixtureAllowedFile(), "utf8").includes("leased"), "mutated");
    const escape = applyLeasedSourceChange({
      session: development,
      lease: lease as DevelopmentAuthorityLeaseV1,
      relative_path: "control/owner-surface-separation/fixtures/outside/secret.ts",
      contents: "export const SECRET = \"nope\";\n",
    });
    console.log(`LIVE_SCOPED_SOURCE_CHANGE=ok ESCAPE=${String(escape.reason_code)}`);
    assert(escape.reason_code === "LEASE_SCOPE_VIOLATION", String(escape.reason_code));
  });

  await check("LIVE 6. No cross-surface lease", () => {
    assert(lease !== null, "lease");
    const denied = applyLeasedSourceChange({
      session: operational,
      lease: lease as DevelopmentAuthorityLeaseV1,
      relative_path: "control/owner-surface-separation/fixtures/allowed/feature.ts",
      contents: "export const MARKER = \"ops\";\n",
    });
    console.log(`LIVE_CROSS_SURFACE_BLOCK=${String(denied.reason_code)}`);
    assert(denied.ok === false, "denied");
  });

  await check("LIVE 7. Security reauth", () => {
    assert(lease !== null, "lease");
    const denied = applyLeasedSourceChange({
      session: development,
      lease: lease as DevelopmentAuthorityLeaseV1,
      relative_path: "control/owner-surface-separation/fixtures/security/auth-policy.ts",
      contents: "export const AUTH_POLICY = \"reauth\";\n",
    });
    console.log(`LIVE_SECURITY_REAUTH=${String(denied.reason_code)}`);
    assert(denied.BIOMETRIC_AUTHORIZATION_REQUIRED === true, JSON.stringify(denied));
  });

  await check("X. Existing MCP reused; no second plane", () => {
    const names = DNA_OS_MCP_TOOLS.map((tool) => tool.metadata.name);
    assert(names.includes("submit_command"), "existing mcp");
    assert(names.includes("dna_os.get_owner_surface"), "surface tool on existing server");
    assert(!names.includes("get_secret"), "no secret");
    const snap = ownerWorkSurfaceSnapshot(AI, `session-surf-${STAMP}`);
    const sep = snap.surface_separation as { SHARED_IMPLICIT_AUTHORITY?: boolean; write_source_button_in_operational_chat?: boolean };
    assert(sep.SHARED_IMPLICIT_AUTHORITY === false, "implicit");
    assert(sep.write_source_button_in_operational_chat === false, "button");
    assert(invokeCodingWorkerWithLease(operational, lease).CODING_WORKER_STARTED !== true, "op worker");
  });

  writeFileSync(fixtureAllowedFile(), allowedBefore);
  writeFileSync(fixtureOutsideFile(), outsideBefore);
  writeFileSync(fixtureSecurityFile(), securityBefore);
  if (notesBefore) writeFileSync(NOTES, notesBefore);
  for (const file of Object.values(logs)) {
    if (existsSync(file)) unlinkSync(file);
  }
  setBiometricPort(null);
  console.log(`NEW_DETERMINISTIC_PROOFS_PASSED = ${failed === 0}`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();
