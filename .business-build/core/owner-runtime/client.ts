/**
 * Owner conversation runtime client — workspace side.
 *
 * Calls the INFRASTRUCTURE conversation runtime at 127.0.0.1:8791
 * (`GET /owner/language`) for system/business questions the deterministic
 * workspace path could not answer. This file adds NO AI, NO command engine,
 * NO reader/router — it is a thin, fail-closed HTTP caller:
 *
 *   · identity_id always comes from the AUTHENTICATED session mapping
 *     (OWNER_RUNTIME_IDENTITY env — never hardcoded, never the customer/
 *     relationship id, never the infrastructure's default identity).
 *   · No session-resolved identity = NO call (fail-closed; the runtime is
 *     never invoked with a guessed or default identity, so no request can
 *     silently fall into a tenant the session does not belong to).
 *   · relationshipId / documentContext travel as their own params — they
 *     are UI context, never identity.
 *   · Unreachable runtime / non-JSON / blocked status => null (the caller
 *     keeps its existing deterministic answer).
 */

export const OWNER_RUNTIME_ORIGIN_ENV = "OWNER_RUNTIME_ORIGIN";
export const OWNER_RUNTIME_IDENTITY_ENV = "OWNER_RUNTIME_IDENTITY";
export const DEFAULT_OWNER_RUNTIME_ORIGIN = "http://127.0.0.1:8791";

const TIMEOUT_MS = 15_000;

export interface OwnerRuntimeDocumentContext {
  /** document_no in the canonical source (e.g. INV-D10-...) when the UI has one open */
  document_no?: string | null;
  document_id?: string | null;
  title?: string | null;
}

export interface OwnerRuntimeAskRequest {
  /** instruction text exactly as the operator typed it (UI context folded in before sending) */
  text: string;
  /** authenticated-session identity registered in the tenant registry — never a customer id */
  identityId: string;
  /** current relationship (company) the workspace has open — UI context, never identity */
  relationshipId?: string | null;
  documentContext?: OwnerRuntimeDocumentContext | null;
  requestId?: string;
}

export interface OwnerRuntimeAnswer {
  status: string;
  answer: string;
  intent: { intent?: string; parameters?: Record<string, unknown> } | null;
  evidence_refs: string[];
  facts_verified: boolean;
  facts: Record<string, unknown> | null;
  raw: Record<string, unknown>;
}

function readEnv(name: string): string | undefined {
  if (typeof process === "undefined" || process.env === undefined) return undefined;
  return process.env[name];
}
/**
 * The owner-runtime identity for THIS authenticated session.
 *
 * OWNER_RUNTIME_IDENTITY is deployment configuration (which registered
 * identity this machine's admin session maps to). Returning null means "this
 * session has no registered owner-runtime identity" — callers must then skip
 * the runtime entirely (never substitute a default).
 */
export function resolveOwnerRuntimeIdentity(
  session: { id: string; email: string; role?: string } | null | undefined,
): string | null {
  if (!session || !session.id) return null;
  // OWNER_RUNTIME_IDENTITY is deployment-level configuration for the platform
  // owner's runtime. A tenant admin/member walking the same chat route must
  // never be mapped onto it — only the platform super_admin role may.
  if (session.role !== "super_admin") return null;
  const identity = (readEnv(OWNER_RUNTIME_IDENTITY_ENV) ?? "").trim();
  return identity.length > 0 ? identity : null;
}

/**
 * Ask the owner conversation runtime. Returns null (fail-closed) whenever the
 * runtime does not produce a real answer: unreachable, non-JSON, blocked, or
 * an unresolved semantic state.
 */
export async function askOwnerRuntime(
  request: OwnerRuntimeAskRequest,
  options: { origin?: string; fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<OwnerRuntimeAnswer | null> {
  const origin = (options.origin ?? readEnv(OWNER_RUNTIME_ORIGIN_ENV) ?? DEFAULT_OWNER_RUNTIME_ORIGIN).replace(/\/+$/, "");
  const fetchImpl = options.fetchImpl ?? fetch;
  const url = new URL("/owner/language", origin);
  url.searchParams.set("text", request.text);
  url.searchParams.set("identity_id", request.identityId);
  if (request.relationshipId) url.searchParams.set("relationship_id", request.relationshipId);
  if (request.documentContext) url.searchParams.set("document_context", JSON.stringify(request.documentContext));
  if (request.requestId) url.searchParams.set("request_id", request.requestId);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetchImpl(url.toString(), { signal: controller.signal, cache: "no-store" });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }

  let body: Record<string, unknown> | null = null;
  try {
    body = (await response.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!response.ok || !body) return null;

  // The transport wraps or flattens the ConversationResult projection —
  // read whichever shape arrives, never a third copy of either.
  const envelope =
    typeof body.result === "object" && body.result !== null && !Array.isArray(body.result)
      ? (body.result as Record<string, unknown>)
      : body;
  const status = typeof envelope.status === "string" ? envelope.status : "";
  const answer = typeof envelope.answer === "string" ? envelope.answer.trim() : "";
  const factsVerified = envelope.FACTS_VERIFIED === true;
  const answered = (status === "TRANSLATED" || status === "ANSWERED") && answer.length > 0;
  if (!answered) return null;

  const intentRaw = envelope.intent;
  const state = envelope.owner_response_state as { structured_answer?: { facts?: Record<string, unknown> } } | undefined;
  const facts =
    state?.structured_answer?.facts && typeof state.structured_answer.facts === "object"
      ? state.structured_answer.facts
      : null;
  const evidence = Array.isArray(envelope.evidence_refs)
    ? (envelope.evidence_refs as unknown[]).filter((row): row is string => typeof row === "string")
    : [];

  return {
    status,
    answer,
    intent:
      intentRaw && typeof intentRaw === "object" && !Array.isArray(intentRaw)
        ? (intentRaw as { intent?: string; parameters?: Record<string, unknown> })
        : null,
    evidence_refs: evidence,
    facts_verified: factsVerified,
    facts,
    raw: envelope,
  };
}

/**
 * Fold current UI document context into an anaphoric instruction
 * ("เอกสารนี้สถานะอะไร" + an open INV-... document → explicit document_no).
 * Only rewrites when the UI actually has a document open — never guesses.
 */
export function resolveOwnerRuntimeInstruction(
  text: string,
  documentContext: OwnerRuntimeDocumentContext | null | undefined,
): string {
  const documentNo = documentContext?.document_no?.trim();
  if (!documentNo) return text;
  if (!/(เอกสารนี้|เอกสารนั้น|ฉบับนี้|invoiceนี้|documentนี้)/i.test(text)) return text;
  return text.replace(/(เอกสารนี้|เอกสารนั้น|ฉบับนี้|invoiceนี้|documentนี้)/gi, `เอกสาร ${documentNo}`);
}
