// purpose: Canonicalize www requests to the apex host without routing static requests through the homepage Worker.
export default {
  fetch(request: Request): Response {
    const url = new URL(request.url);
    if (url.hostname !== "www.dnaos.dev") {
      return new Response("Not Found", {
        status: 404,
        headers: { "cache-control": "no-store" },
      });
    }

    url.hostname = "dnaos.dev";
    return Response.redirect(url.toString(), 308);
  },
};
