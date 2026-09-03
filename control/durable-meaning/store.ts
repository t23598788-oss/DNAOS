/**
 * หน้าที่: persist durable meaning next to the canonical registry — origins,
 * admissions, registered vocabularies — and resolve them by identity so a fresh
 * process can answer what a finished session learned (Owner, 2026-09-02).
 *
 * NOT A SECOND REGISTRY. Nothing here stores a resource. Every row is keyed by a
 * `resource_id` that the canonical registry already owns, and the canonical
 * files are never opened for writing. This is an additive layer of MEANING over
 * an existing layer of IDENTITY, which is precisely the split Step 17 measured
 * as missing.
 *
 * KNOWLEDGE-FIRST IS THE POINT. `resolveKnowledgeFirst` answers from the store
 * and returns `KNOWLEDGE_FOUND` or `DISCOVERY_REQUIRED`. It takes a structured
 * request — a canonical identity and a question kind — and never a sentence, so
 * the answer cannot vary with how someone phrased it. That is what makes
 * rediscovery unnecessary rather than merely discouraged.
 *
 * WHY THE LOOKUP KEY IS NOT THE PROMPT. Two differently worded questions about
 * the same capability must reach the same facts. They do that here by being
 * normalised into the same canonical identity before this file is called; the
 * resolver itself sees only identities. Any resolver that accepted free text
 * would make wording part of the truth.
 *
 * Input: origin/admission/vocabulary records; structured requests.
 * Output: append/read helpers and resolveKnowledgeFirst.
 * Dependency ที่อนุญาต: ./contract, ./vocabulary, node:fs, node:path.
 * สิ่งที่ห้ามแตะ: ห้ามเขียนลง canonical registry, ห้ามรับข้อความอิสระเป็นกุญแจ
 * ค้นหา, ห้ามคืนความรู้ที่ไม่มี provenance.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AdmissionResult, ResourceOrigin } from "./contract";
import type { VocabularyExtension } from "./vocabulary";

const DATA_DIR = "control/durable-meaning/data";

function file(dir: string, name: string): string {
  const base = join(process.cwd(), dir);
  mkdirSync(base, { recursive: true });
  const p = join(base, name);
  if (!existsSync(p)) writeFileSync(p, "", { encoding: "utf8", mode: 0o600 });
  return p;
}
const readAll = <T>(dir: string, name: string): readonly T[] =>
  readFileSync(file(dir, name), "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as T);

export function appendOrigin(origin: ResourceOrigin, dir: string = DATA_DIR): void {
  appendFileSync(file(dir, "resource-origins.jsonl"), `${JSON.stringify(origin)}\n`, { encoding: "utf8", mode: 0o600 });
}
export const readOrigins = (dir: string = DATA_DIR): readonly ResourceOrigin[] => readAll<ResourceOrigin>(dir, "resource-origins.jsonl");

export function appendAdmission(result: AdmissionResult, dir: string = DATA_DIR): void {
  appendFileSync(file(dir, "admissions.jsonl"), `${JSON.stringify(result)}\n`, { encoding: "utf8", mode: 0o600 });
}
export const readAdmissions = (dir: string = DATA_DIR): readonly AdmissionResult[] => readAll<AdmissionResult>(dir, "admissions.jsonl");

export function appendVocabulary(extension: VocabularyExtension, dir: string = DATA_DIR): void {
  appendFileSync(file(dir, "vocabularies.jsonl"), `${JSON.stringify(extension)}\n`, { encoding: "utf8", mode: 0o600 });
}
export const readVocabularies = (dir: string = DATA_DIR): readonly VocabularyExtension[] => readAll<VocabularyExtension>(dir, "vocabularies.jsonl");

/** What a caller wants to know. A canonical identity plus a question kind — never a sentence. */
export interface StructuredRequest {
  canonical_identity: string;
  question: "WHY_DOES_THIS_EXIST" | "WHAT_IS_BOUND_TO_THIS" | "WHAT_IS_ITS_BINDING_STATE";
}

export type KnowledgeOutcome = "KNOWLEDGE_FOUND" | "DISCOVERY_REQUIRED";

export interface KnowledgeAnswer {
  canonical_identity: string;
  question: StructuredRequest["question"];
  outcome: KnowledgeOutcome;
  /** The persisted facts, verbatim. Null when discovery is required. */
  origin: ResourceOrigin | null;
  admission: AdmissionResult | null;
  /** Where the answer came from — always a store path, never a session. */
  answered_from: string | null;
  /** Finite reason when nothing was found. */
  discovery_reason: "NO_ADMISSION_RECORD" | "NO_ORIGIN_RECORD" | null;
}

/**
 * Answers from persisted knowledge, or says discovery is required. Pure over
 * the records it is handed, so the same identity always yields the same answer
 * regardless of who asks, when, or in what words.
 */
export function resolveKnowledgeFirst(
  request: StructuredRequest,
  origins: readonly ResourceOrigin[],
  admissions: readonly AdmissionResult[],
): KnowledgeAnswer {
  const admission = admissions.filter((a) => a.resource_id === request.canonical_identity).at(-1) ?? null;
  const origin = origins.filter((o) => o.resource_id === request.canonical_identity).at(-1) ?? null;
  const base = { canonical_identity: request.canonical_identity, question: request.question };

  if (!admission) {
    return { ...base, outcome: "DISCOVERY_REQUIRED", origin: null, admission: null, answered_from: null, discovery_reason: "NO_ADMISSION_RECORD" };
  }
  // "Why does this exist" is only answered by an origin record. An admission
  // alone proves the identity was admitted, not why it was wanted.
  if (request.question === "WHY_DOES_THIS_EXIST" && !origin) {
    return { ...base, outcome: "DISCOVERY_REQUIRED", origin: null, admission, answered_from: "control/durable-meaning/data/admissions.jsonl", discovery_reason: "NO_ORIGIN_RECORD" };
  }
  return {
    ...base, outcome: "KNOWLEDGE_FOUND", origin, admission,
    answered_from: "control/durable-meaning/data/", discovery_reason: null,
  };
}
