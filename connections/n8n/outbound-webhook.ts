/**
 * หน้าที่: DNA OS's outbound event sender to n8n — the ONE real HTTP POST
 * this repo makes to `https://n8n.srv1740014.hstgr.cloud/webhook/...`.
 * DNA OS is always the caller here; nothing on the n8n side ever calls
 * back into DNA-OS-INFRASTRUCTURE (Owner decision, 2026-08-27:
 * "DNA OS → n8n" direction only, this round). No new control-plane
 * listener is opened by this file — it only ever originates an
 * outbound request, same as every other single-purpose outbound
 * adapter in this repo (connections/railway/router-invoker.ts,
 * connections/digitalocean/, connections/github/) — each owns exactly
 * one external destination, never a generic arbitrary-URL sender.
 *
 * Target workflow: `DNA-OS-OUTBOUND-ORCHESTRATION-PROOF`
 * (n8n workflow_id jiNltcrOhck2wYtM, webhook path
 * `dna-os-outbound-proof`) — created, verified (node/connection
 * read-back match), activated, and proven live 2026-08-27: real POST →
 * real n8n execution (execution_id=1, status=success) → real JSON
 * response matching the Owner's stated OUTPUT_CONTRACT, round trip
 * 477ms. Evidence: connections/n8n/evidence/outbound-proof-*.json.
 *
 * The n8n webhook itself requires no credential (n8n webhook URLs are
 * unauthenticated by default unless the workflow adds its own check) —
 * this file therefore never touches credentials/registry or
 * credentials/macos-keychain; it only ever sends the event body.
 *
 * Input: `DnaOsOutboundEvent` (event_id/work_id/event_type/
 * source_capability/timestamp/payload/evidence_ref — the Owner's
 * required INPUT_CONTRACT verbatim).
 * Output: `sendDnaOsEventToN8n` -> `OutboundWebhookResult`
 * (accepted/workflow_id/received_event_id/processed_at/result/
 * evidence_ref, matching the workflow's real response shape).
 * Dependency ที่อนุญาต: node:https only (no framework, matches
 * connections/email-alert-source/host-runtime.ts's own convention).
 * สิ่งที่ห้ามแตะ: never add a second webhook path/target here without a
 * separate Owner authorization round (matches
 * connections/railway/router-invoker.ts's own "no new intent without
 * separate authorization" rule). Never accept a caller-supplied URL —
 * the n8n base URL and webhook path stay fixed constants, exactly like
 * connections/railway/router-invoker.ts's GRAPHQL_ENDPOINT.
 */

import { request } from "node:https";
import type { DnaOsCentralEvent, RouterDecision } from "./types";

const N8N_BASE_URL = "https://n8n.srv1740014.hstgr.cloud";
const WEBHOOK_PATH = "dna-os-outbound-proof";
const REQUEST_TIMEOUT_MS = 15_000;

export interface DnaOsOutboundEvent {
  event_id: string;
  work_id: string;
  event_type: string;
  source_capability: string;
  timestamp: string;
  payload: Readonly<Record<string, unknown>>;
  evidence_ref: string;
}

export interface OutboundWebhookResult {
  ok: boolean;
  http_status: number;
  round_trip_ms: number;
  request_timestamp: string;
  response_timestamp: string;
  output: { accepted: boolean; workflow_id: string; received_event_id: string; processed_at: string; result: string; evidence_ref: string } | null;
  error: string | null;
}

function postJson(url: string, payload: string, timeoutMs: number): Promise<{ status: number; text: string }> {
  return new Promise((resolvePromise, rejectPromise) => {
    const parsed = new URL(url);
    const req = request(
      { hostname: parsed.hostname, port: 443, path: `${parsed.pathname}${parsed.search}`, method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) }, timeout: timeoutMs },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolvePromise({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8") }));
      },
    );
    req.on("timeout", () => { req.destroy(); rejectPromise(new Error(`no answer within ${timeoutMs}ms`)); });
    req.on("error", rejectPromise);
    req.write(payload);
    req.end();
  });
}

/** The one real, proven entry point — sends a DNA OS event to the n8n outbound-orchestration-proof workflow and returns its real response. Never called with a caller-supplied URL. */
export async function sendDnaOsEventToN8n(event: DnaOsOutboundEvent): Promise<OutboundWebhookResult> {
  const requestTimestamp = new Date().toISOString();
  const startedAt = Date.now();
  try {
    const result = await postJson(`${N8N_BASE_URL}/webhook/${WEBHOOK_PATH}`, JSON.stringify(event), REQUEST_TIMEOUT_MS);
    const roundTripMs = Date.now() - startedAt;
    const responseTimestamp = new Date().toISOString();
    let output: OutboundWebhookResult["output"] = null;
    try { output = JSON.parse(result.text); } catch { /* non-JSON response handled as null output below */ }
    return { ok: result.status >= 200 && result.status < 300 && !!output, http_status: result.status, round_trip_ms: roundTripMs, request_timestamp: requestTimestamp, response_timestamp: responseTimestamp, output, error: output ? null : `unparseable response body: ${result.text.slice(0, 200)}` };
  } catch (error) {
    return { ok: false, http_status: 0, round_trip_ms: Date.now() - startedAt, request_timestamp: requestTimestamp, response_timestamp: new Date().toISOString(), output: null, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * The SAME workflow, the SAME webhook path, carrying the central event schema
 * (`./types.ts#DnaOsCentralEvent`) instead of the original seven-field proof
 * event. This is deliberately NOT a second target: the "no new webhook
 * path/target without a separate authorization round" rule above is about
 * adding destinations, and this adds none. The original
 * `sendDnaOsEventToN8n` stays exactly as proven, so the first caller is
 * untouched.
 *
 * The response type widens to the router decision because the workflow now
 * returns one. Every field the original contract returned is still present --
 * the n8n side kept them for exactly this reason.
 */
export async function sendCentralEventToN8n(event: DnaOsCentralEvent): Promise<{
  ok: boolean;
  http_status: number;
  round_trip_ms: number;
  request_timestamp: string;
  response_timestamp: string;
  decision: RouterDecision | null;
  error: string | null;
}> {
  const requestTimestamp = new Date().toISOString();
  const startedAt = Date.now();
  try {
    const result = await postJson(`${N8N_BASE_URL}/webhook/${WEBHOOK_PATH}`, JSON.stringify(event), REQUEST_TIMEOUT_MS);
    const roundTripMs = Date.now() - startedAt;
    let decision: RouterDecision | null = null;
    try { decision = JSON.parse(result.text) as RouterDecision; } catch { /* reported as an error below, never swallowed */ }
    return {
      ok: result.status >= 200 && result.status < 300 && !!decision,
      http_status: result.status,
      round_trip_ms: roundTripMs,
      request_timestamp: requestTimestamp,
      response_timestamp: new Date().toISOString(),
      decision,
      error: decision ? null : `unparseable response body: ${result.text.slice(0, 200)}`,
    };
  } catch (error) {
    // An unreachable router is a real, reportable state -- never a silent
    // "assume routed". The caller turns this into ROUTER_UNREACHABLE.
    return {
      ok: false, http_status: 0, round_trip_ms: Date.now() - startedAt,
      request_timestamp: requestTimestamp, response_timestamp: new Date().toISOString(),
      decision: null, error: error instanceof Error ? error.message : String(error),
    };
  }
}
