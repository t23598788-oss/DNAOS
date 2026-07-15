/**
 * Cloudflare API Client — DNS + Zone management
 *
 * Endpoints verified against live Cloudflare API reference (2026-07-13):
 * https://developers.cloudflare.com/api/resources/{zones,dns/subresources/records}
 * Base URL, auth header, and request/response shapes below are real, not guessed.
 *
 * Every function requires a real "cloudflare" Connector to exist, be Tested,
 * and be Enabled (Connect→Register→Test→Enable, registry/connector-lifecycle.json —
 * no exceptions) — see core/connector-loader.ts. No mock/fake responses if the
 * connector isn't ready; callers get a clear connectorNotReady() error instead.
 */

import { getConnector, getConnectedConnector } from "@/core/connector-loader";
import { supabaseAdmin } from "@/services/supabase/queries";
import { connectorNotReady, type DnsRecord, type ConnectorNotReadyError } from "./types";

const SLUG = "cloudflare";
const DEFAULT_BASE_URL = "https://api.cloudflare.com/client/v4";

async function requireCloudflare(): Promise<{ baseUrl: string; token: string } | ConnectorNotReadyError> {
  const db = supabaseAdmin();
  const record = await getConnector(db, SLUG);
  if (!record) return connectorNotReady(SLUG, "not_found");
  const connected = await getConnectedConnector(db, SLUG);
  if (!connected) {
    return connectorNotReady(SLUG, record.status === "connected" ? "not_enabled" : "not_connected");
  }
  const token = (connected.secret?.api_token as string) ?? (connected.secret?.api_key as string) ?? "";
  if (!token) return connectorNotReady(SLUG, "not_connected");
  const baseUrl = (connected.config?.base_url as string) || DEFAULT_BASE_URL;
  return { baseUrl, token };
}

interface CfResponse<T> {
  success: boolean;
  result: T;
  result_info?: { count: number; page: number; per_page: number; total_count: number; total_pages: number };
  errors: { code: number; message: string }[];
  messages: unknown[];
}

async function cfFetch<T>(baseUrl: string, token: string, path: string, init: RequestInit = {}): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  const json = (await res.json().catch(() => null)) as CfResponse<T> | null;
  if (!res.ok || !json?.success) {
    const msg = json?.errors?.map((e) => e.message).join("; ") || `Cloudflare API HTTP ${res.status}`;
    return { ok: false, error: msg };
  }
  return { ok: true, data: json.result };
}

export interface CloudflareZone {
  id: string;
  name: string;
  status: string;
  name_servers: string[];
}

// GET /zones?name={domain} — find the zone id for a domain already added to Cloudflare
export async function findZoneByDomain(domain: string): Promise<{ ok: true; zone: CloudflareZone | null } | { ok: false; error: string } | ConnectorNotReadyError> {
  const conn = await requireCloudflare();
  if ("error" in conn) return conn;
  const r = await cfFetch<CloudflareZone[]>(conn.baseUrl, conn.token, `/zones?name=${encodeURIComponent(domain)}`);
  if (!r.ok) return r;
  return { ok: true, zone: r.data[0] ?? null };
}

// POST /zones — add a new domain to this Cloudflare account (does not register the
// domain itself — the domain must already be owned; this just puts it under
// Cloudflare's DNS/proxy/SSL management). Irreversible-adjacent (changes where DNS
// authority lives) — callers must route this through gateway/domains.ts, never call
// directly from a UI action.
export async function createZone(domain: string): Promise<{ ok: true; zone: CloudflareZone } | { ok: false; error: string } | ConnectorNotReadyError> {
  const conn = await requireCloudflare();
  if ("error" in conn) return conn;
  const r = await cfFetch<CloudflareZone>(conn.baseUrl, conn.token, "/zones", {
    method: "POST",
    body: JSON.stringify({ name: domain }),
  });
  if (!r.ok) return r;
  return { ok: true, zone: r.data };
}

// GET /zones/{zone_id}/dns_records
export async function listDnsRecords(zoneId: string): Promise<{ ok: true; records: DnsRecord[] } | { ok: false; error: string } | ConnectorNotReadyError> {
  const conn = await requireCloudflare();
  if ("error" in conn) return conn;
  const r = await cfFetch<any[]>(conn.baseUrl, conn.token, `/zones/${zoneId}/dns_records`);
  if (!r.ok) return r;
  return {
    ok: true,
    records: r.data.map((d) => ({
      id: d.id, type: d.type, name: d.name, content: d.content, ttl: d.ttl, proxied: d.proxied,
    })),
  };
}

// POST /zones/{zone_id}/dns_records
export async function createDnsRecord(zoneId: string, record: DnsRecord): Promise<{ ok: true; record: DnsRecord } | { ok: false; error: string } | ConnectorNotReadyError> {
  const conn = await requireCloudflare();
  if ("error" in conn) return conn;
  const body: Record<string, unknown> = {
    type: record.type, name: record.name, content: record.content,
    ttl: record.ttl ?? 1,
  };
  if (record.priority != null) body.priority = record.priority;
  if (record.proxied != null) body.proxied = record.proxied;
  const r = await cfFetch<any>(conn.baseUrl, conn.token, `/zones/${zoneId}/dns_records`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!r.ok) return r;
  return { ok: true, record: { id: r.data.id, type: r.data.type, name: r.data.name, content: r.data.content, ttl: r.data.ttl, proxied: r.data.proxied } };
}

// PATCH /zones/{zone_id}/dns_records/{record_id}
export async function updateDnsRecord(zoneId: string, recordId: string, patch: Partial<DnsRecord>): Promise<{ ok: true } | { ok: false; error: string } | ConnectorNotReadyError> {
  const conn = await requireCloudflare();
  if ("error" in conn) return conn;
  const r = await cfFetch(conn.baseUrl, conn.token, `/zones/${zoneId}/dns_records/${recordId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  if (!r.ok) return r;
  return { ok: true };
}

// DELETE /zones/{zone_id}/dns_records/{record_id}
export async function deleteDnsRecord(zoneId: string, recordId: string): Promise<{ ok: true } | { ok: false; error: string } | ConnectorNotReadyError> {
  const conn = await requireCloudflare();
  if ("error" in conn) return conn;
  const r = await cfFetch(conn.baseUrl, conn.token, `/zones/${zoneId}/dns_records/${recordId}`, { method: "DELETE" });
  if (!r.ok) return r;
  return { ok: true };
}
