// purpose: Serve the public DNA OS landing page and its assets on the root domain route.
interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  CF_VERSION_METADATA: { id: string; tag: string; timestamp: string };
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
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

    if (pathname === "/" || pathname.startsWith("/assets/")) {
      return env.ASSETS.fetch(request);
    }

    return Promise.resolve(new Response("Not Found", {
      status: 404,
      headers: { "cache-control": "no-store" },
    }));
  },
};
