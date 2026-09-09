# Provider brand assets (local)

Production UI resolves icons via `connections/connection-registry/brand-asset-resolver.ts`.

## Hierarchy

| Kind | Asset | Where it appears |
|---|---|---|
| `DNA_OS_MASTER_BRAND` | `dna-os/dna-os-mark-d.png` | App shell, header, system navigation, owner/system identity |
| `EXTERNAL_PROVIDER` | Official provider mark (when imported) | Connection cards, integration rows, provider selectors, provider-specific capability rows |
| Missing official / unknown | `generic/dna-os-integration-generic.svg` | Temporary placeholder on provider cards only |

**Never** use the DNA OS D mark as a substitute for Google, Gmail, Drive, Supabase, GitHub, Railway, LINE, Meta, Instagram, TikTok, or any other external provider.

## Rules

1. Official provider marks must be imported from the provider's brand resource center (Owner-approved).
2. Do **not** hotlink remote CDNs for production render.
3. Do **not** download from random icon sites, scrape unofficial logos, or AI-generate provider marks.
4. Until an official file is present, resolver returns `MISSING_OFFICIAL_ASSET` and the **neutral generic** SVG — not the DNA OS D.
5. Google Workspace children (Gmail / Calendar / Drive / Sheets) must each have distinct product icons — never reuse the parent Google G for all four.
6. Pattern for provider cards: `[official provider icon] Provider Name`.

## Import checklist (Owner)

For each provider with `asset_state: MISSING_OFFICIAL_ASSET` or `REVIEW_REQUIRED`:

1. Open `official_brand_source_ref` from `provider-metadata.ts`
2. Accept provider terms / guidelines
3. Place unmodified SVG (preferred) under `brand-assets/<provider_id>/`
4. Set `official_brand_asset_ref` + `asset_state: READY` + `last_verified_at`
5. Record ASSET_HASH in a sibling `PROVENANCE.md`

## Google Workspace sources (do not alter marks)

- Brand Resource Center: https://about.google/brand-resource-center/
- Workspace internal brand ZIP (Admin Help): https://knowledge.workspace.google.com/admin/getting-started/brand-your-internal-communications-with-google-workspace
- Drive brand guide (do not alter Drive logo): https://developers.google.com/workspace/drive/api/guides/branding

`BRAND_ASSET_REVIEW_REQUIRED = true` until Owner imports these files.
