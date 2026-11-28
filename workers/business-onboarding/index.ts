/** DNA OS authentication and command Gateway: verifies Supabase OTP sessions, checks authorized scope, traces requests, and routes approved capabilities. */
import { landingPage } from "./landing-page.ts";
import { entryPage } from "./entry-page.ts";
import { connectionsPage } from "./connections-page.ts";
import { GATEWAY_TRACE, traceEvent, verifiedRpcContext, type GatewayTrace } from "../shared/gatewayTrace.ts";

interface Env {
  [GATEWAY_TRACE]?: GatewayTrace;
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  ERP_CREDENTIALS_ENCRYPTION_KEY?: string;
  ERP_CREDENTIALS_KEY_VERSION?: string;
  AUTH_APP_ORIGIN?: string;
  ENTRY_ONLY?: string;
  AUTH_ONLY?: string;
  AUTH_RATE_LIMITER?: { limit(input: { key: string }): Promise<{ success: boolean }> };
  RATE_LIMITER?: { limit(input: { key: string }): Promise<{ success: boolean }> };
  GATEWAY_INTERNAL_SECRET?: string;
  STOCK_INGEST?: { fetch(request: Request): Promise<Response> };
  DEMAND_INGEST?: { fetch(request: Request): Promise<Response> };
  FULFILLMENT_INGEST?: { fetch(request: Request): Promise<Response> };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BODY = 8_192;
const ACCESS_COOKIE = "__Host-dnaos_access";
const REFRESH_COOKIE = "__Host-dnaos_refresh";
const CSRF_COOKIE = "__Host-dnaos_csrf";
const OAUTH_VERIFIER_COOKIE = "__Host-dnaos_oauth_verifier";

const toolManifest = {
  tools: [
    { name: "onboarding.read", description: "อ่านข้อมูลเริ่มต้นที่บัญชีนี้แจ้งไว้ ไม่ใช่สิทธิ์ธุรกิจ", input_schema: { type: "object", properties: {} } },
    { name: "onboarding.save", description: "บันทึกบทบาทและความต้องการที่ผู้ใช้แจ้ง ไม่เปลี่ยนสมาชิกหรือสิทธิ์", input_schema: { type: "object", required: ["display_name", "roles", "details"], properties: { display_name: { type: "string" }, roles: { type: "array" }, details: { type: "object" } } } },
    { name: "onboard_business", description: "สร้างธุรกิจและพิกัดหลักของผู้ใช้ที่ยืนยันตัวตนแล้ว",
      input_schema: { type: "object", required: ["shop_name", "lat", "lng"], properties: {
        shop_name: { type: "string", minLength: 2, maxLength: 160 }, lat: { type: "number", minimum: -90, maximum: 90 },
        lng: { type: "number", minimum: -180, maximum: 180 } } } },
    { name: "request_business_document", description: "ขอเอกสารและสร้างรายการติดตาม",
      input_schema: { type: "object", required: ["company_id", "document_type"], properties: {
        company_id: { type: "string", format: "uuid" }, document_type: { type: "string" } } } },
    { name: "submit_business_document", description: "บันทึกลิงก์ HTTPS ของเอกสารที่ผู้ใช้ส่งมา โดยระบบไม่ดาวน์โหลดไฟล์",
      input_schema: { type: "object", required: ["document_id", "document_url"], properties: {
        document_id: { type: "string", format: "uuid" }, document_url: { type: "string", format: "uri" } } } },
    { name: "consume_ai_interview_turn", description: "ใช้โควตารอบสัมภาษณ์ AI หนึ่งรอบ",
      input_schema: { type: "object", required: ["company_id"], properties: { company_id: { type: "string", format: "uuid" } } } },
    { name: "report_business_quotas", description: "แจ้งจำนวนโควตาที่ใช้แล้วและคงเหลือ",
      input_schema: { type: "object", required: ["company_id"], properties: { company_id: { type: "string", format: "uuid" } } } },
    { name: "connect_erp", description: "เริ่มเชื่อม ERP; ข้อมูลรับรองต้องกรอกผ่านช่องทางตั้งค่าที่ปลอดภัย ไม่ส่งผ่านบทสนทนา AI",
      input_schema: { type: "object", required: ["org_id", "provider"], properties: {
        org_id: { type: "string", format: "uuid" }, provider: { type: "string", enum: ["custom", "shopee", "lazada"] } } } },
    { name: "submit_identity_documents", description: "ส่ง metadata ของเอกสารที่อัปโหลดไปยัง private storage; ไม่ส่งไฟล์ให้โมเดล",
      input_schema: { type: "object", required: ["org_id", "documents"], properties: {
        org_id: { type: "string", format: "uuid" }, documents: { type: "array", items: { type: "object" } } } } },
    { name: "check_product_listing", description: "ตรวจนโยบายหมวดสินค้า ใบอนุญาต และ blacklist ก่อนลงรายการ",
      input_schema: { type: "object", required: ["org_id", "title", "category_code"], properties: {
        org_id: { type: "string", format: "uuid" }, title: { type: "string" }, description: { type: "string" }, category_code: { type: "string" } } } },
    { name: "connect_platform", description: "เริ่มเชื่อมแพลตฟอร์ม; credentials ต้องกรอกผ่าน secure setup ไม่ผ่าน AI chat",
      input_schema: { type: "object", required: ["org_id", "platform_code"], properties: {
        org_id: { type: "string", format: "uuid" }, platform_code: { type: "string" } } } },
    { name: "sync_erp_snapshot", description: "ซิงก์ snapshot ที่ได้จากการเชื่อมต่อ ERP ที่ยืนยันแล้วเข้าสู่รายการและยอดสต๊อกขององค์กร",
      input_schema: { type: "object", required: ["integration_id", "company_id", "listings"], properties: {
        integration_id: { type: "string", format: "uuid" }, company_id: { type: "string", format: "uuid" }, listings: { type: "array", maxItems: 200,
          items: { type: "object", required: ["sku", "name", "price", "stock", "unit"], properties: {
            sku: { type: "string" }, name: { type: "string" }, specs: { type: "object" }, price: { type: "number", minimum: 0 },
            status: { type: "string", enum: ["AVAILABLE", "OUT_OF_STOCK", "CUSTOM_ORDER"] }, stock: { type: "number", minimum: 0 }, unit: { type: "string" } } } } } } },
    { name: "create_order", description: "สร้างคำสั่งซื้อระหว่างองค์กร ตรวจสต๊อกและจองสินค้าแบบ atomic",
      input_schema: { type: "object", required: ["seller_org_id", "buyer_org_id", "items"], properties: {
        seller_org_id: { type: "string", format: "uuid" }, buyer_org_id: { type: "string", format: "uuid" },
        items: { type: "array", items: { type: "object", required: ["listing_id", "quantity"], properties: {
          listing_id: { type: "string", format: "uuid" }, quantity: { type: "number", exclusiveMinimum: 0 } } } } } } },
  ],
};

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { "cache-control": "no-store" } });
}

function cookie(request: Request, name: string): string | null {
  const entry = (request.headers.get("cookie") ?? "").split(";").map(value => value.trim())
    .find(value => value.startsWith(`${name}=`));
  if (!entry) return null;
  try { return decodeURIComponent(entry.slice(name.length + 1)); } catch { return null; }
}

function exactAppOrigin(request: Request, env: Env): boolean {
  if (!env.AUTH_APP_ORIGIN) return false;
  if (request.headers.get("origin") === env.AUTH_APP_ORIGIN) return true;
  // Browsers omit Origin on same-origin GET fetches; Fetch Metadata still
  // proves the browser's initiator relation. Cross-site reads remain denied.
  return request.method === "GET" && !request.headers.has("origin")
    && new URL(request.url).origin === env.AUTH_APP_ORIGIN
    && request.headers.get("sec-fetch-site") === "same-origin";
}

function verifyCsrf(request: Request, env: Env): void {
  const cookieToken = cookie(request, CSRF_COOKIE) ?? "";
  const headerToken = request.headers.get("x-dna-csrf") ?? "";
  if (!exactAppOrigin(request, env) || !cookieToken || !headerToken || cookieToken.length !== headerToken.length) {
    throw Object.assign(new Error("CSRF_REJECTED"), { status: 403 });
  }
  let difference = 0;
  for (let i = 0; i < cookieToken.length; i += 1) difference |= cookieToken.charCodeAt(i) ^ headerToken.charCodeAt(i);
  if (difference !== 0) throw Object.assign(new Error("CSRF_REJECTED"), { status: 403 });
}

function sessionCookie(name: string, value: string, maxAge: number, httpOnly = true): string {
  return `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; Secure; SameSite=Lax${httpOnly ? "; HttpOnly" : ""}`;
}

function clearSessionCookies(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const name of [ACCESS_COOKIE, REFRESH_COOKIE, CSRF_COOKIE]) {
    headers.append("set-cookie", `${name}=; Path=/; Max-Age=0; Secure; SameSite=Lax${name === CSRF_COOKIE ? "" : "; HttpOnly"}`);
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function withCors(request: Request, response: Response, env: Env): Response {
  if (!exactAppOrigin(request, env)) return response;
  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", env.AUTH_APP_ORIGIN!);
  headers.set("access-control-allow-credentials", "true");
  headers.set("access-control-allow-methods", "GET, POST, OPTIONS");
  headers.set("access-control-allow-headers", "content-type, authorization, x-dna-csrf");
  headers.set("access-control-expose-headers", "x-dna-request-id");
  headers.append("vary", "Origin");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function readSessionTokens(value: unknown): { access_token?: string; refresh_token?: string; expires_in?: number; user?: { id?: unknown } } {
  if (!value || typeof value !== "object") throw Object.assign(new Error("AUTH_INVALID"), { status: 401 });
  const session = value as { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown; user?: { id?: unknown } };
  if (typeof session.access_token !== "string" || typeof session.refresh_token !== "string"
    || typeof session.user?.id !== "string" || !UUID_RE.test(session.user.id)) {
    throw Object.assign(new Error("AUTH_INVALID"), { status: 401 });
  }
  return { access_token: session.access_token, refresh_token: session.refresh_token,
    expires_in: typeof session.expires_in === "number" ? session.expires_in : 3600, user: session.user };
}

async function authFetch(env: Env, path: string, body: Record<string, unknown>, accessToken?: string): Promise<Response> {
  traceEvent(env[GATEWAY_TRACE], "auth.provider_request_sent", { backend: path.split("?")[0], outcome: "sent" });
  const response = await fetch(`${env.SUPABASE_URL.replace(/\/$/, "")}${path}`, {
    method: "POST",
    headers: { apikey: env.SUPABASE_ANON_KEY, "content-type": "application/json",
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}) },
    body: JSON.stringify(body),
  });
  traceEvent(env[GATEWAY_TRACE], "auth.provider_response_received", { status: response.status, outcome: response.ok ? "accepted" : "rejected" });
  return response;
}

async function authRoute(request: Request, env: Env, pathname: string): Promise<Response | null> {
  if (pathname === "/auth/google" && request.method === "GET") {
    const verifier = encodeBase64(crypto.getRandomValues(new Uint8Array(32)), true);
    const challenge = encodeBase64(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))), true);
    const authorize = new URL(`${env.SUPABASE_URL.replace(/\/$/, "")}/auth/v1/authorize`);
    authorize.searchParams.set("provider", "google");
    authorize.searchParams.set("redirect_to", `${env.AUTH_APP_ORIGIN}/auth/confirm`);
    authorize.searchParams.set("code_challenge", challenge);
    authorize.searchParams.set("code_challenge_method", "s256");
    const response = new Response(null, { status: 302, headers: { location: authorize.toString(), "cache-control": "no-store" } });
    response.headers.append("set-cookie", sessionCookie(OAUTH_VERIFIER_COOKIE, verifier, 600));
    return response;
  }
  if (pathname === "/auth/confirm" && request.method === "GET") {
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const verifier = cookie(request, OAUTH_VERIFIER_COOKIE);
    if (!code || code.length > 4096 || !verifier) return clearOAuthCookie(Response.redirect(`${env.AUTH_APP_ORIGIN}/login?error=oauth_failed`, 303));
    try {
      const upstream = await authFetch(env, "/auth/v1/token?grant_type=pkce", { auth_code: code, code_verifier: verifier });
      if (!upstream.ok) return clearOAuthCookie(Response.redirect(`${env.AUTH_APP_ORIGIN}/login?error=oauth_failed`, 303));
      const session = readSessionTokens(await upstream.json());
      if (env[GATEWAY_TRACE]) env[GATEWAY_TRACE]!.actorId = session.user!.id as string;
      const response = new Response(null, { status: 303, headers: { location: `${env.AUTH_APP_ORIGIN}/workspace`, "cache-control": "no-store" } });
      response.headers.append("set-cookie", `${OAUTH_VERIFIER_COOKIE}=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax`);
      response.headers.append("set-cookie", sessionCookie(ACCESS_COOKIE, session.access_token!, Math.min(Math.max(session.expires_in!, 60), 3600)));
      response.headers.append("set-cookie", sessionCookie(REFRESH_COOKIE, session.refresh_token!, 60 * 60 * 24 * 30));
      response.headers.append("set-cookie", sessionCookie(CSRF_COOKIE, encodeBase64(crypto.getRandomValues(new Uint8Array(32)), true), 3600, false));
      return response;
    } catch {
      return clearOAuthCookie(Response.redirect(`${env.AUTH_APP_ORIGIN}/login?error=oauth_failed`, 303));
    }
  }
  if (pathname === "/v1/auth/csrf" && request.method === "GET") {
    if (!exactAppOrigin(request, env)) return json({ error: "ORIGIN_REJECTED" }, 403);
    const token = encodeBase64(crypto.getRandomValues(new Uint8Array(32)), true);
    const response = json({ csrf_token: token });
    const headers = new Headers(response.headers);
    headers.append("set-cookie", sessionCookie(CSRF_COOKIE, token, 3600, false));
    return new Response(response.body, { status: response.status, headers });
  }
  if (pathname === "/v1/auth/otp" && request.method === "POST") {
    if (!env.AUTH_APP_ORIGIN || !env.AUTH_RATE_LIMITER) return json({ error: "AUTH_NOT_CONFIGURED" }, 503);
    try {
      verifyCsrf(request, env);
      const body = await readJson(request);
      const email = requiredString(body.email, "email", 320).toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || Object.keys(body).some(key => key !== "email")) {
        return json({ error: "EMAIL_INVALID" }, 400);
      }
      const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
      const emailHash = await sha256Hex(email);
      const [byIp, byEmail] = await Promise.all([
        env.AUTH_RATE_LIMITER.limit({ key: `auth-otp-ip:${ip}` }),
        env.AUTH_RATE_LIMITER.limit({ key: `auth-otp-email:${emailHash}` }),
      ]);
      if (!byIp.success || !byEmail.success) return json({ error: "RATE_LIMITED" }, 429);
      // Authentication is for existing DNA OS identities. Account creation
      // remains an explicit onboarding action; OTP must not mint a duplicate.
      const upstream = await authFetch(env, "/auth/v1/otp", { email, create_user: false });
      // Do not disclose whether an account exists. Supabase remains the OTP
      // issuer/verifier and the only service that creates its accepted session.
      if (upstream.ok || upstream.status === 400 || upstream.status === 404) return json({ status: "accepted" }, 202);
      if (upstream.status === 429) return json({ error: "RATE_LIMITED" }, 429);
      return json({ error: "AUTH_PROVIDER_UNAVAILABLE" }, 502);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "AUTH_REQUEST_FAILED" }, Number((error as { status?: number }).status) || 400);
    }
  }
  if (pathname === "/v1/auth/verify" && request.method === "POST") {
    if (!env.AUTH_APP_ORIGIN) return json({ error: "AUTH_NOT_CONFIGURED" }, 503);
    try {
      verifyCsrf(request, env);
      const body = await readJson(request);
      const email = requiredString(body.email, "email", 320).toLowerCase();
      const token = requiredString(body.code, "code", 12);
      if (!/^\d{6}$/.test(token) || Object.keys(body).some(key => !["email", "code"].includes(key))) {
        return json({ error: "OTP_INVALID" }, 400);
      }
      if (!env.AUTH_RATE_LIMITER) return json({ error: "AUTH_NOT_CONFIGURED" }, 503);
      const attemptLimit = await env.AUTH_RATE_LIMITER.limit({
        key: `auth-otp-verify:${request.headers.get("cf-connecting-ip") ?? "unknown"}:${await sha256Hex(email)}`,
      });
      if (!attemptLimit.success) return json({ error: "RATE_LIMITED" }, 429);
      const upstream = await authFetch(env, "/auth/v1/verify", { email, token, type: "email" });
      if (!upstream.ok) return json({ error: upstream.status === 429 ? "RATE_LIMITED" : "OTP_INVALID" }, upstream.status === 429 ? 429 : 401);
      const session = readSessionTokens(await upstream.json());
      if (env[GATEWAY_TRACE]) env[GATEWAY_TRACE]!.actorId = session.user!.id as string;
      traceEvent(env[GATEWAY_TRACE], "gateway.session_verified", { outcome: "authenticated" });
      const response = json({ status: "success", user_id: session.user!.id });
      const headers = new Headers(response.headers);
      headers.append("set-cookie", sessionCookie(ACCESS_COOKIE, session.access_token!, Math.min(Math.max(session.expires_in!, 60), 3600)));
      headers.append("set-cookie", sessionCookie(REFRESH_COOKIE, session.refresh_token!, 60 * 60 * 24 * 30));
      return new Response(response.body, { status: response.status, headers });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "AUTH_REQUEST_FAILED" }, Number((error as { status?: number }).status) || 400);
    }
  }
  if (pathname === "/v1/auth/refresh" && request.method === "POST") {
    if (!env.AUTH_APP_ORIGIN) return json({ error: "AUTH_NOT_CONFIGURED" }, 503);
    try {
      verifyCsrf(request, env);
      const refreshToken = cookie(request, REFRESH_COOKIE);
      if (!refreshToken) return clearSessionCookies(json({ error: "SESSION_REQUIRED" }, 401));
      const upstream = await authFetch(env, "/auth/v1/token?grant_type=refresh_token", { refresh_token: refreshToken });
      if (!upstream.ok) return clearSessionCookies(json({ error: "SESSION_INVALID" }, 401));
      const session = readSessionTokens(await upstream.json());
      if (env[GATEWAY_TRACE]) env[GATEWAY_TRACE]!.actorId = session.user!.id as string;
      traceEvent(env[GATEWAY_TRACE], "gateway.session_verified", { outcome: "authenticated" });
      const response = json({ status: "success", user_id: session.user!.id });
      const headers = new Headers(response.headers);
      headers.append("set-cookie", sessionCookie(ACCESS_COOKIE, session.access_token!, Math.min(Math.max(session.expires_in!, 60), 3600)));
      headers.append("set-cookie", sessionCookie(REFRESH_COOKIE, session.refresh_token!, 60 * 60 * 24 * 30));
      return new Response(response.body, { status: response.status, headers });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "AUTH_REQUEST_FAILED" }, Number((error as { status?: number }).status) || 400);
    }
  }
  if (pathname === "/v1/auth/logout" && request.method === "POST") {
    if (!env.AUTH_APP_ORIGIN) return json({ error: "AUTH_NOT_CONFIGURED" }, 503);
    try { verifyCsrf(request, env); } catch (error) {
      return json({ error: error instanceof Error ? error.message : "CSRF_REJECTED" }, 403);
    }
    traceEvent(env[GATEWAY_TRACE], "auth.logout_requested", { outcome: "received" });
    const token = cookie(request, ACCESS_COOKIE);
    let response = new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
    if (token) {
      const upstream = await authFetch(env, "/auth/v1/logout?scope=local", {}, token);
      if (!upstream.ok && upstream.status !== 401) response = json({ error: "AUTH_PROVIDER_UNAVAILABLE" }, 502);
    }
    return clearSessionCookies(response);
  }
  if (pathname === "/v1/auth/session" && request.method === "GET") {
    try {
      const { userId } = await authenticate(request, env);
      return json({ authenticated: true, user_id: userId });
    } catch (error) {
      return json({ authenticated: false, error: error instanceof Error ? error.message : "AUTH_INVALID" }, Number((error as { status?: number }).status) || 401);
    }
  }
  return null;
}

function clearOAuthCookie(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.append("set-cookie", `${OAUTH_VERIFIER_COOKIE}=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax`);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function workspacePage(userId: string): Response {
  const nonce = encodeBase64(crypto.getRandomValues(new Uint8Array(18)));
  return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>DNA OS Workspace</title><link rel="stylesheet" href="/assets/fonts/dna-fonts.css" nonce="${nonce}"><style nonce="${nonce}">*{box-sizing:border-box}body{margin:0;background:#f5f7fa;color:#152238;font:16px var(--font-ui)}.top{height:72px;padding:12px clamp(20px,6vw,80px);display:flex;align-items:center;justify-content:space-between;background:#fff}.top img{width:142px;height:48px;object-fit:contain}.top button{padding:10px 15px;border:1px solid #cbd5e1;border-radius:8px;background:#fff;color:#24466e;font-weight:650;cursor:pointer}main{max-width:1100px;margin:48px auto;padding:0 24px}h1{font-size:32px;margin:0 0 8px}p{color:#536782}.panel{margin-top:28px;padding:28px;border:1px solid #d9e1eb;border-radius:16px;background:#fff;min-height:280px}.panel small{color:#526782}#status{margin-top:18px;color:#2464a4}</style><header class="top"><img src="/assets/brand/dna-os/v1/dna-os-horizontal-color.png" alt="DNA OS"><button id="signout">Sign out</button></header><main><h1>Workspace</h1><p>Your DNA OS account is signed in.</p><section class="panel"><strong>Workspace</strong><p id="status">Your account session is active.</p><small>Account ID · ${userId}</small></section></main><script nonce="${nonce}">async function getCsrf(){const r=await fetch('/v1/auth/csrf',{credentials:'same-origin'});if(!r.ok)throw new Error();return (await r.json()).csrf_token}document.getElementById('signout').onclick=async()=>{try{const token=await getCsrf();await fetch('/v1/auth/logout',{method:'POST',credentials:'same-origin',headers:{'x-dna-csrf':token}})}finally{location.replace('/login')}};</script></html>`, { headers: {
    "content-type": "text/html; charset=utf-8", "cache-control": "no-store",
    "content-security-policy": `default-src 'none'; font-src 'self'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; img-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'`,
    "x-content-type-options": "nosniff", "referrer-policy": "no-referrer",
  } });
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) throw new Error("JSON_REQUIRED");
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > MAX_BODY) throw new Error("BODY_TOO_LARGE");
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error("INVALID_JSON"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("OBJECT_REQUIRED");
  return parsed as Record<string, unknown>;
}

async function authenticate(request: Request, env: Env): Promise<{ userId: string; token: string }> {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer ([\w.-]+)$/.exec(header);
  const bearerToken = match?.[1] ?? null;
  const sessionToken = bearerToken ? null : cookie(request, ACCESS_COOKIE);
  if (!bearerToken && !sessionToken) throw Object.assign(new Error("AUTH_REQUIRED"), { status: 401 });
  if (sessionToken) {
    if (!exactAppOrigin(request, env)) throw Object.assign(new Error("ORIGIN_REJECTED"), { status: 403 });
    if (request.method !== "GET") verifyCsrf(request, env);
  }
  const token = bearerToken ?? sessionToken!;
  const response = await fetch(`${env.SUPABASE_URL.replace(/\/$/, "")}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_ANON_KEY, authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw Object.assign(new Error("AUTH_INVALID"), { status: 401 });
  const user = await response.json() as { id?: unknown };
  if (typeof user.id !== "string" || !UUID_RE.test(user.id)) throw Object.assign(new Error("AUTH_INVALID"), { status: 401 });
  if (env[GATEWAY_TRACE]) env[GATEWAY_TRACE]!.actorId = user.id;
  traceEvent(env[GATEWAY_TRACE], "gateway.identity_verified", { outcome: "authenticated" });
  return { userId: user.id, token };
}

async function rpc(env: Env, name: string, args: Record<string, unknown>, token: string,
  schema = "public", serviceRole = false): Promise<unknown> {
  const key = serviceRole ? env.SUPABASE_SERVICE_ROLE_KEY : env.SUPABASE_ANON_KEY;
  if (!key) throw Object.assign(new Error("SERVICE_NOT_CONFIGURED"), { status: 503 });
  traceEvent(env[GATEWAY_TRACE], "gateway.rpc_requested", { backend: `${schema}.${name}`, outcome: "authorization_pending" });
  const response = await fetch(`${env.SUPABASE_URL.replace(/\/$/, "")}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: key, authorization: `Bearer ${serviceRole ? key : token}`, "content-type": "application/json",
      ...(schema === "public" ? {} : { "content-profile": schema, "accept-profile": schema }),
    },
    body: JSON.stringify(args),
  });
  const text = await response.text();
  if (!response.ok) {
    // Never return raw Postgres detail, SQL text, or upstream headers to a caller.
    let upstreamCode = "";
    try { upstreamCode = String((JSON.parse(text) as { code?: unknown }).code ?? ""); } catch { /* Keep response generic. */ }
    const message = text.includes("QUOTA_EXHAUSTED") ? "QUOTA_EXHAUSTED"
      : text.includes("IDENTITY_MISMATCH") ? "IDENTITY_MISMATCH"
      : text.includes("COMPANY_SELECTION_REQUIRED") ? "COMPANY_SELECTION_REQUIRED"
      : text.includes("COMPANY_ORGANIZATION_MISMATCH") ? "COMPANY_ACCESS_DENIED"
      : text.includes("COMPANY_ACCESS_DENIED") || text.includes("IDENTITY_ACCESS_DENIED") ? "COMPANY_ACCESS_DENIED"
      : text.includes("ACCESS_DENIED") ? "ACCESS_DENIED"
      : text.includes("OUT_OF_STOCK") ? "OUT_OF_STOCK"
      : text.includes("LISTING_NOT_ORDERABLE") ? "LISTING_NOT_ORDERABLE"
      : text.includes("ERP_INTEGRATION_AUTH_FAILED") ? "ERP_AUTH_FAILED"
      : text.includes("REQUIRED_DOCUMENTS_INCOMPLETE") ? "REQUIRED_DOCUMENTS_INCOMPLETE"
      : text.includes("LEGAL_DOCUMENT") ? "LEGAL_DOCUMENT_REJECTED"
      : text.includes("BUSINESS_VERIFICATION") || text.includes("DOCUMENTS_NOT_VERIFIED") ? "LEGAL_VERIFICATION_BLOCKED"
      : text.includes("PROHIBITED_GOODS_MATCH") ? "PROHIBITED_GOODS_MATCH"
      : text.includes("REQUIRED_LICENSE_MISSING") ? "REQUIRED_LICENSE_MISSING"
      : text.includes("PRODUCT_CATEGORY_NOT_APPROVED") ? "PRODUCT_CATEGORY_NOT_APPROVED"
      : text.includes("RESERVATIONS") ? "STOCK_CONFLICT"
      : text.includes("PGRST106") ? "DATABASE_SCHEMA_NOT_EXPOSED"
      : text.includes("PGRST202") ? "DATABASE_RPC_NOT_FOUND"
      : text.includes("PGRST204") ? "DATABASE_ARGUMENTS_MISMATCH"
      : upstreamCode === "42P01" ? "DATABASE_RELATION_MISSING"
      : upstreamCode === "42703" ? "DATABASE_COLUMN_MISSING"
      : upstreamCode === "42883" ? "DATABASE_FUNCTION_MISSING"
      : text.includes("COORDINATES_INVALID") ? "INVALID_INPUT"
      : response.status === 401 || response.status === 403 ? "ACCESS_DENIED" : "REQUEST_FAILED";
    const mappedStatus = message === "COMPANY_SELECTION_REQUIRED" ? 409
      : message === "COMPANY_ACCESS_DENIED" ? 403
      : response.status >= 400 && response.status < 500 ? response.status : 502;
    traceEvent(env[GATEWAY_TRACE], "gateway.rpc_rejected", { backend: `${schema}.${name}`, status: mappedStatus,
      reasonCode: upstreamCode === "42501" ? "authorization_denied" : "rpc_rejected" });
    throw Object.assign(new Error(message), { status: mappedStatus });
  }
  const result = text ? JSON.parse(text) : null;
  verifiedRpcContext(env[GATEWAY_TRACE], result);
  await resolveTraceScope(env, args, token, serviceRole);
  traceEvent(env[GATEWAY_TRACE], "gateway.rpc_completed", { backend: `${schema}.${name}`, outcome: "completed" });
  return result;
}

async function resolveTraceScope(env: Env, args: Record<string, unknown>, token: string, serviceRole: boolean): Promise<void> {
  const trace = env[GATEWAY_TRACE];
  if (!trace?.rpcAuthorized || trace.organizationId || !trace.actorId || serviceRole) return;
  // Audit enrichment only after the existing RPC accepted the operation.
  // Read minimal resource ownership using the caller's JWT and existing RLS.
  let path: string | null = null;
  if (typeof args.p_company_id === "string" && UUID_RE.test(args.p_company_id)) {
    path = `/rest/v1/companies?select=id,organization_id&id=eq.${args.p_company_id}`;
  } else if (typeof args.p_document_id === "string" && UUID_RE.test(args.p_document_id)) {
    path = `/rest/v1/business_documents?select=company_id,organization_id&id=eq.${args.p_document_id}`;
  } else if (typeof args.p_org_id === "string" && UUID_RE.test(args.p_org_id)) {
    path = `/rest/v1/org_members?select=organization_id&organization_id=eq.${args.p_org_id}&user_id=eq.${trace.actorId}`;
  }
  if (!path) return;
  try {
    const response = await fetch(`${env.SUPABASE_URL.replace(/\/$/, "")}${path}`, { headers: {
      apikey: env.SUPABASE_ANON_KEY, authorization: `Bearer ${token}`,
    } });
    if (!response.ok) throw new Error("scope_unavailable");
    const rows = await response.json() as Record<string, unknown>[];
    if (!Array.isArray(rows) || rows.length !== 1 || typeof rows[0].organization_id !== "string"
        || !UUID_RE.test(rows[0].organization_id)) throw new Error("scope_unavailable");
    trace.organizationId = rows[0].organization_id;
    const company = rows[0].company_id ?? rows[0].id;
    if (typeof company === "string" && UUID_RE.test(company)) trace.companyId = company;
    trace.scopeEvidence = "authorized_resource_read";
  } catch {
    traceEvent(trace, "gateway.scope_resolution_unavailable", { reasonCode: "audit_scope_unavailable" });
  }
}

function decodeBase64(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}
function encodeBase64(value: Uint8Array, urlSafe = false): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  const encoded = btoa(binary);
  return urlSafe ? encoded.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "") : encoded;
}
async function encryptCredentials(env: Env, credentials: Record<string, unknown>) {
  if (!env.ERP_CREDENTIALS_ENCRYPTION_KEY) throw Object.assign(new Error("SERVICE_NOT_CONFIGURED"), { status: 503 });
  const rawKey = decodeBase64(env.ERP_CREDENTIALS_ENCRYPTION_KEY);
  if (rawKey.length !== 32) throw Object.assign(new Error("SERVICE_NOT_CONFIGURED"), { status: 503 });
  const key = await crypto.subtle.importKey("raw", rawKey, "AES-GCM", false, ["encrypt"]);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(credentials));
  if (plaintext.length < 2 || plaintext.length > 8192) throw new Error("CREDENTIALS_SIZE_INVALID");
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, plaintext));
  return { ciphertext: encodeBase64(encrypted), nonce: encodeBase64(nonce), keyVersion: env.ERP_CREDENTIALS_KEY_VERSION || "v1" };
}
async function sha256Hex(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return [...digest].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
async function verifyLegalUploads(env: Env, token: string, orgId: string, documents: unknown[]): Promise<void> {
  if (documents.length < 1 || documents.length > 30) throw new Error("LEGAL_DOCUMENT_LIST_INVALID");
  let totalBytes = 0;
  for (const item of documents) {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("LEGAL_DOCUMENT_METADATA_INVALID");
    const doc = item as Record<string, unknown>;
    const objectPath = requiredString(doc.storage_object_path, "storage_object_path", 1024);
    if (!objectPath.startsWith(`${orgId}/`) || objectPath.includes("..")) throw new Error("LEGAL_DOCUMENT_PATH_INVALID");
    if (typeof doc.file_sha256 !== "string" || !/^[a-f0-9]{64}$/.test(doc.file_sha256)) throw new Error("LEGAL_DOCUMENT_HASH_INVALID");
    const encodedPath = objectPath.split("/").map(encodeURIComponent).join("/");
    const response = await fetch(`${env.SUPABASE_URL.replace(/\/$/, "")}/storage/v1/object/authenticated/org-legal-documents/${encodedPath}`, {
      headers: { apikey: env.SUPABASE_ANON_KEY, authorization: `Bearer ${token}`, "cache-control": "no-store" },
    });
    if (!response.ok) throw Object.assign(new Error("LEGAL_DOCUMENT_FILE_NOT_ACCESSIBLE"), { status: 400 });
    const mimeType = response.headers.get("content-type")?.split(";")[0] ?? "";
    const bytes = new Uint8Array(await response.arrayBuffer());
    totalBytes += bytes.byteLength;
    if (bytes.byteLength < 1 || bytes.byteLength > 10 * 1024 * 1024 || totalBytes > 20 * 1024 * 1024
      || bytes.byteLength !== doc.file_size_bytes || mimeType !== doc.mime_type) throw new Error("LEGAL_DOCUMENT_FILE_METADATA_MISMATCH");
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    const actualHash = [...digest].map(byte => byte.toString(16).padStart(2, "0")).join("");
    if (actualHash !== doc.file_sha256) throw new Error("LEGAL_DOCUMENT_HASH_MISMATCH");
  }
}

function requiredString(value: unknown, key: string, max = 240): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) throw new Error(`${key.toUpperCase()}_INVALID`);
  return value.trim();
}

function requiredUuid(value: unknown, key: string): string {
  const id = requiredString(value, key, 36);
  if (!UUID_RE.test(id)) throw new Error(`${key.toUpperCase()}_INVALID`);
  return id;
}

async function handleRequest(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    // One command envelope; dispatch uses existing handlers and their DB authority.
    // There is no caller-controlled URL, RPC name, role or execution backend.
    if (url.pathname === "/api/gateway") {
      if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
      try {
        const command = await readJson(request);
        if (Object.keys(command).some(key => !["capability_id", "input"].includes(key))
            || typeof command.capability_id !== "string" || !command.input
            || typeof command.input !== "object" || Array.isArray(command.input)) return json({ error: "GATEWAY_COMMAND_INVALID" }, 400);
        const tool = toolManifest.tools.find(tool => tool.name === command.capability_id);
        const route = tool ? `/v1/tools/${tool.name}` : new Map([
          ["stock.ingest", "/v1/integrations/stock-update"], ["demand.submit", "/v1/integrations/demand"],
          ["stock.fulfillment.confirm", "/v1/integrations/fulfillment"],
        ]).get(command.capability_id);
        if (!route) return json({ error: "CAPABILITY_NOT_AVAILABLE" }, 404);
        if (env[GATEWAY_TRACE]) env[GATEWAY_TRACE]!.capabilityId = command.capability_id;
        traceEvent(env[GATEWAY_TRACE], "gateway.capability_routed", { backend: route, outcome: "authorization_pending" });
        const internalUrl = new URL(route, url.origin);
        return handleRequest(new Request(internalUrl, { method: "POST", headers: request.headers,
          body: JSON.stringify(command.input) }), env);
      } catch {
        return json({ error: "GATEWAY_COMMAND_INVALID" }, 400);
      }
    }
    if (request.method === "GET" && url.pathname === "/") return landingPage();
    if (request.method === "GET" && url.pathname === "/connections") return connectionsPage();
    if (request.method === "GET" && ["/login", "/start"].includes(url.pathname)) return entryPage(env.AUTH_ONLY === "true");
    if (request.method === "GET" && url.pathname === "/workspace" && env.AUTH_ONLY === "true") {
      try {
        const { userId } = await authenticate(request, env);
        return workspacePage(userId);
      } catch {
        return new Response(null, { status: 303, headers: { location: `${env.AUTH_APP_ORIGIN || ""}/login?next=%2Fworkspace`, "cache-control": "no-store" } });
      }
    }
    if (env.AUTH_ONLY === "true" && !url.pathname.startsWith("/v1/auth/")
      && !url.pathname.startsWith("/auth/") && url.pathname !== "/health") return json({ error: "CAPABILITY_NOT_AVAILABLE" }, 404);
    if (env.ENTRY_ONLY === "true" && !url.pathname.startsWith("/v1/auth/")
      && !["/v1/tools/onboarding.read", "/v1/tools/onboarding.save", "/health"].includes(url.pathname)) {
      return json({ error: "CAPABILITY_NOT_AVAILABLE" }, 404);
    }
    if (request.method === "GET" && url.pathname === "/health") return json({ status: "ok" });
    if (request.method === "GET" && url.pathname === "/v1/tools") return json(toolManifest);
    const authResponse = await authRoute(request, env, url.pathname);
    if (authResponse) return authResponse;
    const integrationRoute = new Map<string, { binding: Env["STOCK_INGEST"]; targetPath: string; capability: string }>([
      ["/v1/integrations/stock-update", { binding: env.STOCK_INGEST, targetPath: "/api/integration/stock-update", capability: "stock.ingest" }],
      ["/v1/integrations/demand", { binding: env.DEMAND_INGEST, targetPath: "/api/integration/demand", capability: "demand.submit" }],
      ["/v1/integrations/fulfillment", { binding: env.FULFILLMENT_INGEST, targetPath: "/api/integration/fulfillment", capability: "stock.fulfillment.confirm" }],
    ]).get(url.pathname);
    if (integrationRoute) {
      const requestId = env[GATEWAY_TRACE]?.requestId ?? crypto.randomUUID();
      if (env[GATEWAY_TRACE]) env[GATEWAY_TRACE]!.capabilityId = integrationRoute.capability;
      const adapterId = request.headers.get("x-adapter-id") ?? "";
      const adapterToken = request.headers.get("x-adapter-token") ?? "";
      const gatewayLog = (status: number, reasonCode: string) => console.warn(JSON.stringify({
        event: "integration_gateway_request",
        request_id: requestId,
        adapter_id: UUID_RE.test(adapterId) ? adapterId : null,
        operation: integrationRoute.capability,
        status,
        reason_code: reasonCode,
      }));
      if (request.method !== "POST") {
        gatewayLog(405, "method_not_allowed");
        return json({ error: "METHOD_NOT_ALLOWED", request_id: requestId }, 405);
      }
      if (!env.GATEWAY_INTERNAL_SECRET || !integrationRoute.binding) {
        gatewayLog(503, "gateway_not_configured");
        return json({ error: "INTEGRATION_GATEWAY_NOT_CONFIGURED", request_id: requestId }, 503);
      }
      if (!UUID_RE.test(adapterId) || adapterToken.length < 32 || adapterToken.length > 256) {
        gatewayLog(401, "adapter_auth_required");
        return json({ error: "ADAPTER_AUTH_REQUIRED", request_id: requestId }, 401);
      }
      const contentLength = Number(request.headers.get("content-length") ?? "0");
      if (contentLength > MAX_BODY) {
        gatewayLog(413, "request_body_too_large");
        return json({ error: "REQUEST_BODY_TOO_LARGE", request_id: requestId }, 413);
      }
      const limit = await env.RATE_LIMITER?.limit({ key: `integration-adapter:${adapterId}` });
      if (limit && !limit.success) {
        gatewayLog(429, "rate_limited");
        return json({ error: "RATE_LIMITED", request_id: requestId }, 429);
      }
      let body: ArrayBuffer;
      try {
        body = await request.arrayBuffer();
        if (body.byteLength > MAX_BODY) {
          gatewayLog(413, "request_body_too_large");
          return json({ error: "REQUEST_BODY_TOO_LARGE", request_id: requestId }, 413);
        }
      } catch {
        gatewayLog(400, "request_body_invalid");
        return json({ error: "REQUEST_BODY_INVALID", request_id: requestId }, 400);
      }
      const headers = new Headers({
        "content-type": request.headers.get("content-type") ?? "application/json",
        "x-adapter-id": adapterId,
        "x-adapter-token": adapterToken,
        "x-dna-request-id": requestId,
        "x-dna-capability": integrationRoute.capability,
        "x-dna-gateway-secret": env.GATEWAY_INTERNAL_SECRET,
      });
      const internalRequest = new Request(`https://dnaos.internal${integrationRoute.targetPath}`, { method: "POST", headers, body });
      let internalResponse: Response;
      traceEvent(env[GATEWAY_TRACE], "gateway.worker_dispatched", { backend: integrationRoute.capability, outcome: "authorization_pending" });
      try { internalResponse = await integrationRoute.binding.fetch(internalRequest); }
      catch {
        gatewayLog(502, "service_binding_failed");
        return json({ error: "INTEGRATION_SERVICE_UNAVAILABLE", request_id: requestId }, 502);
      }
      gatewayLog(internalResponse.status, internalResponse.ok ? "completed" : "worker_rejected");
      if (internalResponse.ok && env[GATEWAY_TRACE]) {
        env[GATEWAY_TRACE]!.adapterId = adapterId;
        env[GATEWAY_TRACE]!.rpcAuthorized = true;
      }
      traceEvent(env[GATEWAY_TRACE], "gateway.worker_returned", { backend: integrationRoute.capability,
        status: internalResponse.status, outcome: internalResponse.ok ? "completed" : "rejected_or_failed" });
      const responseHeaders = new Headers(internalResponse.headers);
      responseHeaders.set("x-dna-request-id", requestId);
      responseHeaders.set("cache-control", "no-store");
      return new Response(internalResponse.body, { status: internalResponse.status, statusText: internalResponse.statusText, headers: responseHeaders });
    }
    if (request.method === "POST" && url.pathname === "/v1/secure/business/identity") {
      if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return json({ error: "SERVICE_NOT_CONFIGURED" }, 503);
      try {
        const { token } = await authenticate(request, env);
        const body = await readJson(request);
        if (Object.keys(body).some(key => !["org_id", "company_id", "entity_type", "operation_type", "registration_no", "tax_id", "registered_capital"].includes(key))) throw new Error("IDENTITY_INPUT_INVALID");
        if (body.registered_capital != null && (typeof body.registered_capital !== "number" || !Number.isFinite(body.registered_capital) || body.registered_capital < 0)) throw new Error("REGISTERED_CAPITAL_INVALID");
        const result = await rpc(env, "register_business_identity_for_company", {
          p_org_id: requiredUuid(body.org_id, "org_id"),
          p_company_id: requiredUuid(body.company_id, "company_id"),
          p_entity_type: requiredString(body.entity_type, "entity_type", 20),
          p_operation_type: requiredString(body.operation_type, "operation_type", 40),
          p_registration_no: body.registration_no == null ? null : requiredString(body.registration_no, "registration_no", 64),
          p_tax_id: requiredString(body.tax_id, "tax_id", 13),
          p_registered_capital: body.registered_capital == null ? null : body.registered_capital,
        }, token);
        return json({ status: "success", data: result });
      } catch (error) {
        const message = error instanceof Error ? error.message : "REQUEST_FAILED";
        return json({ error: message }, Number((error as { status?: number }).status) || 400);
      }
    }
    if (request.method === "POST" && url.pathname === "/v1/secure/platform/connect") {
      if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY || !env.ERP_CREDENTIALS_ENCRYPTION_KEY) return json({ error: "SERVICE_NOT_CONFIGURED" }, 503);
      try {
        const { token } = await authenticate(request, env);
        const body = await readJson(request);
        if (!body.credentials || typeof body.credentials !== "object" || Array.isArray(body.credentials)
          || Object.keys(body).some(key => !["org_id", "platform_code", "credentials"].includes(key))) throw new Error("PLATFORM_CREDENTIALS_INVALID");
        const encoded = await encryptCredentials(env, body.credentials as Record<string, unknown>);
        const result = await rpc(env, "connect_platform", {
          p_org_id: requiredUuid(body.org_id, "org_id"),
          p_platform_code: requiredString(body.platform_code, "platform_code", 64),
          p_credentials_ciphertext: encoded.ciphertext, p_credentials_nonce: encoded.nonce,
          p_key_version: encoded.keyVersion,
        }, token, "system");
        return json({ status: "success", data: result });
      } catch (error) {
        const message = error instanceof Error ? error.message : "REQUEST_FAILED";
        return json({ error: message }, Number((error as { status?: number }).status) || 400);
      }
    }
    if (request.method === "POST" && url.pathname === "/v1/secure/erp/connect") {
      if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY || !env.ERP_CREDENTIALS_ENCRYPTION_KEY) return json({ error: "SERVICE_NOT_CONFIGURED" }, 503);
      try {
        const { userId, token } = await authenticate(request, env);
        const limit = await env.RATE_LIMITER?.limit({ key: `erp-connect:${userId}` });
        if (limit && !limit.success) return json({ error: "RATE_LIMITED" }, 429);
        const body = await readJson(request);
        const orgId = requiredUuid(body.org_id, "org_id");
        if (!(["custom", "shopee", "lazada"] as unknown[]).includes(body.provider)) throw new Error("PROVIDER_NOT_SUPPORTED");
        if (!body.credentials || typeof body.credentials !== "object" || Array.isArray(body.credentials)
          || Object.keys(body).some(key => !["org_id", "provider", "credentials"].includes(key))) throw new Error("ERP_CREDENTIALS_INVALID");
        const encoded = await encryptCredentials(env, body.credentials as Record<string, unknown>);
        const ingestToken = encodeBase64(crypto.getRandomValues(new Uint8Array(32)), true);
        const result = await rpc(env, "connect_erp", {
          p_org_id: orgId, p_provider: body.provider, p_credentials_ciphertext: encoded.ciphertext,
          p_credentials_nonce: encoded.nonce, p_key_version: encoded.keyVersion,
          p_ingest_token_sha256: await sha256Hex(ingestToken),
        }, token, "system");
        // Shown once to the authenticated setup client; never logged or returned by status tools.
        return json({ status: "success", data: { ...(result as object), ingest_token: ingestToken,
          ingest_endpoint: "/v1/integrations/{integration_id}/sync", token_display: "one_time" } });
      } catch (error) {
        const message = error instanceof Error ? error.message : "REQUEST_FAILED";
        return json({ error: message }, Number((error as { status?: number }).status) || 400);
      }
    }
    const integrationSync = /^\/v1\/integrations\/([0-9a-f-]{36})\/sync$/i.exec(url.pathname);
    if (request.method === "POST" && integrationSync) {
      if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY || !env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: "SERVICE_NOT_CONFIGURED" }, 503);
      try {
        const secret = request.headers.get("x-erp-ingest-token") ?? "";
        if (secret.length < 32 || secret.length > 256) return json({ error: "ERP_AUTH_FAILED" }, 401);
        const limit = await env.RATE_LIMITER?.limit({ key: `erp:${integrationSync[1]}` });
        if (limit && !limit.success) return json({ error: "RATE_LIMITED" }, 429);
        const body = await readJson(request);
        if (Object.keys(body).some(key => !["company_id", "listings"].includes(key)) || !Array.isArray(body.listings)) return json({ error: "ERP_SNAPSHOT_INVALID" }, 400);
        const result = await rpc(env, "sync_erp_snapshot_for_company", {
          p_integration_id: integrationSync[1], p_ingest_token: secret,
          p_company_id: requiredUuid(body.company_id, "company_id"), p_listings: body.listings,
        }, "", "system", true);
        const { organization_id: _internalOrgId, ...safeResult } = result as Record<string, unknown>;
        return json({ status: "success", data: safeResult });
      } catch (error) {
        const message = error instanceof Error ? error.message : "REQUEST_FAILED";
        return json({ error: message }, Number((error as { status?: number }).status) || 400);
      }
    }
    if (request.method !== "POST" || !url.pathname.startsWith("/v1/tools/")) return json({ error: "NOT_FOUND" }, 404);
    if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return json({ error: "SERVICE_NOT_CONFIGURED" }, 503);
    try {
      const { userId, token } = await authenticate(request, env);
      const limit = await env.RATE_LIMITER?.limit({ key: userId });
      if (limit && !limit.success) return json({ error: "RATE_LIMITED" }, 429);
      const body = await readJson(request);
      // Identity is derived from the verified session. Caller/model-supplied user_id is never accepted.
      if (["user_id", "organization_id", "actor_id", "actor_user_id", "tenant_id", "permission", "request_id"]
          .some(key => Object.hasOwn(body, key))) {
        return json({ error: "IDENTITY_FIELDS_NOT_ACCEPTED" }, 400);
      }
      let result: unknown;
      switch (url.pathname) {
        case "/v1/tools/onboarding.read": {
          if (Object.keys(body).length) throw new Error("INPUT_INVALID");
          const response = await fetch(`${env.SUPABASE_URL.replace(/\/$/, "")}/auth/v1/user`, {
            headers: { apikey: env.SUPABASE_ANON_KEY, authorization: `Bearer ${token}` },
          });
          if (!response.ok) throw Object.assign(new Error("AUTH_INVALID"), { status: 401 });
          const user = await response.json() as { id: string; user_metadata?: { dnaos_onboarding_v1?: unknown } };
          if (user.id !== userId) throw Object.assign(new Error("AUTH_INVALID"), { status: 401 });
          return json({ data: user.user_metadata?.dnaos_onboarding_v1 ?? null });
        }
        case "/v1/tools/onboarding.save": {
          // Self-declared intake only. Never consumed as membership, ownership,
          // verified legal identity, capability or authorization evidence.
          if (Object.keys(body).some(key => !["display_name", "roles", "details"].includes(key))) throw new Error("INPUT_INVALID");
          const displayName = requiredString(body.display_name, "display_name", 120);
          const allowedRoles = ["driver", "business_owner", "employee", "service_provider"];
          if (!Array.isArray(body.roles) || body.roles.length < 1 || body.roles.length > 4
            || body.roles.some(role => typeof role !== "string" || !allowedRoles.includes(role))
            || new Set(body.roles).size !== body.roles.length) throw new Error("ROLES_INVALID");
          if (!body.details || typeof body.details !== "object" || Array.isArray(body.details)) throw new Error("DETAILS_INVALID");
          const details = body.details as Record<string, unknown>;
          const allowedFields = ["business_name", "activities", "vehicle_type", "service_area", "needs"];
          if (Object.keys(details).some(key => !allowedFields.includes(key))) throw new Error("DETAILS_INVALID");
          const cleanDetails: Record<string, string> = {};
          for (const [key, value] of Object.entries(details)) {
            if (typeof value !== "string" || value.length > 500) throw new Error("DETAILS_INVALID");
            cleanDetails[key] = value.trim();
          }
          if (body.roles.includes("driver") && (!cleanDetails.vehicle_type || !cleanDetails.service_area)) throw new Error("DRIVER_DETAILS_REQUIRED");
          if (body.roles.includes("business_owner") && (!cleanDetails.business_name || !cleanDetails.activities)) throw new Error("BUSINESS_DETAILS_REQUIRED");
          const intake = { version: 1, display_name: displayName, roles: body.roles, details: cleanDetails,
            status: "SELF_DECLARED", updated_at: new Date().toISOString() };
          const response = await fetch(`${env.SUPABASE_URL.replace(/\/$/, "")}/auth/v1/user`, {
            method: "PUT", headers: { apikey: env.SUPABASE_ANON_KEY, authorization: `Bearer ${token}`, "content-type": "application/json" },
            body: JSON.stringify({ data: { dnaos_onboarding_v1: intake } }),
          });
          if (!response.ok) throw Object.assign(new Error("PROFILE_SAVE_FAILED"), { status: 502 });
          const user = await response.json() as { id?: unknown };
          if (user.id !== userId) throw Object.assign(new Error("AUTH_INVALID"), { status: 401 });
          return json({ status: "saved", data: intake });
        }
        case "/v1/tools/onboard_business": {
          const shopName = requiredString(body.shop_name, "shop_name", 160);
          const lat = body.lat; const lng = body.lng;
          if (typeof lat !== "number" || !Number.isFinite(lat) || lat < -90 || lat > 90
            || typeof lng !== "number" || !Number.isFinite(lng) || lng < -180 || lng > 180) throw new Error("COORDINATES_INVALID");
          result = await rpc(env, "onboard_business", { p_user_id: userId, p_shop_name: shopName, p_lat: lat, p_lng: lng }, token);
          break;
        }
        case "/v1/tools/request_business_document":
          result = await rpc(env, "request_business_document", {
            p_company_id: requiredUuid(body.company_id, "company_id"),
            p_document_type: requiredString(body.document_type, "document_type", 64).toLowerCase(),
          }, token);
          break;
        case "/v1/tools/submit_business_document": {
          const documentUrl = requiredString(body.document_url, "document_url", 2048);
          if (new URL(documentUrl).protocol !== "https:") throw new Error("HTTPS_DOCUMENT_URL_REQUIRED");
          result = await rpc(env, "submit_business_document", {
            p_document_id: requiredUuid(body.document_id, "document_id"), p_document_url: documentUrl,
          }, token);
          break;
        }
        case "/v1/tools/consume_ai_interview_turn":
          result = await rpc(env, "consume_ai_interview_turn", { p_company_id: requiredUuid(body.company_id, "company_id") }, token);
          break;
        case "/v1/tools/report_business_quotas":
          result = await rpc(env, "report_business_quotas", { p_company_id: requiredUuid(body.company_id, "company_id") }, token);
          break;
        case "/v1/tools/submit_identity_documents":
          if (!Array.isArray(body.documents)) throw new Error("LEGAL_DOCUMENT_LIST_INVALID");
          await verifyLegalUploads(env, token, requiredUuid(body.org_id, "org_id"), body.documents);
          result = await rpc(env, "submit_identity_documents", {
            p_org_id: requiredUuid(body.org_id, "org_id"), p_docs_json: body.documents,
          }, token, "system");
          break;
        case "/v1/tools/check_product_listing":
          if (Object.keys(body).some(key => !["org_id", "title", "description", "category_code"].includes(key))) throw new Error("PRODUCT_LISTING_INPUT_INVALID");
          result = await rpc(env, "check_product_listing", {
            p_org_id: requiredUuid(body.org_id, "org_id"), p_title: requiredString(body.title, "title", 300),
            p_description: typeof body.description === "string" ? body.description.slice(0, 2000) : "",
            p_category_code: requiredString(body.category_code, "category_code", 64),
          }, token, "system");
          break;
        case "/v1/tools/connect_platform":
          result = { status: "credentials_required", org_id: requiredUuid(body.org_id, "org_id"),
            platform_code: requiredString(body.platform_code, "platform_code", 64),
            secure_setup_endpoint: "/v1/secure/platform/connect",
            instruction: "Submit credentials through secure platform setup; never include them in AI chat." };
          break;
        case "/v1/tools/connect_erp": {
          const orgId = requiredUuid(body.org_id, "org_id");
          if (!(["custom", "shopee", "lazada"] as unknown[]).includes(body.provider)) throw new Error("PROVIDER_NOT_SUPPORTED");
          result = { status: "credentials_required", org_id: orgId, provider: body.provider,
            secure_setup_endpoint: "/v1/secure/erp/connect", instruction: "Submit credentials through the secure connection form; never include them in AI chat." };
          break;
        }
        case "/v1/tools/sync_erp_snapshot": {
          if (Object.keys(body).some(key => !["integration_id", "company_id", "listings"].includes(key))) throw new Error("ERP_SNAPSHOT_INVALID");
          if (!Array.isArray(body.listings) || body.listings.length < 1 || body.listings.length > 200) throw new Error("ERP_SNAPSHOT_INVALID");
          result = await rpc(env, "sync_erp_snapshot_for_company", {
            p_integration_id: requiredUuid(body.integration_id, "integration_id"),
            p_ingest_token: null,
            p_company_id: requiredUuid(body.company_id, "company_id"),
            p_listings: body.listings,
          }, token, "system");
          const { organization_id: _internalOrgId, ...safeResult } = result as Record<string, unknown>;
          result = safeResult;
          break;
        }
        case "/v1/tools/create_order": {
          const sellerOrgId = requiredUuid(body.seller_org_id, "seller_org_id");
          const buyerOrgId = requiredUuid(body.buyer_org_id, "buyer_org_id");
          if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 50) throw new Error("ORDER_ITEMS_INVALID");
          const items = body.items.map((item: unknown) => {
            if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("ORDER_ITEM_INVALID");
            const row = item as Record<string, unknown>;
            if (typeof row.quantity !== "number" || !Number.isFinite(row.quantity) || row.quantity <= 0) throw new Error("ORDER_ITEM_INVALID");
            return { listing_id: requiredUuid(row.listing_id, "listing_id"), quantity: row.quantity };
          });
          result = await rpc(env, "create_order", {
            p_seller_org_id: sellerOrgId, p_buyer_org_id: buyerOrgId, p_items_json: items,
          }, token, "system");
          break;
        }
        default: return json({ error: "TOOL_NOT_FOUND" }, 404);
      }
      return json({ status: "success", data: result });
    } catch (error) {
      const message = error instanceof Error ? error.message : "REQUEST_FAILED";
      const status = Number((error as { status?: number }).status) || 400;
      return json({ error: message }, status);
    }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const trace: GatewayTrace = { requestId: crypto.randomUUID(), capabilityId: null, actorId: null, adapterId: null,
      organizationId: null, companyId: null, startedAt: Date.now(), rpcAuthorized: false, scopeEvidence: "not_resolved" };
    const scopedEnv: Env = { ...env, [GATEWAY_TRACE]: trace };
    const url = new URL(request.url);
    const directTool = toolManifest.tools.find(tool => url.pathname === `/v1/tools/${tool.name}`);
    if (directTool) trace.capabilityId = directTool.name;
    if (["csrf", "otp", "verify", "refresh", "logout", "session"].some(name => url.pathname === `/v1/auth/${name}`)) {
      trace.capabilityId = `auth.${url.pathname.split("/").at(-1)}`;
    }
    traceEvent(trace, "gateway.request_received", { outcome: "received" });
    let response: Response;
    try {
    if (request.method === "OPTIONS") {
      response = !exactAppOrigin(request, scopedEnv) ? json({ error: "ORIGIN_REJECTED" }, 403)
        : new Response(null, { status: 204 });
    } else {
      response = await handleRequest(request, scopedEnv);
    }
    } catch {
      response = json({ error: "GATEWAY_UNAVAILABLE" }, 502);
    }
    traceEvent(trace, "gateway.request_completed", { status: response.status,
      outcome: response.ok ? "completed" : "rejected_or_failed" });
    if (response.status === 401 || response.status === 403 || response.status >= 500) {
      traceEvent(trace, "gateway.alert_candidate", { status: response.status,
        reasonCode: response.status >= 500 ? "backend_failure" : "access_rejected" });
    }
    const headers = new Headers(response.headers);
    headers.set("x-dna-request-id", trace.requestId);
    return withCors(request, new Response(response.body, { status: response.status, headers }), scopedEnv);
  },
};
