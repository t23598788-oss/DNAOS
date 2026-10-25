/* DNA OS Service Worker (2026-09-24) — PWA install + update plumbing ONLY.
 *
 * Caching contract (owner rules):
 *   - ONLY immutable static assets are cached: content-hashed /_next/static/*,
 *     icons, brand art, manifest. Their URLs change when content changes, so a
 *     cached copy can never become a stale UI.
 *   - HTML documents, /api/*, and every authed response are NEVER cached →
 *     no user stuck on an old screen after a deploy, and no cross-account
 *     data survives logout or an account switch (there is nothing cached to
 *     leak). Page drafts live in the page, untouched by this worker.
 *   - Updates are ANNOUNCED, never forced: the page shows
 *     "มีเวอร์ชันใหม่" and reloads only when the human clicks รีเฟรช,
 *     so unsaved work is not destroyed by a background update.
 *   - Everything requires the network: this app has no offline mode, and the
 *     install help page says so honestly.
 */
const STATIC_CACHE = "dnaos-static-2026-09-24-a";
const STATIC_PREFIXES = ["/_next/static/", "/icons/", "/brand/"];
const STATIC_FILES = ["/manifest.json", "/favicon.ico"];

function isStaticPath(pathname) {
  return STATIC_PREFIXES.some((p) => pathname.startsWith(p)) || STATIC_FILES.includes(pathname);
}

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k.startsWith("dnaos-static-") && k !== STATIC_CACHE).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return; // never cache mutations
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // cross-origin → network
  if (!isStaticPath(url.pathname)) return; // HTML / API / auth → network-only

  event.respondWith(
    caches.open(STATIC_CACHE).then(async (cache) => {
      const cached = await cache.match(req);
      const network = fetch(req)
        .then((res) => {
          if (res.ok) {
            cache.put(req, res.clone());
            // Bound the cache (oldest-first eviction) so deploys can't grow it forever.
            cache
              .keys()
              .then((keys) => {
                if (keys.length > 300) cache.delete(keys[0]);
              })
              .catch(() => {});
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});
