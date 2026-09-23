/**
 * DNA OS — device evidence hook factory (PHASE A10, owner 2026-09-23).
 *
 * The device AI runtime (./device-ai-runtime.mjs) is deliberately DB-free: it
 * requires an evidence hook and fails closed if the hook is missing or throws.
 * This factory builds that hook for device scripts that own a Supabase client,
 * writing to the SAME table/keys every other runtime uses (system_health_status ·
 * service_key dna_os_ai_gateway · check_kind ai_invocation). It is not an
 * authority of any kind — it only records what the runtime already decided.
 */
export function createDeviceEvidence({ db, origin }) {
  if (!db) throw new Error("AI_GATEWAY_EVIDENCE_FAILED: no db client supplied");
  return async (event) => {
    const { error } = await db.from("system_health_status").upsert({
      service_key: "dna_os_ai_gateway",
      check_kind: "ai_invocation",
      status: event.status === "failed" ? "degraded" : "healthy",
      consecutive_failures: event.status === "failed" ? 1 : 0,
      last_check_at: new Date().toISOString(),
      last_error: event.error ?? null,
      detail: { ...event, origin },
    }, { onConflict: "service_key" });
    if (error) throw new Error(`AI_GATEWAY_EVIDENCE_FAILED:${error.message}`);
  };
}
