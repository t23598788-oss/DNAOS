/** Public auth-only surface. The business Gateway is never exposed by this Worker. */
import gateway from "../business-onboarding/index.ts";

interface AuthEnv {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  AUTH_APP_ORIGIN: string;
  AUTH_RATE_LIMITER: { limit(input: { key: string }): Promise<{ success: boolean }> };
}

const allowedMethods = new Map<string, ReadonlySet<string>>([
  ["/login", new Set(["GET"])],
  ["/start", new Set(["GET"])],
  ["/workspace", new Set(["GET"])],
  ["/auth/google", new Set(["GET"])],
  ["/auth/confirm", new Set(["GET"])],
  ["/v1/auth/csrf", new Set(["GET"])],
  ["/v1/auth/otp", new Set(["POST"])],
  ["/v1/auth/verify", new Set(["POST"])],
  ["/v1/auth/refresh", new Set(["POST"])],
  ["/v1/auth/logout", new Set(["POST"])],
  ["/v1/auth/session", new Set(["GET"])],
]);

function rejected(): Response {
  return Response.json({ error: "NOT_FOUND" }, { status: 404, headers: { "cache-control": "no-store" } });
}

export default {
  async fetch(request: Request, env: AuthEnv): Promise<Response> {
    const url = new URL(request.url);
    const methods = allowedMethods.get(url.pathname);
    if (!methods) return rejected();
    if (!methods.has(request.method) && request.method !== "OPTIONS") return rejected();

    // Pass a newly constructed allowlisted environment so optional business
    // secrets and service bindings can never reach the shared Gateway module.
    return gateway.fetch(request, {
      SUPABASE_URL: env.SUPABASE_URL,
      SUPABASE_ANON_KEY: env.SUPABASE_ANON_KEY,
      AUTH_APP_ORIGIN: env.AUTH_APP_ORIGIN,
      AUTH_RATE_LIMITER: env.AUTH_RATE_LIMITER,
      AUTH_ONLY: "true",
    });
  },
};
