// purpose: Serve the public DNA OS landing page and its assets on the root domain route.
interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === "/" || pathname.startsWith("/assets/")) {
      return env.ASSETS.fetch(request);
    }

    return Promise.resolve(new Response("Not Found", {
      status: 404,
      headers: { "cache-control": "no-store" },
    }));
  },
};
