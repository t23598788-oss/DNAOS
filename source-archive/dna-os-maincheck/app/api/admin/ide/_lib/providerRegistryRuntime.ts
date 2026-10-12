/**
 * Provider Registry Runtime (owner, 2026-08-10, DigitalOcean AI
 * Inference Infrastructure Control & Billing Layer). The ONE real join
 * point across the three real, already-existing sources of provider
 * truth in this repo — never a 4th, parallel, hand-maintained list:
 *
 *   1. registry/PROVIDER_DIRECTORY.json — identity/purpose/status rollup
 *   2. app/api/admin/ide/_lib/workerSelectorRuntime.ts#WORKER_ADAPTER_REGISTRY
 *      — real, live capability/availability/health per Worker Adapter
 *   3. registry/infrastructure.json — real cost/quota fields (where a
 *      provider has one — not every provider does, e.g. digitalocean
 *      doesn't yet)
 *
 * Every caller that needs "what providers exist and are they usable"
 * (the admin Infrastructure Control & Billing Center, any future check)
 * calls listProviderRegistry() — never re-implements this join
 * elsewhere (Owner's own instruction: "ห้าม hardcode logic กระจายตามระบบ").
 *
 * Never reads or returns a secret value — only the same real, already-
 * safe availability()/health() output every WorkerAdapter already
 * produces (booleans + human-readable reasons, verified in
 * digitalOceanWorkerAdapter.ts and every other real Adapter).
 */
import { readFileSync, existsSync, writeFileSync } from "fs";
import { join } from "path";
import { WORKSPACE_ROOT } from "./fsSecurity";
import { WORKER_ADAPTER_REGISTRY } from "./workerAdapterRegistry";
import { listConnectors } from "@/gateway/connectors";
import { getAccumulatedUsageSummary } from "./costLedgerViewRuntime";
import type { DependencyDiscoveryReport } from "@/core/shared/types";

export type CredentialStatus = "CONFIGURED" | "MISSING" | "INVALID" | "NOT_APPLICABLE";

export interface ProviderWorkerAdapterView {
  id: string;
  type: string;
  capabilities: string[];
  availability: { available: boolean; reason: string };
  credentialStatus: CredentialStatus;
}

export interface ProviderRegistryEntry {
  provider: string;
  directoryStatus: string;
  purpose: string;
  workerAdapters: ProviderWorkerAdapterView[];
  costMonthlyThb: number | null;
  infraStatus: string | null;
}

interface ProviderDirectoryFile {
  providers: { name: string; status: string; purpose: string; source: string }[];
}

interface InfrastructureFile {
  services?: Record<string, { status?: string; cost_monthly_thb?: number }>;
}

function readJson<T>(relPath: string): T {
  return JSON.parse(readFileSync(join(WORKSPACE_ROOT, relPath), "utf-8")) as T;
}

/** Real, honest 3-state derivation from an Adapter's own already-safe
 * methods — no new secret storage, no token ever read here.
 * CONFIGURED: availability().available === true.
 * INVALID: unavailable AND the most recent real live call this process
 *   failed (health status DEGRADED) — a real credential exists but the
 *   provider rejected it, distinct from never having one at all.
 * MISSING: unavailable and no such evidence exists (the honest default —
 *   never guessed toward INVALID without a real failed live call). */
async function deriveCredentialStatus(adapter: (typeof WORKER_ADAPTER_REGISTRY)[number]): Promise<CredentialStatus> {
  if (adapter.type === "HUMAN" || adapter.type === "LOCAL_RUNTIME") return "NOT_APPLICABLE";
  const avail = adapter.availability();
  if (avail.available) return "CONFIGURED";
  const health = await adapter.health();
  return health.status === "DEGRADED" ? "INVALID" : "MISSING";
}

export async function listProviderRegistry(): Promise<ProviderRegistryEntry[]> {
  const directory = readJson<ProviderDirectoryFile>("registry/PROVIDER_DIRECTORY.json");
  const infra = readJson<InfrastructureFile>("registry/infrastructure.json");

  const adaptersByProvider = new Map<string, typeof WORKER_ADAPTER_REGISTRY>();
  for (const a of WORKER_ADAPTER_REGISTRY) {
    const list = adaptersByProvider.get(a.provider) ?? [];
    list.push(a);
    adaptersByProvider.set(a.provider, list);
  }

  const entries: ProviderRegistryEntry[] = [];
  for (const p of directory.providers) {
    const adapters = adaptersByProvider.get(p.name) ?? [];
    const workerAdapters: ProviderWorkerAdapterView[] = [];
    for (const a of adapters) {
      workerAdapters.push({
        id: a.id, type: a.type, capabilities: a.capabilities(), availability: a.availability(),
        credentialStatus: await deriveCredentialStatus(a),
      });
    }
    const infraService = infra.services?.[p.name];
    entries.push({
      provider: p.name, directoryStatus: p.status, purpose: p.purpose, workerAdapters,
      costMonthlyThb: infraService?.cost_monthly_thb ?? null, infraStatus: infraService?.status ?? null,
    });
  }
  return entries;
}

/**
 * ══════════════════════════════════════════════════════════════════════
 * Provider Registry Reconciliation (owner, 2026-08-11, "ทำต่อเฟส Provider
 * Registry Reconciliation ตาม Discovery Report นี้ทันที").
 *
 * Discovery ≠ Registration. This layer NORMALIZES provider identity across
 * every real, existing evidence source and computes an honest
 * connection_status — it never writes into registry/PROVIDER_DIRECTORY.json
 * (that remains the owner-controlled system of record) and never invents a
 * new scanner (engines/workspace/dependencyDiscovery/ is reused as-is, via
 * its own written artifact registry/auto-dependency-graph.json — reading the
 * artifact, exactly like diff.ts already does, rather than re-running the
 * generator inside every request).
 *
 * A raw name with no explicit mapping below is NEVER guessed into an
 * existing provider — it becomes its own provider_id and, if not already
 * confirmed in PROVIDER_DIRECTORY.json, PENDING_RECONCILIATION. Under-
 * merging (two real names staying separate) is the deliberate safe failure
 * mode; over-merging is not.
 * ══════════════════════════════════════════════════════════════════════
 */

export type ServiceOwner = "DNA_OS" | "EXTERNAL_PROVIDER" | "UNKNOWN";
export type ProviderType = "API_PROVIDER" | "PROTOCOL" | "INFRASTRUCTURE" | "UNKNOWN";
export type NormalizedConnectionStatus =
  | "LIVE" | "WAITING_FOR_CREDENTIAL" | "NOT_YET_VERIFIED" | "DISCOVERED_NOT_CONNECTED" | "PENDING_RECONCILIATION";
export type ReconciliationStatus = "CONFIRMED" | "PENDING_RECONCILIATION";

export interface ProviderEvidenceItem {
  source: string; // e.g. "registry/PROVIDER_DIRECTORY.json", "connectors_table:slug=openclaw-pinto", "env_var_name:BOT_API_KEY", "dependency_discovery:auto-dependency-graph.json"
  detail: string;
  captured_at: string;
}

export interface NormalizedProvider {
  provider_id: string;
  canonical_name: string;
  service_owner: ServiceOwner;
  provider_type: ProviderType;
  discovered_from: string[];
  capabilities: string[];
  connection_status: NormalizedConnectionStatus;
  credential_status: CredentialStatus | "UNKNOWN";
  runtime_status: string;
  evidence: ProviderEvidenceItem[];
  last_verified_at: string | null;
  reconciliation_status: ReconciliationStatus;
  brand_asset_status: "UNKNOWN";
  brand_asset_source: "UNKNOWN";
  brand_asset_license_status: "UNKNOWN";
}

/** Real, explicit, hand-reviewed raw-name → provider_id map. Every mapping
 * here is backed by the SAME real name/purpose appearing in ≥2 independent
 * real sources (cited inline). Never fuzzy-matched. */
const RAW_NAME_TO_PROVIDER_ID: Record<string, string> = {
  // Anthropic — API adapter (provider="anthropic") + CLI adapter
  // (provider="anthropic-cli") + PROVIDER_DIRECTORY + infrastructure.json
  // all name the same real company/credential family.
  anthropic: "anthropic", "anthropic-cli": "anthropic",
  openai: "openai",
  digitalocean: "digitalocean",
  runpod: "runpod",
  github: "github",
  vercel: "vercel",
  // Supabase — foundational infra (DB/Auth/Realtime/Edge) + the real
  // "Supabase Management API" connector are the same vendor's own product
  // line (registry/PROVIDER_DIRECTORY.json's own purpose text says so).
  supabase: "supabase", "supabase-management-api": "supabase",
  cloudflare: "cloudflare",
  // LINE Messaging API — infrastructure.json's "line_messaging" + the real
  // connector slug "line-messaging-api-*" name the identical real product.
  line_messaging: "line_messaging_api", "line-messaging-api": "line_messaging_api",
  // LINE Notify is a distinct real LINE product — never merged with the
  // Messaging API (PROVIDER_DIRECTORY's own "line" entry lists them as 2
  // real services under one umbrella purpose, not 1 unified service).
  line_notify: "line_notify",
  // Gemini — infrastructure.json's "gemini" service + the gemini-api Worker
  // Adapter (provider="gemini") + PROVIDER_DIRECTORY's "google" sub-service
  // text all consistently name "gemini".
  gemini: "google_gemini",
  google_maps: "google_maps",
  gmail: "gmail",
  mcp: "mcp",
  sip: "sip",
  openclaw: "openclaw", "openclaw-pinto": "openclaw",
  ollama: "ollama",
  human: "human_worker",
  domain: "domain",
  node_runtime: "node_runtime",
  deno_runtime: "deno_runtime",
};

/** PROVIDER_DIRECTORY.json umbrella entries that its OWN purpose text
 * already declares are "not 1 unified entry" — their evidence is attached
 * to every real sub-provider instead of creating a redundant umbrella node. */
const DIRECTORY_UMBRELLA_SPLIT: Record<string, string[]> = {
  google: ["google_gemini", "google_maps", "gmail"],
  line: ["line_messaging_api", "line_notify"],
};

const CANONICAL_NAMES: Record<string, string> = {
  anthropic: "Anthropic", openai: "OpenAI", digitalocean: "DigitalOcean", runpod: "RunPod",
  github: "GitHub", vercel: "Vercel", supabase: "Supabase", cloudflare: "Cloudflare",
  line_messaging_api: "LINE Messaging API", line_notify: "LINE Notify",
  google_gemini: "Google Gemini", google_maps: "Google Maps", gmail: "Gmail (Google)",
  mcp: "Model Context Protocol (MCP)", sip: "SIP",
  openclaw: "OpenClaw + Pinto (openclaw.ai)", ollama: "Ollama", human_worker: "Human Worker (DNA OS)",
  domain: "Domain (DNA OS)", node_runtime: "Node.js Runtime (DNA OS)", deno_runtime: "Deno Runtime (DNA OS)",
  google_ai_studio: "Google AI Studio (unconfirmed relationship to google_gemini)",
  bank_of_thailand: "Bank of Thailand (BOT)", kasikorn_bank: "Kasikornbank",
  hostinger: "Hostinger", longdo_map: "Longdo Map",
};

/** Explicit protocol/internal classification — never guessed per-provider. */
const PROVIDER_TYPE_OVERRIDE: Record<string, ProviderType> = {
  mcp: "PROTOCOL", sip: "PROTOCOL",
  human_worker: "INFRASTRUCTURE", domain: "INFRASTRUCTURE", node_runtime: "INFRASTRUCTURE", deno_runtime: "INFRASTRUCTURE",
};
const SERVICE_OWNER_OVERRIDE: Record<string, ServiceOwner> = {
  human_worker: "DNA_OS", domain: "DNA_OS", node_runtime: "DNA_OS", deno_runtime: "DNA_OS",
  mcp: "EXTERNAL_PROVIDER", // real, external, open protocol spec — DNA OS is a consumer, not the owner
};

/** Known credential-shaped env var NAMES → provider_id. Presence-only
 * evidence (a NAME appearing in .env.local's key list) — the value itself
 * is never read here. Deliberately NOT a fuzzy scan of every env key: only
 * names independently confirmed (via source-code grep) to belong to a real
 * external provider integration are mapped, so internal secrets (CRON_SECRET,
 * ADMIN_PASSWORD, etc.) are never miscounted as provider evidence. */
/**
 * ENV VAR → provider id. Exported (2026-09-23, Developer Connect §(ข)) so a
 * developer runtime can LOOK UP which connector owns a credential by its env-var
 * name — the mapping is not a credential source, and nothing reads the value
 * from the environment any more (see edgeFunctionWorkerRuntime.resolveAuthHeader).
 */
export const ENV_VAR_TO_PROVIDER: Record<string, string> = {
  BOT_API_KEY: "bank_of_thailand",
  KASIKORN_STATEMENT_PASSWORD: "kasikorn_bank",
  GMAIL_CLIENT_ID: "gmail", GMAIL_CLIENT_SECRET: "gmail", GMAIL_REFRESH_TOKEN: "gmail",
  LINE_CHANNEL_ACCESS_TOKEN: "line_messaging_api", NEXT_PUBLIC_LIFF_ADD_FRIEND_ID: "line_messaging_api",
  OWNER_LINE_USER_ID: "line_messaging_api",
  OPENCLAW_INTERNAL_SECRET: "openclaw",
  OPENAI_API_KEY: "openai",
  RUNPOD_API_KEY: "runpod",
  GOOGLE_PLACES_API_KEY: "google_places", GOOGLE_MAPS_API_KEY: "google_places",
  SUPABASE_MANAGEMENT_API_TOKEN: "supabase", SUPABASE_SERVICE_ROLE_KEY: "supabase", NEXT_PUBLIC_SUPABASE_URL: "supabase", NEXT_PUBLIC_SUPABASE_ANON_KEY: "supabase",
};

/** Manual-discovery evidence gathered THIS session's Discovery Report pass
 * (real file citations found via grep, not an automated scanner) for real
 * dependencies confirmed to exist in code/env but absent from
 * PROVIDER_DIRECTORY.json entirely. Per the owner's explicit instruction,
 * these enter PENDING_RECONCILIATION and are never auto-written into
 * PROVIDER_DIRECTORY.json by this module. */
const MANUAL_DISCOVERY: { provider_id: string; capabilities: string[]; evidence: [string, string][] }[] = [
  {
    provider_id: "bank_of_thailand",
    capabilities: ["exchange_rate_lookup"],
    evidence: [
      ["manual_discovery:2026-08-11", "engines/bot-exchange-rate.ts — real, live BOT exchange-rate client (getLatestExchangeRates/getExchangeRateFor), used for real USD→THB conversion in costLedgerViewRuntime.ts"],
      ["env_var_name:BOT_API_KEY", "credential-shaped env var present in .env.local; value never read here"],
    ],
  },
  {
    provider_id: "kasikorn_bank",
    capabilities: ["bank_statement_reconciliation"],
    evidence: [
      ["env_var_name:KASIKORN_STATEMENT_PASSWORD", "credential-shaped env var present in .env.local; value never read here"],
      ["manual_discovery:2026-08-11", "BANK_STATEMENT_RECONCILE_SECRET also present, corroborating a real Kasikorn statement-reconciliation integration"],
    ],
  },
  {
    provider_id: "hostinger",
    capabilities: ["domain_availability", "domain_registration", "domain_whois", "nameserver_management"],
    evidence: [
      ["manual_discovery:2026-08-11", "engines/domains/hostinger.ts — real client, credential resolved from Connectors table only (secret.api_key/secret.token via connector slug \"hostinger\"), no env var — confirms this is a coded, real integration currently WAITING at the Connector-registration step"],
      ["manual_discovery:2026-08-11", "gateway/domains.ts, app/api/admin/domains/{availability,suggestions,whois}/route.ts, config/system-links.ts, supabase/functions/subscription-email-sync/index.ts all reference Hostinger"],
    ],
  },
  {
    provider_id: "longdo_map",
    capabilities: ["geocoding", "map_search"],
    evidence: [
      ["manual_discovery:2026-08-11", "engines/geocoding.ts — real client gated on process.env.LONGDO_MAP_API_KEY (absent from .env.local); also referenced by engines/equipment/relay-command.ts, scripts/sync-infrastructure-dependencies.ts, services/ai/bridge-claude.ts"],
    ],
  },
  {
    provider_id: "google_places",
    capabilities: ["place_discovery", "material_supplier_search"],
    evidence: [
      ["manual_discovery:2026-09-23", "engines/place-discovery.ts — real, read-only Google Places API (New) Text Search client (searchGooglePlaces / discoverKhonKaenMaterialPlaces). Credential resolved as options.apiKey ?? process.env.GOOGLE_PLACES_API_KEY ?? process.env.GOOGLE_MAPS_API_KEY and failing closed with a structured result when absent (same pattern as engines/geocoding.ts); a caller may inject the key it resolved elsewhere, so no second credential path is introduced. Writes no table — it does not touch pit_profiles, pit_materials, contacts or prices"],
      ["manual_discovery:2026-09-23", "scripts/place-discovery-test.ts + package.json#place-discovery:test — regression test with the network stubbed, so no live Google request is made; also .github/workflows/place-discovery-test.yml"],
    ],
  },
];

function nowIso(): string { return new Date().toISOString(); }
function ev(source: string, detail: string): ProviderEvidenceItem { return { source, detail, captured_at: nowIso() }; }

/** Strip a connector's random 6-hex-char identity suffix (see
 * gateway/connectors.ts#slugify) to get a stable comparison key. */
function stripConnectorSlugSuffix(slug: string): string {
  return slug.replace(/-[a-f0-9]{6}$/, "");
}

/**
 * The ONE connector -> provider-id resolver (owner-approved Connect Core
 * design, 2026-09-20). Prefers the connector's OWN declared provider
 * (config.provider, written at Connect time once a caller declares it) and
 * falls back to the legacy slug-derived identity — minus slugify's random
 * suffix — for every row created before a provider was declared. Reuses
 * stripConnectorSlugSuffix above, so the suffix rule still lives in exactly one
 * place; callers must never re-derive identity from a display name.
 */
export function resolveConnectorProvider(
  config: Record<string, unknown> | null | undefined,
  slug: string,
): string {
  const declared = typeof config?.provider === "string" ? config.provider.trim().toLowerCase() : "";
  if (declared) return declared;
  return stripConnectorSlugSuffix(slug).toLowerCase();
}

function resolveProviderId(rawName: string): string {
  return RAW_NAME_TO_PROVIDER_ID[rawName] ?? rawName.replace(/[^a-z0-9]+/gi, "_").toLowerCase();
}

function ensureProvider(map: Map<string, NormalizedProvider>, providerId: string): NormalizedProvider {
  let p = map.get(providerId);
  if (!p) {
    p = {
      provider_id: providerId,
      canonical_name: CANONICAL_NAMES[providerId] ?? providerId,
      service_owner: SERVICE_OWNER_OVERRIDE[providerId] ?? "UNKNOWN",
      provider_type: PROVIDER_TYPE_OVERRIDE[providerId] ?? "UNKNOWN",
      discovered_from: [],
      capabilities: [],
      connection_status: "PENDING_RECONCILIATION",
      credential_status: "UNKNOWN",
      runtime_status: "UNKNOWN",
      evidence: [],
      last_verified_at: null,
      reconciliation_status: "PENDING_RECONCILIATION",
      brand_asset_status: "UNKNOWN",
      brand_asset_source: "UNKNOWN",
      brand_asset_license_status: "UNKNOWN",
    };
    map.set(providerId, p);
  }
  return p;
}

function addEvidence(p: NormalizedProvider, source: string, detail: string) {
  p.evidence.push(ev(source, detail));
  if (!p.discovered_from.includes(source)) p.discovered_from.push(source);
}

function addCapabilities(p: NormalizedProvider, caps: string[]) {
  for (const c of caps) if (!p.capabilities.includes(c)) p.capabilities.push(c);
}

/**
 * Builds the full normalized provider set from every real, existing
 * evidence source. Does NOT write to PROVIDER_DIRECTORY.json. Providers
 * confirmed present in PROVIDER_DIRECTORY.json get reconciliation_status
 * "CONFIRMED"; everything else defaults to "PENDING_RECONCILIATION" (the
 * ensureProvider() default) unless explicitly promoted below.
 */
export async function listNormalizedProviders(): Promise<NormalizedProvider[]> {
  const map = new Map<string, NormalizedProvider>();
  const directory = readJson<ProviderDirectoryFile>("registry/PROVIDER_DIRECTORY.json");
  const infra = readJson<InfrastructureFile>("registry/infrastructure.json");
  const confirmedDirectoryIds = new Set<string>();

  // ── Source 1: registry/PROVIDER_DIRECTORY.json ──
  for (const d of directory.providers) {
    const splitIds = DIRECTORY_UMBRELLA_SPLIT[d.name];
    const ids = splitIds ?? [resolveProviderId(d.name)];
    for (const id of ids) {
      const p = ensureProvider(map, id);
      p.reconciliation_status = "CONFIRMED";
      confirmedDirectoryIds.add(id);
      addEvidence(p, "registry/PROVIDER_DIRECTORY.json", `name="${d.name}" status="${d.status}" purpose="${d.purpose}"`);
      if (d.name === "mcp") p.provider_type = "PROTOCOL"; // explicit, directory itself says "protocol, not a vendor"
    }
  }

  // ── Source 2: registry/infrastructure.json services ──
  for (const [key, svc] of Object.entries(infra.services ?? {})) {
    const id = resolveProviderId(key);
    const p = ensureProvider(map, id);
    addEvidence(p, "registry/infrastructure.json", `service="${key}" status="${svc?.status ?? "unknown"}"`);
    if (svc?.status && svc.status !== "removed") p.reconciliation_status = "CONFIRMED";
  }

  // ── Source 3: WORKER_ADAPTER_REGISTRY (real, live capability/availability) ──
  for (const a of WORKER_ADAPTER_REGISTRY) {
    const id = resolveProviderId(a.provider);
    const p = ensureProvider(map, id);
    p.reconciliation_status = "CONFIRMED";
    addCapabilities(p, a.capabilities());
    const avail = a.availability();
    addEvidence(p, "worker_adapter_registry", `adapterId="${a.id}" type="${a.type}" available=${avail.available} reason="${avail.reason}"`);
    if (a.type === "HUMAN" || a.type === "LOCAL_RUNTIME") {
      p.credential_status = "NOT_APPLICABLE";
      p.connection_status = avail.available ? "LIVE" : "DISCOVERED_NOT_CONNECTED";
    } else {
      p.credential_status = avail.available ? "CONFIGURED" : "MISSING";
    }
  }

  // ── Source 4: real connectors table (live, current) ──
  try {
    const connectors = await listConnectors();
    for (const c of connectors) {
      const stripped = stripConnectorSlugSuffix(c.slug);
      const mappedId = RAW_NAME_TO_PROVIDER_ID[stripped];
      const id = mappedId ?? resolveProviderId(stripped);
      const p = ensureProvider(map, id);
      if (mappedId) p.reconciliation_status = "CONFIRMED";
      // Unmapped connector (e.g. "google-ai-studio") is genuinely new
      // identity — never assumed to belong to an existing provider (item 6).
      addEvidence(p, "connectors_table", `slug="${c.slug}" name="${c.name}" auth_type="${c.auth_type}" status="${c.status}" enabled=${c.enabled}`);
      p.last_verified_at = c.last_checked_at ?? p.last_verified_at;
      if (c.status === "connected" && c.enabled) {
        p.credential_status = "CONFIGURED";
        if (p.connection_status !== "LIVE") p.connection_status = "NOT_YET_VERIFIED";
      } else if (c.status === "error") {
        p.credential_status = "INVALID";
      }
    }
  } catch (e) {
    // Live DB read can legitimately fail outside a configured environment —
    // degrade honestly, never fabricate connector evidence.
  }

  // ── Source 5: env var NAMES only (never values) ──
  try {
    const envPath = join(WORKSPACE_ROOT, ".env.local");
    if (existsSync(envPath)) {
      const raw = readFileSync(envPath, "utf-8");
      for (const line of raw.split("\n")) {
        if (!line.includes("=") || line.trim().startsWith("#")) continue;
        const key = line.slice(0, line.indexOf("=")).trim();
        const mapped = ENV_VAR_TO_PROVIDER[key];
        if (!mapped) continue;
        const p = ensureProvider(map, mapped);
        addEvidence(p, `env_var_name:${key}`, "credential-shaped env var name present in .env.local (value never read)");
      }
    }
  } catch {
    // .env.local may not exist in every environment — honest no-op, not a guess.
  }

  // ── google-ai-studio: real live connector, ownership/relationship to
  // google_gemini NOT provable from repo evidence alone — explicitly left
  // unmapped above (item 6). Mark it clearly rather than silently drop it.
  const gaStudio = map.get("google_ai_studio");
  if (gaStudio) {
    gaStudio.service_owner = "UNKNOWN";
    gaStudio.provider_type = "UNKNOWN";
    gaStudio.reconciliation_status = "PENDING_RECONCILIATION";
    gaStudio.connection_status = "PENDING_RECONCILIATION";
  }

  // ── Manual-discovery gaps (BOT / Kasikorn / Hostinger / Longdo) — real,
  // evidence-backed, but absent from PROVIDER_DIRECTORY.json entirely.
  // Never auto-registered — PENDING_RECONCILIATION until the owner confirms. ──
  for (const m of MANUAL_DISCOVERY) {
    const p = ensureProvider(map, m.provider_id);
    p.service_owner = "EXTERNAL_PROVIDER";
    p.provider_type = "API_PROVIDER";
    addCapabilities(p, m.capabilities);
    for (const [source, detail] of m.evidence) addEvidence(p, source, detail);
    p.reconciliation_status = "PENDING_RECONCILIATION";
    p.connection_status = "PENDING_RECONCILIATION";
  }

  // ── Source 6: dependency-graph corroboration (reads the artifact already
  // written by engines/workspace/dependencyDiscovery/generate.ts — never
  // re-runs scanners here). Strengthens already-known providers' evidence
  // only; never invents a brand-new provider from an edge string alone. ──
  try {
    const graphPath = join(WORKSPACE_ROOT, "registry/auto-dependency-graph.json");
    if (existsSync(graphPath)) {
      const graph = JSON.parse(readFileSync(graphPath, "utf-8")) as DependencyDiscoveryReport;
      const searchTerms: [string, string][] = Array.from(map.keys()).map((id) => [id, id.replace(/_/g, "")]);
      const CAP_PER_PROVIDER = 3;
      const hitCounts = new Map<string, number>();
      for (const edge of graph.edges) {
        const haystack = (edge.source + edge.target).toLowerCase().replace(/[^a-z0-9]/g, "");
        for (const [id, term] of searchTerms) {
          if (term.length < 4) continue; // avoid noisy short-term false positives (e.g. "sip")
          if (!haystack.includes(term)) continue;
          const count = hitCounts.get(id) ?? 0;
          if (count >= CAP_PER_PROVIDER) continue;
          hitCounts.set(id, count + 1);
          const p = map.get(id)!;
          addEvidence(p, "dependency_discovery:auto-dependency-graph.json", `edge ${edge.source} -> ${edge.target} (kind=${edge.kind})`);
        }
      }
    }
  } catch {
    // Artifact may not exist yet in a fresh checkout — honest no-op.
  }

  // ── Live-usage promotion to LIVE (real, proven — not just "credential
  // looks present") using the already-built Usage Meter rollup. ──
  try {
    const usageSummaries = await getAccumulatedUsageSummary();
    for (const s of usageSummaries) {
      const id = resolveProviderId(s.provider);
      const p = map.get(id);
      if (p && s.hasLiveUsage && s.requestCount > 0) {
        p.connection_status = "LIVE";
        p.last_verified_at = nowIso();
      }
    }
  } catch {
    // worker_usage_events may be unreachable in some environments — degrade honestly.
  }

  // ── Final connection_status resolution for anything not already decided
  // by the LIVE/HUMAN/LOCAL_RUNTIME/connector/manual-discovery branches above. ──
  for (const p of map.values()) {
    if (p.connection_status === "LIVE") continue; // already proven
    if (p.reconciliation_status === "PENDING_RECONCILIATION") { p.connection_status = "PENDING_RECONCILIATION"; continue; }
    if (p.connection_status === "NOT_YET_VERIFIED") continue; // set by connector branch, real signal
    if (p.credential_status === "CONFIGURED") { p.connection_status = "NOT_YET_VERIFIED"; continue; }
    if (p.credential_status === "MISSING" || p.credential_status === "INVALID") { p.connection_status = "WAITING_FOR_CREDENTIAL"; continue; }
    // No live check mechanism at all (e.g. github, vercel, cloudflare, sip) —
    // real code/evidence exists but nothing here has ever tried to connect it.
    p.connection_status = "DISCOVERED_NOT_CONNECTED";
  }

  return Array.from(map.values()).sort((a, b) => a.provider_id.localeCompare(b.provider_id));
}

export interface ProviderReconciliationEvent {
  event_id: string;
  change: "ADDED" | "REMOVED" | "CHANGED";
  provider_id: string;
  source: string;
  detected_at: string;
  previous_state: Partial<NormalizedProvider> | null;
  proposed_state: Partial<NormalizedProvider> | null;
  reason: string;
  evidence_reference: string[];
}

interface ReconciliationStateFile {
  version: 1;
  generated_at: string;
  providers: NormalizedProvider[];
}

const RECONCILIATION_STATE_PATH = "registry/PROVIDER_RECONCILIATION_STATE.json";
const RECONCILIATION_LOG_PATH = "registry/PROVIDER_RECONCILIATION_LOG.json";

function readReconciliationState(): ReconciliationStateFile | null {
  const p = join(WORKSPACE_ROOT, RECONCILIATION_STATE_PATH);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, "utf-8")) as ReconciliationStateFile; } catch { return null; }
}

function readReconciliationLog(): ProviderReconciliationEvent[] {
  const p = join(WORKSPACE_ROOT, RECONCILIATION_LOG_PATH);
  if (!existsSync(p)) return [];
  try { return (JSON.parse(readFileSync(p, "utf-8")) as { events: ProviderReconciliationEvent[] }).events ?? []; } catch { return []; }
}

/** Minimal comparable slice — avoids CHANGED-noise from evidence timestamps. */
function comparableSlice(p: NormalizedProvider) {
  return {
    canonical_name: p.canonical_name, service_owner: p.service_owner, provider_type: p.provider_type,
    capabilities: [...p.capabilities].sort(), connection_status: p.connection_status,
    credential_status: p.credential_status, reconciliation_status: p.reconciliation_status,
  };
}

/**
 * Extends the SAME compare-current-vs-persisted-snapshot pattern already
 * used by engines/workspace/dependencyDiscovery/diff.ts (there: auto graph
 * vs hand-maintained seed; here: current normalized providers vs the last
 * persisted snapshot) — applied to providers, since diff.ts's own edge-key
 * comparison is specific to dependency-graph edges, not provider identity.
 * Never deletes prior state; every event carries full audit evidence.
 */
export async function reconcileProviders(): Promise<{ current: NormalizedProvider[]; events: ProviderReconciliationEvent[] }> {
  const current = await listNormalizedProviders();
  const previousState = readReconciliationState();
  const previousById = new Map((previousState?.providers ?? []).map((p) => [p.provider_id, p]));
  const currentById = new Map(current.map((p) => [p.provider_id, p]));

  const newEvents: ProviderReconciliationEvent[] = [];
  const detectedAt = nowIso();
  let seq = 0;
  const eventId = () => `RECON-${Date.now()}-${++seq}`;

  for (const p of current) {
    const prev = previousById.get(p.provider_id);
    if (!prev) {
      newEvents.push({
        event_id: eventId(), change: "ADDED", provider_id: p.provider_id,
        source: "providerRegistryRuntime.reconcileProviders", detected_at: detectedAt,
        previous_state: null, proposed_state: comparableSlice(p),
        reason: `New provider_id "${p.provider_id}" observed with no matching entry in the previous reconciliation snapshot.`,
        evidence_reference: p.discovered_from,
      });
    } else if (JSON.stringify(comparableSlice(prev)) !== JSON.stringify(comparableSlice(p))) {
      newEvents.push({
        event_id: eventId(), change: "CHANGED", provider_id: p.provider_id,
        source: "providerRegistryRuntime.reconcileProviders", detected_at: detectedAt,
        previous_state: comparableSlice(prev), proposed_state: comparableSlice(p),
        reason: "Normalized provider fields differ from the previous reconciliation snapshot.",
        evidence_reference: p.discovered_from,
      });
    }
  }
  for (const prev of previousState?.providers ?? []) {
    if (!currentById.has(prev.provider_id)) {
      newEvents.push({
        event_id: eventId(), change: "REMOVED", provider_id: prev.provider_id,
        source: "providerRegistryRuntime.reconcileProviders", detected_at: detectedAt,
        previous_state: comparableSlice(prev), proposed_state: null,
        reason: `provider_id "${prev.provider_id}" no longer observed in any evidence source this run.`,
        evidence_reference: prev.discovered_from,
      });
    }
  }

  if (newEvents.length > 0) {
    const allEvents = [...readReconciliationLog(), ...newEvents];
    writeFileSync(join(WORKSPACE_ROOT, RECONCILIATION_LOG_PATH), JSON.stringify({
      version: 1,
      note: "Append-only audit log of provider ADDED/REMOVED/CHANGED events, written by providerRegistryRuntime.reconcileProviders(). Never hand-edited.",
      events: allEvents,
    }, null, 2) + "\n", "utf-8");
  }

  writeFileSync(join(WORKSPACE_ROOT, RECONCILIATION_STATE_PATH), JSON.stringify({
    version: 1,
    generated_at: detectedAt,
    providers: current,
  } satisfies ReconciliationStateFile, null, 2) + "\n", "utf-8");

  return { current, events: newEvents };
}
