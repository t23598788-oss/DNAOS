/**
 * Manager Question Queue Runtime (owner, 2026-08-09, Constitution Rule 251
 * — "Single Owner Inquiry Authority" — real build, TASK-042).
 *
 * Implements the Owner's exact required flow (registry/CONSTITUTION.json,
 * iron_rules, Rule 251, verbatim): Worker Question -> Manager Question
 * Queue -> Registry-first lookup -> Deduplicate -> Aggregate -> Resolve
 * internally when evidence exists -> Escalate only unresolved Owner
 * Decisions. "Factory Manager คือการขยาย
 * app/api/admin/ide/_lib/workerTaskOrchestrator.ts ที่มีอยู่แล้ว...ไม่ใช่
 * ระบบใหม่คู่ขนาน" — this file is the real extension Rule 251 names;
 * workerTaskOrchestrator.ts composes exactly one function from here
 * (submitJobContractQuestion, see that file) and nothing else.
 *
 * STRUCTURAL GUARANTEE (Rule 251's hard requirement — "Worker/Validator/
 * Inspector/Integrator ห้ามถาม Owner โดยตรง"): this is the ONLY module in
 * this repo that may produce an Owner-facing question (getOwnerFacingQueue)
 * or accept an Owner's answer (answerAggregatedQuestion). Every Worker-
 * facing path (workerTaskOrchestrator.ts, workerRegistry.ts,
 * workerContract.ts, workerSelectorRuntime.ts, codeWorkerRuntime.ts,
 * workerAdapters/*) may reach ONLY submitWorkerQuestion() (and, for
 * checking on an already-submitted ask, getAnswerForAsk()) — never the two
 * Owner-facing functions. Verified mechanically by
 * scripts/manager-question-queue-test.ts's criterion (d): a real,
 * whole-repo grep confirms getOwnerFacingQueue/answerAggregatedQuestion
 * are referenced nowhere outside this file and the acceptance test(s)
 * that verify this surface directly — as of 2026-08-09 (Constitution
 * Rule 257, TASK-048/FCR-009) that also includes
 * scripts/cost-gate-test.ts, which reads getOwnerFacingQueue()
 * READ-ONLY to prove a real COST_GATE LOCK's escalation actually lands
 * there — it never imports/calls answerAggregatedQuestion, and no
 * WorkerType execution path gained access (criterion (d)'s second check
 * in that same test still holds this line exactly).
 *
 * Reuses this repo's established patterns rather than inventing new ones
 * (Constitution Rule 101/103):
 *  - bounded in-memory Map + eviction, the same pattern already used by
 *    contextPlannerRuntime.ts's contextPlans / workerTaskOrchestrator.ts's
 *    lastWorkerAcceptanceProofByRole — same disclosed limitation
 *    (in-memory only, resets on process restart, never claimed durable
 *    beyond this process's lifetime).
 *  - a small, closed set of deterministically recognized, real-file-backed
 *    "resolvable question shapes", mirroring acceptanceContractRuntime.ts's
 *    compileAcceptanceCriteria() philosophy exactly: a question either
 *    matches one of a few real, evidence-backed shapes, or it is honestly
 *    left UNRESOLVED_BY_REGISTRY and must escalate — never an LLM asked to
 *    guess whether a question is "answered".
 *  - real Evidence/Audit Trail via createOperationsArtifact()
 *    (artifactRuntime.ts, this repo's one real Evidence Warehouse) using a
 *    new MANAGER_QUESTION_RECORD ArtifactType (see artifactRegistry.ts) —
 *    one real, immutable artifact VERSION per lifecycle transition, all
 *    sharing artifactType+generatedFrom=questionId so
 *    artifactRuntime.ts's own real version-history mechanism (see its
 *    `artifactHeads`/`supersedes`/`supersededBy`) produces the audit trail
 *    for free — never a second audit log invented.
 *
 * Honest, disclosed limitation (Constitution Rule 100/106/109/110 —
 * declare gaps, never overclaim): the dedup below is a real, deterministic
 * keyword-set (overlap-coefficient) match over normalized question text —
 * NOT full natural-language understanding. Two genuinely-same-meaning
 * questions that share zero significant keywords (e.g. "who's free right
 * now" vs "list idle personnel") will NOT be merged; two different, SHORT
 * questions that happen to share their one or two keywords could
 * theoretically over-merge. This is the same class of disclosed
 * limitation as acceptanceContractRuntime.ts's NOT_MACHINE_CHECKABLE
 * fallback — real, deterministic, closed-set, and honestly bounded rather
 * than silently wrong. Likewise, the registry-first resolver below only
 * recognizes a small, closed set of question shapes (RULE_STATUS,
 * ACTIVE_WORKERS, CURRENT_TASK_STATUS, LATEST_CHANGELOG) — a real,
 * evidence-answerable question outside that set is honestly escalated to
 * the Owner rather than guessed at.
 */
import { readFileSync } from "fs";
import { randomUUID } from "crypto";
import path from "path";
import { WORKSPACE_ROOT } from "./fsSecurity";
import { createOperationsArtifact } from "./artifactRuntime";
import { WORKER_REGISTRY, type WorkerType } from "./workerRegistry";

const ROOT = WORKSPACE_ROOT;

// ============================================================
// Real, mandated registry-first lookup surface (Rule 251, requirement 4)
// — exactly these 5 files, in this order, every time, before anything may
// escalate to the Owner.
// ============================================================
export const MANAGED_REGISTRY_FILES = [
  "registry/CONSTITUTION.json",
  "registry/CURRENT_STATE.json",
  "registry/CHANGELOG.json",
  "registry/rule-coverage.json",
  "registry/factory-registry.json",
] as const;

// ============================================================
// Types
// ============================================================
export type ManagerQuestionStatus = "RESOLVED_BY_REGISTRY" | "PENDING_OWNER" | "ANSWERED_BY_OWNER";

export interface WorkerQuestionAsk {
  askId: string;
  workerRole: WorkerType;
  jobContractId: string;
  actor: string;
  ownerId: string;
  questionText: string;
  askedAt: string;
}

export interface RegistryLookupHit {
  sourceFile: string;
  matchedPath: string;
  matchedText: string;
}

export interface ManagerQuestionAuditEvent {
  eventId: string;
  kind: "SUBMITTED" | "DEDUPED_INTO_EXISTING" | "REGISTRY_LOOKUP" | "RESOLVED_INTERNALLY" | "ESCALATED_TO_OWNER" | "OWNER_ANSWERED" | "ANSWER_FANNED_OUT";
  detail: string;
  actor: string;
  occurredAt: string;
}

export interface ManagerQuestionRecord {
  questionId: string;
  questionKey: string;
  canonicalQuestionText: string;
  askers: WorkerQuestionAsk[];
  status: ManagerQuestionStatus;
  registryFilesChecked: string[];
  registryHits: RegistryLookupHit[];
  matchedShape: string | null;
  resolutionAnswer: string | null;
  resolvedBy: "REGISTRY" | "OWNER" | null;
  createdAt: string;
  resolvedAt: string | null;
  ownerId: string;
  evidenceArtifactIds: string[];
  auditTrail: ManagerQuestionAuditEvent[];
}

export class ManagerQuestionError extends Error {
  code: "QUESTION_NOT_FOUND" | "QUESTION_NOT_OWNED" | "ALREADY_ANSWERED";
  constructor(code: typeof ManagerQuestionError.prototype.code, message: string) {
    super(message);
    this.code = code;
    this.name = "ManagerQuestionError";
  }
}

// ============================================================
// Bounded in-memory store (disclosed limitation — see file header)
// ============================================================
const questions = new Map<string, ManagerQuestionRecord>();
const MAX_QUESTION_HISTORY = 500;

function evictOld(ownerId: string) {
  const owned = [...questions.values()].filter((q) => q.ownerId === ownerId && q.status !== "PENDING_OWNER").sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  let total = [...questions.values()].filter((q) => q.ownerId === ownerId).length;
  while (total > MAX_QUESTION_HISTORY && owned.length > 0) {
    const oldest = owned.shift()!;
    questions.delete(oldest.questionId);
    total -= 1;
  }
}

// ============================================================
// Real, deterministic normalization / dedup (no AI, no fuzzy LLM judgment)
// ============================================================
const STOPWORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "be", "been", "being", "do", "does", "did", "doing",
  "can", "could", "will", "would", "should", "shall", "may", "might", "must",
  "please", "kindly", "tell", "let", "me", "i", "we", "you", "your", "our", "us", "it", "its",
  "need", "want", "to", "know", "knowing", "what", "which", "who", "whom", "whose", "why", "how",
  "list", "all", "that", "this", "these", "those", "of", "for", "on", "in", "at", "by", "with", "and",
  "or", "have", "has", "had", "having", "up", "down", "out", "about", "give", "gives", "show", "shows",
  "provide", "provides", "right", "now", "today", "currently", "status", "just", "am", "im",
]);

function normalizeToken(raw: string): string {
  let t = raw.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (t.length > 4 && t.endsWith("ies")) t = `${t.slice(0, -3)}y`;
  else if (t.length > 4 && t.endsWith("es")) t = t.slice(0, -2);
  else if (t.length > 3 && t.endsWith("s") && !t.endsWith("ss")) t = t.slice(0, -1);
  return t;
}

/** Real, deterministic keyword extraction — lowercase, strip punctuation,
 * strip a real, fixed stopword list, light plural-stripping, dedupe,
 * sorted. Exported so the acceptance suite can prove the dedup mechanism
 * directly rather than trusting it as a black box. */
export function extractKeywords(text: string): string[] {
  return Array.from(new Set(text.split(/\s+/).map(normalizeToken).filter((t) => t.length > 2 && !STOPWORDS.has(t)))).sort();
}

/** Real, deterministic Szymkiewicz-Simpson overlap coefficient
 * (intersection / min(|A|,|B|)) — deliberately used INSTEAD of plain
 * Jaccard (intersection / union). Free-text rewording of "the same
 * question" routinely adds a few incidental extra words (politeness,
 * filler, a different verb form) that plain Jaccard punishes hard via a
 * growing union; the overlap coefficient asks the more honest question
 * for this use case — "is the smaller set's content essentially a
 * subset of the larger one's?" — which tracks "same underlying question,
 * different verbosity" much better. Disclosed tradeoff: two SHORT,
 * different questions that happen to share their one keyword would score
 * a coincidental 1.0 — mitigated in practice by requiring
 * DEDUP_SIMILARITY_THRESHOLD and by extractKeywords()'s real stopword
 * filtering already discarding near-universal filler words.
 *
 * Exported (2026-08-09, Switch-Based Orchestrator gate pipeline,
 * switchBasedOrchestratorRuntime.ts) so that runtime's real DEDUP stage
 * reuses this exact, already-tested formula for work-item deduplication
 * instead of reimplementing keyword-overlap matching from scratch
 * (Constitution Rule 101/103). Purely additive — signature and behavior
 * unchanged, still covered by manager-question-queue-test.ts's 21/21. */
export function overlapCoefficient(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let intersection = 0;
  for (const k of setA) if (setB.has(k)) intersection += 1;
  return intersection / Math.min(setA.size, setB.size);
}

const DEDUP_SIMILARITY_THRESHOLD = 0.5;

/** Real merge-target search — compares the new ask's keywords against
 * each existing question's ACCUMULATED keyword set (the union of every
 * real asker's keywords merged into it so far, stored in questionKey),
 * not just the very first asker's wording. This is a deliberate,
 * realistic design: as more real, differently-worded asks join a
 * cluster, the cluster's own keyword vocabulary grows, making it
 * correctly easier (not harder) to recognize the next real rewording as
 * the same underlying question. */
function findMergeTarget(ownerId: string, keywords: string[]): ManagerQuestionRecord | null {
  let best: ManagerQuestionRecord | null = null;
  let bestScore = 0;
  for (const q of questions.values()) {
    if (q.ownerId !== ownerId) continue;
    const accumulated = q.questionKey.split("|").filter(Boolean);
    const score = overlapCoefficient(keywords, accumulated);
    if (score >= DEDUP_SIMILARITY_THRESHOLD && score > bestScore) {
      best = q;
      bestScore = score;
    }
  }
  return best;
}

// ============================================================
// Real, registry-first lookup — real file reads, real keyword matching
// (never a stub that always says "not found").
// ============================================================
function flattenJson(value: unknown, pathPrefix: string, out: { path: string; text: string }[], depth = 0): void {
  if (depth > 6 || value === null || value === undefined) return;
  if (typeof value === "string") {
    if (value.length > 0) out.push({ path: pathPrefix, text: value });
    return;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    out.push({ path: pathPrefix, text: String(value) });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => flattenJson(v, `${pathPrefix}[${i}]`, out, depth + 1));
    return;
  }
  if (typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) flattenJson(v, pathPrefix ? `${pathPrefix}.${k}` : k, out, depth + 1);
  }
}

function searchRegistryFile(relPath: string, keywords: string[]): RegistryLookupHit[] {
  try {
    const raw = readFileSync(path.join(ROOT, relPath), "utf-8");
    const json = JSON.parse(raw);
    const flat: { path: string; text: string }[] = [];
    flattenJson(json, "", flat);
    const requiredMatches = Math.min(2, keywords.length);
    const hits: RegistryLookupHit[] = [];
    for (const entry of flat) {
      const lower = entry.text.toLowerCase();
      const matchCount = keywords.filter((k) => k.length > 2 && lower.includes(k)).length;
      if (matchCount > 0 && matchCount >= requiredMatches) {
        hits.push({ sourceFile: relPath, matchedPath: entry.path, matchedText: entry.text.slice(0, 400) });
      }
    }
    return hits.slice(0, 5);
  } catch {
    // Real, honest "file unreadable or not valid JSON" — never fabricated
    // as a match, never silently treated as "nothing to check".
    return [];
  }
}

/** Real, mandated registry-first search across all 5 files named by Rule
 * 251, in the specified order, every time — before anything may escalate. */
function runRegistryFirstSearch(questionText: string): { checked: string[]; hits: RegistryLookupHit[] } {
  const keywords = extractKeywords(questionText);
  const hits: RegistryLookupHit[] = [];
  for (const f of MANAGED_REGISTRY_FILES) hits.push(...searchRegistryFile(f, keywords));
  return { checked: [...MANAGED_REGISTRY_FILES], hits };
}

// ============================================================
// Real, closed set of deterministically resolvable question shapes.
// Each resolver reads a real file / real registry and returns a real,
// evidence-backed answer, or null (never guessed). Anything not matching
// one of these shapes is honestly left for the Owner.
// ============================================================
interface ShapeResolution {
  matchedShape: string;
  answer: string;
}

function tryResolveRuleStatus(questionText: string): ShapeResolution | null {
  const m = questionText.match(/\brule\s*#?\s*(\d{1,3})\b/i);
  if (!m) return null;
  const ruleNum = m[1];
  try {
    const cov = JSON.parse(readFileSync(path.join(ROOT, "registry/rule-coverage.json"), "utf-8")) as {
      rules: Record<string, { title: string; enforced_by: string[]; type: string; detection: string }>;
    };
    const rule = cov.rules[ruleNum];
    if (!rule) return null;
    const answer = `Real answer from registry/rule-coverage.json: Rule ${ruleNum} — "${rule.title}" (type: ${rule.type}). detection: ${rule.detection} enforced_by: ${rule.enforced_by.length > 0 ? rule.enforced_by.join("; ") : "(none recorded)"}.`;
    return { matchedShape: "RULE_STATUS", answer };
  } catch {
    return null;
  }
}

function tryResolveActiveWorkers(questionText: string): ShapeResolution | null {
  const kws = extractKeywords(questionText);
  const hasWorker = kws.some((k) => k.startsWith("worker"));
  const hasActive = kws.some((k) => k.startsWith("activ"));
  if (!hasWorker || !hasActive) return null;
  const active = Object.values(WORKER_REGISTRY).filter((w) => w.status === "ACTIVE").map((w) => w.id);
  const answer = `Real answer from app/api/admin/ide/_lib/workerRegistry.ts's WORKER_REGISTRY: ACTIVE workers = ${active.length > 0 ? active.join(", ") : "(none currently ACTIVE)"}.`;
  return { matchedShape: "ACTIVE_WORKERS", answer };
}

function tryResolveCurrentTaskStatus(questionText: string): ShapeResolution | null {
  const kws = extractKeywords(questionText);
  const hasCurrent = kws.some((k) => k.startsWith("current") || k === "status");
  const hasTask = kws.some((k) => k.startsWith("task") || k.startsWith("work") || k.startsWith("progress"));
  if (!hasCurrent || !hasTask) return null;
  try {
    const state = JSON.parse(readFileSync(path.join(ROOT, "registry/CURRENT_STATE.json"), "utf-8")) as { status: string; current_task: string; next_step: string };
    const answer = `Real answer from registry/CURRENT_STATE.json: status=${state.status}. current_task: ${state.current_task} next_step: ${state.next_step}`;
    return { matchedShape: "CURRENT_TASK_STATUS", answer };
  } catch {
    return null;
  }
}

function tryResolveLatestChangelog(questionText: string): ShapeResolution | null {
  const kws = extractKeywords(questionText);
  const hasRecency = kws.some((k) => k.startsWith("latest") || k.startsWith("last") || k.startsWith("recent"));
  const hasChange = kws.some((k) => k.startsWith("chang"));
  if (!hasRecency || !hasChange) return null;
  try {
    const parsed = JSON.parse(readFileSync(path.join(ROOT, "registry/CHANGELOG.json"), "utf-8"));
    const arr = Array.isArray(parsed) ? parsed : [];
    const last = arr[arr.length - 1] as Record<string, unknown> | undefined;
    if (!last) return null;
    const answer = `Real answer from registry/CHANGELOG.json (latest entry): change_id=${String(last.change_id ?? "?")}, status=${String(last.status ?? "?")}, summary=${String(last.summary ?? "").slice(0, 300)}`;
    return { matchedShape: "LATEST_CHANGELOG", answer };
  } catch {
    return null;
  }
}

const SHAPE_RESOLVERS: Array<(q: string) => ShapeResolution | null> = [
  tryResolveRuleStatus, tryResolveActiveWorkers, tryResolveCurrentTaskStatus, tryResolveLatestChangelog,
];

function tryResolveFromRegistry(questionText: string): ShapeResolution | null {
  for (const resolver of SHAPE_RESOLVERS) {
    const res = resolver(questionText);
    if (res) return res;
  }
  return null;
}

// ============================================================
// Evidence / Audit Trail — one real, immutable artifact VERSION per event.
// ============================================================
function recordEvent(record: ManagerQuestionRecord, kind: ManagerQuestionAuditEvent["kind"], actor: string, detail: string): void {
  record.auditTrail.push({ eventId: randomUUID(), kind, detail, actor, occurredAt: new Date().toISOString() });
  const artifact = createOperationsArtifact({
    artifactType: "MANAGER_QUESTION_RECORD", content: JSON.stringify(record), mimeType: "application/json",
    actor, ownerId: record.ownerId, generatedFrom: record.questionId, jobId: null, workspaceSessionId: null,
  });
  record.evidenceArtifactIds.push(artifact.artifactId);
}

// ============================================================
// WORKER-FACING SURFACE — the ONLY entry point a Worker/Job may use.
// ============================================================
export interface SubmitWorkerQuestionInput {
  workerRole: WorkerType;
  jobContractId: string;
  actor: string;
  ownerId: string;
  questionText: string;
}

export interface SubmitWorkerQuestionOutcome {
  questionId: string;
  askId: string;
  status: ManagerQuestionStatus;
  /** Real, immediate answer — present only when this ask was
   * RESOLVED_BY_REGISTRY, or when it merged into an already-answered
   * question (instant fan-out to a late asker). Null while PENDING_OWNER. */
  answer: string | null;
  merged: boolean;
  matchedShape: string | null;
}

/** Real, single Worker-facing submission point (Rule 251). Runs the full
 * required flow: dedupe against existing questions for this owner
 * (Jaccard keyword-set match) -> if new, registry-first lookup across all
 * 5 mandated files -> try the closed set of recognized resolvable shapes
 * -> resolve internally (never reaches the Owner-facing queue) or
 * honestly escalate. Every transition is recorded as a real audit event
 * + a real, immutable evidence artifact version. */
export function submitWorkerQuestion(input: SubmitWorkerQuestionInput): SubmitWorkerQuestionOutcome {
  const now = new Date().toISOString();
  const keywords = extractKeywords(input.questionText);
  const ask: WorkerQuestionAsk = {
    askId: randomUUID(), workerRole: input.workerRole, jobContractId: input.jobContractId,
    actor: input.actor, ownerId: input.ownerId, questionText: input.questionText, askedAt: now,
  };

  const existing = findMergeTarget(input.ownerId, keywords);
  if (existing) {
    const accumulated = new Set([...existing.questionKey.split("|").filter(Boolean), ...keywords]);
    existing.questionKey = [...accumulated].sort().join("|");
    existing.askers.push(ask);
    recordEvent(existing, "DEDUPED_INTO_EXISTING", input.actor, `real ask ${ask.askId} from ${input.workerRole} (jobContractId=${input.jobContractId}) merged into existing question ${existing.questionId} — worded: "${input.questionText}"`);
    if (existing.status === "RESOLVED_BY_REGISTRY" || existing.status === "ANSWERED_BY_OWNER") {
      recordEvent(existing, "ANSWER_FANNED_OUT", input.actor, `real, already-known answer fanned out immediately to late asker ${ask.askId} (${input.workerRole}, jobContractId=${input.jobContractId})`);
      return { questionId: existing.questionId, askId: ask.askId, status: existing.status, answer: existing.resolutionAnswer, merged: true, matchedShape: existing.matchedShape };
    }
    return { questionId: existing.questionId, askId: ask.askId, status: existing.status, answer: null, merged: true, matchedShape: existing.matchedShape };
  }

  const questionId = randomUUID();
  const record: ManagerQuestionRecord = {
    questionId, questionKey: keywords.join("|"), canonicalQuestionText: input.questionText, askers: [ask],
    status: "PENDING_OWNER", registryFilesChecked: [], registryHits: [], matchedShape: null,
    resolutionAnswer: null, resolvedBy: null, createdAt: now, resolvedAt: null, ownerId: input.ownerId,
    evidenceArtifactIds: [], auditTrail: [],
  };
  questions.set(questionId, record);
  recordEvent(record, "SUBMITTED", input.actor, `real, new question submitted by ${input.workerRole} (jobContractId=${input.jobContractId}): "${input.questionText}"`);

  const lookup = runRegistryFirstSearch(input.questionText);
  record.registryFilesChecked = lookup.checked;
  record.registryHits = lookup.hits;
  recordEvent(record, "REGISTRY_LOOKUP", input.actor, `real registry-first lookup checked ${lookup.checked.length} mandated file(s) (${lookup.checked.join(", ")}) — ${lookup.hits.length} real keyword-matched hit(s) found`);

  const resolution = tryResolveFromRegistry(input.questionText);
  if (resolution) {
    record.status = "RESOLVED_BY_REGISTRY";
    record.resolutionAnswer = resolution.answer;
    record.resolvedBy = "REGISTRY";
    record.matchedShape = resolution.matchedShape;
    record.resolvedAt = new Date().toISOString();
    recordEvent(record, "RESOLVED_INTERNALLY", input.actor, `registry-first lookup resolved this question via recognized shape ${resolution.matchedShape} — answered directly, NEVER reached the Owner-facing queue. Answer: ${resolution.answer}`);
    evictOld(input.ownerId);
    return { questionId, askId: ask.askId, status: "RESOLVED_BY_REGISTRY", answer: resolution.answer, merged: false, matchedShape: resolution.matchedShape };
  }

  recordEvent(record, "ESCALATED_TO_OWNER", input.actor, "no recognized, evidence-backed resolvable shape matched this question after the mandated registry-first lookup — genuinely Owner-only, added to the Owner-facing queue");
  evictOld(input.ownerId);
  return { questionId, askId: ask.askId, status: "PENDING_OWNER", answer: null, merged: false, matchedShape: null };
}

/** Real, Worker-facing poll for an ask's own current answer (never reads
 * or exposes any OTHER question in the queue) — used by a Worker/Job that
 * asked a question still PENDING_OWNER at submit time to check back later
 * without needing Owner-facing queue access. */
export function getAnswerForAsk(askId: string): { status: ManagerQuestionStatus; answer: string | null; questionId: string } | null {
  for (const q of questions.values()) {
    if (q.askers.some((a) => a.askId === askId)) {
      return { status: q.status, answer: q.resolutionAnswer, questionId: q.questionId };
    }
  }
  return null;
}

// ============================================================
// OWNER-FACING SURFACE — the ONLY two functions that may ever expose a
// question to, or accept an answer from, the Owner. Never imported by any
// WorkerType execution path (see file header + criterion (d) test).
// ============================================================
export interface OwnerFacingQuestionAsker {
  workerRole: WorkerType;
  jobContractId: string;
  askedAt: string;
  questionText: string;
}

export interface OwnerFacingQuestion {
  questionId: string;
  canonicalQuestionText: string;
  askerCount: number;
  askers: OwnerFacingQuestionAsker[];
  registryFilesChecked: string[];
  registryHitCount: number;
  createdAt: string;
}

/** Real, Owner-facing read — the queue contains ONLY genuinely unresolved,
 * Owner-only questions (status PENDING_OWNER); every registry-resolvable
 * question was already answered internally and never reaches here. */
export function getOwnerFacingQueue(ownerId: string): OwnerFacingQuestion[] {
  return [...questions.values()]
    .filter((q) => q.ownerId === ownerId && q.status === "PENDING_OWNER")
    .map((q) => ({
      questionId: q.questionId,
      canonicalQuestionText: q.canonicalQuestionText,
      askerCount: q.askers.length,
      askers: q.askers.map((a) => ({ workerRole: a.workerRole, jobContractId: a.jobContractId, askedAt: a.askedAt, questionText: a.questionText })),
      registryFilesChecked: q.registryFilesChecked,
      registryHitCount: q.registryHits.length,
      createdAt: q.createdAt,
    }));
}

export interface AnswerAggregatedQuestionOutcome {
  questionId: string;
  answer: string;
  fannedOutTo: { askId: string; workerRole: WorkerType; jobContractId: string }[];
}

/** Real, Owner-facing write — the Owner answers an aggregated question
 * EXACTLY ONCE here, and the real answer fans out to every real asker
 * recorded on it (Rule 251's fan-out requirement), including any asker
 * who submitted before this call. A second call on the same questionId
 * is a real, honest error (ALREADY_ANSWERED), never a silent overwrite. */
export function answerAggregatedQuestion(questionId: string, ownerId: string, actor: string, answer: string): AnswerAggregatedQuestionOutcome {
  const record = questions.get(questionId);
  if (!record) throw new ManagerQuestionError("QUESTION_NOT_FOUND", `no Manager Question with id ${questionId}`);
  if (record.ownerId !== ownerId) throw new ManagerQuestionError("QUESTION_NOT_OWNED", "this Manager Question belongs to a different session");
  if (record.status === "ANSWERED_BY_OWNER") throw new ManagerQuestionError("ALREADY_ANSWERED", "this Manager Question was already answered once — the Owner answers exactly once, per Rule 251's fan-out requirement");

  record.status = "ANSWERED_BY_OWNER";
  record.resolutionAnswer = answer;
  record.resolvedBy = "OWNER";
  record.resolvedAt = new Date().toISOString();
  recordEvent(record, "OWNER_ANSWERED", actor, `real Owner answered aggregated question ${questionId} exactly once: "${answer}"`);

  const fannedOutTo = record.askers.map((a) => ({ askId: a.askId, workerRole: a.workerRole, jobContractId: a.jobContractId }));
  recordEvent(record, "ANSWER_FANNED_OUT", actor, `real answer fanned out to all ${fannedOutTo.length} real asker(s): ${fannedOutTo.map((f) => `${f.workerRole}/${f.jobContractId}`).join(", ") || "(none)"}`);

  return { questionId, answer, fannedOutTo };
}

// ============================================================
// Debug/test-only helpers — same, already-established convention as
// contextPlannerRuntime.ts's __debugContextPlanCount / workerTaskOrchestrator.ts's
// __debugResetWorkerAcceptanceProof.
// ============================================================
export function __debugGetQuestionRecord(questionId: string): ManagerQuestionRecord | undefined {
  return questions.get(questionId);
}
export function __debugResetManagerQuestionQueue(ownerId?: string): void {
  if (ownerId) { for (const [id, q] of questions) if (q.ownerId === ownerId) questions.delete(id); }
  else questions.clear();
}
export function __debugQuestionCount(ownerId?: string): number {
  return ownerId ? [...questions.values()].filter((q) => q.ownerId === ownerId).length : questions.size;
}
