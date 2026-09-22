/**
 * CANONICAL TRANSPORT CLIENT (IntegrPASS 6 / G2) — Edge/Deno side, CHANNEL role only.
 *
 * Sends a business intent to the canonical runtime as a transport envelope. It contains NO
 * business logic: it never computes money, never writes a business table and never interprets
 * the result. Auth reuses the existing internal-secret header pattern. When the transport
 * cannot know whether the canonical side wrote (timeout), it reports that honestly so the
 * caller can look up by idempotency instead of blindly retrying a writer.
 */
export interface CanonicalJobRequest {
  capability: string;
  source_channel: "LINE" | "EMAIL" | "BANK" | "UPLOAD" | "DRIVE";
  intent: string;
  identity_refs: { line_user_id?: string; partner_id?: string | null; event_id?: string | null };
  exec_args: unknown;
  source_event_id: string;
  correlation_id?: string;
  evidence_refs?: string[];
  approval_refs?: string[];
  data_write?: string[];
}

export interface CanonicalJobResponse {
  job_id: string;
  status: string;
  capability: string;
  business_refs: Array<{ table: string; id: string }>;
  acceptance: Array<{ acceptance_id: string; pass: boolean; verifier_id: string; evidence_ref: string }>;
  evidence_refs: string[];
  recovery: { action: string; terminal_state: string; reason: string } | null;
  idempotent_replay: boolean;
  wrote: boolean;
  transport_error?: string;
}

function appBase(): string | null {
  return Deno.env.get("NEXT_PUBLIC_APP_URL") ?? Deno.env.get("APP_URL") ?? null;
}

/** Deterministic idempotency key: capability + real source event (never a random value). */
export function idempotencyKeyFor(capability: string, sourceEventId: string): string {
  return `${capability}:${sourceEventId}`;
}

export async function requestCanonicalJob(req: CanonicalJobRequest): Promise<CanonicalJobResponse> {
  const base = appBase();
  const secret = Deno.env.get("CANONICAL_JOB_INTERNAL_SECRET");
  const jobId = crypto.randomUUID();
  const correlationId = req.correlation_id ?? jobId;
  const key = idempotencyKeyFor(req.capability, req.source_event_id);

  const unavailable = (why: string): CanonicalJobResponse => ({
    job_id: jobId, status: "TRANSPORT_UNAVAILABLE", capability: req.capability, business_refs: [],
    acceptance: [], evidence_refs: [], recovery: { action: "REVIEW", terminal_state: "TERMINAL_AFTER_MAX_ATTEMPTS", reason: why },
    idempotent_replay: false, wrote: false, transport_error: why,
  });
  if (!base || !secret) return unavailable("canonical transport not configured (APP_URL / CANONICAL_JOB_INTERNAL_SECRET)");

  const envelope = {
    job_id: jobId, kind: "BUSINESS", source_runtime: "SUPABASE_EDGE", source_channel: req.source_channel,
    capability: req.capability, executor: "SERVICE", intent: req.intent,
    identity_refs: req.identity_refs, scope: { data_write: req.data_write ?? [], spend: { kind: "FREE" } },
    plan_ref: null, approval_refs: req.approval_refs ?? [], evidence_refs: req.evidence_refs ?? [],
    correlation_id: correlationId, idempotency_key: key, requested_at: new Date().toISOString(),
    source_event_id: req.source_event_id, exec_args: req.exec_args,
  };

  try {
    const res = await fetch(`${base}/api/internal/canonical/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-canonical-job-secret": secret },
      body: JSON.stringify(envelope),
    });
    if (!res.ok && res.status !== 202 && res.status !== 422) return unavailable(`canonical transport HTTP ${res.status}`);
    return (await res.json()) as CanonicalJobResponse;
  } catch (e) {
    // timeout / network: we do NOT know whether the write happened → never retry the writer blindly
    return unavailable(`transport error (write outcome unknown): ${e instanceof Error ? e.message : String(e)}`);
  }
}
