// DNA OS — presentation/assets
//
// Phase 3 (Assets, concern 11 of the consolidation map) does NOT relocate binary
// assets. Every visual asset in this repository already has exactly one canonical
// location, and moving one would silently break the URLs that reference it
// (e.g. the Owner-approved, LOCKED Login page references /brand/dna-os-mark-d.png).
//
// MOVE = FORBIDDEN in Phase 3, so this file is a *map*, not a copy: it records where
// the canonical asset actually lives, verified by the import/reference trace in
// UI_SOURCE_MASTER_INVENTORY.md (FAM-H) and UI_CONSOLIDATION_MAP.md.
//
// Rule: ONE CONCERN = ONE CANONICAL IMPLEMENTATION — for assets that means one file
// on disk, referenced by URL. Never duplicate an asset into presentation/assets/.

export interface PresentationAsset {
  /** Stable key used by callers/catalogs. */
  key: string;
  /** Real public URL served by Next.js (public/ is the asset root). */
  url: string;
  /** Canonical file on disk, relative to the repository root. */
  file: string;
  /** LIVE = rendered by a real route/component today. */
  status: 'LIVE' | 'UNREFERENCED';
  /** Real consumers found by tracing imports/references. */
  consumers: string[];
  note?: string;
}

export const presentationAssets: PresentationAsset[] = [
  {
    key: 'dna-os-mark-d',
    url: '/brand/dna-os-mark-d.png',
    file: 'public/brand/dna-os-mark-d.png',
    status: 'LIVE',
    consumers: ['app/login/page.tsx', 'app/register/page.tsx', 'workers/business-onboarding/entry-page.ts'],
    note:
      'Official Owner brand mark (D สี่เหลี่ยมสีรุ้ง + NA OS). Provenance: ' +
      'DNA-OS-INFRASTRUCTURE/connections/connection-registry/brand-assets/dna-os/PROVENANCE.md, ' +
      'sha256 e48d08e63e0deaf30fe24ae916a7e6843bfabac9965eed3de1cdb842c50e4c55. ' +
      'Reserved as the canonical owner-supplied mark. Sign-in and workspace use the approved horizontal color lockup from public/landing-preview/assets/brand/dna-os/v1/.',
  },
  {
    key: 'dna-os-horizontal-color',
    url: '/assets/brand/dna-os/v1/dna-os-horizontal-color.png',
    file: 'public/landing-preview/assets/brand/dna-os/v1/dna-os-horizontal-color.png',
    status: 'LIVE',
    consumers: ['workers/business-onboarding/entry-page.ts', 'workers/business-onboarding/index.ts', 'public/landing-preview/index.html (social preview)'],
    note: 'Owner-approved full-color horizontal DNA OS lockup. Original transparent artwork; use on light surfaces with contain and no added background.',
  },
  {
    key: 'google-sign-in-button',
    url: '/assets/providers/google/signin-light-pill-android-web@2x.png',
    file: 'public/landing-preview/assets/providers/google/signin-light-pill-android-web@2x.png',
    status: 'LIVE',
    consumers: ['workers/business-onboarding/entry-page.ts'],
    note: 'Unmodified pre-approved Google Identity button. Source, retrieval date, usage surface, and SHA-256 are recorded beside the asset in README.md.',
  },
  {
    key: 'dna-os-logo-dark-surface',
    url: '/landing-preview/assets/dna-os-logo-transparent.png',
    file: 'public/landing-preview/assets/dna-os-logo-transparent.png',
    status: 'LIVE',
    consumers: ['public/landing-preview/index.html'],
    note: 'Locked white-wordmark variant for dark surfaces only. SHA-256 is recorded in public/landing-preview/brand-lock.json; never use on white surfaces or rebuild from a cropped mark.',
  },
  {
    key: 'dna-os-integration-generic',
    url: '/brand/dna-os-integration-generic.svg',
    file: 'public/brand/dna-os-integration-generic.svg',
    status: 'LIVE',
    consumers: ['workers/business-onboarding/entry-page.ts'],
    note: 'DNA OS neutral integration glyph. Use when an external provider asset is absent or its permitted use is not documented.',
  },
  {
    key: 'favicon',
    url: '/favicon.ico',
    file: 'public/favicon.ico',
    status: 'LIVE',
    consumers: ['app/layout.tsx (metadata icons)', 'workers/landing-entry/wrangler.jsonc assets (Google and browser favicon)'],
    note: '32 px ICO generated from the registered transparent DNA OS color mark; SHA-256 a0d2bf43301b4b98eba0f7b912c40eefd9ce79b45af42fdf48db6af8a73e6d38.',
  },
  {
    key: 'icon-192',
    url: '/icons/icon-192.png',
    file: 'public/icons/icon-192.png',
    status: 'LIVE',
    consumers: ['public/manifest.json (PWA)', 'public/landing-preview/manifest.json (Cloudflare landing PWA)'],
    note: 'Transparent 192 px color mark from the registered DNA OS icon artwork. SHA-256 28c02fc5ebb7b758d3252a2d4d5fe353ec78780012145ab7ba0d8e0fe54272e2.',
  },
  {
    key: 'icon-512',
    url: '/icons/icon-512.png',
    file: 'public/icons/icon-512.png',
    status: 'LIVE',
    consumers: ['public/manifest.json (PWA)', 'public/landing-preview/manifest.json (Cloudflare landing PWA)'],
    note: 'Transparent 512 px color mark from the registered DNA OS icon artwork. SHA-256 3a313f9773d932592737cdb975e574481fe96b46e6122deaa276551860c5b872.',
  },
  {
    key: 'apple-touch-icon',
    url: '/icons/apple-touch-icon.png',
    file: 'public/icons/apple-touch-icon.png',
    status: 'LIVE',
    consumers: ['app/layout.tsx (metadata icons)', 'public/landing-preview/index.html (Apple touch icon)'],
    note: 'Transparent 180 px color mark from the registered DNA OS icon artwork. SHA-256 c305c8dfcd56f99e408bb5d6c9bd800d269001b1ac2e3ba1948ae8dd3f2d58ea.',
  },
];
