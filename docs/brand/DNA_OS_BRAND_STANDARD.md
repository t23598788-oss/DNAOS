# DNA OS Brand Standard

**Version:** 1.0  
**Status:** Active for DNA OS owned surfaces  
**Reviewed:** 2026-11-23

This guide is the source of truth for DNA OS logo selection, sizing, placement, and provider marks in product UI. Keep the original artwork intact. Do not reconstruct a lockup by combining a cropped D mark with newly typed text.

## 1. DNA OS master logo

| Field | Standard |
|---|---|
| Canonical file | [`public/brand/dna-os-mark-d.png`](../../public/brand/dna-os-mark-d.png) |
| Exact SHA-256 | `e48d08e63e0deaf30fe24ae916a7e6843bfabac9965eed3de1cdb842c50e4c55` |
| Source | Owner-provided DNA OS master mark; original provenance is recorded in `DNA-OS-INFRASTRUCTURE/connections/connection-registry/brand-assets/dna-os/PROVENANCE.md`. |
| Canvas | 1024 × 1024 pixels. Visible artwork bounds: approximately x=167, y=383, width=692, height=244. |
| Composition | One multicolor D tile followed by the embedded “NA OS” wordmark. The artwork already spells DNA OS. |
| Approved surfaces | App shell, header, system navigation, owner/system identity, and explicitly DNA OS owned surfaces. |
| Excluded surfaces | Any card or label representing Apple, Google, Meta/Facebook, TikTok, LINE, or another outside provider. |

The file is byte-identical to the owner-provided source. Its filename ends in `.png`, while its current file signature is JPEG. Do not rename, re-encode, crop into a new file, or change its bytes without an owner-approved asset update. The web components use a centered `object-fit: cover` viewport only to trim the source canvas padding; the artwork itself remains unchanged.

### Web sizing

The master image has a square source canvas with the logo centered inside it. Use a centered crop viewport with a ratio close to 2.98:1. At that ratio, the visible artwork occupies approximately 67.6% of the viewport width and 23.8% of the viewport width in height.

| Use | CSS viewport | Approx. visible artwork |
|---|---:|---:|
| Compact app header | 142 × 48 px | 96 × 34 px |
| Identity panel | 184 × 62 px | 124 × 44 px |
| Centered sign-in card | 280 × 94 px | 189 × 67 px |

The first two sizes are used in the dedicated sign-in page. The centered 280 × 94 px treatment matches the existing owner-locked app login. Keep the whole D-plus-wordmark artwork legible; below the compact size, use a product app icon only in a true app-icon surface rather than shrinking or cutting the wordmark.

### Placement and treatment

- Use the master logo on a white or near-white surface. The source canvas is near-white and opaque.
- Preserve the source artwork and its proportions. Do not add another “D” or type “DNA OS” beside it.
- Do not recolor, add effects, crop the mark into separate pieces, or put the master on a dark tile, frame, or shadow.
- Preserve breathing room around the visible mark. The file’s centered source canvas provides the built-in clear area; do not crop to the visible bounds.
- Use the embedded wordmark as supplied. Do not substitute a local font or recreate its letterforms.

## 2. Dark landing-page lockup

[`public/landing-preview/assets/dna-os-logo-transparent.png`](../../public/landing-preview/assets/dna-os-logo-transparent.png) is the existing white-wordmark transparent lockup for the dark landing page. Its hash is recorded in [`public/landing-preview/brand-lock.json`](../../public/landing-preview/brand-lock.json). Keep it within that dark-surface use; do not put it on the white sign-in screen or reconstruct it from the master mark.

The campaign artwork `dna-os-logo-primary.png`, the dark-background crop, and the source originals are reference artwork. They are not replacements for the two product lockups above. The unused beige `public/icons/logo-master.png` was removed; it was not a DNA OS product mark.

## 3. Product icons and external-provider marks

The canonical full logo above is DNA OS identity. It must never be presented as an Apple, Google, Facebook/Meta, TikTok, LINE, or other provider logo.

For an outside provider, use that provider’s own button or logo artwork only when its official source, permitted use, and exact asset are recorded. Never hand-draw, approximate, or paste a logo from an unverified icon collection. Until then, show the provider name with the DNA OS neutral integration symbol [`public/brand/dna-os-integration-generic.svg`](../../public/brand/dna-os-integration-generic.svg).

Current provider guidance:

- **Apple:** use the official Sign in with Apple button or Apple Design Resources artwork; never draw the Apple mark yourself. [Apple Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines/sign-in-with-apple/)
- **Facebook / Meta:** obtain the current asset from Meta’s Brand Resource Center and follow its usage rules; the standalone “f” is not a substitute for its complete logo. [Facebook logo guidance](https://www.meta.com/brand/resources/facebook/logo/)
- **TikTok:** the developer design guide requires prior written permission to use TikTok logos, icons, symbols, or designs; use its official button pack only when the required permission and integration are in place. [TikTok developer design guidelines](https://developers.tiktok.com/docs/en/getting-started-design-guidelines)

For each approved provider asset, record all of the following beside the file: provider, official download/source URL, retrieved date, exact SHA-256, asset filename and format, applicable usage terms/permission, approved UI surface, and owner of the approval. Keep the original downloaded bytes unchanged.

## 4. App icons are a separate asset class

`public/icons/icon-192.png`, `public/icons/icon-512.png`, `public/icons/apple-touch-icon.png`, and favicon files are app-install/browser icons. Use each only in its declared browser or install surface. Do not use those square icons as a substitute for the full DNA OS header logo.

## 5. Source of truth in code

- Owner logo and generic integration mark: `public/brand/`.
- Asset identity and consumers: `presentation/assets/manifest.ts`.
- Dedicated sign-in implementation: `workers/business-onboarding/entry-page.ts`.
- Dark landing-page lock and SHA-256 records: `public/landing-preview/brand-lock.json`.

When adding a new logo surface, use these paths and update the manifest and its provenance record in the same change.
