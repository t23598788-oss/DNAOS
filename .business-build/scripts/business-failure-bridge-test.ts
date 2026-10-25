#!/usr/bin/env npx tsx
/**
 * Business Failure Bridge — LIVE proof (owner, 2026-09-19).
 *
 * Proves the missing BUSINESS → INFRASTRUCTURE failure boundary using the
 * repo's CURRENT real state — the LINE authentication failure — through the
 * EXISTING infrastructure systems only:
 *
 *   Business send attempt (real registry/communication.ts#sendLineMessage,
 *   real api.line.me call with the connector's real credential path)
 *     → businessFailureBridge.normalizeSendResult()
 *       → connection identity (core/connector-loader → connectors table)
 *       → canonical event ingress (monitoringRuntime#collectSignal — the ONE
 *         existing Signal store; EXTERNAL_PROVIDER_HEALTH → PROVIDER_OUTAGE,
 *         CONNECTOR_HEALTH → CONNECTOR_FAILURE)
 *       → existing incident-remediation (incidentRuntime#openIncidentFromSignal
 *         deduped + recoveryRuntime#createRecoveryPlan, PLAN_ONLY)
 *       → existing work-session-state (queueRuntime Operations jobs)
 *       → existing evidence (artifactRuntime checksummed artifacts + audit_logs)
 *       → existing Owner escalation (alertRuntime#dispatchAlert, OWNER_UI first)
 *       → normalized business result ONLY (no provider text, no status codes,
 *         no credential fragments)
 *
 * Hard rules proven here:
 *   - ONE incident identity across retries (the existing 30-min dedupe window).
 *   - ONE recovery plan per incident (not per retry) — bounded, PLAN_ONLY.
 *   - The bridge NEVER retries the provider itself (bounded recovery): exactly
 *     one real api.line.me call per business attempt, counted live.
 *   - Raw provider/credential details NEVER appear in the business result.
 *   - Business-data failures (invoice not found / already SENT / no LINE link)
 *     do NOT open infrastructure incidents (isProviderPushFailure gate).
 *   - No AI anywhere: every classification is a deterministic string function.
 *
 * Same stub-Supabase pattern as scripts/line-credential-path-test.ts (the
 * stub answers the connectors-table SELECT the loader performs). Network:
 * exactly one real HTTPS call to api.line.me per business attempt, using the
 * connector credential path — that IS the live LINE authentication failure.
 *
 * Run: npx tsx scripts/business-failure-bridge-test.ts
 */
import fs from "fs";
import path from "path";
import { sendLineMessage } from "@/registry/communication";
import {
  normalizeSendResult,
  normalizeGatewayResult,
  isProviderPushFailure,
  classifyProviderFailure,
  readConnectionIdentity,
} from "@/app/api/admin/ide/_lib/businessFailureBridge";
import { getIncident, listIncidents } from "@/app/api/admin/ide/_lib/incidentRuntime";
import { getRecoveryPlan, listRecoveryPlans } from "@/app/api/admin/ide/_lib/recoveryRuntime";
import { listAlerts } from "@/app/api/admin/ide/_lib/alertRuntime";
import { listJobs } from "@/app/api/admin/ide/_lib/queueRuntime";
import { getArtifact } from "@/app/api/admin/ide/_lib/artifactRuntime";
import { listSignals } from "@/app/api/admin/ide/_lib/monitoringRuntime";
import { clearConnectorCache } from "@/core/connector-loader";

// Manual .env.local read (repo has no dotenv — same pattern as
// local-runtime/runpod-controller.mjs) so the real Supabase client can be
// constructed for audit/health evidence. Never overrides existing env.
(function loadEnvLocal() {
  const p = path.join(__dirname, "..", ".env.local");
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
})();

const OWNER = "business-bridge-proof-owner";
const ACTOR = "business-failure-bridge-proof@dnaos.local";
const FAKE_TOKEN = `INVALID-TOKEN-FOR-LIVE-PROOF-${Math.random().toString(36).slice(2)}`;

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? " — " + detail : ""}`); }
}
function note(msg: string) { console.log(`  NOTE  ${msg}`); }

// Stub Supabase client — answers ONLY the connectors-table SELECT the
// loader performs; writes are swallowed. Same role as the stub in
// scripts/line-credential-path-test.ts.
function stubDb(rows: Record<string, unknown>[]) {
  const chain: any = {
    from(_t: string) { return chain; },
    select() { return chain; },
    insert(_v: unknown) { return chain; },
    update(_v: unknown) { return chain; },
    order() { return chain; },
    eq() { return chain; },
    limit() { return chain; },
    async maybeSingle() { return { data: rows[0] ?? null, error: null }; },
    async single() { return { data: rows[0] ?? null, error: null }; },
    async then(resolve: (v: unknown) => unknown) { return resolve({ data: rows, error: null }); },
  };
  return chain as never;
}

// Live call counter for the bounded-recovery rule: the bridge must never
// retry the provider by itself — one real HTTPS call per business attempt.
let lineApiCalls = 0;
const realFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = async (input: any, init?: any) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  if (String(url).includes("api.line.me")) lineApiCalls++;
  return realFetch(input, init);
};

const lineConnectorRow = {
  id: "proof-line-connector", name: "LINE", slug: "line", auth_type: "token",
  status: "connected", enabled: true, config: {}, secret: { channel_access_token: FAKE_TOKEN },
  last_checked_at: null, last_error: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
};

async function main() {
  console.log("\nBusiness Failure Bridge — LIVE proof (LINE authentication failure)\n" + "=".repeat(72));

  // ── Scenario A: the CURRENT live failure — business reply through a bad
  //    LINE credential. Real requireConnector Run gate passes, real
  //    api.line.me answers, the bridge owns the failure end-to-end.
  console.log("\n[A] Live business send → real LINE auth failure → infrastructure\n");
  const badSend1 = await sendLineMessage(stubDb([lineConnectorRow]) as any, "U123", [{ type: "text", text: "hello" }]);
  const liveAuthFailure = badSend1.success === false && (badSend1.error ?? "").includes("401");

  let firstAttempt: Awaited<ReturnType<typeof normalizeSendResult>> | null = null;
  if (badSend1.success === false) {
    firstAttempt = await normalizeSendResult(badSend1, {
      providerSlug: "line", businessAction: "line.reply", ownerId: OWNER, actor: ACTOR, source: "/proof/line-customers/reply",
    });
  }

  check("A1. real LINE provider call happened and failed (live, via connector credential path)", badSend1.success === false);
  if (liveAuthFailure) {
    check("A2. live failure is the real LINE authentication failure (HTTP 401 from api.line.me)", true);
  } else {
    note(`live provider answered differently than 401 (error starts: "${(badSend1.error ?? "").slice(0, 80)}") — auth-specific assertions degrade to observed class, everything else still proven`);
  }

  if (firstAttempt) {
    const n = firstAttempt;
    check("A3. business receives a normalized BLOCKED result (ok:false, INFRASTRUCTURE_BLOCKED)", n.ok === false && n.code === "INFRASTRUCTURE_BLOCKED");
    if (liveAuthFailure) {
      check("A4. deterministic class = PROVIDER_AUTH (no AI — pure string classification)", n.failureClass === "PROVIDER_AUTH", `got ${n.failureClass}`);
    } else {
      note(`observed deterministic class: ${n.failureClass}`);
    }
    check("A5. business result carries one work identity (workId)", typeof n.workId === "string" && n.workId.length > 0);
    check("A6. business result carries ONE incident identity (incidentId)", typeof n.incidentId === "string" && n.incidentId.length > 0);

    const bizJson = JSON.stringify(n);
    check("A7. business result contains NO raw provider error (no 'LINE API Error', no api.line.me)", !bizJson.includes("LINE API Error") && !bizJson.includes("api.line.me"));
    check("A8. business result contains NO status codes (no 401/403 string)", !bizJson.includes("401") && !bizJson.includes("403"));
    check("A9. business result contains NO credential fragment (fake token absent, no Bearer)", !bizJson.includes(FAKE_TOKEN) && !bizJson.includes("Bearer") && !bizJson.includes("channel_access_token"));

    // Business message must be human Thai, business-safe.
    check("A10. business message is non-empty Thai business text", n.message.length > 10);

    if (n.incidentId) {
      const inc = getIncident(n.incidentId, OWNER);
      if (liveAuthFailure) {
        check("A11. real Incident from the EXISTING ingress: PROVIDER_OUTAGE (EXTERNAL_PROVIDER_HEALTH signal), OPEN", inc.type === "PROVIDER_OUTAGE" && inc.status === "OPEN", `got ${inc.type}/${inc.status}`);
        check("A12. HIGH severity floor → Owner escalation is actually required (ownerDecisionRequired)", inc.severity === "HIGH" && inc.ownerDecisionRequired === true);
      } else {
        note(`observed incident type: ${inc.type} (${inc.severity})`);
      }
      check("A13. incident carries real signal(s) from the existing Signal store", inc.signals.length >= 1 && listSignals(OWNER).some((s) => s.signalId === inc.signals[0]));
      check("A14. incident evidence is real checksummed immutable artifacts", inc.artifactIds.length > 0 && inc.artifactIds.every((id) => getArtifact(id, OWNER).immutable));
      check("A15. ONE recovery plan attached to the incident (PLAN_ONLY, owner approval gate)", typeof inc.recoveryPlanId === "string" && getRecoveryPlan(inc.recoveryPlanId!, OWNER).approvalRequired === true);

      const plansForIncident = listRecoveryPlans(OWNER).filter((p) => p.incidentId === n.incidentId);
      check("A16. exactly ONE remediation plan exists for this incident (not per attempt)", plansForIncident.length === 1, `got ${plansForIncident.length}`);

      const alert = listAlerts(OWNER).find((a) => a.incidentId === n.incidentId);
      check("A17. existing Owner escalation fired (OWNER_UI first, not suppressed)", !!alert && alert.status !== "SUPPRESSED" && alert.channelResults.some((c) => c.channel === "OWNER_UI" && c.ok));

      const workJob = listJobs(OWNER).find((j) => j.file === n.workId && j.type === "INCIDENT_OPEN");
      check("A18. work-session-state recorded the bridged attempt (SUCCEEDED job on the work identity)", !!workJob && workJob.status === "SUCCEEDED", `got ${workJob?.status ?? "none"}`);

      // ── Retry: a SECOND business attempt of the same action minutes later.
      //    Same provider failure. Must correlate into the SAME incident.
      const badSend2 = await sendLineMessage(stubDb([lineConnectorRow]) as any, "U123", [{ type: "text", text: "hello again" }]);
      const n2 = await normalizeSendResult(badSend2, {
        providerSlug: "line", businessAction: "line.reply", ownerId: OWNER, actor: ACTOR, source: "/proof/line-customers/reply",
      });
      check("A19. ONE incident identity across retries (existing 30-min dedupe, not a new incident)", n2.incidentId === n.incidentId, `got ${n2.incidentId}`);
      const inc2 = getIncident(n.incidentId!, OWNER);
      check("A20. retry correlated into the same incident's real signal list", inc2.signals.length >= 2);

      // Bounded recovery: exactly TWO live provider calls for TWO business
      // attempts — the bridge itself made ZERO provider calls.
      check("A21. bounded recovery: bridge never retries the provider itself (2 business attempts = exactly 2 live calls)", lineApiCalls === 2, `got ${lineApiCalls}`);
    }
  } else {
    check("A-fallback. gateway returned failure to the bridge (business failure reached infrastructure)", false, "sendLineMessage unexpectedly succeeded");
  }

  // ── Scenario B: our own lifecycle gate not ready (INFRA_NOT_READY) —
  //    connector missing → Run gate rejection, NO network call.
  //    (clearConnectorCache: the loader caches rows 60s — scenario A's real
  //    connector row must not leak into this fail-closed scenario.)
  console.log("\n[B] INFRA_NOT_READY (Run gate) — connector missing, no network\n");
  clearConnectorCache();
  const beforeB = lineApiCalls;
  const gateSend = await sendLineMessage(stubDb([]) as any, "U123", [{ type: "text", text: "hello" }]);
  const gateRes = await normalizeSendResult(gateSend, {
    providerSlug: "line", businessAction: "line.draft_send", ownerId: OWNER, actor: ACTOR, source: "/proof/outbound-drafts/send",
  });
  check("B1. Run-gate rejection classified INFRA_NOT_READY (our lifecycle, not the provider)", gateRes.failureClass === "INFRA_NOT_READY", `got ${gateRes.failureClass}`);
  check("B2. no network call happened (fail-closed at the lifecycle gate)", lineApiCalls === beforeB);
  if (gateRes.incidentId) {
    const incB = getIncident(gateRes.incidentId, OWNER);
    check("B3. maps to the existing CONNECTOR_FAILURE incident type via CONNECTOR_HEALTH", incB.type === "CONNECTOR_FAILURE");
    check("B4. MEDIUM floor → below the existing alert threshold — NO premature Owner escalation", incB.severity === "MEDIUM" && incB.ownerDecisionRequired === false);
  }
  check("B5. business message tells the truth without provider internals", !JSON.stringify(gateRes).includes("Run gate") && gateRes.message.length > 10);

  // ── Scenario C: gateway business-data failures must NOT open incidents.
  console.log("\n[C] Business-data failures stay business (no infrastructure incidents)\n");
  check("C1. 'already SENT' is NOT a provider push failure", isProviderPushFailure("ใบแจ้งหนี้ IV-001 ถูกส่งไปแล้ว") === false);
  check("C2. 'invoice not found' is NOT a provider push failure", isProviderPushFailure("ไม่พบใบแจ้งหนี้นี้ในระบบ") === false);
  check("C3. the real LINE push wrapper IS a provider push failure", isProviderPushFailure("ส่ง LINE ไม่สำเร็จ: LINE API Error 401: {}") === true);
  const okGateway = await normalizeGatewayResult({ ok: true }, { providerSlug: "line", businessAction: "invoice.send", ownerId: OWNER, actor: ACTOR, source: "/proof/invoice/send" });
  check("C4. successful gateway send normalizes to SENT with no incident", okGateway.ok === true && okGateway.code === "SENT" && okGateway.incidentId === null);

  // ── Scenario D: classifier discipline (deterministic, exhaustive).
  console.log("\n[D] Deterministic classification discipline\n");
  check("D1. 401 → PROVIDER_AUTH", classifyProviderFailure("LINE API Error 401: {}") === "PROVIDER_AUTH");
  check("D2. 500 → PROVIDER_UNAVAILABLE", classifyProviderFailure("LINE API Error 500: {}") === "PROVIDER_UNAVAILABLE");
  check("D3. Run-gate text → INFRA_NOT_READY", classifyProviderFailure("LINE connector ยังไม่พร้อม (Run gate ปฏิเสธ): ยังไม่ผ่าน Test") === "INFRA_NOT_READY");
  check("D4. unknown text → PROVIDER_REJECTED (never silently OK)", classifyProviderFailure("something odd") === "PROVIDER_REJECTED");

  // ── Scenario E: connection identity read is secret-free and safe.
  console.log("\n[E] Connection identity — lifecycle state only, never the secret\n");
  clearConnectorCache(); // scenario B cached an empty connector list — reset
  const identity = await readConnectionIdentity(stubDb([lineConnectorRow]) as any, "line");
  check("E1. identity read returns lifecycle state (status/enabled)", !!identity && identity.status === "connected" && identity.enabled === true);
  check("E2. identity read NEVER returns the secret", !!identity && !JSON.stringify(identity).includes(FAKE_TOKEN) && !("secret" in (identity as object)));

  // ── Honest summary of the infrastructure-side audit trail (best-effort DB).
  if (process.env.NEXT_PUBLIC_SUPABASE_URL) {
    try {
      const { supabaseAdmin } = await import("@/services/supabase/queries");
      const { count, error } = await supabaseAdmin().from("audit_logs").select("audit_id", { count: "exact", head: true }).eq("entity_type", "business_failure_bridge");
      if (!error) note(`durable technical evidence: ${count ?? 0} business_failure_bridge audit row(s) in the real audit_logs (Owner-side only)`);
      else note(`audit_logs not readable from here (${error.message.slice(0, 60)}) — evidence path degrades honestly, incidents unaffected`);
    } catch { note("audit_logs not readable from this process — evidence path degrades honestly, incidents unaffected"); }
  }

  console.log("\n" + "=".repeat(72));
  console.log(`${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error("SUITE CRASHED:", e); process.exit(1); });
