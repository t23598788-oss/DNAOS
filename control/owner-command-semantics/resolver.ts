/**
 * หน้าที่: the deterministic half of `control/owner-command-semantics/` — the
 * part that turns the model's WORDS into PROVEN references, or refuses to
 * (Owner, 2026-08-26).
 *
 * The division is absolute. `./semantic-runner.py` may say "the Owner seems to
 * have called it 'ตัวคำนวณอันเมื่อกี้'". Only this file may say "that is
 * capability X", and only by finding X in a real registry and recording what
 * proved it. Three outcomes, no fourth:
 *   exactly one real match + evidence -> RESOLVER_MATCHED
 *   more than one                     -> RESOLVER_AMBIGUOUS (candidates listed)
 *   none                              -> RESOLVER_UNRESOLVED
 * There is no "probably". A mention this file cannot prove stays unproven and
 * travels downstream as `unresolved_refs`, never as a target.
 *
 * Every lookup goes to something that already existed: `../command-router/`'s
 * capability registry, `../../execution/run/`'s command descriptors,
 * `../../permissions/`'s identity/account/workspace/membership stores,
 * `../../software/registry-database/`'s resource graph, and this layer's own
 * durable history. Nothing here invents a capability, a resource, or an id.
 *
 * Input: the Owner's raw text + identity, and (optionally) a `RegistryStore`
 * for the resource graph.
 * Output: `StructuredOwnerContext` — the model's reading and the proven
 * references, kept apart, with a per-field `source_trace`.
 * Dependency ที่อนุญาต: ./types.ts, ./ai-contract.ts,
 * `../command-router/contract.ts`, `../../execution/run/contract.ts`,
 * `../../software/registry-database/contract.ts` (type + lookup only), node built-ins.
 * สิ่งที่ห้ามแตะ:
 * - ห้ามให้ค่าใดๆ จากโมเดลกลายเป็น id โดยไม่ผ่านการค้นทะเบียนจริง.
 * - ห้ามคืน RESOLVER_MATCHED โดยไม่มี evidence_refs.
 * - ห้ามเขียนทะเบียนใดๆ จากไฟล์นี้ — read-only ทุกการเรียก.
 * - ห้ามเดา continuation จากความคล้ายของข้อความ — resolve ได้เฉพาะจาก history
 *   record จริงที่ layer นี้เขียนไว้เอง.
 */

declare const require: any;
declare const process: { env: Record<string, string | undefined> };
declare const __dirname: string;

import { validateAiInterpretation } from "./ai-contract";
import type { AiSemanticInterpretation, ResolvedReference, SourceTraceEntry, StructuredOwnerContext } from "./types";
import { listCapabilities } from "../command-router/contract";
import { listCommandDescriptors } from "../../execution/run/contract";
import type { RegistryStore } from "../../software/registry-database/contract";
import { findResourceById, findCapability } from "../../software/registry-database/contract";

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const os = require("node:os");

const HISTORY_FILE = path.join(__dirname, "data", "semantic-history.jsonl");

export interface SemanticDeps {
  /** The resource graph. Injected, never constructed here — this folder must not choose a storage adapter for someone else. */
  registryStore?: RegistryStore;
  /** Where the model process runs. A fresh directory holding only its input. */
  sandboxDir?: string;
}

export type SemanticOutcome =
  | { ok: true; context: StructuredOwnerContext }
  | { ok: false; stage: "MODEL" | "CONTRACT"; reasons: string[] };

// ---------------------------------------------------------------------------
// The model call — isolated, and never trusted afterwards
// ---------------------------------------------------------------------------

function runModel(rawText: string, sandboxDir: string): { ok: true; raw: string } | { ok: false; reason: string } {
  try {
    fs.mkdirSync(sandboxDir, { recursive: true });
    fs.writeFileSync(path.join(sandboxDir, "input.json"), JSON.stringify({ raw_text: rawText }));
    const launcher = path.join(__dirname, "run-semantic.sh");
    const raw = execFileSync(launcher, [sandboxDir, "input.json"], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
    return { ok: true, raw: String(raw) };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

// ---------------------------------------------------------------------------
// Resolution — one function per real store
// ---------------------------------------------------------------------------

/**
 * A mention is only usable if the Owner actually said it. Measured
 * 2026-08-26: asked to label "เอาตัวเดิมต่อ", the model returned
 * previous_context_reference "อันเมื่อกี้" — a plausible Thai phrase for the
 * same idea that appears nowhere in what the Owner typed. The model's reading
 * is still preserved on `context.ai` for inspection, but a phrase that cannot
 * be pointed to in the Owner's own text is never resolved against a registry:
 * resolving a paraphrase would mean the proven id traces back to the model's
 * words, not the Owner's.
 */
function isOwnerQuoted(mention: string, rawText: string): boolean {
  return rawText.toLocaleLowerCase().includes(mention.toLocaleLowerCase());
}

function unresolved(mention: string, kind: ResolvedReference["kind"], detail: string): ResolvedReference {
  return { mention, status: "RESOLVER_UNRESOLVED", resolved_id: null, kind, provenance: "AI_INTERPRETATION", evidence_refs: [detail], candidates: [] };
}

/**
 * Capability, resolved against `../command-router/`'s registry using the
 * registry's OWN `match_keyword_sets` — the same data the router already
 * matches on, so this layer cannot disagree with the router about what a
 * phrase means. An exact `capability_id` in the text is honoured too, but only
 * because it was found in the registry, never because the model said it.
 */
export function resolveCapabilityMention(mention: string): ResolvedReference {
  const normalized = mention.toLocaleLowerCase();
  const registered = listCapabilities();

  const exact = registered.filter((cap) => normalized.includes(cap.capability_id.toLocaleLowerCase()));
  const byKeywords = registered.filter((cap) => cap.match_keyword_sets.some((set) => set.every((keyword) => normalized.includes(keyword.toLocaleLowerCase()))));
  const matches = exact.length > 0 ? exact : byKeywords;

  if (matches.length === 0) return unresolved(mention, "capability", "no registered capability matched this phrase");
  if (matches.length > 1) {
    return {
      mention,
      status: "RESOLVER_AMBIGUOUS",
      resolved_id: null,
      kind: "capability",
      provenance: "REGISTRY",
      evidence_refs: ["control/command-router/capability-registry.ts#match_keyword_sets"],
      candidates: matches.map((m) => m.capability_id),
    };
  }
  return {
    mention,
    status: "RESOLVER_MATCHED",
    resolved_id: matches[0].capability_id,
    kind: "capability",
    provenance: "REGISTRY",
    evidence_refs: [`control/command-router/capability-registry.ts#${matches[0].capability_id}`, `contract=${matches[0].contract}`],
    candidates: [],
  };
}

/**
 * Resource, resolved against the real resource graph. The graph only answers
 * exact `resource_id` / `canonical_name` lookups (see
 * software/registry-database/lookup.ts) — there is no free-text search — so a
 * phrase that is not one of those two things is UNRESOLVED, which is the
 * correct answer rather than a shortfall to paper over.
 */
export function resolveResourceMention(mention: string, store: RegistryStore | undefined): ResolvedReference {
  if (!store) return unresolved(mention, "resource", "no resource graph store was provided to this resolution");
  const byId = findResourceById(mention, store);
  if (byId) {
    return { mention, status: "VERIFIED_REFERENCE", resolved_id: mention, kind: "resource", provenance: "RESOURCE_GRAPH", evidence_refs: [`software/registry-database#resource:${mention}`], candidates: [] };
  }
  const byName = findCapability({ canonical_name: mention }, store);
  if (byName) {
    const id = (byName as { capability?: { capability_id?: string } }).capability?.capability_id ?? null;
    if (id) return { mention, status: "VERIFIED_REFERENCE", resolved_id: id, kind: "resource", provenance: "RESOURCE_GRAPH", evidence_refs: [`software/registry-database#canonical_name:${mention}`], candidates: [] };
  }
  return unresolved(mention, "resource", "not found in the resource graph by resource_id or canonical_name");
}

/** The real, registered command descriptor for ../entry-context/ — or null. Never the literal "unknown". */
export function resolvePolicyCommandId(mention: string | null): ResolvedReference | null {
  if (!mention) return null;
  const normalized = mention.toLocaleLowerCase();
  const descriptors = listCommandDescriptors();
  const matches = descriptors.filter((d) => normalized.includes(d.command_id.toLocaleLowerCase()));
  if (matches.length === 0) return unresolved(mention, "command_policy", "no registered command descriptor matched (execution/run/registry.ts)");
  if (matches.length > 1) {
    return { mention, status: "RESOLVER_AMBIGUOUS", resolved_id: null, kind: "command_policy", provenance: "REGISTRY", evidence_refs: ["execution/run/registry.ts"], candidates: matches.map((m) => m.command_id) };
  }
  return { mention, status: "RESOLVER_MATCHED", resolved_id: matches[0].command_id, kind: "command_policy", provenance: "REGISTRY", evidence_refs: [`execution/run/registry.ts#${matches[0].command_id}`], candidates: [] };
}

interface HistoryRecord {
  recorded_at: string;
  command_id: string;
  identity_id: string;
  raw_text: string;
  resolved_target_ids: string[];
  resolved_capability_ids: string[];
}

function readHistory(identityId: string): HistoryRecord[] {
  try {
    return String(fs.readFileSync(HISTORY_FILE, "utf8"))
      .split("\n")
      .filter((line: string) => line.trim().length > 0)
      .map((line: string) => JSON.parse(line) as HistoryRecord)
      .filter((record) => record.identity_id === identityId);
  } catch {
    return [];
  }
}

/**
 * "อันเมื่อกี้" / "ตัวเดิม", resolved from this layer's own durable history —
 * the previous command by the SAME identity, and specifically the reference
 * that command actually proved. If the previous command proved nothing, this
 * one cannot inherit a target: UNRESOLVED, not a guess at what was meant.
 */
export function resolveContinuation(identityId: string, mention: string): ResolvedReference {
  const history = readHistory(identityId);
  if (history.length === 0) return unresolved(mention, "task", "no previous command by this identity in control/owner-command-semantics/data/semantic-history.jsonl");
  const previous = history[history.length - 1];
  const inherited = [...previous.resolved_target_ids, ...previous.resolved_capability_ids];
  if (inherited.length === 0) {
    return { mention, status: "RESOLVER_UNRESOLVED", resolved_id: null, kind: "task", provenance: "HISTORY", evidence_refs: [`semantic-history.jsonl#${previous.command_id}`, `previous_raw_text=${previous.raw_text}`], candidates: [] };
  }
  if (inherited.length > 1) {
    return { mention, status: "RESOLVER_AMBIGUOUS", resolved_id: null, kind: "task", provenance: "HISTORY", evidence_refs: [`semantic-history.jsonl#${previous.command_id}`], candidates: inherited };
  }
  return { mention, status: "RESOLVER_MATCHED", resolved_id: inherited[0], kind: "task", provenance: "HISTORY", evidence_refs: [`semantic-history.jsonl#${previous.command_id}`, `previous_raw_text=${previous.raw_text}`], candidates: [] };
}

// ---------------------------------------------------------------------------
// The layer itself
// ---------------------------------------------------------------------------

function appendHistory(context: StructuredOwnerContext): void {
  const record: HistoryRecord = {
    recorded_at: new Date().toISOString(),
    command_id: context.command_id,
    identity_id: context.owner_identity.identity_id,
    raw_text: context.raw_text,
    resolved_target_ids: context.resolved_resources.filter((r) => r.resolved_id !== null).map((r) => r.resolved_id as string),
    resolved_capability_ids: context.resolved_capabilities.filter((r) => r.resolved_id !== null).map((r) => r.resolved_id as string),
  };
  fs.mkdirSync(path.dirname(HISTORY_FILE), { recursive: true });
  fs.appendFileSync(HISTORY_FILE, `${JSON.stringify(record)}\n`);
}

/** Builds the structured context from an interpretation that has already passed ./ai-contract.ts. Pure apart from the registry reads it performs. */
export function resolveFromInterpretation(
  commandId: string,
  ownerIdentity: { identity_id: string; kind: string },
  ai: AiSemanticInterpretation,
  deps: SemanticDeps = {},
): StructuredOwnerContext {
  const trace: SourceTraceEntry[] = [
    { field: "raw_text", provenance: "OWNER_TEXT", detail: "the Owner's text, unchanged" },
    { field: "command_id", provenance: "RUNTIME", detail: "minted by control/owner-command/owner-command.ts#submitOwnerCommand" },
    { field: "intent", provenance: "AI_INTERPRETATION", detail: "control/owner-command-semantics/semantic-runner.py" },
    { field: "action", provenance: "AI_INTERPRETATION", detail: "control/owner-command-semantics/semantic-runner.py" },
    { field: "owner_identity", provenance: "RUNTIME", detail: "issued_by on the CommandEnvelope" },
  ];

  const capabilityMentions = [ai.capability_reference, ai.target_text].filter((m): m is string => typeof m === "string" && m.length > 0);
  const resolvedCapabilities = capabilityMentions.map((mention) =>
    isOwnerQuoted(mention, ai.raw_text)
      ? resolveCapabilityMention(mention)
      : unresolved(mention, "capability", "the model paraphrased — this phrase is not in the Owner's text"));
  if (resolvedCapabilities.length > 0) trace.push({ field: "resolved_capabilities", provenance: "REGISTRY", detail: "control/command-router/capability-registry.ts" });

  const resourceMentions = [ai.resource_reference, ...ai.entity_mentions].filter((m): m is string => typeof m === "string" && m.length > 0);
  const resolvedTargets = resourceMentions.map((mention) =>
    isOwnerQuoted(mention, ai.raw_text)
      ? resolveResourceMention(mention, deps.registryStore)
      : unresolved(mention, "resource", "the model paraphrased — this phrase is not in the Owner's text"));
  if (resolvedTargets.length > 0) trace.push({ field: "resolved_resources", provenance: "RESOURCE_GRAPH", detail: "software/registry-database lookup (exact resource_id / canonical_name only)" });

  // Any backward reference the model reports is looked up — not only the
  // literal "PREVIOUS_CONTEXT" sentinel the prompt asks for. Measured
  // 2026-08-26: the model returned the Owner's own words ("ตัวเดิม") there
  // instead of the sentinel, which is a reasonable answer to the same
  // question; depending on one exact magic string would have silently
  // dropped a real continuation.
  const backwardMention = ai.continuation_reference ?? ai.previous_context_reference;
  const continuation = backwardMention ? resolveContinuation(ownerIdentity.identity_id, backwardMention) : null;
  if (continuation) trace.push({ field: "resolved_history", provenance: "HISTORY", detail: "control/owner-command-semantics/data/semantic-history.jsonl" });

  const policy = resolvePolicyCommandId(ai.target_text ?? ai.intent);
  if (policy) trace.push({ field: "policy_command_id", provenance: "REGISTRY", detail: "execution/run/registry.ts command descriptors" });

  const all = [...resolvedCapabilities, ...resolvedTargets, ...(continuation ? [continuation] : []), ...(policy ? [policy] : [])];
  const matched = all.filter((r) => r.status === "RESOLVER_MATCHED" || r.status === "VERIFIED_REFERENCE");

  const context: StructuredOwnerContext = {
    command_id: commandId,
    owner_identity: ownerIdentity,
    raw_text: ai.raw_text,
    intent: ai.intent,
    action: ai.action,
    semantic_interpretation: ai,
    resolved_resources: resolvedTargets.filter((r) => r.status === "RESOLVER_MATCHED" || r.status === "VERIFIED_REFERENCE"),
    resolved_capabilities: resolvedCapabilities.filter((r) => r.status === "RESOLVER_MATCHED" || r.status === "VERIFIED_REFERENCE"),
    parameters: ai.parameters,
    constraints: ai.constraints,
    resolved_history: continuation,
    resolved_state: matched.length > 0 ? "RESOLVED" : all.length > 0 ? "UNRESOLVED" : "NO_REFERENCES",
    evidence_refs: matched.flatMap((r) => r.evidence_refs),
    unresolved_refs: all.filter((r) => r.status === "RESOLVER_UNRESOLVED"),
    ambiguities: all.filter((r) => r.status === "RESOLVER_AMBIGUOUS"),
    source_trace: trace,
    policy_command_id: policy && policy.status === "RESOLVER_MATCHED" ? policy.resolved_id : null,
  };

  appendHistory(context);
  return context;
}

/** The full layer: Owner text -> isolated model -> contract check -> deterministic resolution. */
export function resolveOwnerCommandSemantics(
  commandId: string,
  rawText: string,
  ownerIdentity: { identity_id: string; kind: string },
  deps: SemanticDeps = {},
): SemanticOutcome {
  const sandboxDir = deps.sandboxDir ?? fs.mkdtempSync(path.join(os.tmpdir(), "dna-os-semantic-"));
  const model = runModel(rawText, sandboxDir);
  if (!model.ok) return { ok: false, stage: "MODEL", reasons: [model.reason] };

  const validation = validateAiInterpretation(model.raw, rawText);
  if (!validation.ok) return { ok: false, stage: "CONTRACT", reasons: validation.reasons };

  return { ok: true, context: resolveFromInterpretation(commandId, ownerIdentity, validation.interpretation, deps) };
}
