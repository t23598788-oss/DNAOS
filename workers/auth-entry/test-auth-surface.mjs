import assert from "node:assert/strict";
import worker from "./index.ts";

let businessFetchCalls = 0;
const env = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_ANON_KEY: "public-anon-test-value",
  AUTH_APP_ORIGIN: "https://dnaos.dev",
  AUTH_RATE_LIMITER: { limit: async () => ({ success: true }) },
  SUPABASE_SERVICE_ROLE_KEY: "must-not-be-forwarded",
  STOCK_INGEST: { fetch: async () => { businessFetchCalls += 1; return Response.json({ unexpected: true }); } },
};

const login = await worker.fetch(new Request("https://dnaos.dev/login"), env);
assert.equal(login.status, 200);
assert.match(await login.text(), /Sign in to DNA OS/);

const csrf = await worker.fetch(new Request("https://dnaos.dev/v1/auth/csrf", {
  headers: { origin: "https://dnaos.dev" },
}), env);
assert.equal(csrf.status, 200);
const csrfCookie = /__Host-dnaos_csrf=([^;]+)/.exec(csrf.headers.get("set-cookie") ?? "")?.[1];
const csrfToken = (await csrf.json()).csrf_token;
assert.ok(csrfCookie && csrfToken);

let authProviderCalls = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  authProviderCalls += 1;
  assert.match(String(input), /\/auth\/v1\/verify$/);
  assert.equal(new Headers(init?.headers).get("apikey"), env.SUPABASE_ANON_KEY);
  return Response.json({
    access_token: "local-test-access-token",
    refresh_token: "local-test-refresh-token",
    expires_in: 3600,
    user: { id: "11111111-1111-4111-8111-111111111111" },
  });
};
const verify = async (code) => worker.fetch(new Request("https://dnaos.dev/v1/auth/verify", {
  method: "POST",
  headers: {
    origin: "https://dnaos.dev",
    cookie: `__Host-dnaos_csrf=${csrfCookie}`,
    "x-dna-csrf": csrfToken,
    "content-type": "application/json",
  },
  body: JSON.stringify({ email: "test@example.invalid", code }),
}), env);
const wrongLength = await verify("12345678");
assert.equal(wrongLength.status, 400);
assert.equal(authProviderCalls, 0, "invalid OTP lengths must be rejected before Supabase");
const acceptedLength = await verify("123456");
assert.equal(acceptedLength.status, 200);
assert.equal(authProviderCalls, 1);
assert.match(acceptedLength.headers.get("set-cookie") ?? "", /__Host-dnaos_access=/);
globalThis.fetch = originalFetch;

for (const path of ["/", "/api/gateway", "/v1/tools", "/v1/integrations/stock-update", "/health"]) {
  const response = await worker.fetch(new Request(`https://dnaos.dev${path}`, { method: path.includes("api") ? "POST" : "GET" }), env);
  assert.equal(response.status, 404, `${path} must not be available on the auth-only Worker`);
}
assert.equal(businessFetchCalls, 0);

console.log("AUTH-ONLY SURFACE PASS");
