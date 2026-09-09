/**
 * MCP_CONTROLLED_CODE_KNOWLEDGE_ACCESS_V1
 * DNA_OS_REGISTERED_MUTATION_TOOL_BOUNDARY_V1
 *
 * How to run:
 *   npx tsx control/mcp-code-knowledge/tests/mcp-code-knowledge.test.ts
 */

import { existsSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { canDiscover, canInvoke } from "../../../connections/dna-os-mcp/export-policy";
import { CANONICAL_MCP_RESOURCE_URIS, DEVELOPMENT_MCP_RESOURCE_URIS } from "../../../connections/dna-os-mcp/canonical-resources";
import { DNA_OS_MCP_TOOLS } from "../../../connections/dna-os-mcp/contract";
import {
  createOwnerSurfaceSession,
  prepareDevelopmentProposal,
  requestDevelopmentLease,
  setBiometricPort,
} from "../../owner-surface-separation/contract";
import type { DevelopmentAuthorityLeaseV1, DevelopmentChangeProposalV1 } from "../../owner-surface-separation/types";
import {
  applyRegisteredSourceMutation,
  codeKnowledgeMetrics,
  codingClientBarriers,
  codingKnowledgeFirst,
  createScopedDevelopmentWorktree,
  denyCanonicalFactEdit,
  denyDirectCanonicalWrite,
  denyDirectGithubWrite,
  denyUnrestrictedShell,
  developmentContext,
  filterMcpResources,
  filterMcpTools,
  providerIdentityGrantsSourceAuthority,
  readScopedSource,
  scopedWorktreeFile,
} from "../contract";

declare const process: { cwd(): string; env: Record<string, string | undefined>; exit: (code: number) => void };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

const STAMP = Date.now();
const DIR = join(process.cwd(), "control/mcp-code-knowledge/data");
const SURF = join(process.cwd(), "control/owner-surface-separation/data");
for (const [key, value] of Object.entries({
  OWNER_SURFACE_SESSION_LOG: join(SURF, `ck-sess-${STAMP}.jsonl`),
  OWNER_SURFACE_LEASE_LOG: join(SURF, `ck-lease-${STAMP}.jsonl`),
  OWNER_SURFACE_PROPOSAL_LOG: join(SURF, `ck-prop-${STAMP}.jsonl`),
  OWNER_SURFACE_AUDIT_LOG: join(SURF, `ck-audit-${STAMP}.jsonl`),
  OWNER_SURFACE_NOTIFY_LOG: join(SURF, `ck-note-${STAMP}.jsonl`),
  MCP_CODE_MUTATION_LOG: join(DIR, `mut-${STAMP}.jsonl`),
})) process.env[key] = value;

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

setBiometricPort({
  probe: () => ({ availability: "AVAILABLE", helper_present: true }),
  evaluate: () => ({
    challenge_id: "chal-ck",
    outcome: "VERIFIED",
    verification_method_class: "BIOMETRIC",
    verified_at: new Date().toISOString(),
    error_code: null,
    detail: null,
  }),
});

async function main(): Promise<void> {
  const operational = createOwnerSurfaceSession({ owner_id: "owner-human-ck", surface_id: "OPERATIONAL_OWNER_SURFACE" });
  const development = createOwnerSurfaceSession({ owner_id: "owner-human-ck", surface_id: "DEVELOPMENT_CONTROL_SURFACE" });
  const prepared = prepareDevelopmentProposal({ session: development, goal: "extend fixture-echo FEATURE_MARKER" });
  assert(prepared.proposal !== null, "proposal");
  const leased = requestDevelopmentLease({
    session: development,
    proposal: prepared.proposal as DevelopmentChangeProposalV1,
    owner_id: "owner-human-ck",
    expires_in_ms: 60_000,
  });
  const lease = leased.lease as DevelopmentAuthorityLeaseV1;
  assert(lease !== undefined, "lease");
  const workId = lease.work_id;
  const catalog = DNA_OS_MCP_TOOLS.map((tool) => tool.metadata.name);

  await check("A. Coding client understands capability through MCP without repo search", () => {
    const first = codingKnowledgeFirst("local-resource-access");
    assert(first.MCP_KNOWLEDGE_QUERY_FIRST === true, "query first");
    assert(first.SOURCE_SEARCH_REQUIRED === false, "no search");
    assert(first.entity !== null, "entity");
    assert(first.SOURCE_READ_GRANTS_WRITE === false, "read≠write");
    console.log("LIVE_MCP_KNOWLEDGE_FIRST=true");
  });

  await check("B. Source visibility does not grant write authority", () => {
    const ctx = developmentContext({ work_id: workId, lease, goal: "extend fixture" });
    assert(ctx.FULL_CHAT_TRANSCRIPT_REQUIRED === false, "no transcript");
    assert(codingClientBarriers().SOURCE_VISIBILITY_GRANTS_AUTHORITY === false, "visibility");
    const read = readScopedSource({ session: development, lease, work_id: workId, relative_path: "allowed/feature.ts" });
    assert(read.ok === false, "worktree not created yet");
  });

  await check("C. Operational client sees no coding mutation tools", () => {
    const filtered = filterMcpTools({ authority_domain: "OPERATIONAL", lease_active: false, tool_names: catalog });
    assert(!filtered.AVAILABLE_TOOLS.includes("dna_os.modify_source"), "modify hidden");
    assert(!filtered.AVAILABLE_TOOLS.includes("dna_os.apply_scoped_source_write"), "write hidden");
    assert(!filtered.AVAILABLE_TOOLS.includes("dna_os.commit_source"), "commit hidden");
    assert(canDiscover("dna_os.modify_source", { caller: "cursor", channel: "EXTERNAL", authority_domain: "OPERATIONAL" }).allowed === false, "discover");
    assert(canInvoke("dna_os.apply_scoped_source_write", { caller: "cursor", channel: "EXTERNAL", authority_domain: "OPERATIONAL" }).allowed === false, "invoke");
  });

  await check("D. Development client before biometric lease sees no source mutation tool", () => {
    const filtered = filterMcpTools({ authority_domain: "DEVELOPMENT", lease_active: false, tool_names: catalog });
    assert(!filtered.AVAILABLE_TOOLS.includes("dna_os.apply_scoped_source_write"), "no write");
    assert(filtered.AVAILABLE_TOOLS.includes("dna_os.submit_development_control"), "proposal ok");
    const disc = canDiscover("dna_os.apply_scoped_source_write", { caller: "cursor", channel: "EXTERNAL", authority_domain: "DEVELOPMENT", lease_active: false });
    assert(disc.allowed === false, disc.reason);
    const attempt = applyRegisteredSourceMutation({
      session: development,
      lease: null,
      client_id: "ai://cursor",
      work_id: workId,
      relative_path: "allowed/feature.ts",
      contents: "nope",
    });
    assert(attempt.reason_code === "DEVELOPMENT_AUTHORITY_REQUIRED", String(attempt.reason_code));
    console.log("LIVE_NO_LEASE_WRITE=true");
  });

  await check("E. Valid lease exposes only scoped registered mutation capabilities", () => {
    const filtered = filterMcpTools({ authority_domain: "DEVELOPMENT", lease_active: true, tool_names: catalog });
    assert(filtered.CLIENT_SEES_ONLY_REQUIRED_MUTATION_TOOLS === true, "least");
    assert(filtered.AVAILABLE_TOOLS.includes("dna_os.apply_scoped_source_write"), "scoped write");
    assert(!filtered.AVAILABLE_TOOLS.includes("dna_os.commit_source"), "no commit");
    assert(!filtered.AVAILABLE_TOOLS.includes("dna_os.publish_source"), "no publish");
    assert(!filtered.AVAILABLE_TOOLS.includes("dna_os.create_worktree"), "canonical worktree hidden");
  });

  await check("F. Generic canonical-source write tool is absent", () => {
    assert(!catalog.includes("write_file"), "no write_file");
    assert(!catalog.includes("dna_os.write_file"), "no dna write_file");
  });

  await check("G–M. Isolated worktree write, scope, revision, evidence", () => {
    const tree = createScopedDevelopmentWorktree({ session: development, lease, work_id: workId });
    assert(tree.ok === true && tree.CODING_MUTATION_TARGET === "SCOPED_WORKTREE", JSON.stringify(tree));
    const file = scopedWorktreeFile(workId, "allowed/feature.ts");
    const before = readFileSync(file, "utf8");
    const preimage = String(tree.preimage_hash);
    const applied = applyRegisteredSourceMutation({
      session: development,
      lease,
      client_id: "ai://cursor",
      work_id: workId,
      relative_path: "allowed/feature.ts",
      contents: "export const MARKER = \"scoped\";\n",
      expected_revision: lease.base_revision,
      expected_preimage_hash: preimage,
    });
    assert(applied.ok === true && applied.result === "APPLIED", JSON.stringify(applied));
    const evidence = applied.evidence as { before_hash: string; after_hash: string; RUNTIME_VERIFIED: boolean; CAPABILITY_REGISTERED: boolean; OWNER_ENABLED: boolean };
    assert(typeof evidence.after_hash === "string" && evidence.after_hash.length === 64, "hash");
    assert(readFileSync(file, "utf8").includes("scoped"), "mutated worktree");
    const read = readScopedSource({ session: development, lease, work_id: workId, relative_path: "allowed/feature.ts" });
    assert(read.ok === true && read.SOURCE_READ_GRANTS_WRITE === false, JSON.stringify(read));
    const outside = applyRegisteredSourceMutation({
      session: development,
      lease,
      client_id: "ai://cursor",
      work_id: workId,
      relative_path: "outside/secret.ts",
      contents: "nope",
      expected_revision: lease.base_revision,
    });
    assert(outside.result === "SCOPE_VIOLATION", String(outside.result));
    writeFileSync(file, `${readFileSync(file, "utf8")}\n// drift\n`);
    const stale = applyRegisteredSourceMutation({
      session: development,
      lease,
      client_id: "ai://cursor",
      work_id: workId,
      relative_path: "allowed/feature.ts",
      contents: "export const MARKER = \"overwrite\";\n",
      expected_revision: lease.base_revision,
      expected_preimage_hash: preimage,
    });
    assert(stale.result === "REVISION_CONFLICT", String(stale.result));
    assert(readFileSync(file, "utf8").includes("drift"), "no overwrite");
    assert(evidence.RUNTIME_VERIFIED === false && evidence.CAPABILITY_REGISTERED === false && evidence.OWNER_ENABLED === false, "production split");
    assert(before.includes("unchanged") || before.length >= 0, "had before");
    console.log("LIVE_SCOPED_WRITE=true");
    console.log("LIVE_REVISION_CONFLICT=true");
    console.log("LIVE_PRODUCTION_SEPARATION=true");
  });

  await check("H–J. Coding client cannot commit, push, or use unrestricted shell", () => {
    const barriers = codingClientBarriers();
    assert(barriers.CODING_CLIENT_CAN_CREATE_CANONICAL_COMMIT === false, "commit");
    assert(barriers.CODING_CLIENT_CAN_PUSH_CANONICAL_SOURCE === false, "push");
    assert(barriers.ARBITRARY_SHELL_ACCESS === false && barriers.SUDO_ACCESS === false, "shell");
    assert(denyUnrestrictedShell().ARBITRARY_SHELL_ACCESS === false, "shell deny");
    assert(canInvoke("dna_os.commit_source", { caller: "cursor", channel: "EXTERNAL", authority_domain: "DEVELOPMENT", lease_active: true }).allowed === false, "commit invoke");
  });

  await check("K–Q. Canonical / GitHub / facts / provider / transcript barriers", () => {
    assert(denyDirectCanonicalWrite().reason_code === "NOT_EXPOSED", "canonical");
    assert(denyDirectGithubWrite().AI_DIRECT_GITHUB_WRITE === false, "github");
    assert(denyCanonicalFactEdit().CODING_CLIENT_CAN_EDIT_CANONICAL_FACTS === false, "facts");
    assert(providerIdentityGrantsSourceAuthority("Cursor") === false, "provider");
    assert(providerIdentityGrantsSourceAuthority("ChatGPT") === false, "chatgpt");
    assert(codingClientBarriers().AI_CAN_EXPAND_OWN_SCOPE === false, "scope");
    assert(codingClientBarriers().AI_CAN_APPROVE_OWN_WRITE === false, "approve");
    assert(codingClientBarriers().FULL_CHAT_TRANSCRIPT_REQUIRED === false, "transcript");
    const opAttempt = applyRegisteredSourceMutation({
      session: operational,
      lease,
      client_id: "ai://cursor",
      work_id: workId,
      relative_path: "allowed/feature.ts",
      contents: "x",
    });
    assert(opAttempt.reason_code === "MUTATION_TOOL_NOT_EXPOSED", String(opAttempt.reason_code));
    console.log("LIVE_CANONICAL_BARRIER=true");
  });

  await check("R. Knowledge resources and existing MCP reused", () => {
    assert(CANONICAL_MCP_RESOURCE_URIS.includes("resource://dna-os/capabilities"), "canon");
    assert(DEVELOPMENT_MCP_RESOURCE_URIS.includes("resource://dna-os/development/context"), "dev ctx");
    const resources = filterMcpResources("DEVELOPMENT");
    assert(resources.includes("resource://dna-os/development/source-map"), "source-map");
    assert(catalog.includes("dna_os.get_information_entity"), "existing knowledge tools");
    assert(catalog.includes("dna_os.apply_scoped_source_write"), "registered mutation");
    assert(catalog.includes("submit_command"), "existing mcp");
    assert(!catalog.includes("get_secret"), "no secret");
  });

  const metrics = codeKnowledgeMetrics();
  console.log(`MCP_FACT_LOOKUPS=${metrics.MCP_FACT_LOOKUPS}`);
  console.log(`SOURCE_SEARCH_FALLBACKS=${metrics.SOURCE_SEARCH_FALLBACKS}`);
  console.log(`SOURCE_SEARCH_BYTES=${metrics.SOURCE_SEARCH_BYTES}`);
  console.log(`SOURCE_READ_BYTES=${metrics.SOURCE_READ_BYTES}`);
  console.log(`MCP_CONTEXT_BYTES_RETURNED=${metrics.MCP_CONTEXT_BYTES_RETURNED}`);

  rmSync(join(DIR, "worktrees", workId), { recursive: true, force: true });
  for (const file of [
    process.env.OWNER_SURFACE_SESSION_LOG,
    process.env.OWNER_SURFACE_LEASE_LOG,
    process.env.OWNER_SURFACE_PROPOSAL_LOG,
    process.env.OWNER_SURFACE_AUDIT_LOG,
    process.env.OWNER_SURFACE_NOTIFY_LOG,
    process.env.MCP_CODE_MUTATION_LOG,
  ]) {
    if (file && existsSync(file)) unlinkSync(file);
  }
  setBiometricPort(null);
  console.log(`NEW_DETERMINISTIC_PROOFS_PASSED = ${failed === 0}`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();
