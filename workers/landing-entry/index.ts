// purpose: Serve the public DNA OS landing page and its assets on the root domain route.
interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.hostname === "www.dnaos.dev") {
      url.hostname = "dnaos.dev";
      return Promise.resolve(Response.redirect(url.toString(), 308));
    }
    return env.ASSETS.fetch(request);
  },
};
