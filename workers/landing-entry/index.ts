// purpose: Serve the public DNA OS landing page and its assets on the root domain route.
import { systemMapHtml } from "./system-map-html";

interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  CF_VERSION_METADATA: { id: string; tag: string; timestamp: string };
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    const isVersionedBrandAsset = pathname.startsWith("/assets/brand/dna-os/v1/");
    if (isVersionedBrandAsset && request.method === "OPTIONS") {
      return Promise.resolve(new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET, HEAD, OPTIONS",
          "access-control-allow-headers": "Content-Type",
          "access-control-max-age": "86400",
          "cache-control": "public, max-age=86400",
        },
      }));
    }
    if (isVersionedBrandAsset && (request.method === "GET" || request.method === "HEAD")) {
      return env.ASSETS.fetch(request).then((asset) => {
        const headers = new Headers(asset.headers);
        headers.set("access-control-allow-origin", "*");
        headers.set("access-control-allow-methods", "GET, HEAD, OPTIONS");
        headers.set("cache-control", "public, max-age=300, stale-while-revalidate=86400");
        return new Response(asset.body, { status: asset.status, statusText: asset.statusText, headers });
      });
    }
    if (pathname === "/system-map") {
      const headers = new Headers({ "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      const version = env.CF_VERSION_METADATA;
      const html = systemMapHtml
        .replaceAll("__DNAOS_WORKER_VERSION__", version.id)
        .replaceAll("__DNAOS_WORKER_CREATED_AT__", version.timestamp);
      return Promise.resolve(new Response(html, { status: 200, headers }));
    }
    if (pathname === "/system-map.json" || pathname === "/system-map.md") {
      return env.ASSETS.fetch(request).then(async (asset) => {
        if (!asset.ok) return asset;
        const headers = new Headers(asset.headers);
        headers.delete("content-length");
        headers.delete("content-encoding");
        headers.delete("etag");
        headers.set("cache-control", "no-store");
        const version = env.CF_VERSION_METADATA;
        if (pathname === "/system-map.json") {
          const manifest = await asset.json() as Record<string, unknown>;
          return new Response(JSON.stringify({
            ...manifest,
            served_from: {
              worker: "dnaos-homepage",
              worker_version_id: version.id,
              version_tag: version.tag,
              version_created_at: version.timestamp,
            },
          }, null, 2) + "\n", { status: asset.status, headers });
        }
        const runtimeEvidence = [
          "## Live serving evidence",
          `- Worker: dnaos-homepage` ,
          `- Worker version ID: ${version.id}`,
          `- Version tag: ${version.tag || "(none)"}`,
          `- Version created at: ${version.timestamp}`,
          "",
        ].join("\n");
        return new Response(`${runtimeEvidence}${await asset.text()}`, { status: asset.status, headers });
      });
    }

    if (pathname === "/" || pathname.startsWith("/assets/") || pathname === "/system-map-ai.zip") {
      return env.ASSETS.fetch(request);
    }

    return Promise.resolve(new Response("Not Found", {
      status: 404,
      headers: { "cache-control": "no-store" },
    }));
  },
};
