// Cloudflare Worker — DNA OS API Gateway (wandering-queen-756b)
// Step 1: Baseline & Health Check — minimal entry point, no business logic.

export interface Env {
  ENVIRONMENT: string
}

const healthPayload = (env: Env) => ({
  status: "ok",
  message: "Hello from Workers Builds!",
  service: "dna-os-gateway",
  environment: env.ENVIRONMENT ?? "unknown",
  ts: new Date().toISOString(),
})

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === "/" || url.pathname === "/health" || url.pathname === "/api/gateway/status") {
      return new Response(JSON.stringify(healthPayload(env)), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    }

    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    })
  },
}
