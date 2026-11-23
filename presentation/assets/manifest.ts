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
  /** LIVE = rendered by a real route/component today; ARCHIVED = reference-only. */
  status: 'LIVE' | 'UNREFERENCED' | 'ARCHIVED';
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
    consumers: ['app/login/page.tsx'],
    note:
      'Official Owner brand mark (D สี่เหลี่ยมสีรุ้ง + NA OS). Provenance: ' +
      'DNA-OS-INFRASTRUCTURE/connections/connection-registry/brand-assets/dna-os/PROVENANCE.md, ' +
      'sha256 e48d08e63e0deaf30fe24ae916a7e6843bfabac9965eed3de1cdb842c50e4c55. ' +
      'Login presentation is OWNER LOCKED — this asset must not be moved, renamed, or re-drawn.',
  },
  {
    key: 'favicon',
    url: '/favicon.ico',
    file: 'public/favicon.ico',
    status: 'LIVE',
    consumers: ['app/layout.tsx (metadata icons)'],
  },
  {
    key: 'icon-192',
    url: '/icons/icon-192.png',
    file: 'public/icons/icon-192.png',
    status: 'LIVE',
    consumers: ['public/manifest.json (PWA)'],
  },
  {
    key: 'icon-512',
    url: '/icons/icon-512.png',
    file: 'public/icons/icon-512.png',
    status: 'LIVE',
    consumers: ['public/manifest.json (PWA)'],
  },
  {
    key: 'apple-touch-icon',
    url: '/icons/apple-touch-icon.png',
    file: 'public/icons/apple-touch-icon.png',
    status: 'LIVE',
    consumers: ['app/layout.tsx (metadata icons)'],
  },
  {
    key: 'logo-master',
    url: '/icons/logo-master.png',
    file: 'public/icons/logo-master.png',
    status: 'ARCHIVED',
    consumers: [],
    note: 'Review-only brown background asset, updated with the current color D mark and the exact source wordmark. Not used in production pages, documents, or provider integrations; active brand package has only color and monochrome variants.',
  },
];
