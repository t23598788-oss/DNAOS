/**
 * Worker Usage Meter Runtime (owner, 2026-08-10, DigitalOcean AI
 * Inference Infrastructure Control & Billing Layer). Real, persistent,
 * provider-neutral per-call telemetry — writes public.worker_usage_events
 * (supabase/migrations/20260810000002_worker_usage_events.sql). Called
 * from ONE real site (codeWorkerRuntime.ts, immediately after
 * adapter.execute() returns), generic for every real Adapter — never
 * special-cased per provider.
 *
 * Real, honest token discipline (Owner's own instruction, verbatim):
 * "ห้ามประมาณ token ถ้า API ส่ง usage จริงกลับมา ถ้าไม่มีข้อมูลจริงให้เก็บ
 * UNKNOWN พร้อม source/reason" — recordUsageEvent() NEVER estimates a
 * token count. If WorkerResponse.tokenUsage.input/output is null, this
 * writes token_source='UNKNOWN' with a real, specific reason, never a
 * guessed number.
 *
 * Best-effort write (same resilience discipline already established in
 * this repo, e.g. auto-confirm-payment.ts's tryPushReceiptDocument): a
 * failure to record usage (e.g. the migration hasn't been applied to
 * this environment's live database yet — this build only wrote the
 * migration file, per the Owner's explicit "ห้าม deploy" instruction)
 * must never fail or roll back the real Worker dispatch that already
 * happened. Logged to console, never thrown.
 */
import { supabaseAdmin } from "@/services/supabase/queries";
import type { WorkerRequest, WorkerResponse } from "./workerContract";

export interface UsageEventRecord {
  id: string;
  request_id: string;
  provider: string;
  service: string;
  model: string | null;
  adapter_id: string;
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
  token_source: "PROVIDER_REPORTED" | "UNKNOWN";
  token_unknown_reason: string | null;
  latency_ms: number;
  status: string;
  error: string | null;
  started_at: string;
  completed_at: string;
  created_at: string;
}

/**
 * Real, deterministic entry point — called once per real adapter.execute()
 * completion. Derives started_at from completed_at - durationMs (the real
 * WorkerResponse doesn't carry a separate started_at field; this is the
 * only real value available, computed, not guessed, and disclosed here).
 */
export async function recordUsageEvent(request: WorkerRequest, adapterId: string, response: WorkerResponse): Promise<void> {
  const completedAt = new Date(response.finishedAt);
  const startedAt = new Date(completedAt.getTime() - response.durationMs);

  const hasRealTokens = response.tokenUsage.input !== null && response.tokenUsage.output !== null;
  const tokenUnknownReason = hasRealTokens
    ? null
    : response.status === "NOT_CONFIGURED"
      ? "no real provider call was made — Adapter reported NOT_CONFIGURED before any request"
      : response.status === "FAILED" || response.status === "TIMEOUT"
        ? "the real provider call did not complete successfully — no usage body was returned"
        : "the real provider response did not include a real, parseable token usage field";

  try {
    const { error } = await supabaseAdmin().from("worker_usage_events").insert({
      request_id: request.workerRequestId,
      provider: response.provider,
      service: request.capabilityRequired,
      model: response.model,
      adapter_id: adapterId,
      input_tokens: response.tokenUsage.input,
      output_tokens: response.tokenUsage.output,
      token_source: hasRealTokens ? "PROVIDER_REPORTED" : "UNKNOWN",
      token_unknown_reason: tokenUnknownReason,
      latency_ms: response.durationMs,
      status: response.status,
      error: response.error,
      started_at: startedAt.toISOString(),
      completed_at: completedAt.toISOString(),
    });
    if (error) console.error(`[usageMeterRuntime] real insert failed (table may not be migrated yet in this environment): ${error.message}`);
  } catch (e) {
    console.error(`[usageMeterRuntime] real insert threw: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export interface UsageEventQuery {
  provider?: string;
  adapterId?: string;
  limit?: number;
}

/** Real, read-only query — used by the admin Infrastructure Control &
 * Billing Center, never by anything that mutates state. */
export async function listUsageEvents(query: UsageEventQuery = {}): Promise<UsageEventRecord[]> {
  let q = supabaseAdmin().from("worker_usage_events").select("*").order("created_at", { ascending: false }).limit(query.limit ?? 100);
  if (query.provider) q = q.eq("provider", query.provider);
  if (query.adapterId) q = q.eq("adapter_id", query.adapterId);
  const { data, error } = await q;
  if (error) throw new Error(`listUsageEvents failed: ${error.message}`);
  return (data ?? []) as UsageEventRecord[];
}
