import type { MetadataRoute } from "next"
import permissions from "@/registry/permissions.json"
import { appBaseUrl } from "@/config/system-links"

/**
 * /robots.txt — server-rendered (Next.js MetadataRoute).
 *
 * Allow-list comes from the SAME registry the sitemap uses
 * (registry/permissions.json `public_routes`), so a route cannot be
 * crawlable here while being non-public there. Everything authenticated
 * (admin/business/partner/user/account/workspace) and every API surface is
 * disallowed explicitly — defence against indexable session-gated pages,
 * not a substitute for the middleware/requireAuth guards themselves.
 */
const DISALLOW = [
  "/admin",
  "/business",
  "/partner",
  "/user",
  "/account",
  "/workspace",
  "/workspace-preview",
  "/business-workspace-template",
  "/api/",
  "/auth/",
  "/liff",
  "/oauth",
]

// Same reason as app/sitemap.ts: the Sitemap: line is absolute and must reflect
// the serving environment, not whatever env existed at build time.
export const dynamic = "force-dynamic"

export default function robots(): MetadataRoute.Robots {
  const base = appBaseUrl()
  return {
    rules: [
      {
        userAgent: "*",
        allow: permissions.public_routes as string[],
        disallow: DISALLOW,
      },
    ],
    ...(base ? { sitemap: `${base}/sitemap.xml` } : {}),
  }
}
