/**
 * KIS inbound core — pure logic shared by the edge function (Deno) and the
 * offline tests (node/tsx). No Deno API, no fetch, no DB — parse/verify/
 * idempotency-key derivation only (BATCH 19/20).
 */
import { createHash, timingSafeEqual } from "node:crypto";

export interface KisEmailPayload {
  subject?: string;
  text?: string;
  from?: string;
  envelope?: { sender?: string } | string;
  timestamp?: string | number;
  "message-id"?: string;
  attachments?: unknown;
  [key: string]: unknown;
}

export interface KisEmailFacts {
  machine: string;
  event: string;
  job_id: string | null;
  start_time: string | null;
  stop_time: string | null;
  duration_hours: number;
}

function parseDurationToHours(text: string): number {
  const durationMatch = text.match(/Duration:\\s*(\\d+)\\s*hours?\\s*(\\d+)\\s*minutes?/i);
  if (durationMatch) {
    const hours = parseInt(durationMatch[1], 10);
    const minutes = parseInt(durationMatch[2], 10);
    return hours + minutes / 60;
  }
  const minutesMatch = text.match(/Duration:\\s*(\\d+)\\s*minutes?/i);
  if (minutesMatch) return parseInt(minutesMatch[1], 10) / 60;
  const decimalMatch = text.match(/Duration:\\s*([\\d\\.]+)\\s*hours?/i);
  if (decimalMatch) return parseFloat(decimalMatch[1]);
  return 0;
}

function extractValue(text: string, label: string): string {
  const regex = new RegExp(`${label}:\\\\s*(.+)`, "i");
  const match = text.match(regex);
  return match ? match[1].trim() : "";
}

export function parseKisEmail(payload: KisEmailPayload): KisEmailFacts {
  const bodyText = typeof payload.text === "string" ? payload.text : "";
  return {
    machine: extractValue(bodyText, "Machine") || "Kubota Excavator",
    event: extractValue(bodyText, "Event") || "Engine Stop",
    job_id: extractValue(bodyText, "Job ID") || null,
    start_time: extractValue(bodyText, "Start Time") || null,
    stop_time: extractValue(bodyText, "Stop Time") || null,
    duration_hours: parseDurationToHours(bodyText),
  };
}

function envelopeSender(payload: KisEmailPayload): string {
  const env = payload.envelope;
  if (env && typeof env === "object" && "sender" in env) return String((env as { sender?: string }).sender ?? "");
  if (typeof env === "string") return env;
  return "";
}

/**
 * Deterministic idempotency key of the SOURCE event:
 *   1. provider Message-Id when the payload carries one
 *   2. else sha256(sender | subject | start_time | stop_time) — the same email
 *      always hashes to the same key, so a SendGrid retry can never insert twice.
 */
export function buildKisSourceEventId(payload: KisEmailPayload): string {
  const messageId = typeof payload["message-id"] === "string" ? payload["message-id"].trim() : "";
  if (messageId) return `kis-msg:${messageId}`;
  const sender = envelopeSender(payload) || String(payload.from ?? "");
  const basis = [sender, String(payload.subject ?? ""), String(payload.timestamp ?? "")].join("|");
  return `kis-sha:${createHash("sha256").update(basis).digest("hex")}`;
}

/** sha256 of the raw source facts — re-verifiable evidence for the row. */
export function buildKisEvidenceRef(payload: KisEmailPayload, facts: KisEmailFacts): string {
  const basis = [String(payload.subject ?? ""), String(payload.from ?? ""), facts.job_id ?? "", facts.start_time ?? "", facts.stop_time ?? "", String(payload.timestamp ?? "")].join("|");
  return `sha256:${createHash("sha256").update(basis).digest("hex")}`;
}

function timingSafeStringEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Webhook auth — fail-closed:
 *   · token must be configured AND match the URL token (timing-safe)
 *   · sender (from/envelope) must be in KIS_SENDER_ALLOWLIST (comma list)
 * Missing config = NOT verified (caller must 401, never proceed).
 */
export function verifyKisWebhook(
  url: URL,
  payload: KisEmailPayload,
  config: { token: string | undefined; senderAllowlist: string | undefined },
): { ok: true } | { ok: false; reason: string } {
  const expected = (config.token ?? "").trim();
  if (!expected) return { ok: false, reason: "KIS_WEBHOOK_TOKEN not configured" };
  const provided = url.searchParams.get("token") ?? "";
  if (!provided || !timingSafeStringEqual(provided, expected)) {
    return { ok: false, reason: "webhook token mismatch" };
  }
  const allowlist = (config.senderAllowlist ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (allowlist.length === 0) return { ok: false, reason: "KIS_SENDER_ALLOWLIST not configured" };
  const sender = (envelopeSender(payload) || String(payload.from ?? "")).toLowerCase();
  const senderAddress = sender.match(/<([^>]+)>/)?.[1] ?? sender;
  if (!allowlist.some((entry) => senderAddress.includes(entry))) {
    return { ok: false, reason: "sender not allowlisted" };
  }
  return { ok: true };
}
