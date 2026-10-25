import type { MetadataRoute } from "next";

// PUBLIC DISCOVERY (owner 2026-10-20): only public pages are listed.
// Authenticated areas and internal tools are intentionally excluded.
const SITE_URL = "https://dnaos.dev";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${SITE_URL}/pub`, changeFrequency: "daily", priority: 0.9 },
    { url: `${SITE_URL}/solutions`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${SITE_URL}/marketplace`, changeFrequency: "monthly", priority: 0.7 },
  ];
}
