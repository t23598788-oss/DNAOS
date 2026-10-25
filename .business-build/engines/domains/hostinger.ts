/**
 * Hostinger API Client — Domain search / registration / nameservers / WHOIS
 *
 * ⚠️ UNVERIFIED ENDPOINTS — read this before trusting any path below.
 * developers.hostinger.com is a JS-rendered docs site; automated fetch
 * attempts against it this session returned only 404s or an empty nav
 * shell (no server-rendered endpoint content reachable). The paths below
 * are best-effort defaults based on general REST conventions and Hostinger's
 * publicly-known API shape at the time this was written — NOT confirmed
 * against a live reference. Per this project's own rule (ห้ามเดา — do not
 * guess and present as fact), do not treat these as correct until tested
 * against the real API with real credentials.
 *
 * To make this safe to ship anyway: every path is read from the connector's
 * `config` object with the value below only as a fallback default — so a
 * wrong guess is a one-field fix in /admin/connectors (no code change, no
 * redeploy), not a silent failure baked into the source.
 */

import { getConnector, getConnectedConnector } from "@/core/connector-loader";
import { supabaseAdmin } from "@/services/supabase/queries";
import { connectorNotReady, type DomainAvailability, type DomainSuggestion, type DomainRegistrationRequest, type DomainRegistrationResult, type Nameservers, type WhoisRecord, type ConnectorNotReadyError } from "./types";

const SLUG = "hostinger";
const DEFAULT_BASE_URL = "https://developers.hostinger.com/api";

const DEFAULT_PATHS = {
  availability: "/domains/v1/availability",
  suggestions: "/domains/v1/availability/suggestions",
  register: "/domains/v1/portfolio",
  nameservers: (domain: string) => `/domains/v1/portfolio/${domain}/nameservers`,
  whois: (domain: string) => `/domains/v1/portfolio/${domain}`,
};

async function requireHostinger(): Promise<{ baseUrl: string; apiKey: string; paths: typeof DEFAULT_PATHS } | ConnectorNotReadyError> {
  const db = supabaseAdmin();
  const record = await getConnector(db, SLUG);
  if (!record) return connectorNotReady(SLUG, "not_found");
  const connected = await getConnectedConnector(db, SLUG);
  if (!connected) {
    return connectorNotReady(SLUG, record.status === "connected" ? "not_enabled" : "not_connected");
  }
  const apiKey = (connected.secret?.api_key as string) ?? (connected.secret?.token as string) ?? "";
  if (!apiKey) return connectorNotReady(SLUG, "not_connected");
  const baseUrl = (connected.config?.base_url as string) || DEFAULT_BASE_URL;
  const paths = {
    availability: (connected.config?.availability_path as string) || DEFAULT_PATHS.availability,
    suggestions: (connected.config?.suggestions_path as string) || DEFAULT_PATHS.suggestions,
    register: (connected.config?.register_path as string) || DEFAULT_PATHS.register,
    nameservers: DEFAULT_PATHS.nameservers,
    whois: DEFAULT_PATHS.whois,
  };
  return { baseUrl, apiKey, paths };
}

async function hFetch<T>(baseUrl: string, apiKey: string, path: string, init: RequestInit = {}): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { ok: false, error: `Hostinger API HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ""}` };
  }
  const data = (await res.json().catch(() => null)) as T;
  return { ok: true, data };
}

export async function checkAvailability(domain: string): Promise<{ ok: true; result: DomainAvailability } | { ok: false; error: string } | ConnectorNotReadyError> {
  const conn = await requireHostinger();
  if ("error" in conn) return conn;
  const r = await hFetch<any>(conn.baseUrl, conn.apiKey, conn.paths.availability, {
    method: "POST",
    body: JSON.stringify({ domain }),
  });
  if (!r.ok) return r;
  return {
    ok: true,
    result: { domain, available: !!r.data?.is_available, price: r.data?.price, premium: r.data?.is_premium },
  };
}

export async function suggestDomains(keyword: string, limit = 10): Promise<{ ok: true; suggestions: DomainSuggestion[] } | { ok: false; error: string } | ConnectorNotReadyError> {
  const conn = await requireHostinger();
  if ("error" in conn) return conn;
  const r = await hFetch<any>(conn.baseUrl, conn.apiKey, `${conn.paths.suggestions}?keyword=${encodeURIComponent(keyword)}&limit=${limit}`);
  if (!r.ok) return r;
  const list = Array.isArray(r.data) ? r.data : r.data?.suggestions ?? [];
  return { ok: true, suggestions: list.map((s: any) => ({ domain: s.domain, available: !!s.is_available, price: s.price })) };
}

// Real money, real irreversible action — must only ever be called from
// gateway/domains.ts's execute step after a human-confirmed preview token,
// never directly from a UI action or an autonomous AI decision.
export async function registerDomain(req: DomainRegistrationRequest): Promise<{ ok: true; result: DomainRegistrationResult } | { ok: false; error: string } | ConnectorNotReadyError> {
  const conn = await requireHostinger();
  if ("error" in conn) return conn;
  const r = await hFetch<any>(conn.baseUrl, conn.apiKey, conn.paths.register, {
    method: "POST",
    body: JSON.stringify({
      domain: req.domain,
      period: req.years,
      privacy_protection: req.privacy_protection ?? true,
      contact: req.contact,
    }),
  });
  if (!r.ok) return r;
  return { ok: true, result: { domain: req.domain, order_id: r.data?.order_id ?? r.data?.id, status: r.data?.status ?? "pending", expires_at: r.data?.expires_at } };
}

export async function getNameservers(domain: string): Promise<{ ok: true; result: Nameservers } | { ok: false; error: string } | ConnectorNotReadyError> {
  const conn = await requireHostinger();
  if ("error" in conn) return conn;
  const r = await hFetch<any>(conn.baseUrl, conn.apiKey, conn.paths.nameservers(domain));
  if (!r.ok) return r;
  return { ok: true, result: { domain, nameservers: r.data?.nameservers ?? r.data ?? [] } };
}

// Irreversible-adjacent (repoints where DNS authority for the domain lives —
// e.g. moving a domain onto Cloudflare) — must go through gateway/domains.ts.
export async function setNameservers(domain: string, nameservers: string[]): Promise<{ ok: true } | { ok: false; error: string } | ConnectorNotReadyError> {
  const conn = await requireHostinger();
  if ("error" in conn) return conn;
  const r = await hFetch(conn.baseUrl, conn.apiKey, conn.paths.nameservers(domain), {
    method: "PUT",
    body: JSON.stringify({ nameservers }),
  });
  if (!r.ok) return r;
  return { ok: true };
}

export async function getWhois(domain: string): Promise<{ ok: true; result: WhoisRecord } | { ok: false; error: string } | ConnectorNotReadyError> {
  const conn = await requireHostinger();
  if ("error" in conn) return conn;
  const r = await hFetch<any>(conn.baseUrl, conn.apiKey, conn.paths.whois(domain));
  if (!r.ok) return r;
  return {
    ok: true,
    result: {
      domain,
      registrar: r.data?.registrar ?? "Hostinger",
      created_at: r.data?.created_at ?? null,
      expires_at: r.data?.expires_at ?? null,
      nameservers: r.data?.nameservers ?? [],
      status: r.data?.status ? [r.data.status] : [],
    },
  };
}
