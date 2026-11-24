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
const loginHtml = await login.text();
assert.match(loginHtml, /Sign in to DNA OS/);
assert.match(loginHtml, /signin-light-pill-android-web@2x\.png/);
assert.match(loginHtml, /location\.replace\('\/workspace'\)/, "OTP sign-in should finish at the workspace");

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

const anonymousWorkspace = await worker.fetch(new Request("https://dnaos.dev/workspace"), env);
assert.equal(anonymousWorkspace.status, 303, "workspace must redirect anonymous visitors to login");
assert.match(anonymousWorkspace.headers.get("location") ?? "", /\/login\?next=%2Fworkspace$/);

const googleStart = await worker.fetch(new Request("https://dnaos.dev/auth/google?next=https%3A%2F%2Fevil.example"), env);
assert.equal(googleStart.status, 302);
const authorizeUrl = new URL(googleStart.headers.get("location"));
assert.equal(authorizeUrl.searchParams.get("provider"), "google");
assert.equal(authorizeUrl.searchParams.get("redirect_to"), "https://dnaos.dev/auth/confirm");
assert.equal(authorizeUrl.searchParams.get("code_challenge_method"), "s256");
assert.ok(authorizeUrl.searchParams.get("code_challenge"));
const verifierCookie = /__Host-dnaos_oauth_verifier=([^;]+)/.exec(googleStart.headers.get("set-cookie") ?? "")?.[1];
assert.ok(verifierCookie, "PKCE verifier must be held in an HttpOnly cookie");

globalThis.fetch = async (input, init) => {
  assert.match(String(input), /\/auth\/v1\/token\?grant_type=pkce$/);
  const body = JSON.parse(String(init?.body));
  assert.equal(body.auth_code, "test-oauth-code");
  assert.equal(typeof body.code_verifier, "string");
  return Response.json({ access_token: "oauth-access", refresh_token: "oauth-refresh", expires_in: 3600,
    user: { id: "22222222-2222-4222-8222-222222222222" } });
};
const oauthCallback = await worker.fetch(new Request("https://dnaos.dev/auth/confirm?code=test-oauth-code&next=https%3A%2F%2Fevil.example", {
  headers: { cookie: `__Host-dnaos_oauth_verifier=${verifierCookie}` },
}), env);
assert.equal(oauthCallback.status, 303);
assert.equal(oauthCallback.headers.get("location"), "https://dnaos.dev/workspace", "OAuth return path must stay on the workspace");
assert.ok(oauthCallback.headers.getSetCookie().some((value) => value.startsWith("__Host-dnaos_access=")));
assert.ok(oauthCallback.headers.getSetCookie().some((value) => value.startsWith("__Host-dnaos_refresh=")));
assert.ok(oauthCallback.headers.getSetCookie().some((value) => value.startsWith("__Host-dnaos_csrf=")));

globalThis.fetch = async (input, init) => {
  assert.match(String(input), /\/auth\/v1\/user$/);
  assert.equal(new Headers(init?.headers).get("authorization"), "Bearer oauth-access");
  return Response.json({ id: "22222222-2222-4222-8222-222222222222" });
};
const workspace = await worker.fetch(new Request("https://dnaos.dev/workspace", {
  headers: { cookie: "__Host-dnaos_access=oauth-access", "sec-fetch-site": "same-origin" },
}), env);
assert.equal(workspace.status, 200, "a Supabase-verified cookie session should open the workspace");
assert.match(await workspace.text(), /DNA OS Workspace/);
globalThis.fetch = originalFetch;

for (const path of ["/", "/api/gateway", "/v1/tools", "/v1/integrations/stock-update", "/health"]) {
  const response = await worker.fetch(new Request(`https://dnaos.dev${path}`, { method: path.includes("api") ? "POST" : "GET" }), env);
  assert.equal(response.status, 404, `${path} must not be available on the auth-only Worker`);
}
assert.equal(businessFetchCalls, 0);

console.log("AUTH-ONLY SURFACE PASS");
