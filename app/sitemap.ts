import type { MetadataRoute } from "next"
import permissions from "@/registry/permissions.json"
import { appBaseUrl } from "@/config/system-links"
import { readPublicCatalog } from "@/services/public-catalog/reader"

/**
 * /sitemap.xml — server-rendered (Next.js MetadataRoute), no database read.
 *
 * Sources of truth (nothing invented here):
 *  - which URLs may be public: registry/permissions.json `public_routes`
 *    (the same list middleware.ts / the hardcode-governance registry already
 *    treats as the public surface — adding a route to the sitemap without
 *    adding it there is impossible by construction).
 *  - the host: NEXT_PUBLIC_APP_URL via config/system-links.ts appBaseUrl().
 *    A sitemap entry REQUIRES an absolute URL, so when the env is absent
 *    (local dev without the var) this returns an EMPTY list rather than a
 *    guessed domain. Empty = honest; a fabricated canonical host would make
 *    crawlers index a URL this system does not own.
 *
 * Deliberately NOT listed: /admin, /business, /user, /partner, /account,
 * /workspace*, /api/** — none of them are public (see app/robots.ts).
 */
// Runtime, not build-time: the canonical origin comes from NEXT_PUBLIC_APP_URL,
// and a sitemap frozen empty at build time (env absent during a CI build) would
// stay empty in production forever. Resolving it per request keeps the emitted
// URLs tied to the environment that is actually serving them.
export const dynamic = "force-dynamic"

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = appBaseUrl()
  if (!base) return []

  const lastModified = new Date()
  const routes: MetadataRoute.Sitemap = (permissions.public_routes as string[]).map((route) => ({
    url: route === "/" ? base : `${base}${route}`,
    lastModified,
    changeFrequency: "weekly" as const,
    priority: route === "/" ? 1 : 0.6,
  }))

  // Published catalog detail URLs (mission §06: a Withdrawn/unpublished record
  // must never appear here). readPublicCatalog already applies the publication
  // gate; if the source or service key is unavailable the crawler still gets the
  // static public routes instead of a 500 — the catalog simply contributes 0 URLs.
  try {
    const catalog = await readPublicCatalog({ pageSize: 50 })
    for (const item of catalog.items) {
      routes.push({
        url: `${base}/products/${item.slug}`,
        lastModified: new Date(item.updated_at),
        changeFrequency: "daily" as const,
        priority: 0.8,
      })
    }
  } catch {
    // fail-closed: no catalog URLs rather than a guessed/stale list
  }

  return routes
}
