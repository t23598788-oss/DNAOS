/**
 * Provider presentation + brand-asset metadata owned by the connection layer.
 * This is not provider state and is not a second provider registry: identity,
 * connection state, credentials, and availability remain in their existing
 * registries. Consumers must only use an entry when the provider identity was
 * resolved by an existing connection declaration / binding.
 *
 * Brand rules (Owner 2026-09-09):
 * - DNA OS D / wordmark → DNA OS–owned surfaces only (shell, header, nav, system identity).
 * - External services → official provider marks only (never the DNA OS D).
 * - Unknown / missing approved official asset → neutral generic integration icon
 *   (geometric), NEVER the DNA OS D as a substitute for Google/Gmail/Drive/
 *   Supabase/GitHub/Railway/LINE/Meta/Instagram/TikTok/etc.
 * - No logo redesign, no AI-generated provider logos, no unofficial scraping.
 * - Production UI resolves via official_brand_asset_ref (local) — never hotlink.
 */

export type BrandIconSource =
  | "local-official"
  | "local-generic-fallback"
  | "simple-icons-legacy" // provenance only — not for production render
  | "missing-official";

export type BrandAssetState = "READY" | "MISSING_OFFICIAL_ASSET" | "REVIEW_REQUIRED";

export type BrandAssetVariant = "FULL_COLOR" | "LIGHT_BACKGROUND" | "DARK_BACKGROUND" | "MONOCHROME";

export type BrandAssetSize = "COMPACT" | "STANDARD" | "LARGE";

export type BrandAssetHierarchy =
  | "EXTERNAL_PROVIDER"
  | "DNA_OS_INTERNAL_CAPABILITY"
  | "DNA_OS_MASTER_BRAND";

export interface ProviderMetadata {
  readonly provider_id: string;
  readonly display_name: string;
  readonly brand_slug: string;
  /** @deprecated Hotlink retained for legacy consumers only — do not use for production UI. */
  readonly brand_icon_url: string;
  readonly brand_icon_source: BrandIconSource;
  readonly source: "connection-provider-metadata";
  readonly hierarchy: BrandAssetHierarchy;
  readonly parent_provider_id: string | null;
  readonly official_brand_asset_ref: string | null;
  readonly official_brand_source_ref: string | null;
  readonly asset_variant: BrandAssetVariant;
  readonly background_requirement: "ANY" | "LIGHT" | "DARK" | "NEUTRAL_CONTAINER";
  readonly compact_icon_ref: string | null;
  readonly wordmark_ref: string | null;
  readonly usage_notes: string;
  readonly trademark_notice_ref: string | null;
  readonly asset_state: BrandAssetState;
  readonly last_verified_at: string | null;
}

const GENERIC_ASSET = "asset://provider-brand/generic/dna-os-integration-generic.svg" as const;
const GENERIC_SOURCE = "connections/connection-registry/brand-assets/generic/PROVENANCE.md" as const;
/** DNA OS master mark — shell/header/nav only. Never a provider-card fallback. */
export const DNA_OS_MASTER_BRAND_ASSET_REF = "asset://provider-brand/dna-os/dna-os-mark-d.png" as const;
const DNA_OS_MASTER_SOURCE = "connections/connection-registry/brand-assets/dna-os/PROVENANCE.md" as const;

function external(partial: {
  provider_id: string;
  display_name: string;
  brand_slug: string;
  parent_provider_id?: string | null;
  official_brand_source_ref: string | null;
  trademark_notice_ref?: string | null;
  usage_notes?: string;
  legacy_hotlink?: string;
  asset_state?: BrandAssetState;
  official_brand_asset_ref?: string | null;
}): ProviderMetadata {
  const missing = partial.asset_state !== "READY";
  return {
    provider_id: partial.provider_id,
    display_name: partial.display_name,
    brand_slug: partial.brand_slug,
    brand_icon_url: partial.legacy_hotlink ?? `https://cdn.simpleicons.org/${partial.brand_slug}`,
    brand_icon_source: missing ? "missing-official" : "local-official",
    source: "connection-provider-metadata",
    hierarchy: "EXTERNAL_PROVIDER",
    parent_provider_id: partial.parent_provider_id ?? null,
    official_brand_asset_ref: missing ? null : (partial.official_brand_asset_ref ?? null),
    official_brand_source_ref: partial.official_brand_source_ref,
    asset_variant: "FULL_COLOR",
    background_requirement: missing ? "NEUTRAL_CONTAINER" : "ANY",
    compact_icon_ref: missing ? null : (partial.official_brand_asset_ref ?? null),
    wordmark_ref: null,
    usage_notes: partial.usage_notes
      ?? (missing
        ? "Official mark not yet imported. Connection cards must use the neutral generic integration icon — NEVER the DNA OS D mark — until Owner imports from official_brand_source_ref."
        : "Use unmodified official mark on connection/integration cards; do not recolor or alter proportions. Never substitute the DNA OS D."),
    trademark_notice_ref: partial.trademark_notice_ref ?? partial.official_brand_source_ref,
    asset_state: partial.asset_state ?? "MISSING_OFFICIAL_ASSET",
    last_verified_at: null,
  };
}

function internal(provider_id: string, display_name: string, brand_slug: string): ProviderMetadata {
  return {
    provider_id,
    display_name,
    brand_slug,
    brand_icon_url: "",
    brand_icon_source: "local-generic-fallback",
    source: "connection-provider-metadata",
    hierarchy: "DNA_OS_INTERNAL_CAPABILITY",
    parent_provider_id: null,
    official_brand_asset_ref: GENERIC_ASSET,
    official_brand_source_ref: GENERIC_SOURCE,
    asset_variant: "MONOCHROME",
    background_requirement: "ANY",
    compact_icon_ref: GENERIC_ASSET,
    wordmark_ref: null,
    usage_notes: "DNA OS internal capability iconography (neutral). Never impersonate an external provider mark. Do not use the DNA OS D master logo here unless this is explicitly a system-identity surface.",
    trademark_notice_ref: null,
    asset_state: "READY",
    last_verified_at: "2026-09-09",
  };
}

const PROVIDER_METADATA: Readonly<Record<string, ProviderMetadata>> = {
  // --- DNA OS master brand (app shell / header / system identity only) ---
  "dna-os": {
    provider_id: "dna-os",
    display_name: "DNA OS",
    brand_slug: "dna-os",
    brand_icon_url: "",
    brand_icon_source: "local-official",
    source: "connection-provider-metadata",
    hierarchy: "DNA_OS_MASTER_BRAND",
    parent_provider_id: null,
    official_brand_asset_ref: DNA_OS_MASTER_BRAND_ASSET_REF,
    official_brand_source_ref: DNA_OS_MASTER_SOURCE,
    asset_variant: "FULL_COLOR",
    background_requirement: "LIGHT",
    compact_icon_ref: DNA_OS_MASTER_BRAND_ASSET_REF,
    wordmark_ref: DNA_OS_MASTER_BRAND_ASSET_REF,
    usage_notes:
      "DNA OS D + wordmark for app shell, header, system navigation, owner/system identity only. FORBIDDEN as substitute for any external provider card (Google, Gmail, Drive, Supabase, GitHub, Railway, LINE, Meta, Instagram, TikTok, …).",
    trademark_notice_ref: DNA_OS_MASTER_SOURCE,
    asset_state: "READY",
    last_verified_at: "2026-09-09",
  },

  // --- already-identified connection providers (brand slots; connectors not built here) ---
  github: external({
    provider_id: "github",
    display_name: "GitHub",
    brand_slug: "github",
    official_brand_source_ref: "https://github.com/logos",
    trademark_notice_ref: "https://github.com/logos",
    usage_notes: "Import Octocat/mark from GitHub Logos only after Owner review of GitHub logo guidelines.",
    asset_state: "REVIEW_REQUIRED",
  }),
  digitalocean: external({
    provider_id: "digitalocean",
    display_name: "DigitalOcean",
    brand_slug: "digitalocean",
    official_brand_source_ref: "https://www.digitalocean.com/brand",
    asset_state: "REVIEW_REQUIRED",
  }),
  supabase: external({
    provider_id: "supabase",
    display_name: "Supabase",
    brand_slug: "supabase",
    official_brand_source_ref: "https://supabase.com/brand-assets",
    trademark_notice_ref: "https://supabase.com/brand-assets",
    usage_notes: "Import from Supabase brand assets; do not alter the mark. Brand-only — connection behavior unchanged.",
    asset_state: "REVIEW_REQUIRED",
  }),
  google: external({
    provider_id: "google",
    display_name: "Google Workspace",
    brand_slug: "google",
    official_brand_source_ref: "https://about.google/brand-resource-center/",
    trademark_notice_ref: "https://about.google/brand-resource-center/",
    usage_notes: "Parent Workspace family mark. Child services use distinct product icons — do not reuse the G mark for Gmail/Calendar/Drive/Sheets.",
    asset_state: "MISSING_OFFICIAL_ASSET",
  }),
  "google-gmail": external({
    provider_id: "google-gmail",
    display_name: "Gmail",
    brand_slug: "gmail",
    parent_provider_id: "google",
    official_brand_source_ref: "https://knowledge.workspace.google.com/admin/getting-started/brand-your-internal-communications-with-google-workspace",
    trademark_notice_ref: "https://about.google/brand-resource-center/",
    usage_notes: "Official Gmail product icon only. Do not use generic Google G for this child.",
    asset_state: "MISSING_OFFICIAL_ASSET",
  }),
  "google-calendar": external({
    provider_id: "google-calendar",
    display_name: "Google Calendar",
    brand_slug: "googlecalendar",
    parent_provider_id: "google",
    official_brand_source_ref: "https://knowledge.workspace.google.com/admin/getting-started/brand-your-internal-communications-with-google-workspace",
    trademark_notice_ref: "https://about.google/brand-resource-center/",
    usage_notes: "Official Calendar product icon only.",
    asset_state: "MISSING_OFFICIAL_ASSET",
  }),
  "google-drive": external({
    provider_id: "google-drive",
    display_name: "Google Drive",
    brand_slug: "googledrive",
    parent_provider_id: "google",
    official_brand_source_ref: "https://developers.google.com/workspace/drive/api/guides/branding",
    trademark_notice_ref: "https://developers.google.com/workspace/drive/api/guides/branding",
    usage_notes: "Drive branding guidance: do not alter the Drive logo.",
    asset_state: "MISSING_OFFICIAL_ASSET",
  }),
  "google-sheets": external({
    provider_id: "google-sheets",
    display_name: "Google Sheets",
    brand_slug: "googlesheets",
    parent_provider_id: "google",
    official_brand_source_ref: "https://knowledge.workspace.google.com/admin/getting-started/brand-your-internal-communications-with-google-workspace",
    trademark_notice_ref: "https://about.google/brand-resource-center/",
    usage_notes: "Official Sheets product icon only.",
    asset_state: "MISSING_OFFICIAL_ASSET",
  }),
  vercel: external({
    provider_id: "vercel",
    display_name: "Vercel",
    brand_slug: "vercel",
    official_brand_source_ref: "https://vercel.com/design/brands",
    asset_state: "MISSING_OFFICIAL_ASSET",
  }),
  railway: external({
    provider_id: "railway",
    display_name: "Railway",
    brand_slug: "railway",
    official_brand_source_ref: "https://railway.com/brand",
    asset_state: "MISSING_OFFICIAL_ASSET",
  }),
  n8n: external({
    provider_id: "n8n",
    display_name: "n8n",
    brand_slug: "n8n",
    official_brand_source_ref: "https://n8n.io/branding/",
    asset_state: "MISSING_OFFICIAL_ASSET",
  }),
  line: external({
    provider_id: "line",
    display_name: "LINE",
    brand_slug: "line",
    official_brand_source_ref: "https://line.me/en/logo",
    asset_state: "MISSING_OFFICIAL_ASSET",
  }),
  facebook: external({
    provider_id: "facebook",
    display_name: "Facebook",
    brand_slug: "facebook",
    parent_provider_id: "meta",
    official_brand_source_ref: "https://about.meta.com/brand/resources/facebook/logo/",
    asset_state: "MISSING_OFFICIAL_ASSET",
  }),
  meta: external({
    provider_id: "meta",
    display_name: "Meta",
    brand_slug: "meta",
    official_brand_source_ref: "https://about.meta.com/brand/resources/",
    asset_state: "MISSING_OFFICIAL_ASSET",
  }),
  instagram: external({
    provider_id: "instagram",
    display_name: "Instagram",
    brand_slug: "instagram",
    parent_provider_id: "meta",
    official_brand_source_ref: "https://about.meta.com/brand/resources/instagram/instagram-brand/",
    asset_state: "MISSING_OFFICIAL_ASSET",
  }),
  tiktok: external({
    provider_id: "tiktok",
    display_name: "TikTok",
    brand_slug: "tiktok",
    official_brand_source_ref: "https://www.tiktok.com/legal/page/global/brand-resources/en",
    asset_state: "MISSING_OFFICIAL_ASSET",
  }),
  gemini: external({
    provider_id: "gemini",
    display_name: "Gemini",
    brand_slug: "googlegemini",
    parent_provider_id: "google",
    official_brand_source_ref: "https://about.google/brand-resource-center/",
    asset_state: "MISSING_OFFICIAL_ASSET",
  }),
  chatgpt: external({
    provider_id: "chatgpt",
    display_name: "ChatGPT",
    brand_slug: "openai",
    official_brand_source_ref: "https://openai.com/brand/",
    asset_state: "MISSING_OFFICIAL_ASSET",
  }),
  vscode: external({
    provider_id: "vscode",
    display_name: "VS Code",
    brand_slug: "visualstudiocode",
    official_brand_source_ref: "https://code.visualstudio.com/brand",
    asset_state: "MISSING_OFFICIAL_ASSET",
  }),

  // --- DNA OS / local capability iconography (not external brands) ---
  calculator: internal("calculator", "Calculator", "calculator"),
  files: internal("files", "Files", "files"),
  pdf: internal("pdf", "PDF", "pdf"),
  printer: internal("printer", "Printer", "printer"),
  computer: internal("computer", "Computer", "computer"),
  server: internal("server", "Server", "server"),
};

/** Neutral DNA OS integration mark used when official provider asset is missing. */
export const GENERIC_INTEGRATION_BRAND_ASSET_REF = GENERIC_ASSET;

export function providerMetadataFor(providerId: string): ProviderMetadata | null {
  return PROVIDER_METADATA[providerId] ?? null;
}

export function listProviderMetadata(): readonly ProviderMetadata[] {
  return Object.values(PROVIDER_METADATA);
}

/** Map remote-service provider / service_id fragments to brand provider_id. */
export function brandProviderIdForService(serviceIdOrProvider: string): string | null {
  const s = serviceIdOrProvider.toLowerCase();
  if (s.includes("gmail")) return "google-gmail";
  if (s.includes("calendar")) return "google-calendar";
  if (s.includes("drive")) return "google-drive";
  if (s.includes("sheets") || s.includes("spreadsheet")) return "google-sheets";
  if (s === "google" || s.includes("google/workspace") || s.includes("google_workspace")) return "google";
  if (s.includes("supabase") || s.includes("database-schema") || s.includes("database/schema")) return "supabase";
  if (s.includes("github")) return "github";
  if (s.includes("vercel")) return "vercel";
  if (s.includes("railway")) return "railway";
  if (s.includes("n8n")) return "n8n";
  if (s.includes("line")) return "line";
  if (s.includes("instagram")) return "instagram";
  if (s.includes("facebook")) return "facebook";
  if (s.includes("tiktok")) return "tiktok";
  if (s.includes("gemini")) return "gemini";
  if (s.includes("chatgpt") || s.includes("openai")) return "chatgpt";
  if (s.includes("vscode") || s.includes("visualstudio")) return "vscode";
  const direct = providerMetadataFor(serviceIdOrProvider);
  return direct ? direct.provider_id : null;
}
