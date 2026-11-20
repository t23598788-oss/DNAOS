import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import worker from "./index.ts";

const status = spawnSync("supabase", ["status", "--workdir", "../../", "--output", "env"], {
  cwd: new URL(".", import.meta.url).pathname, encoding: "utf8",
});
assert.equal(status.status, 0, "Supabase Local must be running");
const values = Object.fromEntries(status.stdout.split(/\r?\n/).flatMap(line => {
  const at = line.indexOf("=");
  if (at < 1) return [];
  let value = line.slice(at + 1).trim();
  if ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"'))) value = value.slice(1, -1);
  return [[line.slice(0, at), value]];
}));
const apiUrl = new URL(values.API_URL);
assert.ok(["127.0.0.1", "localhost"].includes(apiUrl.hostname), "refusing a non-local Auth URL");
const email = `dnaos-auth-${crypto.randomUUID()}@example.test`;
const origin = "http://localhost:3000";
const limits = new Map();
const env = {
  SUPABASE_URL: values.API_URL,
  SUPABASE_ANON_KEY: values.ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: values.SERVICE_ROLE_KEY,
  AUTH_APP_ORIGIN: origin,
  AUTH_RATE_LIMITER: { async limit({ key }) {
    const next = (limits.get(key) ?? 0) + 1;
    limits.set(key, next);
    return { success: next <= 5 };
  } },
};
const request = (path, { method = "GET", body, headers = {} } = {}) => worker.fetch(new Request(`http://worker.local${path}`, {
  method,
  headers: { ...(body ? { "content-type": "application/json" } : {}), ...headers },
  ...(body ? { body: JSON.stringify(body) } : {}),
}), env);
const originHeader = { origin };
let userId;

async function createFixtureIdentity() {
  const response = await fetch(`${values.API_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: { apikey: values.SERVICE_ROLE_KEY, authorization: `Bearer ${values.SERVICE_ROLE_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ email, password: crypto.randomUUID(), email_confirm: true }),
  });
  assert.equal(response.status, 200, "Local-only existing Auth identity fixture must be created");
  const payload = await response.json();
  assert.equal(typeof payload.id, "string");
  userId = payload.id;
}

async function findOtp() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await fetch("http://127.0.0.1:55424/api/v1/messages");
    assert.equal(response.status, 200, "Local Inbucket API must be available");
    const mailbox = await response.json();
    const message = mailbox.messages?.find(item => item.To?.some(recipient => recipient.Address === email));
    if (message?.ID) {
      const detailResponse = await fetch(`http://127.0.0.1:55424/api/v1/message/${encodeURIComponent(message.ID)}`);
      assert.equal(detailResponse.status, 200, "Local Inbucket message detail must be available");
      const detail = await detailResponse.json();
      const match = `${detail.Subject ?? ""}\n${detail.Text ?? ""}`.match(/(?:code|token|otp)[^0-9]{0,50}(\d{6})/i)
        ?? `${detail.Subject ?? ""}\n${detail.Text ?? ""}`.match(/\b(\d{6})\b/);
      if (match) return match[1];
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error("OTP email did not arrive in Local Inbucket");
}

try {
  await createFixtureIdentity();
  const csrfResponse = await request("/v1/auth/csrf", { headers: originHeader });
  assert.equal(csrfResponse.status, 200);
  assert.equal(csrfResponse.headers.get("access-control-allow-credentials"), "true");
  const csrf = (await csrfResponse.json()).csrf_token;
  const csrfCookie = csrfResponse.headers.get("set-cookie").split(";")[0];

  const rejectedOrigin = await request("/v1/auth/otp", {
    method: "POST", body: { email }, headers: { origin: "https://attacker.example", cookie: csrfCookie, "x-dna-csrf": csrf },
  });
  assert.equal(rejectedOrigin.status, 403, "foreign Origin must be rejected");

  const otpRequest = await request("/v1/auth/otp", {
    method: "POST", body: { email }, headers: { ...originHeader, cookie: csrfCookie, "x-dna-csrf": csrf },
  });
  assert.equal(otpRequest.status, 202, "OTP request must be accepted without disclosing account existence");
  assert.deepEqual(await otpRequest.json(), { status: "accepted" });
  const code = await findOtp();

  const verified = await request("/v1/auth/verify", {
    method: "POST", body: { email, code }, headers: { ...originHeader, cookie: csrfCookie, "x-dna-csrf": csrf },
  });
  assert.equal(verified.status, 200, `OTP verification failed: ${verified.status}`);
  const verifiedBody = await verified.json();
  userId = verifiedBody.user_id;
  assert.equal(typeof userId, "string");
  assert.ok(!("access_token" in verifiedBody) && !("refresh_token" in verifiedBody), "tokens must not be exposed to JavaScript");
  const sessionCookies = verified.headers.getSetCookie();
  assert.equal(sessionCookies.length, 2, "access and refresh tokens must be separate cookies");
  assert.ok(sessionCookies.every(value => value.includes("Secure") && value.includes("HttpOnly") && value.includes("SameSite=Lax")));
  const accessCookie = sessionCookies.find(value => value.startsWith("__Host-dnaos_access="));
  const refreshCookie = sessionCookies.find(value => value.startsWith("__Host-dnaos_refresh="));
  assert.ok(accessCookie && refreshCookie);
  const originalRefresh = decodeURIComponent(refreshCookie.split(";")[0].split("=").slice(1).join("="));
  const cookieHeader = `${csrfCookie}; ${accessCookie.split(";")[0]}; ${refreshCookie.split(";")[0]}`;

  const csrfRejected = await request("/v1/tools/report_business_quotas", {
    method: "POST", body: { company_id: crypto.randomUUID() },
    headers: { ...originHeader, cookie: cookieHeader, "x-dna-csrf": "wrong" },
  });
  assert.equal(csrfRejected.status, 403, "cookie-authenticated POST must require valid CSRF token");

  const session = await request("/v1/auth/session", { headers: { ...originHeader, cookie: cookieHeader } });
  assert.equal(session.status, 200);
  assert.deepEqual(await session.json(), { authenticated: true, user_id: userId });

  const html = await request("/");
  assert.equal(html.status, 200);
  assert.ok(html.headers.get("content-security-policy").includes("frame-ancestors 'none'"));
  const intakeHeaders = { ...originHeader, cookie: cookieHeader, "x-dna-csrf": csrf };
  const command = (capability_id, input, headers = intakeHeaders) => request("/api/gateway", {
    method: "POST", headers, body: { capability_id, input },
  });
  const initial = await command("onboarding.read", {});
  assert.equal(initial.status, 200);
  assert.equal((await initial.json()).data, null);
  const input = { display_name: "ผู้ทดสอบ", roles: ["driver", "business_owner"], details: {
    vehicle_type: "รถ 6 ล้อ", service_area: "ขอนแก่น", business_name: "กิจการทดสอบ", activities: "ขนส่ง", needs: "หางานขนส่ง",
  } };
  assert.equal((await command("onboarding.save", input, { ...originHeader })).status, 401);
  assert.equal((await command("onboarding.save", { ...input, user_id: crypto.randomUUID() })).status, 400);
  assert.equal((await command("onboarding.save", { ...input, roles: ["admin"] })).status, 400);
  assert.equal((await command("onboarding.save", { ...input, details: { ...input.details, organization_id: crypto.randomUUID() } })).status, 400);
  assert.equal((await command("onboarding.save", { ...input, details: {} })).status, 400);
  const saved = await command("onboarding.save", input);
  assert.equal(saved.status, 200);
  assert.equal((await saved.json()).data.status, "SELF_DECLARED");
  const restored = await command("onboarding.read", {});
  assert.equal((await restored.json()).data.details.vehicle_type, "รถ 6 ล้อ");
  const checkMemberships = spawnSync("docker", ["exec", "supabase_db_dnaos-clean-v2", "psql", "-U", "postgres", "-d", "postgres", "-XAt", "-c",
    `SELECT count(*) FROM public.org_members WHERE user_id = '${userId}'::uuid`], { encoding: "utf8" });
  assert.equal(checkMemberships.status, 0);
  assert.equal(checkMemberships.stdout.trim(), "0", "self-declared role cannot grant membership");
  const previousEntry = env.ENTRY_ONLY; env.ENTRY_ONLY = "true";
  assert.equal((await command("create_order", {})).status, 404);
  assert.equal((await command("onboarding.read", {})).status, 200);
  env.ENTRY_ONLY = previousEntry;

  const refreshed = await request("/v1/auth/refresh", {
    method: "POST", headers: { ...originHeader, cookie: cookieHeader, "x-dna-csrf": csrf },
  });
  assert.equal(refreshed.status, 200, `refresh failed: ${refreshed.status}`);
  const refreshedCookies = refreshed.headers.getSetCookie();
  const rotatedRefreshCookie = refreshedCookies.find(value => value.startsWith("__Host-dnaos_refresh="));
  assert.ok(rotatedRefreshCookie, "refresh must issue a new refresh cookie");
  const rotatedRefresh = decodeURIComponent(rotatedRefreshCookie.split(";")[0].split("=").slice(1).join("="));
  assert.notEqual(rotatedRefresh, originalRefresh, "refresh token must rotate");

  const logoutCookie = `${csrfCookie}; ${refreshedCookies.map(value => value.split(";")[0]).join("; ")}`;
  const logout = await request("/v1/auth/logout", {
    method: "POST", headers: { ...originHeader, cookie: logoutCookie, "x-dna-csrf": csrf },
  });
  assert.equal(logout.status, 204, "logout must clear the local session");
  assert.equal(logout.headers.getSetCookie().length, 3, "logout must clear access, refresh, and CSRF cookies");

  console.log(JSON.stringify({ result: "PASS", scope: "Supabase Local only", checks: [
    "OTP request routed through DNA OS Worker and enumeration-safe response",
    "foreign Origin rejected",
    "Supabase-issued OTP verified into host-only HttpOnly cookies",
    "session tokens not returned to browser JavaScript",
    "cookie-authenticated writes require CSRF token",
    "session identity verified through Supabase Auth",
    "entry page served with CSP; self-declared multi-role intake saves and reloads via Gateway",
    "unauthorized, actor spoof, admin role, organization injection, missing role details rejected",
    "onboarding creates no organization membership; entry-only release blocks business commands",
    "refresh rotates the Supabase refresh token",
    "logout revokes local Supabase session and clears cookies",
  ] }, null, 2));
} finally {
  // Remove only this script's temporary Local Auth account.
  if (values.SERVICE_ROLE_KEY) {
    const usersResponse = await fetch(`${values.API_URL}/auth/v1/admin/users?page=1&per_page=1000`, {
      headers: { apikey: values.SERVICE_ROLE_KEY, authorization: `Bearer ${values.SERVICE_ROLE_KEY}` },
    });
    if (usersResponse.ok) {
      const usersPayload = await usersResponse.json();
      const users = Array.isArray(usersPayload.users) ? usersPayload.users : [];
      const fixture = users.find(user => user.email === email || user.id === userId);
      if (fixture?.id) {
        await fetch(`${values.API_URL}/auth/v1/admin/users/${fixture.id}`, {
          method: "DELETE", headers: { apikey: values.SERVICE_ROLE_KEY, authorization: `Bearer ${values.SERVICE_ROLE_KEY}` },
        });
      }
    }
  }
}
