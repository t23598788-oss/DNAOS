/**
 * หน้าที่: REMOVE_HUMAN_PHRASE_HARDCODING_FROM_SELF_KNOWLEDGE_ROUTING (Owner
 * UNLOCK 2026-09-07). The ONE language boundary self-knowledge routing may
 * cross — replaces the enumerated pronoun/phrase regex lists that used to
 * live in `./self-knowledge-reader.ts`, `./subject-router.ts`'s SELF branch,
 * and `./main.ts`'s `isSelfWorkStatusQuestion` with a real semantic
 * classification, using the SAME sandboxed local model
 * (`../owner-command-semantics/language-processor/`) the generic pipeline
 * already runs — not a new capability, not a new child_process user (the
 * dependency gate's "one approved child_process user" check already covers
 * this exact boundary).
 *
 * THE MODEL MAY OUTPUT subject_candidate / question_type_candidate /
 * confidence, and may echo raw_text only when it is a character-for-character
 * copy of the Owner text. Any other extra field is rejected.
 * `question_type_candidate` is drawn from a CLOSED list this file
 * passes to the model (`ALLOWED_SELF_QUESTION_TYPES`); a value not in that
 * list, an id-shaped value, or an unparseable response is rejected, never
 * coerced into a guess. This mirrors `../owner-command-semantics/ai-contract.ts`'s
 * own discipline (reject unknown fields, reject id shapes) for the existing
 * default-mode output — same rule, applied to this narrower schema.
 *
 * FAILS CLOSED (PHASE 5): a model/process failure, invalid JSON, or an
 * out-of-list value produces `{ kind: "UNRESOLVED_LANGUAGE" }` — callers
 * must NOT fall back to any phrase-regex list on this path. This file
 * itself never inspects Owner text for a fixed pronoun set; the model does
 * the entire "what is this question about" judgment.
 *
 * Input: raw Owner text.
 * Output: `classifySelfQuestion(text)` →
 * `{ kind: "RESOLVED"; subject_is_self: boolean; other_subject_text: string | null; question_type: SelfQuestionType; confidence: number }`
 * | `{ kind: "UNRESOLVED_LANGUAGE"; reason: string }`
 * | `{ kind: "UNSUPPORTED_QUESTION_TYPE" }` (parsed fine, but
 * `question_type_candidate` was null — a real "I don't know what kind of
 * question this is", not a language failure).
 * Dependency ที่อนุญาต: ../owner-command-semantics/language-processor/contract.ts.
 * สิ่งที่ห้ามแตะ: ห้ามเติม phrase-regex เป็น fallback เมื่อ model ล้มเหลว. ห้าม
 * รับค่า question_type ที่ไม่อยู่ใน ALLOWED_SELF_QUESTION_TYPES. ห้ามรับค่า
 * subject_candidate ที่มีรูปร่างเป็น id.
 */

import { runLanguageProcessor } from "../owner-command-semantics/language-processor/contract";

/**
 * PHASE 2: canonical question types — every value here is an existing,
 * already-non-human-wording discriminant already used as the FACT_OWNER
 * dispatch key in `./self-knowledge-reader.ts` (`SelfKnowledgeQueryKind`)
 * and `./main.ts` (`WORK_STATUS`, folded in here since it is also a
 * question about the running program itself). Reused verbatim — renaming
 * them would be a cosmetic change to fact-owner dispatch this task does not
 * require.
 */
export const ALLOWED_SELF_QUESTION_TYPES = [
  "WHAT_AM_I",
  "SOURCE",
  "BUILD",
  "CAPABILITIES",
  "CONNECTIONS",
  "REPOSITORY",
  "SYNC_STATE",
  "RECOVERY_SOURCE",
  "ROLE",
  "DIRTY",
  "WORK_STATUS",
] as const;

export type SelfQuestionType = (typeof ALLOWED_SELF_QUESTION_TYPES)[number];

const ID_SHAPED = /\b(capability|resource|task|identity|account|workspace)-[0-9a-f]{8}-|^cmd_[a-z0-9]+$/i;

export type SelfQuestionClassification =
  | { readonly kind: "RESOLVED"; readonly subject_is_self: boolean; readonly other_subject_text: string | null; readonly question_type: SelfQuestionType; readonly confidence: number }
  | { readonly kind: "UNSUPPORTED_QUESTION_TYPE"; readonly subject_is_self: boolean; readonly other_subject_text: string | null }
  | { readonly kind: "UNRESOLVED_LANGUAGE"; readonly reason: string };

interface RawModelOutput {
  readonly subject_candidate: unknown;
  readonly question_type_candidate: unknown;
  readonly confidence: unknown;
}

function parseAndValidate(raw: string, ownerText: string): { ok: true; value: RawModelOutput } | { ok: false; reason: string } {
  const trimmed = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    return { ok: false, reason: `model output is not valid JSON: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, reason: "model output is not a JSON object" };
  }
  const body = parsed as Record<string, unknown>;
  const allowedKeys = new Set(["subject_candidate", "question_type_candidate", "confidence", "raw_text"]);
  for (const key of Object.keys(body)) {
    if (!allowedKeys.has(key)) return { ok: false, reason: `unexpected field: ${key}` };
  }
  if (typeof body.raw_text === "string" && body.raw_text !== ownerText) {
    return { ok: false, reason: "raw_text must be the Owner's text, unchanged" };
  }
  if (body.raw_text !== undefined && typeof body.raw_text !== "string") {
    return { ok: false, reason: "raw_text must be a string when present" };
  }
  if (body.subject_candidate !== null && typeof body.subject_candidate !== "string") {
    return { ok: false, reason: "subject_candidate must be a string or null" };
  }
  if (body.question_type_candidate !== null && typeof body.question_type_candidate !== "string") {
    return { ok: false, reason: "question_type_candidate must be a string or null" };
  }
  if (typeof body.confidence !== "number" || Number.isNaN(body.confidence)) {
    return { ok: false, reason: "confidence must be a number" };
  }
  if (typeof body.subject_candidate === "string" && ID_SHAPED.test(body.subject_candidate)) {
    return { ok: false, reason: `subject_candidate must never be an id — got "${body.subject_candidate}"` };
  }
  return { ok: true, value: body as unknown as RawModelOutput };
}

export function validateSelfQuestionModelOutput(raw: string, ownerText: string): { ok: true; value: RawModelOutput } | { ok: false; reason: string } {
  return parseAndValidate(raw, ownerText);
}

export function classifySelfQuestion(text: string): SelfQuestionClassification {
  const outcome = runLanguageProcessor(text, undefined, { mode: "OWNER_SELF_QUESTION_CLASSIFY_V1", allowedCandidates: ALLOWED_SELF_QUESTION_TYPES });
  if (!outcome.ok) {
    return { kind: "UNRESOLVED_LANGUAGE", reason: `language processor failed: ${outcome.reason}` };
  }
  const validated = parseAndValidate(outcome.raw, text);
  if (!validated.ok) {
    return { kind: "UNRESOLVED_LANGUAGE", reason: validated.reason };
  }
  const { subject_candidate, question_type_candidate, confidence } = validated.value;
  const subjectIsSelf = subject_candidate === "SELF";
  const otherSubjectText = typeof subject_candidate === "string" && !subjectIsSelf ? subject_candidate : null;

  if (typeof question_type_candidate !== "string" || !(ALLOWED_SELF_QUESTION_TYPES as readonly string[]).includes(question_type_candidate)) {
    return { kind: "UNSUPPORTED_QUESTION_TYPE", subject_is_self: subjectIsSelf, other_subject_text: otherSubjectText };
  }

  return {
    kind: "RESOLVED",
    subject_is_self: subjectIsSelf,
    other_subject_text: otherSubjectText,
    question_type: question_type_candidate as SelfQuestionType,
    confidence: typeof confidence === "number" ? confidence : 0,
  };
}
