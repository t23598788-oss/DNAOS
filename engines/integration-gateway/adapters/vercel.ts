/** Integration Gateway — Vercel Adapter. */
import { createHmac, timingSafeEqual } from "crypto";
import { SYSTEM_LINKS } from "@/config/system-links";
import type { GatewayEvent } from "../contracts/event";
import { DNA_OS_RUNTIME_STATE_BOUNDARY, type RuntimeProviderStatus } from "../contracts/runtime-provider";
import type { ExternalConnectActivationRequest, ExternalConnectActivationResult, ExternalConnectStatus } from "../contracts/external-connect";

export function verifyVercelSignature(rawBody: string, signatureHeader: string | null, secret: string): boolean {
  if (!signatureHeader) return false;
  const expected = createHmac("sha1", secret).update(rawBody).digest("hex");
  const a = Buffer.from(signatureHeader);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

const HANDLED_TYPES = new Set(["deployment.created", "deployment.succeeded", "deployment.error", "deployment.canceled"]);

export function normalizeVercelWebhook(payload: any): GatewayEvent | null {
  const type: string | undefined = payload?.type;
  if (!type || !HANDLED_TYPES.has(type)) return null;
  const deployment = payload.payload?.deployment ?? payload.payload;
  return {
    event_id: `EVT-vercel-${type}-${payload.id ?? Date.now()}`,
    provider: "vercel",
    capability: "deployment.status.observed",
    channel: "observe",
    action: "observe",
    session_id: null,
    change_id: deployment?.meta?.githubCommitSha ?? deployment?.id ?? null,
    evidence: { type, deployment_id: deployment?.id, url: deployment?.url, target: deployment?.target, project: payload.payload?.project?.name ?? deployment?.name },
    requested_effect: "none",
    requires_owner_approval: false,
    occurred_at: new Date().toISOString(),
  };
}

export interface VercelRuntimeProviderConfig {
  runtimeUrl?: string | null;
  available?: boolean;
  healthy?: boolean;
  latencyMs?: number | null;
  paid?: boolean;
  ownerApproved?: boolean;
  capabilities?: string[];
}

type RuntimeHealthFetch = (input: string, init: RequestInit) => Promise<{ ok: boolean }>;

function getConfiguredVercelRuntimeUrl(): string | null {
  return process.env.VERCEL_RUNTIME_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? SYSTEM_LINKS.find((group) => group.id === "vercel")?.items.find((item) => item.label === "Production site")?.url ?? null;
}

async function probeRuntimeUrl(runtimeUrl: string, fetchImpl: RuntimeHealthFetch): Promise<{ available: boolean; healthy: boolean; latencyMs: number }> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const response = await fetchImpl(runtimeUrl, { method: "GET", cache: "no-store", signal: controller.signal });
    return { available: true, healthy: response.ok, latencyMs: Date.now() - startedAt };
  } catch {
    return { available: false, healthy: false, latencyMs: Date.now() - startedAt };
  } finally { clearTimeout(timer); }
}

export function vercelRuntimeProviderStatus(config: VercelRuntimeProviderConfig = {}): RuntimeProviderStatus {
  const runtimeUrl = config.runtimeUrl ?? getConfiguredVercelRuntimeUrl();
  const paid = config.paid ?? process.env.VERCEL_RUNTIME_PAID === "true";
  const ownerApproved = config.ownerApproved ?? process.env.VERCEL_RUNTIME_OWNER_APPROVED === "true";
  const available = config.available ?? Boolean(runtimeUrl);
  const healthy = config.healthy ?? Boolean(runtimeUrl);
  return {
    provider_id: "vercel",
    availability: available ? "available" : "unavailable",
    health: healthy ? "healthy" : "unhealthy",
    latency_ms: config.latencyMs ?? null,
    cost: { paid, owner_approved: ownerApproved, requires_owner_approval: paid && !ownerApproved },
    runtime_url: runtimeUrl,
    capabilities: config.capabilities ?? ["runtime.render", "runtime.display", "domain.bind"],
    state_boundary: DNA_OS_RUNTIME_STATE_BOUNDARY,
  };
}

export async function observeVercelRuntimeProviderStatus(config: VercelRuntimeProviderConfig = {}, fetchImpl: RuntimeHealthFetch = fetch): Promise<RuntimeProviderStatus> {
  const base = vercelRuntimeProviderStatus(config);
  if (!base.runtime_url || config.available !== undefined || config.healthy !== undefined || config.latencyMs !== undefined) return base;
  const probe = await probeRuntimeUrl(base.runtime_url, fetchImpl);
  return { ...base, availability: probe.available ? "available" : "unavailable", health: probe.healthy ? "healthy" : "unhealthy", latency_ms: probe.latencyMs };
}

export async function observeVercelConnectStatus(config: VercelRuntimeProviderConfig = {}): Promise<ExternalConnectStatus> {
  const runtime = await observeVercelRuntimeProviderStatus(config);
  const installed = process.env.VERCEL_EXTERNAL_CONNECT_INSTALLED === "true";
  return {
    provider_id: "vercel",
    installed,
    ready: installed && process.env.VERCEL_EXTERNAL_CONNECT_READY === "true",
    release_version: process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.RUNTIME_RELEASE_SHA ?? null,
    runtime,
  };
}

export async function activateVercelRelease(_request: ExternalConnectActivationRequest): Promise<ExternalConnectActivationResult> {
  return { ok: false, code: "EXTERNAL_CONNECT_NOT_INSTALLED" };
}

export const vercelRuntimeProvider = { provider_id: "vercel" as const, observeRuntimeStatus: observeVercelRuntimeProviderStatus };
export const vercelExternalConnect = { provider_id: "vercel" as const, observeConnectStatus: observeVercelConnectStatus, activateRelease: activateVercelRelease };
