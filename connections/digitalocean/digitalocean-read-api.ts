/**
 * หน้าที่: the real, GET-only calls to DigitalOcean's core v2 API for the
 * five Phase-1 capabilities, plus the pure normalizers that turn a raw
 * DigitalOcean response into this connector's own result shapes (never
 * pass raw upstream JSON straight through). Base host taken from
 * `../../providers/digitalocean/definition/provider.json`
 * `api_hosts.core_v2` — hardcoded as a constant here (that value is
 * static/stable, unlike per-endpoint paths which come from
 * ./provider-action-lookup.ts).
 *
 * Every fetch function takes `endpoint`, `token`, and a `FetchImpl` — the
 * SAME production `hostFetch` is used at runtime; ./tests/adapter.test.ts
 * injects a fake `FetchImpl` returning canned JSON, so this file's own
 * logic (URL building, header shape, normalization) is exercised for real
 * without any live network call or real token.
 *
 * Input: `endpoint` (from ./provider-action-lookup.ts), `token` (from
 * ../credential-provider.ts's resolution — never logged), a `FetchImpl`.
 * Output: `DigitalOceanApiOutcome<T>` per capability.
 * Dependency ที่อนุญาต: `./host-runtime` (types + the real `hostFetch`
 * default), `./adapter-contract` (result types).
 * สิ่งที่ห้ามแตะ: no function in this file may accept a `method`/`body`
 * parameter (read-only by construction, matching ./host-runtime.ts's own
 * rule). Never include `token` in a returned value or thrown error — only
 * `credentialSource` (already-safe) is threaded through into results.
 */

import type { FetchImpl, HostResponse } from "./host-runtime";
import { hostFetch } from "./host-runtime";
import type {
  DigitalOceanAccountResult,
  DigitalOceanBillingReadResult,
  DigitalOceanDropletSummary,
  DigitalOceanDropletsListResult,
  DigitalOceanRegionSummary,
  DigitalOceanRegionsListResult,
  DigitalOceanSizeSummary,
  DigitalOceanSizesListResult,
} from "./adapter-contract";

const CORE_V2_BASE_URL = "https://api.digitalocean.com/v2"; // ../../providers/digitalocean/definition/provider.json api_hosts.core_v2
const REQUEST_TIMEOUT_MILLISECONDS = 15000;

export type DigitalOceanApiOutcome<T> = { ok: true; result: T } | { ok: false; reason: string; http_status: number | null };

function buildHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, Accept: "application/json" };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function getJson(endpoint: string, token: string, fetchImpl: FetchImpl): Promise<{ ok: true; body: unknown; http_status: number } | { ok: false; reason: string; http_status: number | null }> {
  const outcome = await fetchImpl(`${CORE_V2_BASE_URL}${endpoint}`, buildHeaders(token), REQUEST_TIMEOUT_MILLISECONDS);
  if (outcome.kind === "transport_error") {
    return { ok: false, reason: `transport error calling DigitalOcean: ${outcome.reason}`, http_status: null };
  }
  const response: HostResponse = outcome.response;
  if (!response.ok) {
    return { ok: false, reason: `DigitalOcean returned HTTP ${response.status}`, http_status: response.status };
  }
  const body = await response.json();
  return { ok: true, body, http_status: response.status };
}

export async function fetchAccount(endpoint: string, token: string, credentialSource: string, fetchImpl: FetchImpl = hostFetch): Promise<DigitalOceanApiOutcome<DigitalOceanAccountResult>> {
  const fetched = await getJson(endpoint, token, fetchImpl);
  if (!fetched.ok) return { ok: false, reason: fetched.reason, http_status: fetched.http_status };
  const account = isRecord(fetched.body) && isRecord(fetched.body["account"]) ? fetched.body["account"] : {};
  return {
    ok: true,
    result: {
      email: typeof account["email"] === "string" ? account["email"] : null,
      uuid: typeof account["uuid"] === "string" ? account["uuid"] : null,
      status: typeof account["status"] === "string" ? account["status"] : null,
      droplet_limit: typeof account["droplet_limit"] === "number" ? account["droplet_limit"] : null,
      raw_available_fields: Object.keys(account),
      http_status: fetched.http_status,
      credential_source: credentialSource,
      fetched_at: new Date().toISOString(),
    },
  };
}

export async function fetchRegionsList(endpoint: string, token: string, credentialSource: string, fetchImpl: FetchImpl = hostFetch): Promise<DigitalOceanApiOutcome<DigitalOceanRegionsListResult>> {
  const fetched = await getJson(endpoint, token, fetchImpl);
  if (!fetched.ok) return { ok: false, reason: fetched.reason, http_status: fetched.http_status };
  const rawList = isRecord(fetched.body) && Array.isArray(fetched.body["regions"]) ? fetched.body["regions"] : [];
  const regions: DigitalOceanRegionSummary[] = rawList.filter(isRecord).map((r) => ({
    slug: typeof r["slug"] === "string" ? r["slug"] : "",
    name: typeof r["name"] === "string" ? r["name"] : "",
    available: r["available"] === true,
    sizes: Array.isArray(r["sizes"]) ? r["sizes"].filter((s): s is string => typeof s === "string") : [],
  }));
  return {
    ok: true,
    result: { regions, count: regions.length, http_status: fetched.http_status, credential_source: credentialSource, fetched_at: new Date().toISOString() },
  };
}

export async function fetchSizesList(endpoint: string, token: string, credentialSource: string, fetchImpl: FetchImpl = hostFetch): Promise<DigitalOceanApiOutcome<DigitalOceanSizesListResult>> {
  const fetched = await getJson(endpoint, token, fetchImpl);
  if (!fetched.ok) return { ok: false, reason: fetched.reason, http_status: fetched.http_status };
  const rawList = isRecord(fetched.body) && Array.isArray(fetched.body["sizes"]) ? fetched.body["sizes"] : [];
  const sizes: DigitalOceanSizeSummary[] = rawList.filter(isRecord).map((s) => ({
    slug: typeof s["slug"] === "string" ? s["slug"] : "",
    price_monthly: typeof s["price_monthly"] === "number" ? s["price_monthly"] : null,
    price_hourly: typeof s["price_hourly"] === "number" ? s["price_hourly"] : null,
    memory: typeof s["memory"] === "number" ? s["memory"] : null,
    vcpus: typeof s["vcpus"] === "number" ? s["vcpus"] : null,
    disk: typeof s["disk"] === "number" ? s["disk"] : null,
  }));
  return {
    ok: true,
    result: { sizes, count: sizes.length, http_status: fetched.http_status, credential_source: credentialSource, fetched_at: new Date().toISOString() },
  };
}

export async function fetchDropletsList(endpoint: string, token: string, credentialSource: string, fetchImpl: FetchImpl = hostFetch): Promise<DigitalOceanApiOutcome<DigitalOceanDropletsListResult>> {
  const fetched = await getJson(endpoint, token, fetchImpl);
  if (!fetched.ok) return { ok: false, reason: fetched.reason, http_status: fetched.http_status };
  const rawList = isRecord(fetched.body) && Array.isArray(fetched.body["droplets"]) ? fetched.body["droplets"] : [];
  const droplets: DigitalOceanDropletSummary[] = rawList.filter(isRecord).map((d) => ({
    id: typeof d["id"] === "number" ? d["id"] : 0,
    name: typeof d["name"] === "string" ? d["name"] : "",
    status: typeof d["status"] === "string" ? d["status"] : "",
    region_slug: isRecord(d["region"]) && typeof d["region"]["slug"] === "string" ? d["region"]["slug"] : null,
    size_slug: typeof d["size_slug"] === "string" ? d["size_slug"] : null,
    created_at: typeof d["created_at"] === "string" ? d["created_at"] : null,
  }));
  return {
    ok: true,
    result: { droplets, count: droplets.length, http_status: fetched.http_status, credential_source: credentialSource, fetched_at: new Date().toISOString() },
  };
}

export async function fetchBilling(endpoint: string, token: string, credentialSource: string, fetchImpl: FetchImpl = hostFetch): Promise<DigitalOceanApiOutcome<DigitalOceanBillingReadResult>> {
  const fetched = await getJson(endpoint, token, fetchImpl);
  if (!fetched.ok) return { ok: false, reason: fetched.reason, http_status: fetched.http_status };
  const body = isRecord(fetched.body) ? fetched.body : {};
  return {
    ok: true,
    result: {
      account_balance: typeof body["account_balance"] === "number" ? body["account_balance"] : null,
      month_to_date_balance: typeof body["month_to_date_balance"] === "number" ? body["month_to_date_balance"] : null,
      month_to_date_usage: typeof body["month_to_date_usage"] === "number" ? body["month_to_date_usage"] : null,
      generated_at: typeof body["generated_at"] === "string" ? body["generated_at"] : null,
      http_status: fetched.http_status,
      credential_source: credentialSource,
      fetched_at: new Date().toISOString(),
    },
  };
}
