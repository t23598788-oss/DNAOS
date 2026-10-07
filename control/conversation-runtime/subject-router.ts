/**
 * หน้าที่: HARDEN_SUBJECT_AWARE_OWNER_QUERY_ROUTING (Owner UNLOCK
 * 2026-09-06), extended by EMIT_FACT_OWNER_RUNTIME_EVENTS (Owner UNLOCK
 * 2026-09-06). Owns exactly one decision: SUBJECT → QUESTION_TYPE →
 * FACT_OWNER → READER — never KEYWORD → READER directly. Every domain
 * reader in this folder used to run its own "does this text mention my
 * subject" check independently and in a fixed try-order in `./main.ts`;
 * that is exactly how a real bug happened (proven,
 * COMPLETE_SELF_EXPLANATION_PROJECTION_OWNER_PROOF: "target-resolution
 * มาจากไหน" matched self-knowledge's loose `SOURCE` pattern before
 * self-explanation ever got a chance to claim it). This file resolves the
 * SUBJECT exactly once, centrally, against every real registered subject
 * — then, and only then, asks the SAME domain reader which question type
 * was asked.
 *
 * NOT A GENERIC AI ROUTER: every step below is a plain, reviewable
 * function over already-published facts — no model call, no scoring, no
 * fuzzy matching. A subject is a SUBJECT only if its own label/name is a
 * literal substring of the Owner's text.
 *
 * AMBIGUITY FAILS CLOSED: if the text names more than one real, distinct
 * subject (two different published capability labels, or a capability
 * label AND a known metric name), this returns `UNRESOLVED` with every
 * matched subject named — it never guesses which one the Owner meant.
 *
 * RUNTIME EVENTS (EMIT_FACT_OWNER_RUNTIME_EVENTS): `emit` is called ONLY
 * around a real program actually running — `SUBJECT_RESOLVED` and
 * `FACT_OWNER_SELECTED` always (they describe THIS file's own real
 * decision), then exactly one `{DOMAIN}_READ_STARTED`/`_COMPLETED` pair
 * matching whichever reader was actually invoked, then
 * `ANSWER_ASSEMBLY_STARTED`/`_COMPLETED`. `UNSUPPORTED_STOPPED` fires
 * instead of any READ event when PHASE 3's calculation/general-knowledge
 * shapes are detected — no fake read event, no fake relationship lookup.
 * `./main.ts` owns turning each notification into a real
 * `LanguageStageEvent` (via `publishLanguageStage`) and streaming it —
 * this file only describes WHAT happened, never how it's transported.
 *
 * Uses EXISTING readers only — `./self-explanation-reader.ts`,
 * `./capability-folder-law-reader.ts`, `./self-knowledge-reader.ts` — and
 * calls no reader's answer function until a subject AND a question type
 * are both resolved.
 *
 * Input: raw Owner text, request_id, trace_id, an `emit` callback.
 * Output: `routeSubjectAwareQuery` — a full `ConversationResult` when a
 * real subject was found (resolved or ambiguous) or an unsupported shape
 * was detected, `null` when no known subject or self-reference was found
 * at all (the caller then falls through to normal semantic resolution —
 * this file makes no claim about questions with no identifiable subject,
 * and emits nothing in that case).
 * Dependency ที่อนุญาต: ./self-explanation-reader.ts,
 * ./capability-folder-law-reader.ts, ./self-knowledge-reader.ts,
 * ./protocol.ts, `../owner-command-semantics/contract.ts` (type only —
 * `LanguageStageNotification`).
 * สิ่งที่ห้ามแตะ: ห้ามเพิ่ม subject ใหม่ที่ไม่ได้มาจากทะเบียนจริง. ห้ามเลือก
 * subject จากความคล้ายของคำ — ต้องเป็น substring ตรงตัวของชื่อจริงเท่านั้น.
 * ห้ามเดาเมื่อพบ subject มากกว่าหนึ่ง. ห้าม emit READ event ใดที่ reader
 * จริงไม่ได้ถูกเรียก.
 */

import {
  answerSelfExplanationQueryForSubject,
  classifySelfExplanationQuestionType,
  findAllMatchingSubjectNodes,
  readPublishedSelfExplanationNodes,
} from "./self-explanation-reader";
import { answerCapabilityFolderLawQuery, detectCapabilityFolderLawQuery } from "./capability-folder-law-reader";
import { answerSelfKnowledgeQuery } from "./self-knowledge-reader";
import { classifySelfQuestion, type SelfQuestionClassification } from "./self-question-classifier";
import { getLatestWorkContinuity, type WorkLedgerRecord } from "./self-work-ledger";
import {
  answerCausalExplanationQuery,
  classifyCausalQuestion,
  extractCausalReference,
  isCausalQuestionShape,
} from "./causal-explanation-reader";
import { readCapabilitySummaries } from "../conversation-read-model/contract";
import type { LanguageStageNotification } from "../owner-command-semantics/contract";
import type { ConversationOwnerIdentity, ConversationResult } from "./protocol";

export type StageEmitter = (notification: LanguageStageNotification) => void;
const NOOP_EMIT: StageEmitter = () => {};

const METRIC_SUBJECT_PATTERN = /capability folder law|folder law/i;
const KNOWN_METRIC_ID = "CAPABILITY_FOLDER_LAW_COMPLIANCE";

/**
 * PHASE 3 (CONNECT_PRODUCTION_OWNER_COMMAND_TO_SUBJECT_FACT_OWNER_ROUTING):
 * text that IS an arithmetic expression, not an action request — real,
 * deterministic shape (digits/operators, optionally followed by a
 * "เท่าไหร่/เท่าไร/equals/what" question tail), never a guess. Checked
 * against the REAL published capability list before answering
 * UNSUPPORTED_CAPABILITY — if a calculation capability is ever registered,
 * this stops being unsupported without any code change here.
 */
const CALCULATION_PATTERN = /^[\s\d+\-*/().]+(\s*(เป็นเท่าไหร่|เป็นเท่าไร|เท่าไหร่|เท่าไร|equals?|what('?s| is)( the (result|answer))?))?\s*$/i;

/** Same shape as self-explanation's IDENTITY question ("X คืออะไร") but used here ONLY after resolveSubject already found no real internal subject — i.e. X is not self, not a published capability, not the one known metric. */
const IDENTITY_SHAPE_PATTERN = /คืออะไร|what is\b/i;

function calculationCapabilityRegistered(): boolean {
  const summaries = readCapabilitySummaries();
  return summaries.some((s) => /calc|math|arithmetic/i.test(s.capability_id));
}

export type ResolvedSubject =
  | { readonly kind: "CAPABILITY_NODE"; readonly label: string }
  | { readonly kind: "METRIC"; readonly metric_id: typeof KNOWN_METRIC_ID }
  // REMOVE_HUMAN_PHRASE_HARDCODING_FROM_SELF_KNOWLEDGE_ROUTING (Owner
  // UNLOCK 2026-09-07): SELF carries the classification computed by
  // `./self-question-classifier.ts` so `routeSubjectAwareQuery` never calls
  // the language processor twice for the same request.
  | { readonly kind: "SELF"; readonly classification: Exclude<SelfQuestionClassification, { readonly kind: "UNRESOLVED_LANGUAGE" }> }
  | { readonly kind: "UNRESOLVED_LANGUAGE"; readonly reason: string }
  | { readonly kind: "CAUSAL_CHANGE"; readonly relationship_id: string }
  | { readonly kind: "AMBIGUOUS"; readonly matched_subjects: readonly string[] }
  | { readonly kind: "NONE" };

/**
 * PHASE 1: subject resolution FIRST, independent of question type. A
 * capability-node match (a real, published label found in the text) and a
 * metric-name match are checked against the SAME registries every answer
 * function reads — never invented here. CONNECT_HUMAN_CAUSAL_EXPLANATION_READER
 * (Owner UNLOCK 2026-09-06): a causal question (phrasing recognized by
 * `./causal-explanation-reader.ts#isCausalQuestionShape`) is checked FIRST
 * — its subject is a literal relationship/change reference token in the
 * text, never a capability label, so it cannot collide with the checks
 * below. Ambiguity (more than one distinct reference token) fails closed.
 */
export function resolveSubject(text: string): ResolvedSubject {
  if (isCausalQuestionShape(text)) {
    const reference = extractCausalReference(text);
    if (reference.kind === "AMBIGUOUS") {
      return { kind: "AMBIGUOUS", matched_subjects: reference.candidates };
    }
    if (reference.kind === "RESOLVED") {
      return { kind: "CAUSAL_CHANGE", relationship_id: reference.relationship_id };
    }
    // reference.kind === "NONE": a causal-shaped question with no
    // identifiable relationship reference is not silently dropped to the
    // generic pipeline (which cannot answer it either) — it falls through
    // to NONE here and is handled explicitly by the caller.
  }

  const nodes = readPublishedSelfExplanationNodes();
  const nodeMatches = nodes ? findAllMatchingSubjectNodes(text, nodes) : [];
  const metricMatched = METRIC_SUBJECT_PATTERN.test(text);

  if (nodeMatches.length > 1) {
    return { kind: "AMBIGUOUS", matched_subjects: nodeMatches.map((n) => n.label ?? n.node_id) };
  }
  if (nodeMatches.length === 1 && metricMatched) {
    return { kind: "AMBIGUOUS", matched_subjects: [nodeMatches[0].label ?? nodeMatches[0].node_id, KNOWN_METRIC_ID] };
  }
  if (nodeMatches.length === 1) {
    return { kind: "CAPABILITY_NODE", label: nodeMatches[0].label ?? nodeMatches[0].node_id };
  }
  if (metricMatched) {
    return { kind: "METRIC", metric_id: KNOWN_METRIC_ID };
  }
  // SELF is the lowest-priority subject: only checked once no NAMED real
  // subject matched anything. REMOVE_HUMAN_PHRASE_HARDCODING_FROM_SELF_KNOWLEDGE_ROUTING
  // (Owner UNLOCK 2026-09-07): "is this about SELF, and what kind of
  // question" is now a single real semantic classification
  // (`./self-question-classifier.ts`), never a pronoun/phrase regex list.
  const classification = classifySelfQuestion(text);
  if (classification.kind === "UNRESOLVED_LANGUAGE") {
    return { kind: "UNRESOLVED_LANGUAGE", reason: classification.reason };
  }
  if (classification.subject_is_self) {
    return { kind: "SELF", classification };
  }
  // Not SELF, and not a NAMED real subject either (checked above) — no
  // claim is made about `classification.other_subject_text`; if it named
  // something real, the deterministic node/metric checks above would
  // already have caught it. This is an honest "no identifiable subject",
  // same as the old fallback.
  return { kind: "NONE" };
}

/**
 * PHASE 1-4 end to end: resolves the subject, then — and only then — asks
 * the owning reader for the question type and the answer. Returns `null`
 * when there is no identifiable subject at all (caller falls through to
 * normal semantic resolution, self-work-status, etc. — this router makes
 * no claim about subject-less text, and emits nothing in that case).
 */
export function routeSubjectAwareQuery(requestId: string, traceId: string, text: string, ownerIdentity: ConversationOwnerIdentity, emit: StageEmitter = NOOP_EMIT): ConversationResult | null {
  const subject = resolveSubject(text);

  if (subject.kind === "UNRESOLVED_LANGUAGE") {
    // PHASE 5: a language-processor failure is a real, distinct outcome —
    // never silently treated as "no subject" (which would let the generic
    // pipeline try again with the same text and the same failure mode).
    emit({ stage: "SUBJECT_RESOLVED", status: "FAILED", detail: `UNRESOLVED_LANGUAGE: ${subject.reason}`, subject_id: null });
    return {
      request_id: requestId,
      trace_id: traceId,
      answer: `ไม่สามารถตีความคำถามได้ในตอนนี้ (language processor ล้มเหลว: ${subject.reason})`,
      intent: { request_id: requestId, intent: "UNRESOLVED_LANGUAGE", parameters: {} },
      status: "UNRESOLVED",
      evidence_refs: [],
      semantic_outcome: { ok: false, unresolved: "UNRESOLVED_LANGUAGE", reason: subject.reason },
    };
  }

  if (subject.kind === "NONE") {
    // CONNECT_HUMAN_CAUSAL_EXPLANATION_READER PHASE 1: a causal-shaped
    // question with no identifiable relationship/change reference is a
    // real, nameable failure — say so honestly instead of letting it fall
    // through to the generic pipeline's relationship lookup (which has no
    // reference to look up either).
    if (isCausalQuestionShape(text)) {
      emit({ stage: "SUBJECT_RESOLVED", status: "FAILED", detail: "causal question shape recognized but no relationship/change reference found in text", subject_id: null });
      return {
        request_id: requestId,
        trace_id: traceId,
        answer: "คำถามนี้ดูเหมือนถามเรื่องสาเหตุ/ผลของการเปลี่ยนแปลง แต่ไม่พบ relationship id หรือ change id ที่ระบุชัดเจนในข้อความ — โปรดระบุ id ที่ต้องการถาม",
        intent: { request_id: requestId, intent: "CAUSAL_EXPLANATION_NO_REFERENCE", parameters: {} },
        status: "UNRESOLVED",
        evidence_refs: [],
        semantic_outcome: { ok: false, unresolved: "NO_CAUSAL_REFERENCE" },
      };
    }

    // PHASE 3: two SHAPES are explicitly out of this router's (and the
    // generic semantic pipeline's) scope — say so honestly, with a real
    // UNSUPPORTED_STOPPED event and no fake read event, rather than let
    // the generic pipeline run a relationship lookup that cannot answer
    // them.
    if (CALCULATION_PATTERN.test(text.trim())) {
      const registered = calculationCapabilityRegistered();
      emit({ stage: "SUBJECT_RESOLVED", status: "COMPLETED", detail: "no internal subject named; text is an arithmetic expression", subject_id: null });
      emit({ stage: "UNSUPPORTED_STOPPED", status: "FAILED", detail: "no CALCULATION capability registered", fact_owner: null, blocker_kind: "CAPABILITY_MISSING" });
      return {
        request_id: requestId,
        trace_id: traceId,
        answer: registered
          ? "พบ capability คำนวณที่ลงทะเบียนไว้ แต่ router นี้ยังไม่เชื่อมต่อให้ — ต้องต่อ reader ใหม่"
          : "ไม่มี capability คำนวณ (CALCULATION) ที่ลงทะเบียนไว้ในระบบนี้ — ไม่สามารถตอบคำถามคำนวณได้จริง",
        intent: { request_id: requestId, intent: "UNSUPPORTED_CAPABILITY", parameters: { required_capability: "CALCULATION" } },
        status: "DENIED",
        evidence_refs: ["control/command-router/capability-registry.ts (no CALCULATION entry)"],
        semantic_outcome: { ok: false, unsupported: "CALCULATION" },
      };
    }

    if (IDENTITY_SHAPE_PATTERN.test(text)) {
      emit({ stage: "SUBJECT_RESOLVED", status: "COMPLETED", detail: "no internal subject named; question is general-knowledge shaped", subject_id: null });
      emit({ stage: "UNSUPPORTED_STOPPED", status: "FAILED", detail: "outside DNA OS internal knowledge boundary", fact_owner: null, blocker_kind: "OUT_OF_SCOPE" });
      return {
        request_id: requestId,
        trace_id: traceId,
        answer: "คำถามนี้เป็นความรู้ทั่วไป ไม่ใช่เรื่องภายในของ DNA OS — อยู่นอกขอบเขตความรู้ที่ระบบนี้ตอบได้จากทะเบียนจริง",
        intent: { request_id: requestId, intent: "UNSUPPORTED_GENERAL_KNOWLEDGE", parameters: {} },
        status: "DENIED",
        evidence_refs: [],
        semantic_outcome: { ok: false, unsupported: "GENERAL_KNOWLEDGE" },
      };
    }

    return null;
  }

  if (subject.kind === "AMBIGUOUS") {
    emit({ stage: "SUBJECT_RESOLVED", status: "FAILED", detail: `ambiguous: ${subject.matched_subjects.join(", ")}`, subject_id: subject.matched_subjects.join(" | ") });
    return {
      request_id: requestId,
      trace_id: traceId,
      answer: `พบชื่อที่ตรงกับมากกว่าหนึ่งสิ่งจริงในทะเบียน: ${subject.matched_subjects.join(", ")} — ยังไม่ชัดเจนว่าถามถึงตัวไหน`,
      intent: { request_id: requestId, intent: "SUBJECT_AMBIGUOUS", parameters: { matched_subjects: subject.matched_subjects } },
      status: "UNRESOLVED",
      evidence_refs: [],
      semantic_outcome: { ok: false, matched_subjects: subject.matched_subjects },
    };
  }

  if (subject.kind === "CAPABILITY_NODE") {
    emit({ stage: "SUBJECT_RESOLVED", status: "COMPLETED", detail: subject.label, subject_id: subject.label });
    const nodes = readPublishedSelfExplanationNodes() ?? [];
    const node = nodes.find((n) => (n.label ?? n.node_id) === subject.label);
    const questionType = classifySelfExplanationQuestionType(text);
    if (!node || !questionType) {
      emit({ stage: "UNSUPPORTED_STOPPED", status: "FAILED", detail: "subject known, question type unclear", subject_id: subject.label, fact_owner: null });
      return {
        request_id: requestId,
        trace_id: traceId,
        answer: `รู้ว่ากำลังถามเกี่ยวกับ "${subject.label}" แต่ไม่ทราบว่าถามประเภทไหน (identity/dependencies/dependents/impact/lineage/duplicates)`,
        intent: { request_id: requestId, intent: "SELF_EXPLANATION_UNKNOWN_QUESTION_TYPE", parameters: { subject: subject.label } },
        status: "UNRESOLVED",
        evidence_refs: [],
        semantic_outcome: null,
      };
    }
    emit({ stage: "FACT_OWNER_SELECTED", status: "COMPLETED", detail: "self-explanation-reader", subject_id: subject.label, fact_owner: "self-explanation", question_type: questionType });
    emit({ stage: "SELF_EXPLANATION_READ_STARTED", status: "STARTED", detail: `reading ${questionType} for ${subject.label}`, subject_id: subject.label, fact_owner: "self-explanation", question_type: questionType });
    const result = answerSelfExplanationQueryForSubject(node, questionType);
    emit({ stage: "SELF_EXPLANATION_READ_COMPLETED", status: "COMPLETED", detail: result.answer, subject_id: subject.label, fact_owner: "self-explanation", question_type: questionType, evidence_ref: result.evidence_refs[0] ?? null });
    emit({ stage: "ANSWER_ASSEMBLY_STARTED", status: "STARTED", detail: "assembling answer from self-explanation facts", subject_id: subject.label });
    emit({ stage: "ANSWER_ASSEMBLY_COMPLETED", status: "COMPLETED", detail: result.answer, subject_id: subject.label });
    return {
      request_id: requestId,
      trace_id: traceId,
      answer: result.answer,
      intent: { request_id: requestId, intent: `SELF_EXPLANATION_${questionType}`, parameters: { query_kind: questionType, subject: subject.label } },
      status: result.status,
      evidence_refs: result.evidence_refs,
      semantic_outcome: { ok: result.status !== "DENIED", self_explanation: result.projection },
    };
  }

  if (subject.kind === "METRIC") {
    emit({ stage: "SUBJECT_RESOLVED", status: "COMPLETED", detail: subject.metric_id, subject_id: subject.metric_id });
    const questionType = detectCapabilityFolderLawQuery(text);
    if (!questionType) {
      emit({ stage: "UNSUPPORTED_STOPPED", status: "FAILED", detail: "subject known, question type unclear", subject_id: subject.metric_id, fact_owner: null });
      return {
        request_id: requestId,
        trace_id: traceId,
        answer: `รู้ว่ากำลังถามเกี่ยวกับ ${subject.metric_id} แต่ไม่ทราบว่าถามประเภทไหน (ค่าปัจจุบัน/ค่าก่อนหน้า/แนวโน้ม/อะไรเปลี่ยน)`,
        intent: { request_id: requestId, intent: "CAPABILITY_FOLDER_LAW_UNKNOWN_QUESTION_TYPE", parameters: { subject: subject.metric_id } },
        status: "UNRESOLVED",
        evidence_refs: [],
        semantic_outcome: null,
      };
    }
    emit({ stage: "FACT_OWNER_SELECTED", status: "COMPLETED", detail: "measurement-history (capability-folder-law-reader)", subject_id: subject.metric_id, fact_owner: "measurement-history", question_type: questionType });
    emit({ stage: "MEASUREMENT_READ_STARTED", status: "STARTED", detail: `reading ${questionType} measurement`, subject_id: subject.metric_id, fact_owner: "measurement-history", question_type: questionType });
    const result = answerCapabilityFolderLawQuery(questionType);
    emit({ stage: "MEASUREMENT_READ_COMPLETED", status: "COMPLETED", detail: result.answer, subject_id: subject.metric_id, fact_owner: "measurement-history", question_type: questionType, evidence_ref: result.evidence_refs[0] ?? null });
    emit({ stage: "ANSWER_ASSEMBLY_STARTED", status: "STARTED", detail: "assembling answer from measurement facts", subject_id: subject.metric_id });
    emit({ stage: "ANSWER_ASSEMBLY_COMPLETED", status: "COMPLETED", detail: result.answer, subject_id: subject.metric_id });
    return {
      request_id: requestId,
      trace_id: traceId,
      answer: result.answer,
      intent: { request_id: requestId, intent: `CAPABILITY_FOLDER_LAW_${questionType}`, parameters: { query_kind: questionType } },
      status: result.status,
      evidence_refs: result.evidence_refs,
      semantic_outcome: { ok: result.status !== "DENIED", capability_folder_law: result.measurement },
    };
  }

  if (subject.kind === "CAUSAL_CHANGE") {
    emit({ stage: "SUBJECT_RESOLVED", status: "COMPLETED", detail: subject.relationship_id, subject_id: subject.relationship_id });
    const questionType = classifyCausalQuestion(text);
    if (!questionType) {
      emit({ stage: "UNSUPPORTED_STOPPED", status: "FAILED", detail: "reference resolved, question type unclear", subject_id: subject.relationship_id, fact_owner: null });
      return {
        request_id: requestId,
        trace_id: traceId,
        answer: `รู้ว่ากำลังถามเกี่ยวกับ relationship "${subject.relationship_id}" แต่ไม่ทราบว่าถามประเภทไหน (ทำไมเปลี่ยน/กระทบอะไร/metric ต้องตรวจใหม่/projection ต้อง refresh)`,
        intent: { request_id: requestId, intent: "CAUSAL_EXPLANATION_UNKNOWN_QUESTION_TYPE", parameters: { subject: subject.relationship_id } },
        status: "UNRESOLVED",
        evidence_refs: [],
        semantic_outcome: null,
      };
    }
    emit({ stage: "FACT_OWNER_SELECTED", status: "COMPLETED", detail: "causal-change-chain (causal-explanation-reader)", subject_id: subject.relationship_id, fact_owner: "causal-change-chain", question_type: questionType });
    emit({ stage: "CAUSAL_EXPLANATION_READ_STARTED", status: "STARTED", detail: `reading ${questionType} for ${subject.relationship_id}`, subject_id: subject.relationship_id, fact_owner: "causal-change-chain", question_type: questionType });
    const result = answerCausalExplanationQuery(subject.relationship_id, questionType);
    emit({ stage: "CAUSAL_EXPLANATION_READ_COMPLETED", status: "COMPLETED", detail: result.answer, subject_id: subject.relationship_id, fact_owner: "causal-change-chain", question_type: questionType, evidence_ref: result.evidence_refs[0] ?? null });
    emit({ stage: "ANSWER_ASSEMBLY_STARTED", status: "STARTED", detail: "assembling answer from causal-change-chain facts", subject_id: subject.relationship_id });
    emit({ stage: "ANSWER_ASSEMBLY_COMPLETED", status: "COMPLETED", detail: result.answer, subject_id: subject.relationship_id });
    return {
      request_id: requestId,
      trace_id: traceId,
      answer: result.answer,
      intent: { request_id: requestId, intent: `CAUSAL_EXPLANATION_${questionType}`, parameters: { query_kind: questionType, relationship_id: subject.relationship_id, fields: result.fields } },
      status: result.status,
      evidence_refs: result.evidence_refs,
      semantic_outcome: { ok: result.status === "ANSWERED", causal_explanation: result.change_record },
    };
  }

  // subject.kind === "SELF" — REMOVE_HUMAN_PHRASE_HARDCODING_FROM_SELF_KNOWLEDGE_ROUTING
  // (Owner UNLOCK 2026-09-07): the reader below receives only the already-
  // validated `resolved_subject` (SELF) and `canonical_question_type` from
  // `./self-question-classifier.ts` — it never inspects `text` itself
  // (PHASE 7: SELF_KNOWLEDGE_READER_READS_RAW_TEXT = NO).
  emit({ stage: "SUBJECT_RESOLVED", status: "COMPLETED", detail: "the conversation program itself", subject_id: "SELF" });
  const classification = subject.classification;

  if (classification.kind === "UNSUPPORTED_QUESTION_TYPE") {
    emit({ stage: "UNSUPPORTED_STOPPED", status: "FAILED", detail: "subject is SELF, but the language processor could not classify the question type", subject_id: "SELF", fact_owner: null });
    return {
      request_id: requestId,
      trace_id: traceId,
      answer: "รู้ว่าคำถามนี้เกี่ยวกับตัวโปรแกรมเอง แต่ยังไม่ทราบว่าถามประเภทไหน",
      intent: { request_id: requestId, intent: "SELF_UNKNOWN_QUESTION_TYPE", parameters: {} },
      status: "UNRESOLVED",
      evidence_refs: [],
      semantic_outcome: null,
    };
  }

  const questionType = classification.question_type;

  if (questionType === "WORK_STATUS") {
    emit({ stage: "FACT_OWNER_SELECTED", status: "COMPLETED", detail: "self-work-ledger", subject_id: "SELF", fact_owner: "self-work-ledger", question_type: questionType });
    emit({ stage: "WORK_STATUS_READ_STARTED", status: "STARTED", detail: "reading latest work continuity", subject_id: "SELF", fact_owner: "self-work-ledger", question_type: questionType });
    const ledger = getLatestWorkContinuity(ownerIdentity.identity_id);
    emit({ stage: "WORK_STATUS_READ_COMPLETED", status: "COMPLETED", detail: ledger ? ledger.WORK_ID : "no history found", subject_id: "SELF", fact_owner: "self-work-ledger", evidence_ref: ledger?.EVIDENCE_REFS[0] ?? null });
    emit({ stage: "ANSWER_ASSEMBLY_STARTED", status: "STARTED", detail: "assembling answer from work ledger facts", subject_id: "SELF" });
    const ledgerResult = answerFromLedger(requestId, traceId, ledger);
    emit({ stage: "ANSWER_ASSEMBLY_COMPLETED", status: "COMPLETED", detail: ledgerResult.answer ?? "", subject_id: "SELF" });
    return ledgerResult;
  }

  emit({ stage: "FACT_OWNER_SELECTED", status: "COMPLETED", detail: "self-knowledge-reader", subject_id: "SELF", fact_owner: "self-knowledge", question_type: questionType });
  emit({ stage: "SELF_KNOWLEDGE_READ_STARTED", status: "STARTED", detail: `reading ${questionType}`, subject_id: "SELF", fact_owner: "self-knowledge", question_type: questionType });
  const result = answerSelfKnowledgeQuery(questionType);
  emit({ stage: "SELF_KNOWLEDGE_READ_COMPLETED", status: "COMPLETED", detail: result.answer, subject_id: "SELF", fact_owner: "self-knowledge", question_type: questionType, evidence_ref: result.source_records[0] ?? null });
  emit({ stage: "ANSWER_ASSEMBLY_STARTED", status: "STARTED", detail: "assembling answer from self-knowledge facts", subject_id: "SELF" });
  emit({ stage: "ANSWER_ASSEMBLY_COMPLETED", status: "COMPLETED", detail: result.answer, subject_id: "SELF" });
  return {
    request_id: requestId,
    trace_id: traceId,
    answer: result.answer,
    intent: { request_id: requestId, intent: "SELF_KNOWLEDGE_QUERY", parameters: { query_kind: questionType } },
    status: result.answer.startsWith("ไม่ทราบ") ? "UNRESOLVED" : "ANSWERED",
    evidence_refs: result.source_records,
    semantic_outcome: { ok: true, self_knowledge: result },
  };
}

/**
 * Moved here from `./main.ts` (REMOVE_HUMAN_PHRASE_HARDCODING_FROM_SELF_KNOWLEDGE_ROUTING,
 * Owner UNLOCK 2026-09-07): the WORK_STATUS question type is now resolved
 * through the same SELF classification as every other self-knowledge
 * question, rather than a separate phrase-regex special case checked before
 * this router ever ran. Logic unchanged from the original
 * `main.ts#answerFromLedger` — fact owner (`./self-work-ledger.ts`) unchanged.
 */
function answerFromLedger(requestId: string, traceId: string, ledger: WorkLedgerRecord | null): ConversationResult {
  if (!ledger) {
    return {
      request_id: requestId,
      trace_id: traceId,
      answer: "ยังไม่มีประวัติงานที่บันทึกไว้สำหรับ Owner นี้",
      intent: { request_id: requestId, intent: "SELF_WORK_STATUS", unresolved_reason: "no RESOLUTION record exists yet for this identity" },
      status: "UNRESOLVED",
      evidence_refs: [],
      semantic_outcome: null,
    };
  }
  const answer = ledger.BLOCKER_KIND === "NONE"
    ? `งานล่าสุด (${ledger.WORK_ID}): "${ledger.OBJECTIVE}" — สถานะ ${ledger.CURRENT_STAGE}, ${ledger.LAST_RESULT}`
    : `งานล่าสุด (${ledger.WORK_ID}): "${ledger.OBJECTIVE}" — ถึงขั้น ${ledger.LAST_COMPLETED_STAGE}, ติด ${ledger.BLOCKER_KIND} (${ledger.BLOCKER_DETAIL}). ขั้นต่อไป: ${ledger.NEXT_STEP}`;
  return {
    request_id: requestId,
    trace_id: traceId,
    answer,
    intent: {
      request_id: requestId,
      intent: "SELF_WORK_STATUS",
      capability_id: ledger.AVAILABLE_CAPABILITY !== "NONE" && ledger.AVAILABLE_CAPABILITY !== "UNKNOWN" ? ledger.AVAILABLE_CAPABILITY : undefined,
      parameters: { blocker_kind: ledger.BLOCKER_KIND, current_stage: ledger.CURRENT_STAGE, next_step: ledger.NEXT_STEP },
    },
    status: ledger.BLOCKER_KIND === "NONE" ? "ANSWERED" : "UNRESOLVED",
    evidence_refs: ledger.EVIDENCE_REFS,
    semantic_outcome: { ok: true, ledger },
  };
}
