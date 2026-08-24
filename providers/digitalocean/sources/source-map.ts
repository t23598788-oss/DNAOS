/**
 * หน้าที่: the real, static DigitalOcean SOURCE POINTER rows — using the
 * GENERIC `../../_shared/source-registry/types.ts` schema (Owner
 * correction 2026-08-22), not the older Hostinger-specific shape. Every
 * `official_location` here was directly verified against an official
 * DigitalOcean/GitHub domain during the prior Discovery round (2026-08-22
 * report, delivered to Owner). Pointers only — no price/product/tool-list
 * VALUE is embedded anywhere in this file; those live only in the
 * transient Current State `../../_shared/source-registry/current-state.ts`
 * resolves at read time.
 *
 * Input: none.
 * Output: `DIGITALOCEAN_SOURCE_POINTERS`.
 * Dependency ที่อนุญาต: ../../_shared/source-registry/types.ts.
 * สิ่งที่ห้ามแตะ: never add an entry whose official_location was not
 * directly verified against an official DigitalOcean or GitHub domain.
 */

import type { SourcePointer } from "../../_shared/source-registry/types";

const PROVIDER = "digitalocean";

function feed(state: string): SourcePointer["feeds"] {
  return [{ feeds_into: state, relationship_kind: "CURRENT_STATE_INPUT" }];
}
function providerRel(): SourcePointer["relationships"] {
  return [{ to_type: "PROVIDER", to_id: PROVIDER, relationship_kind: "SOURCE_OF" }];
}

export const DIGITALOCEAN_SOURCE_POINTERS: readonly SourcePointer[] = [
  {
    provider_id: PROVIDER, source_id: "digitalocean_openapi_spec", source_type: "API_SPEC",
    official_location: "https://raw.githubusercontent.com/digitalocean/openapi/main/specification/DigitalOcean-public.v2.yaml",
    access_method: "REPOSITORY", authority: "OFFICIAL", freshness_mode: "CONTRACT_DIFF", verification_method: "CONTRACT_SCHEMA_DIFF",
    feeds: feed("digitalocean.api.contract_state"), relationships: [...providerRel(), { to_type: "SERVICE", to_id: "digitalocean.api", relationship_kind: "DEFINES_CONTRACT_OF" }],
    last_checked_at: null, current_state_reference: "digitalocean.api.contract_state",
  },
  {
    provider_id: PROVIDER, source_id: "digitalocean_mcp_repository", source_type: "REPOSITORY",
    official_location: "https://raw.githubusercontent.com/digitalocean-labs/mcp-digitalocean/main/README.md",
    access_method: "REPOSITORY", authority: "OFFICIAL", freshness_mode: "POLL", verification_method: "SHA256_FINGERPRINT",
    feeds: feed("digitalocean.mcp.capability_state"), relationships: [...providerRel(), { to_type: "MCP_SERVER", to_id: "digitalocean.mcp_server", relationship_kind: "DOCUMENTS" }],
    last_checked_at: null, current_state_reference: "digitalocean.mcp.capability_state",
  },
  {
    provider_id: PROVIDER, source_id: "digitalocean_mcp_announcement", source_type: "DOCUMENTATION",
    official_location: "https://www.digitalocean.com/blog/mcp-server-public-release",
    access_method: "WEB", authority: "OFFICIAL", freshness_mode: "POLL", verification_method: "SHA256_FINGERPRINT",
    feeds: feed("digitalocean.mcp.capability_state"), relationships: [...providerRel(), { to_type: "MCP_SERVER", to_id: "digitalocean.mcp_server", relationship_kind: "ANNOUNCES" }],
    last_checked_at: null, current_state_reference: "digitalocean.mcp.capability_state",
  },
  {
    provider_id: PROVIDER, source_id: "digitalocean_doctl_releases", source_type: "REPOSITORY",
    official_location: "https://github.com/digitalocean/doctl/releases",
    access_method: "REPOSITORY", authority: "OFFICIAL", freshness_mode: "POLL", verification_method: "SHA256_FINGERPRINT",
    feeds: feed("digitalocean.cli.capability_state"), relationships: [...providerRel(), { to_type: "SERVICE", to_id: "digitalocean.cli", relationship_kind: "DOCUMENTS" }],
    last_checked_at: null, current_state_reference: "digitalocean.cli.capability_state",
  },
  {
    provider_id: PROVIDER, source_id: "digitalocean_api_rate_limits_doc", source_type: "DOCUMENTATION",
    official_location: "https://docs.digitalocean.com/reference/api/reference/public-apis/",
    access_method: "WEB", authority: "OFFICIAL", freshness_mode: "POLL", verification_method: "SHA256_FINGERPRINT",
    feeds: feed("digitalocean.api.rate_limit_state"), relationships: [...providerRel(), { to_type: "SERVICE", to_id: "digitalocean.api", relationship_kind: "DOCUMENTS" }],
    last_checked_at: null, current_state_reference: "digitalocean.api.rate_limit_state",
  },
  {
    provider_id: PROVIDER, source_id: "digitalocean_oauth_doc", source_type: "DOCUMENTATION",
    official_location: "https://docs.digitalocean.com/reference/api/oauth/",
    access_method: "WEB", authority: "OFFICIAL", freshness_mode: "POLL", verification_method: "SHA256_FINGERPRINT",
    feeds: feed("digitalocean.api.auth_state"), relationships: [...providerRel(), { to_type: "SERVICE", to_id: "digitalocean.api", relationship_kind: "DOCUMENTS" }],
    last_checked_at: null, current_state_reference: "digitalocean.api.auth_state",
  },
  {
    provider_id: PROVIDER, source_id: "digitalocean_scopes_doc", source_type: "DOCUMENTATION",
    official_location: "https://docs.digitalocean.com/reference/api/scopes/",
    access_method: "WEB", authority: "OFFICIAL", freshness_mode: "POLL", verification_method: "SHA256_FINGERPRINT",
    feeds: feed("digitalocean.api.scope_state"), relationships: [...providerRel(), { to_type: "SERVICE", to_id: "digitalocean.api", relationship_kind: "DOCUMENTS" }],
    last_checked_at: null, current_state_reference: "digitalocean.api.scope_state",
  },
  {
    provider_id: PROVIDER, source_id: "digitalocean_gpu_droplet_pricing", source_type: "PRODUCT_PAGE",
    official_location: "https://www.digitalocean.com/pricing/gpu-droplets",
    access_method: "WEB", authority: "OFFICIAL", freshness_mode: "POLL", verification_method: "SHA256_FINGERPRINT",
    feeds: feed("digitalocean.gpu_droplets.pricing_state"), relationships: [...providerRel(), { to_type: "SERVICE", to_id: "digitalocean.gpu_droplets", relationship_kind: "PRICES" }],
    last_checked_at: null, current_state_reference: "digitalocean.gpu_droplets.pricing_state",
  },
  {
    provider_id: PROVIDER, source_id: "digitalocean_droplet_pricing", source_type: "PRODUCT_PAGE",
    official_location: "https://www.digitalocean.com/pricing/droplets",
    access_method: "WEB", authority: "OFFICIAL", freshness_mode: "POLL", verification_method: "SHA256_FINGERPRINT",
    feeds: feed("digitalocean.droplets.pricing_state"), relationships: [...providerRel(), { to_type: "SERVICE", to_id: "digitalocean.droplets", relationship_kind: "PRICES" }],
    last_checked_at: null, current_state_reference: "digitalocean.droplets.pricing_state",
  },
  {
    provider_id: PROVIDER, source_id: "digitalocean_pricing_hub", source_type: "PRODUCT_PAGE",
    official_location: "https://www.digitalocean.com/pricing",
    access_method: "WEB", authority: "OFFICIAL", freshness_mode: "POLL", verification_method: "SHA256_FINGERPRINT",
    feeds: feed("digitalocean.pricing.overview_state"), relationships: [...providerRel()],
    last_checked_at: null, current_state_reference: "digitalocean.pricing.overview_state",
  },
  {
    provider_id: PROVIDER, source_id: "digitalocean_startups_program", source_type: "DOCUMENTATION",
    official_location: "https://www.digitalocean.com/startups",
    access_method: "WEB", authority: "OFFICIAL", freshness_mode: "POLL", verification_method: "SHA256_FINGERPRINT",
    feeds: feed("digitalocean.business_programs.startups_state"), relationships: [...providerRel()],
    last_checked_at: null, current_state_reference: "digitalocean.business_programs.startups_state",
  },
  {
    provider_id: PROVIDER, source_id: "digitalocean_referral_program", source_type: "DOCUMENTATION",
    official_location: "https://www.digitalocean.com/referral-program",
    access_method: "WEB", authority: "OFFICIAL", freshness_mode: "POLL", verification_method: "SHA256_FINGERPRINT",
    feeds: feed("digitalocean.business_programs.referral_state"), relationships: [...providerRel()],
    last_checked_at: null, current_state_reference: "digitalocean.business_programs.referral_state",
  },
  {
    provider_id: PROVIDER, source_id: "digitalocean_partner_pod", source_type: "DOCUMENTATION",
    official_location: "https://www.digitalocean.com/partners/pod",
    access_method: "WEB", authority: "OFFICIAL", freshness_mode: "POLL", verification_method: "SHA256_FINGERPRINT",
    feeds: feed("digitalocean.business_programs.partner_pod_state"), relationships: [...providerRel()],
    last_checked_at: null, current_state_reference: "digitalocean.business_programs.partner_pod_state",
  },
  {
    provider_id: PROVIDER, source_id: "digitalocean_marketplace_vendors", source_type: "DOCUMENTATION",
    official_location: "https://marketplace.digitalocean.com/vendors",
    access_method: "WEB", authority: "OFFICIAL", freshness_mode: "POLL", verification_method: "SHA256_FINGERPRINT",
    feeds: feed("digitalocean.marketplace.vendor_state"), relationships: [...providerRel(), { to_type: "SERVICE", to_id: "digitalocean.marketplace", relationship_kind: "DOCUMENTS" }],
    last_checked_at: null, current_state_reference: "digitalocean.marketplace.vendor_state",
  },
  {
    provider_id: PROVIDER, source_id: "digitalocean_status", source_type: "STATUS_FEED",
    official_location: "https://status.digitalocean.com/api/v2/summary.json",
    access_method: "STATUS_API", authority: "OFFICIAL", freshness_mode: "POLL", verification_method: "SHA256_FINGERPRINT",
    feeds: feed("digitalocean.status.incident_state"), relationships: [...providerRel()],
    last_checked_at: null, current_state_reference: "digitalocean.status.incident_state",
  },
  {
    provider_id: PROVIDER, source_id: "digitalocean_product_lifecycle", source_type: "DOCUMENTATION",
    official_location: "https://docs.digitalocean.com/platform/product-lifecycle/",
    access_method: "WEB", authority: "OFFICIAL", freshness_mode: "POLL", verification_method: "SHA256_FINGERPRINT",
    feeds: feed("digitalocean.deprecations.policy_state"), relationships: [...providerRel()],
    last_checked_at: null, current_state_reference: "digitalocean.deprecations.policy_state",
  },
  {
    provider_id: PROVIDER, source_id: "digitalocean_model_support_policy", source_type: "DOCUMENTATION",
    official_location: "https://docs.digitalocean.com/products/inference/details/model-support-policy/",
    access_method: "WEB", authority: "OFFICIAL", freshness_mode: "POLL", verification_method: "SHA256_FINGERPRINT",
    feeds: feed("digitalocean.genai.model_deprecation_state"), relationships: [...providerRel(), { to_type: "SERVICE", to_id: "digitalocean.genai_inference", relationship_kind: "DOCUMENTS" }],
    last_checked_at: null, current_state_reference: "digitalocean.genai.model_deprecation_state",
  },
  {
    provider_id: PROVIDER, source_id: "digitalocean_doks_changelog", source_type: "CHANGELOG",
    official_location: "https://docs.digitalocean.com/products/kubernetes/details/changelog/",
    access_method: "WEB", authority: "OFFICIAL", freshness_mode: "POLL", verification_method: "SHA256_FINGERPRINT",
    feeds: feed("digitalocean.kubernetes.changelog_state"), relationships: [...providerRel(), { to_type: "SERVICE", to_id: "digitalocean.kubernetes", relationship_kind: "DOCUMENTS" }],
    last_checked_at: null, current_state_reference: "digitalocean.kubernetes.changelog_state",
  },
  {
    provider_id: PROVIDER, source_id: "digitalocean_godo", source_type: "REPOSITORY",
    official_location: "https://github.com/digitalocean/godo",
    access_method: "REPOSITORY", authority: "OFFICIAL", freshness_mode: "POLL", verification_method: "SHA256_FINGERPRINT",
    feeds: feed("digitalocean.sdk.godo_state"), relationships: [...providerRel(), { to_type: "SERVICE", to_id: "digitalocean.sdk", relationship_kind: "IMPLEMENTS" }],
    last_checked_at: null, current_state_reference: "digitalocean.sdk.godo_state",
  },
  {
    provider_id: PROVIDER, source_id: "digitalocean_pydo", source_type: "REPOSITORY",
    official_location: "https://github.com/digitalocean/pydo",
    access_method: "REPOSITORY", authority: "OFFICIAL", freshness_mode: "POLL", verification_method: "SHA256_FINGERPRINT",
    feeds: feed("digitalocean.sdk.pydo_state"), relationships: [...providerRel(), { to_type: "SERVICE", to_id: "digitalocean.sdk", relationship_kind: "IMPLEMENTS" }],
    last_checked_at: null, current_state_reference: "digitalocean.sdk.pydo_state",
  },
  {
    provider_id: PROVIDER, source_id: "digitalocean_dots", source_type: "REPOSITORY",
    official_location: "https://github.com/digitalocean/dots",
    access_method: "REPOSITORY", authority: "OFFICIAL", freshness_mode: "POLL", verification_method: "SHA256_FINGERPRINT",
    feeds: feed("digitalocean.sdk.dots_state"), relationships: [...providerRel(), { to_type: "SERVICE", to_id: "digitalocean.sdk", relationship_kind: "IMPLEMENTS" }],
    last_checked_at: null, current_state_reference: "digitalocean.sdk.dots_state",
  },
] as const;
