/**
 * Alert — Channel & Policy Registry (owner, 2026-08-08, Software Factory
 * Step 12.5). Declares the real Alert Channels this Factory can dispatch
 * through, and the real Alert Policy fields alertRuntime.ts reads.
 *
 * Reuse investigation (Phase 1) — real, confirmed by direct inspection:
 *  - registry/communication.ts#sendLineMessage — the real, SINGLE outbound
 *    LINE gateway this whole repo already funnels every LINE push through
 *    (its own header: "Rule: Single outbound gateway for all LINE
 *    Messaging API calls... All other modules/services must route through
 *    this gateway"). REUSED directly, never a second LINE client.
 *  - app/api/admin/notifications/send/route.ts already calls this same
 *    gateway from the admin UI — real, existing precedent for owner-
 *    triggered LINE dispatch.
 *  - No real, reusable EMAIL-send function is importable from the
 *    Next.js app layer (supabase/functions/_shared/gmail-client.ts only
 *    runs in the separate Deno Edge Function runtime) — EMAIL is honestly
 *    NOT_IMPLEMENTED at this layer.
 *  - No real generic outbound WEBHOOK dispatcher existed before this
 *    Step — a minimal, real one is added in alertRuntime.ts (plain
 *    fetch POST to a real, owner-configured ALERT_WEBHOOK_URL env var) —
 *    GENUINELY_NEW, small, and honestly PARTIAL without a configured URL.
 *  - LINE_CHANNEL_ACCESS_TOKEN is NOT set in this sandbox (confirmed via
 *    process.env at investigation time) — sendLineMessage() therefore
 *    fails closed immediately (no real network call) whenever this Step's
 *    code runs here, which is what makes it SAFE to exercise for real in
 *    this Step's regression suite without ever paging the real owner.
 */
export type AlertChannel = "OWNER_UI" | "LINE" | "EMAIL" | "WEBHOOK" | "SYSTEM_EVENT";
export type ChannelStatus = "ACTIVE" | "CONFIGURED" | "PARTIAL" | "NOT_IMPLEMENTED" | "UNKNOWN";

export interface AlertChannelDefinition {
  id: AlertChannel;
  displayName: string;
  adapter: string;
  requiresCredential: string | null;
  status: ChannelStatus;
  evidence: string;
}

// LINE credential now lives behind the canonical connector lifecycle — the
// honest status question is "is the 'line' connector Registered+Tested+
// Enabled?", answered through the same sanctioned gateway listConnectors()
// read every other status surface uses (never env, never the table directly).
async function computeLineStatus(): Promise<ChannelStatus> {
  try {
    const { listConnectors } = await import("@/gateway/connectors");
    const connectors = await listConnectors();
    const line = connectors.find((c) => c.slug === "line");
    return line && line.status === "connected" && line.enabled ? "CONFIGURED" : "PARTIAL";
  } catch {
    return "PARTIAL";
  }
}
function computeWebhookStatus(): ChannelStatus {
  return process.env.ALERT_WEBHOOK_URL ? "CONFIGURED" : "PARTIAL";
}

export async function listAlertChannels(): Promise<AlertChannelDefinition[]> {
  const lineStatus = await computeLineStatus();
  const lineConfigured = lineStatus === "CONFIGURED";
  return [
    { id: "OWNER_UI", displayName: "Owner UI (Operations tab)", adapter: "in-memory alert store, read by the real Operations tab", requiresCredential: null, status: "ACTIVE", evidence: "no external dependency — real, always available whenever the IDE Workspace is open" },
    { id: "LINE", displayName: "LINE", adapter: "registry/communication.ts#sendLineMessage (the real, single LINE gateway — connector lifecycle Run gate)", requiresCredential: "line connector (secret.channel_access_token) via /admin/connectors", status: lineStatus, evidence: lineConfigured ? "connector \"line\" is Registered+Tested+Enabled" : "connector \"line\" missing or not Enabled — dispatch attempts fail closed honestly" },
    { id: "EMAIL", displayName: "Email", adapter: "none reachable from this Runtime layer", requiresCredential: "gmail connector (OAuth) via /admin/connectors", status: "NOT_IMPLEMENTED", evidence: "the real Gmail client only exists inside supabase/functions/_shared/ (Deno runtime, connector-backed via the internal token bridge) — not importable from app/api/admin/ide" },
    { id: "WEBHOOK", displayName: "Generic Webhook", adapter: "alertRuntime.ts#dispatchWebhook (real, new, minimal fetch POST)", requiresCredential: "ALERT_WEBHOOK_URL", status: computeWebhookStatus(), evidence: process.env.ALERT_WEBHOOK_URL ? "real ALERT_WEBHOOK_URL configured" : "no real ALERT_WEBHOOK_URL configured in this environment" },
    { id: "SYSTEM_EVENT", displayName: "System Event Log", adapter: "the real, bounded alert event log this Runtime already maintains", requiresCredential: null, status: "ACTIVE", evidence: "no external dependency — every real Alert Record always gets a real SYSTEM_EVENT entry" },
  ];
}
export async function getAlertChannelDefinition(id: string): Promise<AlertChannelDefinition | undefined> {
  return (await listAlertChannels()).find((c) => c.id === id);
}

export interface AlertPolicy {
  severityThreshold: "INFO" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  incidentTypes: string[] | "ALL";
  repeatedFailureCount: number;
  staleDurationMs: number;
  quietPeriodMs: number;
  deduplicationWindowMs: number;
  escalationDelayMs: number;
  ownerAcknowledgementRequired: boolean;
  channelPriority: AlertChannel[];
  fallbackChannel: AlertChannel;
  evidenceRequirements: string[];
}

const MIN_1 = 60_000, MIN_15 = 15 * MIN_1, MIN_30 = 30 * MIN_1, HOUR_1 = 60 * MIN_1;

/** The ONE real Alert Policy this Step declares — deterministic,
 * never AI-authored. Escalates HIGH/CRITICAL toward LINE (if configured),
 * always records OWNER_UI + SYSTEM_EVENT regardless of channel config. */
export const DEFAULT_ALERT_POLICY: AlertPolicy = {
  severityThreshold: "MEDIUM",
  incidentTypes: "ALL",
  repeatedFailureCount: 3,
  staleDurationMs: HOUR_1,
  quietPeriodMs: MIN_15,
  deduplicationWindowMs: MIN_30,
  escalationDelayMs: MIN_15,
  ownerAcknowledgementRequired: true,
  channelPriority: ["OWNER_UI", "LINE", "WEBHOOK"],
  fallbackChannel: "SYSTEM_EVENT",
  evidenceRequirements: ["real, already-open Incident record", "real, deterministic severity from incidentRuntime.ts — never an AI-authored message"],
};
