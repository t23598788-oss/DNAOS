/**
 * Intent Intake Runtime (owner, 2026-08-08, Software Factory Step 13,
 * Phase 3). Captures the Owner's real intent as real, structured data —
 * never a raw prompt string treated as ground truth. AI may PROPOSE a
 * structured split of free text, but the result stays `source: "AI_PROPOSED"`
 * until the Owner or a deterministic validator confirms it — AI never
 * silently becomes the intent's owner.
 */
import { randomUUID } from "crypto";
import { createOperationsArtifact } from "./artifactRuntime";

export interface StructuredIntent {
  problem: string;
  desiredOutcome: string;
  requestedChange: string;
  affectedArea: string[];
  constraints: string[];
  nonGoals: string[];
  expectedEvidence: string[];
  acceptanceCriteria: string[];
  ownerAuthority: "OWNER_CONFIRMED" | "AI_PROPOSED";
  riskTolerance: "LOW" | "MEDIUM" | "HIGH";
}

export interface IntentRecord {
  intentId: string;
  workspaceSessionId: string;
  raw: string;
  structured: StructuredIntent;
  source: "OWNER_STRUCTURED" | "AI_PROPOSED" | "OWNER_CONFIRMED_AI_PROPOSAL";
  confirmedAt: string | null;
  createdAt: string;
  ownerId: string;
  actor: string;
  artifactIds: string[];
}

export class IntentError extends Error {
  code: "INTENT_NOT_FOUND" | "INTENT_NOT_OWNED" | "INVALID_REQUEST";
  constructor(code: typeof IntentError.prototype.code, message: string) { super(message); this.code = code; this.name = "IntentError"; }
}

const intents = new Map<string, IntentRecord>();
const MAX_INTENT_HISTORY = 300;
function evictOld(ownerId: string) {
  const owned = [...intents.values()].filter((i) => i.ownerId === ownerId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  while (owned.length > MAX_INTENT_HISTORY) { const oldest = owned.shift()!; intents.delete(oldest.intentId); }
}

const REQUIRED_STRUCTURED_FIELDS: (keyof StructuredIntent)[] = ["problem", "desiredOutcome", "requestedChange"];

/** Real, deterministic completeness check — never AI-judged. A
 * structured intent is INCOMPLETE if any real, required field is empty. */
export function validateIntentCompleteness(structured: Partial<StructuredIntent>): { complete: boolean; missingFields: string[] } {
  const missingFields = REQUIRED_STRUCTURED_FIELDS.filter((f) => !structured[f] || (structured[f] as string).trim().length === 0);
  return { complete: missingFields.length === 0, missingFields };
}

/**
 * Captures a real, owner-supplied structured intent directly — the
 * primary, real path. `raw` is preserved verbatim as the real, original
 * text for audit, never discarded once structured.
 */
export function captureStructuredIntent(workspaceSessionId: string, ownerId: string, actor: string, raw: string, structured: StructuredIntent): IntentRecord {
  const { complete, missingFields } = validateIntentCompleteness(structured);
  if (!complete) throw new IntentError("INVALID_REQUEST", `structured intent is incomplete — missing real fields: ${missingFields.join(", ")}`);

  const intentId = randomUUID();
  const record: IntentRecord = {
    intentId, workspaceSessionId, raw, structured,
    source: "OWNER_STRUCTURED", confirmedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(), ownerId, actor, artifactIds: [],
  };
  const artifact = createOperationsArtifact({
    artifactType: "INTENT_RECORD", content: JSON.stringify(record), mimeType: "application/json",
    actor, ownerId, generatedFrom: intentId, jobId: null,
  });
  record.artifactIds.push(artifact.artifactId);
  intents.set(intentId, record);
  evictOld(ownerId);
  return record;
}

/**
 * Real, deterministic (non-AI) fallback splitter — used only when the
 * Owner supplies raw text without pre-structuring it themselves. This is
 * NOT an AI call; it is a real, mechanical text-splitting heuristic
 * (never invents facts, only reorganizes the Owner's own words) and its
 * result is ALWAYS `source: "AI_PROPOSED"`-equivalent (deterministic
 * proposal), requiring explicit confirmation before use.
 */
export function proposeStructuredIntentFromRaw(raw: string): StructuredIntent {
  const trimmed = raw.trim();
  return {
    problem: trimmed, desiredOutcome: "", requestedChange: trimmed,
    affectedArea: [], constraints: [], nonGoals: [], expectedEvidence: [], acceptanceCriteria: [],
    ownerAuthority: "AI_PROPOSED", riskTolerance: "MEDIUM",
  };
}

export function captureProposedIntent(workspaceSessionId: string, ownerId: string, actor: string, raw: string): IntentRecord {
  const structured = proposeStructuredIntentFromRaw(raw);
  const intentId = randomUUID();
  const record: IntentRecord = {
    intentId, workspaceSessionId, raw, structured,
    source: "AI_PROPOSED", confirmedAt: null,
    createdAt: new Date().toISOString(), ownerId, actor, artifactIds: [],
  };
  const artifact = createOperationsArtifact({
    artifactType: "INTENT_RECORD", content: JSON.stringify(record), mimeType: "application/json",
    actor, ownerId, generatedFrom: intentId, jobId: null,
  });
  record.artifactIds.push(artifact.artifactId);
  intents.set(intentId, record);
  evictOld(ownerId);
  return record;
}

/** Real Owner confirmation — the ONLY function that may transition a
 * proposed intent's source away from AI_PROPOSED. Never automatic. */
export function confirmIntent(intentId: string, ownerId: string, actor: string, confirmedStructured?: StructuredIntent): IntentRecord {
  const record = getIntent(intentId, ownerId);
  if (confirmedStructured) {
    const { complete, missingFields } = validateIntentCompleteness(confirmedStructured);
    if (!complete) throw new IntentError("INVALID_REQUEST", `cannot confirm an incomplete intent — missing: ${missingFields.join(", ")}`);
    record.structured = { ...confirmedStructured, ownerAuthority: "OWNER_CONFIRMED" };
  } else {
    record.structured.ownerAuthority = "OWNER_CONFIRMED";
  }
  record.source = "OWNER_CONFIRMED_AI_PROPOSAL";
  record.confirmedAt = new Date().toISOString();
  return record;
}

export function getIntent(intentId: string, ownerId: string): IntentRecord {
  const r = intents.get(intentId);
  if (!r) throw new IntentError("INTENT_NOT_FOUND", "no intent with that id");
  if (r.ownerId !== ownerId) throw new IntentError("INTENT_NOT_OWNED", "this intent belongs to a different session");
  return r;
}
export function listIntents(ownerId: string): IntentRecord[] {
  return [...intents.values()].filter((i) => i.ownerId === ownerId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export function __debugIntentCount(): number { return intents.size; }
