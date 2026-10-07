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
 * Every lookup goes to something that already existed — but never directly.
 * Capability ids and command ids come from `../conversation-read-model/`'s
 * published projections, never from `../command-router/` or
 * `../../execution/run/` themselves (Owner UNLOCK, 2026-09-06: this layer
 * is physically separated from DNA OS Control/Execution — see
 * `../conversation-read-model/contract.ts`'s header for the boundary and
 * why). Resource/identity/permission lookups still go to
 * `../../permissions/`'s stores and `../../software/registry-database/`'s
 * resource graph — those are not part of the execution boundary this round
 * separates. Nothing here invents a capability, a resource, or an id.
 *
 * Input: the Owner's raw text + identity, and (optionally) a `RegistryStore`
 * for the resource graph.
 * Output: `StructuredOwnerContext` — the model's reading and the proven
 * references, kept apart, with a per-field `source_trace`.
 * Dependency ที่อนุญาต: ./types.ts, ./ai-contract.ts,
 * `../conversation-read-model/contract.ts` (read-only side only — never
 * `publish*`), `../../software/registry-database/contract.ts` (type +
 * lookup only), node built-ins.
 * สิ่งที่ห้ามแตะ (เพิ่ม 2026-09-06):
 * - ห้าม import จาก `../command-router/`, `../../execution/run/`, หรือ
 *   `../agent-gateway/` โดยตรงอีก — ต้องผ่าน
 *   `../conversation-read-model/contract.ts` เท่านั้น.
 * - ห้ามเรียกฟังก์ชัน `publish*` ใดๆ จากไฟล์นี้.
 * สิ่งที่ห้ามแตะ:
 * - ห้ามให้ค่าใดๆ จากโมเดลกลายเป็น id โดยไม่ผ่านการค้นทะเบียนจริง.
 * - ห้ามคืน RESOLVER_MATCHED โดยไม่มี evidence_refs.
 * - ห้ามเขียนทะเบียนใดๆ จากไฟล์นี้ — read-only ทุกการเรียก.
 * - ห้ามเดา continuation จากความคล้ายของข้อความ — resolve ได้เฉพาะจาก history
 *   record จริงที่ layer นี้เขียนไว้เอง.
 */

declare const require: any;
declare const process: { env: Record<string, string | undefined>; cwd(): string };

import { validateAiInterpretation } from "./ai-contract";
import type { AiSemanticInterpretation, ResolvedReference, ResolvedRelationshipQuery, SourceTraceEntry, StructuredOwnerContext } from "./types";
import { readCapabilitySummaries, readCommandIdentities } from "../conversation-read-model/contract";
import { readEvidenceForCapability, readEvidenceForTask, readHistoryForIdentity, readTaskState, readDocumentReferences, readOwnerCommandDisplayHistory, HISTORY_FILE, type HistoryRecord } from "./read-paths";
import type { ReadOnlyRegistryView } from "./read-only-registry-view";
import { findResourceById, findCapability } from "../../software/registry-database/contract";
import type { RelationshipRow } from "../../software/registry-database/contract";
import { runLanguageProcessor } from "./language-processor/contract";

const fs = require("node:fs");
const path = require("node:path");

export type LanguageStageType =
  | "OWNER_TEXT_RECEIVED"
  | "LANGUAGE_PROCESSOR_STARTED"
  | "SEMANTIC_INTERPRETATION_COMPLETED"
  | "RELATIONSHIP_LOOKUP_STARTED"
  | "RELATIONSHIP_LOOKUP_COMPLETED"
  | "READ_ONLY_PROJECTION_COMPLETED"
  | "LANGUAGE_PROCESSOR_COMPLETED"
  | "LANGUAGE_PROCESSOR_FAILED"
  | "RESPONSE_GENERATION_STARTED"
  | "RESPONSE_GENERATION_COMPLETED"
  | "OWNER_ANSWER_READY"
  // EMIT_FACT_OWNER_RUNTIME_EVENTS (Owner UNLOCK 2026-09-06): the
  // subject-first dispatch path (control/conversation-runtime/subject-router.ts)
  // emits these INSTEAD OF the generic LANGUAGE_PROCESSOR_*/RELATIONSHIP_LOOKUP_*
  // stages above — never alongside them for the same request, since a
  // request either goes through the generic semantic pipeline or through
  // fact-owner dispatch, never both. Which of the READ_STARTED/COMPLETED
  // pairs fires depends entirely on which real program actually ran.
  | "SUBJECT_RESOLVED"
  | "FACT_OWNER_SELECTED"
  | "SELF_KNOWLEDGE_READ_STARTED"
  | "SELF_KNOWLEDGE_READ_COMPLETED"
  | "SELF_EXPLANATION_READ_STARTED"
  | "SELF_EXPLANATION_READ_COMPLETED"
  | "WORK_STATUS_READ_STARTED"
  | "WORK_STATUS_READ_COMPLETED"
  | "MEASUREMENT_READ_STARTED"
  | "MEASUREMENT_READ_COMPLETED"
  | "ANSWER_ASSEMBLY_STARTED"
  | "ANSWER_ASSEMBLY_COMPLETED"
  | "HUMAN_PRESENTATION_STARTED"
  | "HUMAN_PRESENTATION_COMPLETED"
  | "UNSUPPORTED_STOPPED"
  // CONNECT_HUMAN_CAUSAL_EXPLANATION_READER (Owner UNLOCK 2026-09-06): fires
  // only when `control/conversation-runtime/causal-explanation-reader.ts`
  // actually ran a real `control/causal-change-chain/contract.ts` query.
  | "CAUSAL_EXPLANATION_READ_STARTED"
  | "CAUSAL_EXPLANATION_READ_COMPLETED";

export interface LanguageStageNotification {
  readonly event_id?: string;
  readonly stage: LanguageStageType;
  readonly status: "STARTED" | "COMPLETED" | "FAILED";
  readonly detail: string;
  readonly program_id?: string | null;
  readonly source_file?: string | null;
  readonly source_function?: string | null;
  readonly source_line?: number | null;
  readonly evidence_ref?: string | null;
  readonly input_summary?: string | null;
  readonly operation_summary?: string | null;
  readonly output_summary?: string | null;
  readonly reason?: string | null;
  readonly decision?: string | null;
  readonly next_program?: string | null;
  readonly next_action?: string | null;
  readonly target_type?: string | null;
  readonly target_id?: string | null;
  readonly target_display_name?: string | null;
  readonly blocker_kind?: string | null;
  readonly blocker_detail?: string | null;
  /**
   * EMIT_FACT_OWNER_RUNTIME_EVENTS shared vocabulary (Owner UNLOCK
   * 2026-09-06) — the Owner's own naming: subject_id (what/who the
   * question is about), fact_owner (which real program's data answers
   * it), question_type (which shape of question was classified). Every
   * fact-owner-dispatch stage sets these; the generic semantic pipeline's
   * stages leave them null — never invented for a path that didn't
   * resolve them.
   */
  readonly subject_id?: string | null;
  readonly fact_owner?: string | null;
  readonly question_type?: string | null;
}

export interface LanguageStageEvent extends LanguageStageNotification {
  readonly event_id: string;
  readonly request_id: string;
  readonly trace_id: string;
  readonly observed_at: string;
  readonly source: string;
  readonly program_id: string | null;
  readonly source_file: string | null;
  readonly source_function: string | null;
  readonly source_line: number | null;
  readonly evidence_ref: string | null;
  readonly human_title: string;
  readonly human_detail: string;
  readonly input_summary: string | null;
  readonly operation_summary: string | null;
  readonly output_summary: string | null;
  readonly reason: string | null;
  readonly decision: string | null;
  readonly next_program: string | null;
  readonly next_action: string | null;
  readonly target_type: string | null;
  readonly target_id: string | null;
  readonly target_display_name: string | null;
  readonly blocker_kind: string | null;
  readonly blocker_detail: string | null;
  readonly subject_id: string | null;
  readonly fact_owner: string | null;
  readonly question_type: string | null;
  readonly previous_event_id: string | null;
  readonly next_expected_stage: LanguageStageType | null;
  readonly terminal: boolean;
}

interface LanguageRun {
  events: LanguageStageEvent[];
  listeners: Set<(event: LanguageStageEvent) => void>;
  terminal: boolean;
  cleanup_timer: ReturnType<typeof setTimeout> | null;
}

const languageRuns = new Map<string, LanguageRun>();

const NEXT_STAGE: Partial<Record<LanguageStageType, LanguageStageType | null>> = {
  OWNER_TEXT_RECEIVED: "LANGUAGE_PROCESSOR_STARTED",
  LANGUAGE_PROCESSOR_STARTED: "SEMANTIC_INTERPRETATION_COMPLETED",
  SEMANTIC_INTERPRETATION_COMPLETED: "RELATIONSHIP_LOOKUP_STARTED",
  RELATIONSHIP_LOOKUP_STARTED: "RELATIONSHIP_LOOKUP_COMPLETED",
  RELATIONSHIP_LOOKUP_COMPLETED: "READ_ONLY_PROJECTION_COMPLETED",
  READ_ONLY_PROJECTION_COMPLETED: "LANGUAGE_PROCESSOR_COMPLETED",
  LANGUAGE_PROCESSOR_COMPLETED: "RESPONSE_GENERATION_STARTED",
  LANGUAGE_PROCESSOR_FAILED: "OWNER_ANSWER_READY",
  RESPONSE_GENERATION_STARTED: "RESPONSE_GENERATION_COMPLETED",
  RESPONSE_GENERATION_COMPLETED: "OWNER_ANSWER_READY",
  OWNER_ANSWER_READY: null,
};

function humanMeaning(notification: LanguageStageNotification): { human_title: string; human_detail: string } {
  const titles: Record<LanguageStageType, string> = {
    OWNER_TEXT_RECEIVED: "รับคำสั่งจาก Owner แล้ว",
    LANGUAGE_PROCESSOR_STARTED: "กำลังตีความคำสั่ง",
    SEMANTIC_INTERPRETATION_COMPLETED: "เข้าใจความหมายของคำสั่งแล้ว",
    RELATIONSHIP_LOOKUP_STARTED: "กำลังตรวจทะเบียนและความสัมพันธ์",
    RELATIONSHIP_LOOKUP_COMPLETED: "ตรวจทะเบียนและความสัมพันธ์เสร็จแล้ว",
    READ_ONLY_PROJECTION_COMPLETED: "ตรวจข้อมูลระบบเสร็จแล้ว",
    LANGUAGE_PROCESSOR_COMPLETED: "ตีความและอ่านข้อมูลเสร็จแล้ว",
    LANGUAGE_PROCESSOR_FAILED: "การตีความคำสั่งหยุดลง",
    RESPONSE_GENERATION_STARTED: "กำลังสร้างคำตอบสำหรับ Owner",
    RESPONSE_GENERATION_COMPLETED: "สร้างคำตอบสำหรับ Owner เสร็จแล้ว",
    OWNER_ANSWER_READY: "พร้อมตอบ Owner",
    SUBJECT_RESOLVED: "ระบุตัวตนของสิ่งที่ถามแล้ว",
    FACT_OWNER_SELECTED: "เลือกโปรแกรมเจ้าของข้อมูลแล้ว",
    SELF_KNOWLEDGE_READ_STARTED: "กำลังอ่านข้อมูลตัวตนของโปรแกรม",
    SELF_KNOWLEDGE_READ_COMPLETED: "อ่านข้อมูลตัวตนของโปรแกรมเสร็จแล้ว",
    SELF_EXPLANATION_READ_STARTED: "กำลังตรวจความสัมพันธ์",
    SELF_EXPLANATION_READ_COMPLETED: "ตรวจความสัมพันธ์เสร็จแล้ว",
    WORK_STATUS_READ_STARTED: "กำลังอ่านสถานะงานล่าสุด",
    WORK_STATUS_READ_COMPLETED: "อ่านสถานะงานล่าสุดเสร็จแล้ว",
    MEASUREMENT_READ_STARTED: "กำลังอ่านผลการวัดล่าสุด",
    MEASUREMENT_READ_COMPLETED: "อ่านผลการวัดล่าสุดเสร็จแล้ว",
    ANSWER_ASSEMBLY_STARTED: "กำลังประกอบคำตอบจากข้อมูลจริง",
    ANSWER_ASSEMBLY_COMPLETED: "ประกอบคำตอบเสร็จแล้ว",
    HUMAN_PRESENTATION_STARTED: "กำลังแปลงคำตอบเป็นภาษาคน",
    HUMAN_PRESENTATION_COMPLETED: "แปลงคำตอบเป็นภาษาคนเสร็จแล้ว",
    UNSUPPORTED_STOPPED: "คำถามนี้อยู่นอกขอบเขตที่ตอบได้จากทะเบียนจริง — หยุดโดยไม่แต่งคำตอบ",
    CAUSAL_EXPLANATION_READ_STARTED: "กำลังตรวจสาเหตุและผลของการเปลี่ยนแปลง",
    CAUSAL_EXPLANATION_READ_COMPLETED: "ตรวจสาเหตุและผลของการเปลี่ยนแปลงเสร็จแล้ว",
  };
  const displayTarget = notification.target_display_name ?? notification.target_id;
  if (notification.stage === "OWNER_TEXT_RECEIVED" && notification.input_summary) {
    return { human_title: titles[notification.stage], human_detail: `ได้รับข้อความ "${notification.input_summary}" และส่งต่อให้โปรแกรมตีความภาษา` };
  }
  if (notification.stage === "RELATIONSHIP_LOOKUP_STARTED" && displayTarget) {
    return { human_title: titles[notification.stage], human_detail: `กำลังค้น ${displayTarget} ในทะเบียนความสามารถและความสัมพันธ์ของ DNA OS` };
  }
  if (notification.stage === "READ_ONLY_PROJECTION_COMPLETED" && notification.blocker_detail) {
    return { human_title: titles[notification.stage], human_detail: notification.blocker_detail };
  }
  if (notification.stage === "OWNER_ANSWER_READY" && notification.blocker_detail) {
    return { human_title: titles[notification.stage], human_detail: notification.blocker_detail };
  }
  return { human_title: titles[notification.stage], human_detail: notification.detail };
}

function languageRun(requestId: string): LanguageRun {
  const existing = languageRuns.get(requestId);
  if (existing) return existing;
  const created: LanguageRun = { events: [], listeners: new Set(), terminal: false, cleanup_timer: null };
  languageRuns.set(requestId, created);
  return created;
}

/**
 * Read-only language progress projection. It is deliberately in-memory and
 * never enters the execution SystemEvent/evidence path. The notification is
 * emitted only at the real semantic boundaries below.
 */
export function publishLanguageStage(requestId: string, notification: LanguageStageNotification, source = "control/owner-command-semantics/resolver.ts", traceId = requestId): LanguageStageEvent {
  const run = languageRun(requestId);
  const meaning = humanMeaning(notification);
  const previousEventId = run.events.at(-1)?.event_id ?? null;
  const event: LanguageStageEvent = {
    ...notification,
    event_id: notification.event_id ?? `language-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    request_id: requestId,
    trace_id: traceId,
    observed_at: new Date().toISOString(),
    source,
    program_id: notification.program_id ?? null,
    source_file: notification.source_file ?? null,
    source_function: notification.source_function ?? null,
    source_line: notification.source_line ?? null,
    evidence_ref: notification.evidence_ref ?? null,
    human_title: meaning.human_title,
    human_detail: meaning.human_detail,
    input_summary: notification.input_summary ?? null,
    operation_summary: notification.operation_summary ?? null,
    output_summary: notification.output_summary ?? null,
    reason: notification.reason ?? null,
    decision: notification.decision ?? null,
    next_program: notification.next_program ?? null,
    next_action: notification.next_action ?? null,
    target_type: notification.target_type ?? null,
    target_id: notification.target_id ?? null,
    target_display_name: notification.target_display_name ?? null,
    blocker_kind: notification.blocker_kind ?? null,
    blocker_detail: notification.blocker_detail ?? null,
    subject_id: notification.subject_id ?? null,
    fact_owner: notification.fact_owner ?? null,
    question_type: notification.question_type ?? null,
    previous_event_id: previousEventId,
    next_expected_stage: NEXT_STAGE[notification.stage] ?? null,
    terminal: notification.stage === "OWNER_ANSWER_READY" || notification.stage === "LANGUAGE_PROCESSOR_FAILED",
  };
  run.events.push(event);
  if (event.terminal) {
    run.terminal = true;
    if (run.cleanup_timer) clearTimeout(run.cleanup_timer);
    run.cleanup_timer = setTimeout(() => languageRuns.delete(requestId), 5 * 60 * 1000);
  }
  for (const listener of run.listeners) {
    try { listener(event); } catch { /* a browser stream must not affect language processing */ }
  }
  return event;
}

export function languageEventsSince(requestId: string, lastEventId: string | null): readonly LanguageStageEvent[] {
  const events = languageRun(requestId).events;
  if (!lastEventId) return [...events];
  const index = events.findIndex((event) => event.event_id === lastEventId);
  return index < 0 ? [...events] : events.slice(index + 1);
}

export function onLanguageStage(requestId: string, listener: (event: LanguageStageEvent) => void): () => void {
  const run = languageRun(requestId);
  run.listeners.add(listener);
  return () => { run.listeners.delete(listener); };
}

function notifyLanguageStage(deps: SemanticDeps, notification: LanguageStageNotification): void {
  try { deps.onStage?.(notification); } catch { /* progress projection cannot change semantic outcome */ }
}


export interface SemanticDeps {
  /** The resource graph. Injected, never constructed here — this folder must not choose a storage adapter for someone else. */
  registryStore?: ReadOnlyRegistryView;
  /** Where the model process runs. A fresh directory holding only its input. */
  sandboxDir?: string;
  /** Read-only callers may inspect the semantic result without appending history. */
  persist?: boolean;
  /** Runtime observer for the read-only language progress projection. */
  onStage?: (notification: LanguageStageNotification) => void;
}

export type SemanticOutcome =
  | { ok: true; context: StructuredOwnerContext }
  | { ok: false; stage: "MODEL" | "CONTRACT"; reasons: string[] };

export interface TranslationOutcome {
  message_id: string;
  raw_text: string;
  semantic: SemanticOutcome;
  /** Translation never creates a WorkOrder, task, or Agent run. */
  execution_started: false;
}

// ---------------------------------------------------------------------------
// The model call — isolated, and never trusted afterwards
// ---------------------------------------------------------------------------

// PHASE 2D (Owner UNLOCK, 2026-09-06): this used to run execFileSync
// directly, giving every reader of this file the impression that the
// conversation layer has generic process-launch authority. It does not —
// `./language-processor/fixed-runner.ts` is the ONLY file in this whole
// capability folder allowed to import `node:child_process`, with a fixed
// executable path and a fixed two-element argv. This wrapper exists only so
// the rest of this file keeps calling `runModel(rawText, sandboxDir)`.
function runModel(rawText: string, sandboxDir?: string): { ok: true; raw: string } | { ok: false; reason: string } {
  return runLanguageProcessor(rawText, sandboxDir);
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

function relationshipTokens(value: string): string[] {
  return value.toLocaleLowerCase().replace(/[_/:#.>-]+/g, " ").split(/[^\p{L}\p{N}]+/u).filter((token) => token.length > 1);
}

function phraseMatches(phrase: string, aliases: readonly string[]): boolean {
  const tokens = relationshipTokens(phrase);
  return tokens.length > 0 && tokens.every((token) => aliases.some((alias) => relationshipTokens(alias).includes(token)));
}

function readConnectionLocks(): readonly Record<string, unknown>[] {
  const file = path.join(process.cwd(), "control/owner-backbone/data/connection-locks.jsonl");
  if (!fs.existsSync(file)) return [];
  return String(fs.readFileSync(file, "utf8")).split("\n").filter((line: string) => line.trim()).map((line: string) => JSON.parse(line) as Record<string, unknown>);
}

function resolveRelationshipQuery(ai: AiSemanticInterpretation, store: ReadOnlyRegistryView | undefined): ResolvedRelationshipQuery | null {
  if (ai.action.toLocaleUpperCase() !== "CHECK" || !store?.listRelationshipRows) return null;
  const mentionedEntities = ai.entity_mentions.filter((m): m is string => typeof m === "string" && m.length > 0 && isOwnerQuoted(m, ai.raw_text));
  const atomicMentions = mentionedEntities
    .map((mention, index) => ({ mention, index, size: relationshipTokens(mention).length }))
    .sort((left, right) => left.size - right.size || left.index - right.index)
    .slice(0, 2)
    .sort((left, right) => left.index - right.index)
    .map(({ mention }) => mention);
  const mentions = atomicMentions.length >= 2
    ? atomicMentions
    : [...mentionedEntities, ai.target_text].filter((m): m is string => typeof m === "string" && m.length > 0 && isOwnerQuoted(m, ai.raw_text));
  if (mentions.length < 2) return null;
  const sourceMention = mentions[0];
  const targetMention = mentions[mentions.length - 1];
  const relationships = store.listRelationshipRows().filter((row) => row.from_type === "CAPABILITY" && row.to_type === "CAPABILITY");
  const locks = readConnectionLocks();
  const caps = readCapabilitySummaries();
  const aliasesFor = (id: string, side: "source" | "target", row: RelationshipRow): string[] => {
    const names = caps.filter((cap) => cap.capability_id === id).flatMap((cap) => [cap.capability_id, cap.repo_id, ...cap.match_keyword_sets.flat()]);
    const lock = locks.find((candidate) => candidate.source_capability_id === row.from_id && candidate.target_capability_id === row.to_id);
    const symbol = side === "source" ? lock?.source_symbol : lock?.target_symbol;
    return [...names, row.relationship_kind, typeof symbol === "string" ? symbol : ""];
  };
  const candidates = relationships.filter((row) => phraseMatches(sourceMention, aliasesFor(row.from_id, "source", row)) && phraseMatches(targetMention, aliasesFor(row.to_id, "target", row)));
  if (candidates.length !== 1) {
    return { source_mention: sourceMention, target_mention: targetMention, status: candidates.length > 1 ? "RELATIONSHIP_AMBIGUOUS" : "RELATIONSHIP_UNRESOLVED", source_capability_id: null, target_capability_id: null, relationship_id: null, relationship_kind: null, lock_status: "NOT_FOUND", runtime_status: "NOT_MEASURED", evidence_refs: ["software/registry-database#relationships", "control/owner-backbone/data/connection-locks.jsonl"], candidates: candidates.map((row) => row.relationship_id) };
  }
  const row = candidates[0];
  const lock = locks.find((candidate) => candidate.source_capability_id === row.from_id && candidate.target_capability_id === row.to_id && candidate.registry_relationship_id);
  const evidence = ["software/registry-database/data/canonical/relationships.jsonl", "control/owner-backbone/data/connection-locks.jsonl", ...(Array.isArray(lock?.evidence_refs) ? lock.evidence_refs.filter((value): value is string => typeof value === "string") : [])];
  return { source_mention: sourceMention, target_mention: targetMention, status: "RELATIONSHIP_RESOLVED", source_capability_id: row.from_id, target_capability_id: row.to_id, relationship_id: row.relationship_id, relationship_kind: row.relationship_kind, lock_status: lock ? "LOCKED" : "NOT_LOCKED", runtime_status: lock?.evidence_refs ? "PROVEN_BY_CONNECTION_LOCK_EVIDENCE" : "NOT_MEASURED", evidence_refs: evidence, candidates: [] };
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
  const registered = readCapabilitySummaries();

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
    evidence_refs: [`control/command-router/capability-registry.ts#${matches[0].capability_id}`],
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
export function resolveResourceMention(mention: string, store: ReadOnlyRegistryView | undefined): ResolvedReference {
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
  const commandIds = readCommandIdentities().map((projection) => projection.command_id);
  const matches = commandIds.filter((id) => normalized.includes(id.toLocaleLowerCase()));
  if (matches.length === 0) return unresolved(mention, "command_policy", "no registered command id matched (execution/run/registry.ts)");
  if (matches.length > 1) {
    return { mention, status: "RESOLVER_AMBIGUOUS", resolved_id: null, kind: "command_policy", provenance: "REGISTRY", evidence_refs: ["execution/run/registry.ts"], candidates: matches };
  }
  return { mention, status: "RESOLVER_MATCHED", resolved_id: matches[0], kind: "command_policy", provenance: "REGISTRY", evidence_refs: [`execution/run/registry.ts#${matches[0]}`], candidates: [] };
}

/**
 * "อันเมื่อกี้" / "ตัวเดิม", resolved from this layer's own durable history —
 * the previous command by the SAME identity, and specifically the reference
 * that command actually proved. If the previous command proved nothing, this
 * one cannot inherit a target: UNRESOLVED, not a guess at what was meant.
 */
export function resolveContinuation(identityId: string, mention: string): ResolvedReference {
  const history = readHistoryForIdentity(identityId);
  if (!history.found) return unresolved(mention, "task", `${history.reason} (${history.source})`);

  // Only a RESOLUTION record can be inherited from — a TASK_LINK record is a
  // pointer to what the command became, not to what it proved.
  const resolutions = history.value.filter((record) => (record.kind ?? "RESOLUTION") === "RESOLUTION");
  if (resolutions.length === 0) return unresolved(mention, "task", `no previous resolution record for this identity (${history.source})`);
  const previous = resolutions[resolutions.length - 1];

  // What the PREVIOUS command actually proved — and nothing else. Each of these
  // is an id some registry returned on that earlier turn, carried forward with
  // the record that proved it. `policy_command_id` belongs here (Owner,
  // 2026-08-26 Phase 3): it was resolved against execution/run/registry.ts on
  // the previous command exactly like a capability id was, so excluding it made
  // "เอาตัวเดิมต่อ" report UNRESOLVED after a command whose only proven
  // reference was the descriptor — a real gap, observed in runtime.
  const inherited: { id: string; kind: ResolvedReference["kind"] }[] = [
    ...previous.resolved_capability_ids.map((id) => ({ id, kind: "capability" as const })),
    ...previous.resolved_target_ids.map((id) => ({ id, kind: "resource" as const })),
    ...(previous.policy_command_id ? [{ id: previous.policy_command_id, kind: "command_policy" as const }] : []),
  ];

  const evidence = [
    `${history.source}#${previous.command_id}`,
    `previous_command_id=${previous.command_id}`,
    `previous_raw_text=${previous.raw_text}`,
  ];

  if (inherited.length === 0) {
    return { mention, status: "RESOLVER_UNRESOLVED", resolved_id: null, kind: "task", provenance: "HISTORY", evidence_refs: evidence, candidates: [] };
  }
  if (inherited.length > 1) {
    return { mention, status: "RESOLVER_AMBIGUOUS", resolved_id: null, kind: "task", provenance: "HISTORY", evidence_refs: evidence, candidates: inherited.map((i) => i.id) };
  }
  // Inheritance is allowed only because the id came from the previous
  // resolution record — never because the model named it.
  return { mention, status: "RESOLVER_MATCHED", resolved_id: inherited[0].id, kind: inherited[0].kind, provenance: "HISTORY", evidence_refs: evidence, candidates: [] };
}

/** The previous command's own id, so `resolved_history` can point at the command it continues, not only at what that command proved. */
export function previousCommandId(identityId: string): string | null {
  const history = readHistoryForIdentity(identityId);
  return history.found ? history.value[history.value.length - 1].command_id : null;
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
    policy_command_id: context.policy_command_id,
    task_id: null,
    kind: "RESOLUTION",
    intent: context.intent,
    resolved_state: context.resolved_state === "RESOLVED" || context.resolved_state === "UNRESOLVED" || context.resolved_state === "NO_REFERENCES" ? context.resolved_state : undefined,
    unresolved_refs: context.unresolved_refs.map((r) => ({ kind: r.kind, mention: r.mention, evidence_refs: r.evidence_refs })),
    relationship_query_status: context.relationship_query?.status ?? null,
  };
  fs.mkdirSync(path.dirname(HISTORY_FILE), { recursive: true });
  fs.appendFileSync(HISTORY_FILE, `${JSON.stringify(record)}\n`);
}

/** Persist the exact structured result already returned by Core so refresh can
 * project the same answer without executing the operation again. */
export function recordOwnerVisibleResult(commandId: string, identityId: string, rawText: string, result: Record<string, unknown>): void {
  const record: HistoryRecord = {
    recorded_at: new Date().toISOString(), command_id: commandId, identity_id: identityId,
    raw_text: rawText, resolved_target_ids: [], resolved_capability_ids: [],
    policy_command_id: null, task_id: typeof result.task_id === "string" ? result.task_id : null,
    kind: "OWNER_RESULT", owner_visible_result: result,
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

  // Every Owner-quoted phrase the interpreter extracted is offered to the
  // capability registry — not only the two fields that happen to be named for
  // it.
  //
  // MEASURED 2026-09-02. For "เช็ก revision ของ GitHub" the interpreter returns
  // capability_reference "เช็ก" (the verb) and target_text "revision", while the
  // word that actually identifies the capability, "GitHub", lands in
  // resource_reference/entity_mentions. `control/command-router/capability-registry.ts`
  // already declares `match_keyword_sets: [["github"]]` for it, so the registry
  // could have answered — it was simply never asked. The same sentence phrased
  // as "เช็ก GitHub repo นี้" DID resolve to `github`, because that time the model
  // happened to put the word in a field this list included. Which field a token
  // lands in is the model's choice; whether a token names a capability is the
  // registry's. This restores that division.
  //
  // Nothing about matching is loosened: `isOwnerQuoted` still rejects any phrase
  // the Owner did not type, `match_keyword_sets` remains the only matcher, and
  // several matches still return RESOLVER_AMBIGUOUS rather than a guess. No
  // alias, keyword table or sentence-specific rule is added anywhere.
  const capabilityMentions = [...new Set(
    [ai.capability_reference, ai.target_text, ai.resource_reference, ...(ai.entity_mentions ?? [])]
      .filter((m): m is string => typeof m === "string" && m.length > 0),
  )];
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

  notifyLanguageStage(deps, { stage: "RELATIONSHIP_LOOKUP_STARTED", status: "STARTED", detail: "ตรวจ relationship จาก RegistryStore และ connection-locks.jsonl", program_id: "owner-command-semantics", source_file: "control/owner-command-semantics/resolver.ts", source_function: "resolveFromInterpretation", source_line: 594, evidence_ref: null, operation_summary: "ค้นทะเบียนความสามารถและความสัมพันธ์", reason: "ต้องตรวจสอบเป้าหมายก่อนตัดสินใจส่งต่อ", next_program: "owner-command-semantics", next_action: "ตรวจความสัมพันธ์", target_type: "resource", target_id: resolvedTargets[0]?.resolved_id ?? null, target_display_name: resolvedTargets[0]?.mention ?? null });
  const relationshipQuery = resolveRelationshipQuery(ai, deps.registryStore);
  notifyLanguageStage(deps, {
    stage: "RELATIONSHIP_LOOKUP_COMPLETED",
    status: "COMPLETED",
    detail: relationshipQuery?.status ?? "RELATIONSHIP_NOT_REQUESTED",
    program_id: "owner-command-semantics", source_file: "control/owner-command-semantics/resolver.ts", source_function: "resolveFromInterpretation", source_line: 597, evidence_ref: null, operation_summary: "สรุปผลการค้นทะเบียนความสัมพันธ์", output_summary: relationshipQuery?.status ?? "RELATIONSHIP_NOT_REQUESTED", decision: relationshipQuery?.status ?? "RELATIONSHIP_NOT_REQUESTED", next_program: "owner-command-semantics", next_action: "อ่านข้อมูลแบบ read-only", target_type: "resource", target_id: resolvedTargets[0]?.resolved_id ?? null, target_display_name: resolvedTargets[0]?.mention ?? null,
  });
  if (relationshipQuery) trace.push({ field: "relationship_query", provenance: "REGISTRY", detail: "software/registry-database relationships + control/owner-backbone/data/connection-locks.jsonl" });

  // QUERY -> EVIDENCE STORE, once per capability this run actually proved.
  // Only proven ids are used as the lookup key: asking the evidence store about
  // a phrase the resolver could not resolve would be asking it about nothing.
  const provenCapabilities = resolvedCapabilities.filter((r) => r.status === "RESOLVER_MATCHED" || r.status === "VERIFIED_REFERENCE");
  const resolvedEvidence: ResolvedReference[] = [];
  for (const capability of provenCapabilities) {
    const read = readEvidenceForCapability(capability.resolved_id as string, deps.registryStore);
    resolvedEvidence.push(read.found
      ? { mention: capability.resolved_id as string, status: "VERIFIED_REFERENCE", resolved_id: capability.resolved_id, kind: "capability", provenance: read.provenance, evidence_refs: read.value, candidates: [] }
      : { mention: capability.resolved_id as string, status: "RESOLVER_UNRESOLVED", resolved_id: null, kind: "capability", provenance: "EVIDENCE", evidence_refs: [`${read.reason} (${read.source})`], candidates: [] });
  }
  if (provenCapabilities.length > 0) trace.push({ field: "resolved_evidence", provenance: "EVIDENCE", detail: "software/registry-database evidence_refs via findCapability" });

  // QUERY -> STATE STORE. The key is a real task_id recorded by a previous
  // command; with no such key there is nothing to ask, and that is stated
  // rather than left looking like an empty state.
  let resolvedStateDetail = "no task_id available to query control/agent-gateway — state was not looked up";
  const priorHistory = readHistoryForIdentity(ownerIdentity.identity_id);
  if (priorHistory.found) {
    const lastWithTask = [...priorHistory.value].reverse().find((record) => record.kind === "TASK_LINK" && typeof record.task_id === "string" && (record.task_id as string).length > 0);
    if (lastWithTask && lastWithTask.task_id) {
      const taskEvidence = readEvidenceForTask(lastWithTask.task_id);
      resolvedEvidence.push(taskEvidence.found
        ? { mention: lastWithTask.task_id, status: "VERIFIED_REFERENCE", resolved_id: lastWithTask.task_id, kind: "task", provenance: taskEvidence.provenance, evidence_refs: taskEvidence.value.map((e) => `${e.kind}@${e.source}#${e.recorded_at}`), candidates: [] }
        : { mention: lastWithTask.task_id, status: "RESOLVER_UNRESOLVED", resolved_id: null, kind: "task", provenance: "EVIDENCE", evidence_refs: [`${taskEvidence.reason} (${taskEvidence.source})`], candidates: [] });
      trace.push({ field: "resolved_evidence", provenance: "EVIDENCE", detail: `control/agent-gateway loadEvidenceForTask(${lastWithTask.task_id}) -> ${taskEvidence.found ? taskEvidence.value.length : 0} rows` });

      const state = readTaskState(lastWithTask.task_id);
      resolvedStateDetail = state.found
        ? `task ${state.value.task_id} status=${state.value.status} updated_at=${state.value.updated_at} (${state.source})`
        : `${state.reason} (${state.source})`;
    }
  }
  trace.push({ field: "resolved_state", provenance: "RUNTIME", detail: resolvedStateDetail });

  // QUERY -> DOCUMENT/BLUEPRINT INDEX. Declared, attempted, and reported as
  // having no contract to attempt against.
  const documentRead = readDocumentReferences(ai.target_text ?? ai.raw_text);
  trace.push({ field: "resolved_documents", provenance: "EVIDENCE", detail: documentRead.found ? documentRead.source : documentRead.reason });

  // QUERY -> REGISTERED KNOWLEDGE RECORD. This is an exact readback lookup,
  // gated by the canonical registry; it never scans source or chooses an
  // execution target. An unmatched question remains unmatched.
  const readOnlyKnowledge = readOwnerCommandDisplayHistory(ai.raw_text, deps.registryStore);
  if (readOnlyKnowledge.found) {
    trace.push({ field: "read_only_knowledge", provenance: readOnlyKnowledge.provenance, detail: readOnlyKnowledge.source });
  }

  const all = [...resolvedCapabilities, ...resolvedTargets, ...resolvedEvidence, ...(continuation ? [continuation] : []), ...(policy ? [policy] : [])];
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
    resolved_evidence: resolvedEvidence.filter((r) => r.status === "VERIFIED_REFERENCE"),
    resolved_documents: [],
    parameters: ai.parameters,
    constraints: ai.constraints,
    resolved_history: continuation,
    resolved_state: readOnlyKnowledge.found ? "RESOLVED" : matched.length > 0 ? "RESOLVED" : all.length > 0 ? "UNRESOLVED" : "NO_REFERENCES",
    evidence_refs: [...matched.flatMap((r) => r.evidence_refs), ...(readOnlyKnowledge.found ? readOnlyKnowledge.value.evidence_refs : [])],
    unresolved_refs: all.filter((r) => r.status === "RESOLVER_UNRESOLVED"),
    ambiguities: all.filter((r) => r.status === "RESOLVER_AMBIGUOUS"),
    source_trace: trace,
    policy_command_id: policy && policy.status === "RESOLVER_MATCHED" ? policy.resolved_id : null,
    relationship_query: relationshipQuery,
    read_only_knowledge: readOnlyKnowledge.found ? readOnlyKnowledge.value : null,
  };

  if (deps.persist !== false) appendHistory(context);
  return context;
}

/**
 * Records the real task_id a command produced, so the NEXT command's STATE read
 * has a key to ask the gateway task store with. Append-only, and only ever with
 * an id that routing actually returned — never a placeholder.
 */
export function recordCommandTaskId(commandId: string, identityId: string, taskId: string): void {
  const record: HistoryRecord = {
    recorded_at: new Date().toISOString(),
    command_id: commandId,
    identity_id: identityId,
    raw_text: "",
    resolved_target_ids: [],
    resolved_capability_ids: [],
    policy_command_id: null,
    task_id: taskId,
    kind: "TASK_LINK",
  };
  fs.mkdirSync(path.dirname(HISTORY_FILE), { recursive: true });
  fs.appendFileSync(HISTORY_FILE, `${JSON.stringify(record)}\n`);
}

/**
 * Durable first hop for free-form Owner language. This record is deliberately
 * written before the model is started, so a model failure cannot erase the
 * original words or make the request look as if it was never received.
 */
export function recordRawOwnerMessage(messageId: string, identityId: string, rawText: string): void {
  const record: HistoryRecord = {
    recorded_at: new Date().toISOString(),
    command_id: messageId,
    identity_id: identityId,
    raw_text: rawText,
    resolved_target_ids: [],
    resolved_capability_ids: [],
    policy_command_id: null,
    task_id: null,
    kind: "RAW_MESSAGE",
  };
  fs.mkdirSync(path.dirname(HISTORY_FILE), { recursive: true });
  fs.appendFileSync(HISTORY_FILE, `${JSON.stringify(record)}\n`);
}

/**
 * Owner text -> durable raw intake -> isolated translation/resolution.
 * Nothing in this function routes, admits, creates a task, or starts an
 * Agent. A later, explicit system stage may consume the returned context.
 */
export function translateOwnerMessage(
  messageId: string,
  rawText: string,
  ownerIdentity: { identity_id: string; kind: string },
  deps: SemanticDeps = {},
): TranslationOutcome {
  recordRawOwnerMessage(messageId, ownerIdentity.identity_id, rawText);
  return {
    message_id: messageId,
    raw_text: rawText,
    semantic: resolveOwnerCommandSemantics(messageId, rawText, ownerIdentity, deps),
    execution_started: false,
  };
}

/** The full layer: Owner text -> isolated model -> contract check -> deterministic resolution. */
export function resolveOwnerCommandSemantics(
  commandId: string,
  rawText: string,
  ownerIdentity: { identity_id: string; kind: string },
  deps: SemanticDeps = {},
): SemanticOutcome {
  notifyLanguageStage(deps, { stage: "LANGUAGE_PROCESSOR_STARTED", status: "STARTED", detail: "เริ่ม isolated semantic processor", program_id: "owner-command-semantics", source_file: "control/owner-command-semantics/resolver.ts", source_function: "resolveOwnerCommandSemantics", source_line: 752, evidence_ref: null, operation_summary: "ส่งข้อความเข้า semantic processor แบบแยกส่วน", reason: "ต้องแปลงข้อความ Owner เป็นโครงสร้างที่ตรวจสอบได้", next_program: "owner-command-semantics", next_action: "แยก action และ target" });
  // `deps.sandboxDir` stays optional: when absent, `./language-processor/
  // fixed-runner.ts` mints its own `mkdtempSync` scratch dir — this file no
  // longer touches `node:os` at all.
  const model = runModel(rawText, deps.sandboxDir);
  if (!model.ok) {
    notifyLanguageStage(deps, { stage: "LANGUAGE_PROCESSOR_FAILED", status: "FAILED", detail: model.reason, program_id: "owner-command-semantics", source_file: "control/owner-command-semantics/resolver.ts", source_function: "resolveOwnerCommandSemantics", source_line: 664, evidence_ref: null });
    return { ok: false, stage: "MODEL", reasons: [model.reason] };
  }

  const validation = validateAiInterpretation(model.raw, rawText);
  if (!validation.ok) {
    notifyLanguageStage(deps, { stage: "LANGUAGE_PROCESSOR_FAILED", status: "FAILED", detail: validation.reasons.join("; "), program_id: "owner-command-semantics", source_file: "control/owner-command-semantics/resolver.ts", source_function: "resolveOwnerCommandSemantics", source_line: 670, evidence_ref: null });
    return { ok: false, stage: "CONTRACT", reasons: validation.reasons };
  }

  notifyLanguageStage(deps, { stage: "SEMANTIC_INTERPRETATION_COMPLETED", status: "COMPLETED", detail: "ผ่าน semantic contract validation", program_id: "owner-command-semantics", source_file: "control/owner-command-semantics/resolver.ts", source_function: "resolveOwnerCommandSemantics", source_line: 768, evidence_ref: null, input_summary: validation.interpretation.raw_text, operation_summary: "แยก action และ target จากข้อความ Owner", output_summary: `action=${validation.interpretation.action}, target=${validation.interpretation.target_text ?? "null"}`, reason: "ผ่าน deterministic semantic contract validation", decision: "SEMANTIC_ACCEPTED", next_program: "owner-command-semantics", next_action: "ตรวจทะเบียนและความสัมพันธ์", target_type: "resource", target_id: null, target_display_name: validation.interpretation.target_text ?? null });
  const context = resolveFromInterpretation(commandId, ownerIdentity, validation.interpretation, deps);
  notifyLanguageStage(deps, { stage: "READ_ONLY_PROJECTION_COMPLETED", status: "COMPLETED", detail: `resolved_state=${context.resolved_state}`, program_id: "owner-command-semantics", source_file: "control/owner-command-semantics/resolver.ts", source_function: "resolveOwnerCommandSemantics", source_line: 770, evidence_ref: null, operation_summary: "อ่าน read-only projection", output_summary: `resolved_state=${context.resolved_state}`, reason: "ใช้ผลการ resolve ที่ deterministic resolver คืนมา", decision: context.resolved_state, next_program: "response-generation", next_action: "สร้างคำตอบ Owner", blocker_kind: context.unresolved_refs.length > 0 ? "UNRESOLVED_REFERENCE" : null, blocker_detail: context.unresolved_refs.length > 0 ? context.unresolved_refs.map((ref) => `${ref.kind}:${ref.mention}`).join("; ") : null });
  notifyLanguageStage(deps, { stage: "LANGUAGE_PROCESSOR_COMPLETED", status: "COMPLETED", detail: "semantic + relationship read จบแล้ว", program_id: "owner-command-semantics", source_file: "control/owner-command-semantics/resolver.ts", source_function: "resolveOwnerCommandSemantics", source_line: 771, evidence_ref: null, output_summary: "semantic + relationship read จบแล้ว", decision: "LANGUAGE_PROCESSOR_COMPLETED", next_program: "response-generation", next_action: "สร้างคำตอบ Owner" });
  return { ok: true, context };
}
