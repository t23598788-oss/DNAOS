// Cloudflare Worker — DNA OS API Gateway (wandering-queen-756b)
// Minimal entry point: health check + passthrough. Extend routing here.

export interface Env {
  ENVIRONMENT: string
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === "/health" || url.pathname === "/") {
      return new Response(
        JSON.stringify({
          ok: true,
          service: "dna-os-gateway",
          environment: env.ENVIRONMENT ?? "unknown",
          ts: new Date().toISOString(),
        }),
        { headers: { "content-type": "application/json" } },
      )
    }

    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    })
  },
}
