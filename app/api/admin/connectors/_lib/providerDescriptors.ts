/**
 * Provider Descriptors — static, declared-only facts about known
 * providers (product name, capabilities, role label, declared
 * permission scope, logo). NEVER contains status/enabled/health — those
 * fields always come from a real, live source (ConnectorRecord, worker
 * adapter preflight/health, or the Integration Gateway) so a provider
 * can never render as connected/healthy just because it's "known."
 *
 * Reuses the real logo URLs already curated in plugins/capabilities.ts
 * (`L`) — that file's `status` values are ignored on purpose (they're
 * hardcoded/dead code, not runtime evidence).
 */
import { findTool } from "@/plugins/capabilities";

export interface ProviderDescriptor {
  provider: string;
  product: string;
  model: string | null;
  logo: string | null;
  role: string;
  capabilities: string[];
  permissions: string[];
  functionGroup:
    | "AI_DEVELOPMENT_WORKERS"
    | "EXTERNAL_INTELLIGENCE"
    | "SOURCE_CONTROL"
    | "DEPLOYMENT_INFRASTRUCTURE"
    | "COMMUNICATION"
    | "OTHER";
}

// Slug/name substrings (lowercased) → known provider descriptor. Only
// used to *label* a real, already-registered/available entry — never to
// invent one that doesn't exist in the DB/registry.
export const KNOWN_PROVIDER_DESCRIPTORS: Record<string, ProviderDescriptor> = {
  github: {
    provider: "github",
    product: "GitHub",
    model: null,
    logo: findTool("github")?.logo ?? null,
    role: "Source Control",
    capabilities: ["repository", "branch", "commit", "pull_request", "workflow_run"],
    permissions: ["read:repository", "read:pull_request", "read:workflow_run"],
    functionGroup: "SOURCE_CONTROL",
  },
  vercel: {
    provider: "vercel",
    product: "Vercel",
    model: null,
    logo: findTool("vercel")?.logo ?? null,
    role: "Deployment / Infrastructure",
    capabilities: ["deployment"],
    permissions: ["read:deployment"],
    functionGroup: "DEPLOYMENT_INFRASTRUCTURE",
  },
  supabase: {
    provider: "supabase",
    product: "Supabase",
    model: null,
    logo: findTool("supabase")?.logo ?? null,
    role: "Deployment / Infrastructure",
    capabilities: ["health", "migration_state"],
    permissions: ["read:health", "read:migration_state"],
    functionGroup: "DEPLOYMENT_INFRASTRUCTURE",
  },
  line: {
    provider: "line",
    product: "LINE",
    model: null,
    logo: findTool("line")?.logo ?? null,
    role: "Communication",
    capabilities: ["messaging"],
    permissions: ["send:message"],
    functionGroup: "COMMUNICATION",
  },
  facebook: {
    provider: "facebook",
    product: "Meta Pages / Messenger",
    model: null,
    logo: findTool("facebook")?.logo ?? null,
    role: "Business Page & Messaging",
    capabilities: ["message.received", "document.received", "interaction.received"],
    permissions: ["pages_show_list", "pages_manage_metadata", "pages_messaging"],
    functionGroup: "COMMUNICATION",
  },
  instagram: {
    provider: "instagram",
    product: "Instagram Messaging",
    model: null,
    logo: findTool("instagram")?.logo ?? null,
    role: "Business Messaging",
    capabilities: ["message.received", "document.received", "interaction.received"],
    permissions: ["instagram_business_manage_messages", "instagram_business_basic"],
    functionGroup: "COMMUNICATION",
  },
  meta: {
    provider: "meta",
    product: "Meta App Webhook",
    model: null,
    logo: findTool("facebook")?.logo ?? null,
    role: "Verified Inbound Gateway",
    capabilities: ["message.received", "document.received", "interaction.received"],
    permissions: ["app-level webhook signature verification"],
    functionGroup: "COMMUNICATION",
  },
  tiktok: {
    provider: "tiktok",
    product: "TikTok",
    model: null,
    logo: findTool("tiktok")?.logo ?? null,
    role: "Social Media",
    capabilities: ["profile", "video_list", "stats"],
    permissions: ["read:profile", "read:video_list", "read:stats"],
    functionGroup: "OTHER",
  },
  // TASK-081 (2026-08-11) — mirrors the tiktok entry above in shape. Real
  // AI Code Worker provider (app/api/admin/ide/_lib/workerAdapters/
  // digitalOceanWorkerAdapter.ts, registered in WORKER_ADAPTER_REGISTRY as
  // "digitalocean-api"), unlike TikTok — functionGroup is
  // AI_DEVELOPMENT_WORKERS here, not "OTHER". No real DigitalOcean logo
  // entry exists yet in plugins/capabilities.ts (checked, not guessed) —
  // logo is honestly null, never a fabricated URL. capabilities mirrors
  // exactly what digitalOceanApiAdapter.capabilities() itself declares.
  digitalocean: {
    provider: "digitalocean",
    product: "DigitalOcean",
    model: null,
    logo: findTool("digitalocean")?.logo ?? null,
    role: "AI Code Worker",
    capabilities: ["code.generate"],
    permissions: ["scoped read", "scoped write (owner-approved only)"],
    functionGroup: "AI_DEVELOPMENT_WORKERS",
  },
};

// AI / Code Worker adapters (app/api/admin/ide/_lib/workerAdapters) —
// role/capabilities text only; model comes from the adapter's own real
// code (kept in sync manually — see EXTERNAL_CAPABILITY_CONTROL_REPORT
// for the cross-check against source).
export const AI_WORKER_DESCRIPTORS: Record<string, ProviderDescriptor> = {
  "anthropic-api": {
    provider: "anthropic",
    product: "Claude",
    model: "claude-haiku-4-5-20251001",
    logo: findTool("claude")?.logo ?? null,
    role: "Code Worker",
    capabilities: ["code generation", "code review", "informational answer"],
    permissions: ["scoped read", "scoped write (owner-approved only)"],
    functionGroup: "AI_DEVELOPMENT_WORKERS",
  },
  "claude-cli": {
    provider: "anthropic",
    product: "Claude Code (CLI)",
    model: null,
    logo: findTool("claude")?.logo ?? null,
    role: "Code Worker",
    capabilities: ["code generation", "code review", "informational answer"],
    permissions: ["scoped read", "scoped write (owner-approved only)"],
    functionGroup: "AI_DEVELOPMENT_WORKERS",
  },
  "openai-api": {
    provider: "openai",
    product: "Codex / OpenAI",
    model: null,
    logo: null,
    role: "Code Worker",
    capabilities: ["code generation", "code review"],
    permissions: ["scoped read", "scoped write (owner-approved only)"],
    functionGroup: "AI_DEVELOPMENT_WORKERS",
  },
  "gemini-api": {
    provider: "google",
    product: "Gemini",
    model: null,
    logo: findTool("gemini")?.logo ?? null,
    role: "UI / Code Worker",
    capabilities: ["code generation", "UI generation"],
    permissions: ["scoped read", "scoped write (owner-approved only)"],
    functionGroup: "AI_DEVELOPMENT_WORKERS",
  },
};

export function describeConnectorSlug(slug: string, name: string): ProviderDescriptor | null {
  const key = `${slug} ${name}`.toLowerCase();
  for (const [needle, descriptor] of Object.entries(KNOWN_PROVIDER_DESCRIPTORS)) {
    if (key.includes(needle)) return descriptor;
  }
  return null;
}
