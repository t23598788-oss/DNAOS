import { createHash, randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { listEntitiesByType, queryEntityByCanonicalName, getRelationships, getFacts } from "../canonical-information/query";
import { ensureSafeCanonicalIngest, ingestSafeCanonicalSources } from "../canonical-information/ingest-safe";
import { leaseIsActive } from "../owner-surface-separation/contract";
import type { DevelopmentAuthorityLeaseV1, OwnerSurfaceSessionV1 } from "../owner-surface-separation/contract";

export const MCP_CONTROLLED_CODE_KNOWLEDGE_ACCESS = "MCP_CONTROLLED_CODE_KNOWLEDGE_ACCESS_V1" as const;
export const DNA_OS_REGISTERED_MUTATION_TOOL_BOUNDARY = "DNA_OS_REGISTERED_MUTATION_TOOL_BOUNDARY_V1" as const;

export const DEVELOPMENT_KNOWLEDGE_URIS = [
  "resource://dna-os/development/context",
  "resource://dna-os/development/dependencies",
  "resource://dna-os/development/source-map",
  "resource://dna-os/development/tests",
  "resource://dna-os/development/work-order",
] as const;

export const SOURCE_MUTATION_TOOLS = [
  "dna_os.modify_source",
  "dna_os.apply_scoped_source_write",
  "dna_os.create_scoped_source_file",
  "dna_os.delete_scoped_source_file",
  "dna_os.create_scoped_development_workspace",
  "dna_os.read_scoped_source",
  "dna_os.invoke_coding_worker",
] as const;

export const CANONICAL_PROMOTION_TOOLS = [
  "dna_os.commit_source",
  "dna_os.publish_source",
  "dna_os.create_worktree",
] as const;

/**
 * Engineering-agent bootstrap on the existing MCP knowledge contract.
 * Not a second policy engine: extends MCP_KNOWLEDGE_QUERY_FIRST.
 */
export const ENGINEERING_SESSION_BOOTSTRAP = {
  MCP_KNOWLEDGE_QUERY_FIRST: true,
  SOURCE_SEARCH_REQUIRED_DEFAULT: false,
  historical_requires_explicit_include_historical: true,
  non_authoritative: ["ai_memory", "ide_index", "local_file_cache", "chat_history"] as const,
  steps: [
    "dna_os.get_current_work_context",
    "dna_os.resolve_current_source",
    "dna_os.lookup_code_references",
    "targeted_read_of_returned_paths",
  ] as const,
  broad_search_only_when: "SOURCE_SEARCH_REQUIRED=true or returned references are insufficient",
} as const;

const metrics = {
  MCP_FACT_LOOKUPS: 0,
  SOURCE_SEARCH_FALLBACKS: 0,
  SOURCE_SEARCH_BYTES: 0,
  SOURCE_READ_BYTES: 0,
  MCP_CONTEXT_BYTES_RETURNED: 0,
};

export function codeKnowledgeMetrics(): typeof metrics {
  return { ...metrics };
}

export function codingKnowledgeFirst(capability_id: string): {
  readonly MCP_KNOWLEDGE_QUERY_FIRST: true;
  readonly SOURCE_SEARCH_REQUIRED: false;
  readonly entity: unknown;
  readonly ownership: readonly string[];
  readonly dependencies: readonly string[];
  readonly SOURCE_VISIBILITY_GRANTS_AUTHORITY: false;
  readonly SOURCE_READ_GRANTS_WRITE: false;
} {
  ingestSafeCanonicalSources();
  ensureSafeCanonicalIngest();
  metrics.MCP_FACT_LOOKUPS += 1;
  const entity = queryEntityByCanonicalName(capability_id)
    ?? listEntitiesByType("CAPABILITY").find((row) => row.canonical_name === capability_id || row.entity_id.includes(capability_id))
    ?? listEntitiesByType("CAPABILITY")[0]
    ?? null;
  const rels = entity ? getRelationships(entity.entity_id) : [];
  const payload = {
    MCP_KNOWLEDGE_QUERY_FIRST: true as const,
    SOURCE_SEARCH_REQUIRED: false as const,
    entity,
    ownership: rels.filter((row) => row.relationship_type === "OWNED_BY" || row.relationship_type === "EXPOSES").map((row) => `${row.from_entity_id}->${row.to_entity_id}`),
    dependencies: rels.filter((row) => row.relationship_type === "DEPENDS_ON").map((row) => row.to_entity_id),
    SOURCE_VISIBILITY_GRANTS_AUTHORITY: false as const,
    SOURCE_READ_GRANTS_WRITE: false as const,
  };
  metrics.MCP_CONTEXT_BYTES_RETURNED += Buffer.byteLength(JSON.stringify(payload));
  return payload;
}

export function developmentContext(input: {
  readonly work_id: string;
  readonly lease: DevelopmentAuthorityLeaseV1 | null;
  readonly goal: string;
}): Record<string, unknown> {
  ingestSafeCanonicalSources();
  ensureSafeCanonicalIngest();
  metrics.MCP_FACT_LOOKUPS += 1;
  const ctx = {
    schema: "MCP_DEVELOPMENT_CONTEXT_V1",
    work_id: input.work_id,
    goal: input.goal,
    target_repository: input.lease?.repository_id ?? "repo://owner-surface-fixture",
    base_revision: input.lease?.base_revision ?? "UNCOMMITTED",
    target_components: input.lease?.allowed_components ?? ["owner-surface-fixture"],
    relevant_resources: listEntitiesByType("CAPABILITY").slice(0, 8).map((row) => row.canonical_name),
    source_handles: ["resource://local/dev/scoped-worktree"],
    dependency_refs: getFacts("entity:system:dna-os").map((row) => row.key),
    test_refs: ["control/mcp-code-knowledge/tests"],
    allowed_paths: input.lease?.allowed_paths ?? [],
    forbidden_paths: input.lease?.forbidden_paths ?? [],
    acceptance_criteria: ["scoped worktree only", "revision checked", "evidence required"],
    authority_state: input.lease && leaseIsActive(input.lease) ? "LEASE_ACTIVE" : "DEVELOPMENT_SOURCE_AUTHORITY_DENY",
    FULL_CHAT_TRANSCRIPT_REQUIRED: false,
    ENGINEERING_SESSION_BOOTSTRAP,
    cacheScope: "private",
    ttl: 15,
  };
  metrics.MCP_CONTEXT_BYTES_RETURNED += Buffer.byteLength(JSON.stringify(ctx));
  return ctx;
}

export function filterMcpTools(input: {
  readonly authority_domain?: "OPERATIONAL" | "DEVELOPMENT";
  readonly lease_active?: boolean;
  readonly tool_names: readonly string[];
}): { readonly AVAILABLE_TOOLS: readonly string[]; readonly CLIENT_SEES_ONLY_REQUIRED_MUTATION_TOOLS: true } {
  const available = input.tool_names.filter((name) => {
    const mutation = (SOURCE_MUTATION_TOOLS as readonly string[]).includes(name);
    const promotion = (CANONICAL_PROMOTION_TOOLS as readonly string[]).includes(name);
    if (promotion) return false;
    if (name === "write_file" || name === "dna_os.write_file") return false;
    if (name === "dna_os.get_coding_knowledge" || name === "dna_os.get_development_context") {
      return input.authority_domain === "DEVELOPMENT";
    }
    if (input.authority_domain !== "DEVELOPMENT") {
      if (mutation || name === "dna_os.submit_development_control") return false;
      return true;
    }
    if (!input.lease_active) return !mutation;
    return true;
  });
  return { AVAILABLE_TOOLS: available, CLIENT_SEES_ONLY_REQUIRED_MUTATION_TOOLS: true };
}

export function filterMcpResources(domain: "OPERATIONAL" | "DEVELOPMENT" | undefined): readonly string[] {
  const base = [
    "resource://dna-os/system",
    "resource://dna-os/capabilities",
    "resource://dna-os/connections",
    "resource://dna-os/resources",
    "resource://dna-os/work",
    "resource://dna-os/activity",
    "resource://dna-os/production",
    "resource://dna-os/runtime",
    "resource://dna-os/schemas/canonical-information-v1",
  ];
  if (domain !== "DEVELOPMENT") return base;
  return [...base, ...DEVELOPMENT_KNOWLEDGE_URIS];
}

function sha(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function worktreeRoot(work_id: string): string {
  return join(process.cwd(), "control/mcp-code-knowledge/data/worktrees", work_id);
}

export function createScopedDevelopmentWorktree(input: {
  readonly session: OwnerSurfaceSessionV1;
  readonly lease: DevelopmentAuthorityLeaseV1 | null;
  readonly work_id: string;
}): Record<string, unknown> {
  if (input.session.authority_domain !== "DEVELOPMENT") {
    return { ok: false, reason_code: "MUTATION_TOOL_NOT_EXPOSED", CODING_MUTATION_TARGET: "SCOPED_WORKTREE" };
  }
  if (!input.lease || !leaseIsActive(input.lease)) {
    return { ok: false, reason_code: "DEVELOPMENT_AUTHORITY_REQUIRED", MUTATION_TOOL_NOT_EXPOSED: true };
  }
  const root = worktreeRoot(input.work_id);
  mkdirSync(join(root, "allowed"), { recursive: true });
  const src = join(process.cwd(), "control/owner-surface-separation/fixtures/allowed/feature.ts");
  const dest = join(root, "allowed/feature.ts");
  if (existsSync(src)) copyFileSync(src, dest);
  else writeFileSync(dest, "export const MARKER = \"unchanged\";\n");
  return {
    ok: true,
    CODING_MUTATION_TARGET: "SCOPED_WORKTREE",
    CANONICAL_MAIN_WORKTREE: false,
    worktree: root,
    base_revision: input.lease.base_revision,
    file: dest,
    preimage_hash: sha(readFileSync(dest, "utf8")),
  };
}

export function applyRegisteredSourceMutation(input: {
  readonly session: OwnerSurfaceSessionV1;
  readonly lease: DevelopmentAuthorityLeaseV1 | null;
  readonly client_id: string;
  readonly work_id: string;
  readonly relative_path: string;
  readonly contents: string;
  readonly expected_revision?: string;
  readonly expected_preimage_hash?: string;
}): Record<string, unknown> {
  if (input.session.authority_domain !== "DEVELOPMENT") {
    return { ok: false, result: "DENIED", reason_code: "MUTATION_TOOL_NOT_EXPOSED" };
  }
  if (!input.lease || !leaseIsActive(input.lease) || input.lease.surface_session_id !== input.session.session_id) {
    return { ok: false, result: "DENIED", reason_code: "DEVELOPMENT_AUTHORITY_REQUIRED" };
  }
  const root = worktreeRoot(input.work_id);
  if (!existsSync(root)) {
    return { ok: false, result: "DENIED", reason_code: "SCOPED_WORKTREE_REQUIRED", CODING_MUTATION_TARGET: "SCOPED_WORKTREE" };
  }
  const abs = resolve(root, input.relative_path);
  const rel = relative(root, abs);
  if (rel.startsWith("..")) {
    return { ok: false, result: "SCOPE_VIOLATION", reason_code: "SCOPE_VIOLATION" };
  }
  if (!rel.startsWith("allowed/") && rel !== "allowed") {
    return { ok: false, result: "SCOPE_VIOLATION", reason_code: "SCOPE_VIOLATION" };
  }
  if (input.expected_revision && input.expected_revision !== input.lease.base_revision) {
    return { ok: false, result: "REVISION_CONFLICT", reason_code: "REVISION_CONFLICT" };
  }
  const before = existsSync(abs) ? readFileSync(abs, "utf8") : "";
  const before_hash = sha(before);
  if (input.expected_preimage_hash && input.expected_preimage_hash !== before_hash) {
    return { ok: false, result: "REVISION_CONFLICT", reason_code: "REVISION_CONFLICT" };
  }
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, input.contents);
  const after_hash = sha(input.contents);
  const evidence = {
    schema: "REGISTERED_SOURCE_MUTATION_EVIDENCE_V1",
    mutation_id: `mut-${randomUUID()}`,
    work_id: input.work_id,
    lease_id: input.lease.lease_id,
    client_id: input.client_id,
    resource: rel,
    before_hash,
    after_hash,
    diff_ref: `diff:${before_hash}:${after_hash}`,
    timestamp: new Date().toISOString(),
    authority_evidence: input.lease.authority_evidence_ref,
    RUNTIME_VERIFIED: false,
    CAPABILITY_REGISTERED: false,
    OWNER_ENABLED: false,
  };
  const envLog = process.env.MCP_CODE_MUTATION_LOG;
  const log = envLog && envLog.startsWith("/")
    ? envLog
    : join(process.cwd(), "control/mcp-code-knowledge/data", envLog ?? "mutations.jsonl");
  mkdirSync(dirname(log), { recursive: true });
  writeFileSync(log, existsSync(log) ? `${readFileSync(log, "utf8")}${JSON.stringify(evidence)}\n` : `${JSON.stringify(evidence)}\n`);
  metrics.SOURCE_READ_BYTES += Buffer.byteLength(before);
  return {
    ok: true,
    result: "APPLIED",
    CODING_MUTATION_TARGET: "SCOPED_WORKTREE",
    evidence,
    SOURCE_MUTATION_NE_CAPABILITY_REGISTERED: true,
  };
}

export function codingClientBarriers(): Record<string, boolean | string> {
  return {
    AI_DIRECT_CANONICAL_SOURCE_WRITE: false,
    CODING_CLIENT_DIRECT_CANONICAL_SOURCE_WRITE: false,
    AI_DIRECT_GITHUB_WRITE: false,
    CODING_CLIENT_DIRECT_GITHUB_WRITE: false,
    CODING_CLIENT_CAN_CREATE_CANONICAL_COMMIT: false,
    CODING_CLIENT_CAN_PUSH_CANONICAL_SOURCE: false,
    CODING_CLIENT_CAN_EDIT_CANONICAL_FACTS: false,
    SOURCE_READ_GRANTS_WRITE: false,
    SOURCE_VISIBILITY_GRANTS_AUTHORITY: false,
    PROVIDER_IDENTITY_GRANTS_SOURCE_AUTHORITY: false,
    ARBITRARY_SHELL_ACCESS: false,
    SUDO_ACCESS: false,
    AI_CAN_EXPAND_OWN_SCOPE: false,
    AI_CAN_APPROVE_OWN_WRITE: false,
    FULL_CHAT_TRANSCRIPT_REQUIRED: false,
    CODING_MUTATION_TARGET: "SCOPED_WORKTREE",
    CANONICAL_MAIN_WORKTREE: false,
  };
}

export function denyDirectCanonicalWrite(): { ok: false; reason_code: "NOT_EXPOSED" } {
  return { ok: false, reason_code: "NOT_EXPOSED" };
}

export function denyDirectGithubWrite(): { ok: false; reason_code: "NOT_EXPOSED"; AI_DIRECT_GITHUB_WRITE: false } {
  return { ok: false, reason_code: "NOT_EXPOSED", AI_DIRECT_GITHUB_WRITE: false };
}

export function denyCanonicalFactEdit(): { ok: false; reason_code: "NOT_EXPOSED"; CODING_CLIENT_CAN_EDIT_CANONICAL_FACTS: false } {
  return { ok: false, reason_code: "NOT_EXPOSED", CODING_CLIENT_CAN_EDIT_CANONICAL_FACTS: false };
}

export function denyUnrestrictedShell(): { ok: false; reason_code: "ARBITRARY_SHELL_ACCESS"; ARBITRARY_SHELL_ACCESS: false; SUDO_ACCESS: false } {
  return { ok: false, reason_code: "ARBITRARY_SHELL_ACCESS", ARBITRARY_SHELL_ACCESS: false, SUDO_ACCESS: false };
}

export function providerIdentityGrantsSourceAuthority(_provider: string): false {
  return false;
}

export function scopedWorktreeFile(work_id: string, relative_path: string): string {
  return join(worktreeRoot(work_id), relative_path);
}

export function readScopedSource(input: {
  readonly session: OwnerSurfaceSessionV1;
  readonly lease: DevelopmentAuthorityLeaseV1 | null;
  readonly work_id: string;
  readonly relative_path: string;
}): Record<string, unknown> {
  if (input.session.authority_domain !== "DEVELOPMENT" || !input.lease || !leaseIsActive(input.lease)) {
    return { ok: false, reason_code: "DEVELOPMENT_AUTHORITY_REQUIRED", SOURCE_READ_GRANTS_WRITE: false };
  }
  const abs = resolve(worktreeRoot(input.work_id), input.relative_path);
  const rel = relative(worktreeRoot(input.work_id), abs);
  if (rel.startsWith("..") || !existsSync(abs)) {
    return { ok: false, reason_code: "SCOPE_VIOLATION", SOURCE_READ_GRANTS_WRITE: false };
  }
  const text = readFileSync(abs, "utf8");
  metrics.SOURCE_READ_BYTES += Buffer.byteLength(text);
  metrics.MCP_CONTEXT_BYTES_RETURNED += Buffer.byteLength(text);
  return {
    ok: true,
    resource_handle: `resource://local/dev/scoped-worktree/${rel}`,
    relative_path: rel,
    content: text,
    bytes: Buffer.byteLength(text),
    SOURCE_BYTES_READ: Buffer.byteLength(text),
    SOURCE_READ_GRANTS_WRITE: false,
    SOURCE_VISIBILITY_GRANTS_AUTHORITY: false,
  };
}
