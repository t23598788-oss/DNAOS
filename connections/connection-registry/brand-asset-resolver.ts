/**
 * Resolve provider brand assets for Connection Center / cards / rows.
 * One provider_id → one canonical brand_asset_ref.
 * Never returns remote hotlinks for production render.
 * Never embeds base64 logos.
 * Never substitutes the DNA OS D master mark for an external provider.
 * Does not touch auth, credentials, scopes, or MCP governance.
 */

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DNA_OS_MASTER_BRAND_ASSET_REF,
  GENERIC_INTEGRATION_BRAND_ASSET_REF,
  brandProviderIdForService,
  providerMetadataFor,
  type BrandAssetSize,
  type BrandAssetState,
  type BrandAssetVariant,
  type ProviderMetadata,
} from "./provider-metadata";

const HERE = dirname(fileURLToPath(import.meta.url));
const ASSET_ROOT = join(HERE, "brand-assets");

export interface ResolvedProviderBrandAsset {
  readonly provider_id: string;
  readonly display_name: string;
  readonly parent_provider_id: string | null;
  readonly hierarchy: ProviderMetadata["hierarchy"];
  readonly asset_state: BrandAssetState;
  readonly brand_asset_ref: string;
  /** Relative filesystem path under brand-assets/, or null when using logical asset:// ref only. */
  readonly local_relative_path: string | null;
  readonly local_file_exists: boolean;
  readonly official_brand_source_ref: string | null;
  readonly asset_variant: BrandAssetVariant;
  readonly background_requirement: ProviderMetadata["background_requirement"];
  readonly size_hints: readonly BrandAssetSize[];
  readonly remote_render_url: null; // production UI must never hotlink
  readonly fallback_used: boolean;
  readonly diagnostics: string | null;
}

function assetRefToRelative(ref: string): string | null {
  const prefix = "asset://provider-brand/";
  if (!ref.startsWith(prefix)) return null;
  return ref.slice(prefix.length);
}

function fileExistsForRef(ref: string): boolean {
  const rel = assetRefToRelative(ref);
  if (!rel) return false;
  return existsSync(join(ASSET_ROOT, rel));
}

function isDnaOsMasterMark(ref: string): boolean {
  return ref === DNA_OS_MASTER_BRAND_ASSET_REF || ref.includes("/dna-os/dna-os-mark");
}

function resolveVariant(
  meta: ProviderMetadata,
  preferred: BrandAssetVariant | null,
): { variant: BrandAssetVariant; note: string | null } {
  if (!preferred || preferred === meta.asset_variant) {
    return { variant: meta.asset_variant, note: null };
  }
  if (meta.background_requirement === "NEUTRAL_CONTAINER") {
    return {
      variant: meta.asset_variant,
      note: `No official ${preferred} variant; keep FULL_COLOR on NEUTRAL_CONTAINER`,
    };
  }
  return {
    variant: meta.asset_variant,
    note: `Requested ${preferred} but only ${meta.asset_variant} declared — do not auto-recolor`,
  };
}

export function resolveProviderBrandAsset(
  providerIdOrService: string,
  options?: { preferred_variant?: BrandAssetVariant | null },
): ResolvedProviderBrandAsset {
  const mapped = brandProviderIdForService(providerIdOrService) ?? providerIdOrService;
  const meta = providerMetadataFor(mapped);

  if (!meta) {
    const rel = assetRefToRelative(GENERIC_INTEGRATION_BRAND_ASSET_REF);
    return {
      provider_id: mapped,
      display_name: mapped,
      parent_provider_id: null,
      hierarchy: "DNA_OS_INTERNAL_CAPABILITY",
      asset_state: "MISSING_OFFICIAL_ASSET",
      brand_asset_ref: GENERIC_INTEGRATION_BRAND_ASSET_REF,
      local_relative_path: rel,
      local_file_exists: fileExistsForRef(GENERIC_INTEGRATION_BRAND_ASSET_REF),
      official_brand_source_ref: null,
      asset_variant: "MONOCHROME",
      background_requirement: "ANY",
      size_hints: ["COMPACT", "STANDARD", "LARGE"],
      remote_render_url: null,
      fallback_used: true,
      diagnostics: `ASSET_STATE=MISSING_OFFICIAL_ASSET unknown provider_id=${mapped}; generic only (never DNA OS D)`,
    };
  }

  const variant = resolveVariant(meta, options?.preferred_variant ?? null);

  // Master brand: DNA OS D for shell/header/nav only.
  if (meta.hierarchy === "DNA_OS_MASTER_BRAND") {
    const ref = meta.official_brand_asset_ref ?? DNA_OS_MASTER_BRAND_ASSET_REF;
    const ok = meta.asset_state === "READY" && fileExistsForRef(ref);
    return {
      provider_id: meta.provider_id,
      display_name: meta.display_name,
      parent_provider_id: meta.parent_provider_id,
      hierarchy: meta.hierarchy,
      asset_state: ok ? "READY" : "MISSING_OFFICIAL_ASSET",
      brand_asset_ref: ok ? ref : GENERIC_INTEGRATION_BRAND_ASSET_REF,
      local_relative_path: assetRefToRelative(ok ? ref : GENERIC_INTEGRATION_BRAND_ASSET_REF),
      local_file_exists: fileExistsForRef(ok ? ref : GENERIC_INTEGRATION_BRAND_ASSET_REF),
      official_brand_source_ref: meta.official_brand_source_ref,
      asset_variant: variant.variant,
      background_requirement: meta.background_requirement,
      size_hints: ["COMPACT", "STANDARD", "LARGE"],
      remote_render_url: null,
      fallback_used: !ok,
      diagnostics: ok ? variant.note : "DNA OS master mark file missing",
    };
  }

  // External providers: official mark, else neutral generic — NEVER DNA OS D.
  if (meta.hierarchy === "EXTERNAL_PROVIDER") {
    const candidate = meta.asset_state === "READY" && meta.official_brand_asset_ref
      ? meta.official_brand_asset_ref
      : null;
    const officialOk = candidate !== null && fileExistsForRef(candidate) && !isDnaOsMasterMark(candidate);
    const finalRef = officialOk ? candidate! : GENERIC_INTEGRATION_BRAND_ASSET_REF;
    return {
      provider_id: meta.provider_id,
      display_name: meta.display_name,
      parent_provider_id: meta.parent_provider_id,
      hierarchy: meta.hierarchy,
      asset_state: officialOk
        ? "READY"
        : (meta.asset_state === "REVIEW_REQUIRED" ? "REVIEW_REQUIRED" : "MISSING_OFFICIAL_ASSET"),
      brand_asset_ref: finalRef,
      local_relative_path: assetRefToRelative(finalRef),
      local_file_exists: fileExistsForRef(finalRef),
      official_brand_source_ref: meta.official_brand_source_ref,
      asset_variant: variant.variant,
      background_requirement: meta.background_requirement,
      size_hints: ["COMPACT", "STANDARD", "LARGE"],
      remote_render_url: null,
      fallback_used: !officialOk,
      diagnostics: officialOk
        ? variant.note
        : `ASSET_STATE=${meta.asset_state}; provider card uses generic (never DNA OS D); import from ${meta.official_brand_source_ref ?? "n/a"}${variant.note ? `; ${variant.note}` : ""}`,
    };
  }

  // Internal DNA OS capabilities: neutral capability iconography (generic), not master D unless explicit.
  const internalRef = meta.official_brand_asset_ref ?? GENERIC_INTEGRATION_BRAND_ASSET_REF;
  const safeRef = isDnaOsMasterMark(internalRef) ? GENERIC_INTEGRATION_BRAND_ASSET_REF : internalRef;
  return {
    provider_id: meta.provider_id,
    display_name: meta.display_name,
    parent_provider_id: meta.parent_provider_id,
    hierarchy: meta.hierarchy,
    asset_state: fileExistsForRef(safeRef) ? "READY" : "MISSING_OFFICIAL_ASSET",
    brand_asset_ref: safeRef,
    local_relative_path: assetRefToRelative(safeRef),
    local_file_exists: fileExistsForRef(safeRef),
    official_brand_source_ref: meta.official_brand_source_ref,
    asset_variant: variant.variant,
    background_requirement: meta.background_requirement,
    size_hints: ["COMPACT", "STANDARD", "LARGE"],
    remote_render_url: null,
    fallback_used: safeRef === GENERIC_INTEGRATION_BRAND_ASSET_REF,
    diagnostics: variant.note,
  };
}

/** Convenience aliases used by ConnectionCard / ToolCard / CapabilityRow. */
export function resolveConnectionBrand(providerId: string): ResolvedProviderBrandAsset {
  return resolveProviderBrandAsset(providerId);
}

export function resolveToolBrand(providerId: string): ResolvedProviderBrandAsset {
  return resolveProviderBrandAsset(providerId);
}

export function resolveCapabilityBrand(providerIdOrService: string): ResolvedProviderBrandAsset {
  return resolveProviderBrandAsset(providerIdOrService);
}
