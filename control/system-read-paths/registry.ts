/**
 * หน้าที่: the declared read paths of DNA OS, and the verifier that keeps the
 * declarations honest (Owner, 2026-08-26).
 *
 * Every entry below points at a function that ALREADY EXISTS on a public
 * contract. Nothing here is new capability; this file is an index of what the
 * system can already be asked, written down so it stops being rediscovered by
 * grep. `verifyReadPaths()` resolves each declared symbol in the running
 * process — a declaration whose symbol is absent reports MISSING_SYMBOL rather
 * than being quietly believed.
 *
 * Input: none for the declarations; `verifyReadPaths()` takes nothing and reads
 * the real modules.
 * Output: `READ_PATHS`, `verifyReadPaths()`, `readPathCircuitGraph()`.
 * Dependency ที่อนุญาต: ./types.ts, and the public contracts of the providers it
 * indexes — imported ONLY to verify the symbols exist.
 * สิ่งที่ห้ามแตะ:
 * - ห้ามเพิ่ม entry ที่ไม่มี provider จริง.
 * - ห้าม import ไฟล์ภายในของ capability อื่น — public contract เท่านั้น (that is
 *   what makes NOT_ON_PUBLIC_CONTRACT a real, reportable status rather than an
 *   excuse to reach in).
 * - ห้ามให้ UI edge ถูกสร้างจากอย่างอื่นนอกจาก declaration ในไฟล์นี้.
 */

import type { ReadPathDeclaration, ReadPathVerification } from "./types";

import * as gateway from "../agent-gateway/contract";
import * as registryDatabase from "../../software/registry-database/contract";
import * as commandRouter from "../command-router/contract";
import * as executionRun from "../../execution/run/contract";
import { blueprintReadPathStatus } from "./blueprint-index";

export const READ_PATHS: readonly ReadPathDeclaration[] = [
  {
    id: "RP-RESOURCE-BY-ID",
    domain: "RESOURCE",
    answers: "which canonical resource is this resource_id, and what does the graph hold about it",
    request: { sends: ["resource_id", "store"], lookup_key: "resource_id", never_sends: ["free-text phrase", "Owner language"] },
    response: { returns: ["resource_id", "resource_type", "source_location", "version", "content_hash", "status"], provenance: "RESOURCE_GRAPH", failure_state: "null — the id is not in the graph", carries_evidence: false },
    provider: { capability: "software/registry-database", contract_path: "software/registry-database/contract.ts", symbol: "findResourceById" },
    evidence: ["software/registry-database/lookup.ts#findResourceById", "software/registry-database/types.ts#ResourceRow"],
  },
  {
    id: "RP-CAPABILITY-REGISTERED",
    domain: "CAPABILITY",
    answers: "what does the registry database hold for this capability — contracts, source locations, dependencies, evidence refs",
    request: { sends: ["capability_id | canonical_name | semantic_fingerprint", "store"], lookup_key: "capability_id", never_sends: ["free-text phrase"] },
    response: { returns: ["capability_id", "resource_ids", "source_location", "input_contract", "output_contract", "dependencies", "evidence_refs", "status"], provenance: "RESOURCE_GRAPH", failure_state: "null — not registered", carries_evidence: true },
    provider: { capability: "software/registry-database", contract_path: "software/registry-database/contract.ts", symbol: "findCapability" },
    evidence: ["software/registry-database/lookup.ts#findCapability", "software/registry-database/types.ts#CapabilityLookupResult"],
  },
  {
    id: "RP-CAPABILITY-ROUTABLE",
    domain: "CAPABILITY",
    answers: "which capabilities the router can actually route to, and on what keywords",
    request: { sends: ["capability_id (or nothing, to list)"], lookup_key: "capability_id", never_sends: ["Owner language"] },
    response: { returns: ["capability_id", "repo_id", "contract", "endpoint", "supported_commands", "match_keyword_sets", "permission_requirement", "health_status"], provenance: "REGISTRY", failure_state: "undefined — not a routable capability", carries_evidence: false },
    provider: { capability: "control/command-router", contract_path: "control/command-router/contract.ts", symbol: "getCapability" },
    evidence: ["control/command-router/capability-registry.ts#CAPABILITY_REGISTRY"],
  },
  {
    id: "RP-COMMAND-DESCRIPTOR",
    domain: "CAPABILITY",
    answers: "which registered command descriptors exist, and what policy each declares",
    request: { sends: ["command_id (or nothing, to list)"], lookup_key: "command_id", never_sends: ["Owner language"] },
    response: { returns: ["command_id", "required_capability", "allowed_actions", "allowed_cwd_scope_prefixes"], provenance: "REGISTRY", failure_state: "undefined — no such descriptor", carries_evidence: false },
    provider: { capability: "execution/run", contract_path: "execution/run/contract.ts", symbol: "listCommandDescriptors" },
    evidence: ["execution/run/registry.ts", "execution/run/policy-descriptor.ts#projectCommandPolicyDescriptor"],
  },
  {
    id: "RP-TASK-STATE",
    domain: "TASK",
    answers: "what is the current state of this task",
    request: { sends: ["task_id"], lookup_key: "task_id", never_sends: ["Owner language"] },
    response: { returns: ["task_id", "status", "created_at", "updated_at", "next_action", "output_lane"], provenance: "RUNTIME", failure_state: "undefined — unknown task_id", carries_evidence: false },
    provider: { capability: "control/agent-gateway", contract_path: "control/agent-gateway/contract.ts", symbol: "getTask" },
    evidence: ["control/agent-gateway/gateway.ts#getTask", "control/agent-gateway/memory-store.ts#loadTask"],
  },
  {
    id: "RP-TASK-EXPLANATION",
    domain: "TASK",
    answers: "the recorded explanation of what happened to this task",
    request: { sends: ["task_id"], lookup_key: "task_id", never_sends: ["Owner language"] },
    response: { returns: ["explanation record"], provenance: "RUNTIME", failure_state: "undefined — nothing recorded", carries_evidence: true },
    provider: { capability: "control/agent-gateway", contract_path: "control/agent-gateway/contract.ts", symbol: "explain" },
    evidence: ["control/agent-gateway/gateway.ts#explain"],
  },
  {
    id: "RP-EVIDENCE-BY-TASK",
    domain: "EVIDENCE",
    answers: "every evidence row recorded against this task",
    request: { sends: ["task_id"], lookup_key: "task_id", never_sends: ["Owner language"] },
    response: { returns: ["evidence_id", "task_id", "kind", "source", "recorded_at", "payload"], provenance: "EVIDENCE", failure_state: "[] — no rows for this task", carries_evidence: true },
    provider: { capability: "control/agent-gateway", contract_path: "control/agent-gateway/contract.ts", symbol: "loadEvidenceForTask" },
    evidence: ["control/agent-gateway/memory-store.ts#loadEvidenceForTask", "DNA-OS-BLUEPRINT blueprint/03-RUNTIME_TOPOLOGY.md:1019 lists this read API"],
  },
  {
    id: "RP-EVIDENCE-BY-CAPABILITY",
    domain: "EVIDENCE",
    answers: "the evidence references the registry holds for a registered capability",
    request: { sends: ["capability_id", "store"], lookup_key: "capability_id", never_sends: ["Owner language"] },
    response: { returns: ["evidence_refs"], provenance: "EVIDENCE", failure_state: "null capability, or an empty evidence_refs array", carries_evidence: true },
    provider: { capability: "software/registry-database", contract_path: "software/registry-database/contract.ts", symbol: "findCapability" },
    evidence: ["software/registry-database/types.ts#CapabilityLookupResult.evidence_refs"],
  },
  {
    id: "RP-TASK-HANDOFFS",
    domain: "TASK",
    answers: "the agent handoffs recorded for this task",
    request: { sends: ["task_id"], lookup_key: "task_id", never_sends: ["Owner language"] },
    response: { returns: ["HandoffRecord[]"], provenance: "HISTORY", failure_state: "[] — no handoffs", carries_evidence: true },
    provider: { capability: "control/agent-gateway", contract_path: "control/agent-gateway/contract.ts", symbol: "loadHandoffsForTask" },
    evidence: ["control/agent-gateway/memory-store.ts#loadHandoffsForTask"],
  },
  {
    id: "RP-EVENT-JOINTS",
    domain: "EVENT",
    answers: "the cross-capability joint events the collector observed",
    request: { sends: ["HTTP GET /joints to JOINT_MONITOR_URL"], lookup_key: "collector base url", never_sends: ["Owner language", "credentials beyond the collector's own shared secret"] },
    response: { returns: ["event_id", "from_capability", "to_capability", "task_id", "status", "occurred_at", "occurred_seq", "received_at", "source"], provenance: "RUNTIME", failure_state: "HTTP error, or an empty joints array", carries_evidence: true },
    provider: { capability: "observability/joint-monitor", contract_path: "observability/joint-monitor/contract.ts", symbol: "JointStore" },
    evidence: ["observability/joint-monitor/server.ts GET /joints", "observability/joint-monitor/joint-store.ts#snapshot"],
  },
  {
    id: "RP-STATE-TASK",
    domain: "STATE",
    answers: "the current proven state of an entity that has a task_id, and when it was observed",
    request: { sends: ["task_id"], lookup_key: "task_id", never_sends: ["Owner language"] },
    response: { returns: ["status", "updated_at (observed_at)"], provenance: "RUNTIME", failure_state: "undefined — unknown task_id", carries_evidence: false },
    provider: { capability: "control/agent-gateway", contract_path: "control/agent-gateway/contract.ts", symbol: "getTask" },
    evidence: ["control/agent-gateway/gateway.ts#getTask"],
  },
  {
    id: "RP-DOCUMENT-BLUEPRINT",
    domain: "DOCUMENT",
    answers: "which DNA-OS-BLUEPRINT claims reference this source symbol or path",
    request: { sends: ["source reference (repo-relative path, or symbol name)"], lookup_key: "source_reference", never_sends: ["Owner language", "document content to be rewritten"] },
    response: { returns: ["document_id", "repository", "path", "section", "claim", "source_reference", "implementation_reference", "verification_reference", "revision"], provenance: "DOCUMENT", failure_state: "NO_RUNTIME_CONTRACT when the external repository is not reachable; [] when it is reachable and nothing references this source", carries_evidence: true },
    provider: { capability: "control/system-read-paths", contract_path: "control/system-read-paths/contract.ts", symbol: "readBlueprintReferences" },
    evidence: ["DNA-OS-BLUEPRINT blueprint/_SOURCE_SYMBOL_INDEX.md", "DNA-OS-BLUEPRINT blueprint/*.md [SOURCE: ...] claims"],
  },
];

/** Resolves a declared symbol on its real provider module. Returns undefined when the symbol is not on that public contract. */
function resolveSymbol(contractPath: string, symbol: string): unknown {
  const modules: Record<string, Record<string, unknown>> = {
    "control/agent-gateway/contract.ts": gateway as unknown as Record<string, unknown>,
    "software/registry-database/contract.ts": registryDatabase as unknown as Record<string, unknown>,
    "control/command-router/contract.ts": commandRouter as unknown as Record<string, unknown>,
    "execution/run/contract.ts": executionRun as unknown as Record<string, unknown>,
  };
  const module = modules[contractPath];
  return module ? module[symbol] : undefined;
}

/**
 * Checks every declaration against the RUNNING process, not against source
 * text. This is the mechanism that would have caught `loadEvidenceForTask`
 * being available and unused: a declared path either resolves to a real
 * function here, or it is reported as broken.
 */
export function verifyReadPaths(): readonly ReadPathVerification[] {
  return READ_PATHS.map((path) => {
    if (path.id === "RP-DOCUMENT-BLUEPRINT") {
      const status = blueprintReadPathStatus();
      return { id: path.id, status: status.reachable ? "VERIFIED" : "NO_RUNTIME_CONTRACT", detail: status.detail };
    }
    if (path.provider.contract_path === "observability/joint-monitor/contract.ts") {
      return { id: path.id, status: "NOT_ON_PUBLIC_CONTRACT", detail: "observability/joint-monitor/contract.ts exports the JointStore class, not a process-wide read function — this path is exercised over its HTTP surface (GET /joints), which cannot be verified by symbol resolution" };
    }
    const resolved = resolveSymbol(path.provider.contract_path, path.provider.symbol);
    if (typeof resolved === "function") {
      return { id: path.id, status: "VERIFIED", detail: `${path.provider.contract_path}#${path.provider.symbol} resolves to a real function in this process` };
    }
    return { id: path.id, status: "MISSING_SYMBOL", detail: `${path.provider.contract_path} does not export a callable "${path.provider.symbol}"` };
  });
}

/**
 * The circuit view. Each declared path becomes TWO directed edges — never one
 * `↔` — so the UI renders what is sent and what comes back as separate
 * relationships with separate schemas. Nodes and edges are generated from
 * `READ_PATHS` only: nothing here is guessed, and every edge carries the
 * provider's contract path as its own evidence.
 */
export function readPathCircuitGraph(): {
  nodes: { id: string; label: string; kind: string; source_note: string }[];
  edges: { id: string; from: string; to: string; direction: "REQUEST" | "RESPONSE"; schema: readonly string[]; provenance?: string; evidence: readonly string[] }[];
} {
  const caller = { id: "SYSTEM_RESOLUTION", label: "SYSTEM RESOLUTION", kind: "function", source_note: "control/owner-command-semantics/resolver.ts — the deterministic half that issues these reads" };
  const nodes = [caller, ...READ_PATHS.map((path) => ({
    id: `READ_${path.id.replace(/-/g, "_")}`,
    label: path.id,
    kind: "read_path",
    source_note: `${path.provider.contract_path}#${path.provider.symbol} — ${path.answers}`,
  }))];

  const edges = READ_PATHS.flatMap((path) => {
    const target = `READ_${path.id.replace(/-/g, "_")}`;
    return [
      { id: `${path.id}_REQUEST`, from: caller.id, to: target, direction: "REQUEST" as const, schema: path.request.sends, evidence: [`lookup_key=${path.request.lookup_key}`, ...path.evidence] },
      { id: `${path.id}_RESPONSE`, from: target, to: caller.id, direction: "RESPONSE" as const, schema: path.response.returns, provenance: path.response.provenance, evidence: [`failure_state=${path.response.failure_state}`, ...path.evidence] },
    ];
  });

  return { nodes, edges };
}
