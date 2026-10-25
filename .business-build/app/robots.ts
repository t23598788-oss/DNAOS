import type { MetadataRoute } from "next";

// PUBLIC DISCOVERY (owner 2026-10-20): crawlers may index public pages only.
// Disallow list mirrors middleware.ts PROTECTED_PAGE_PREFIXES + API prefixes.
const SITE_URL = "https://dnaos.dev";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/pub", "/solutions", "/marketplace", "/login"],
        disallow: [
          "/admin",
          "/business",
          "/user",
          "/partner",
          "/transporter",
          "/account",
          "/workspace",
          "/workspace-preview",
          "/business-workspace-template",
          "/developer",
          "/api/",
          // internal architecture/schema summary — not for public search indexing
          "/observer",
          "/observer.json",
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
