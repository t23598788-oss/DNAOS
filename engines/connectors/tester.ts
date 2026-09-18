/**
 * Connector Tester — ตรวจสอบการเชื่อมต่อจริงตาม auth_type
 *
 * ทุก test ยิง request จริงออกไปหาบริการภายนอก ไม่มี mock/fake
 * ผลลัพธ์ใช้ตัดสิน status ที่บันทึกกลับลงตาราง connectors
 */

import type { ConnectorAuthType } from "@/core/connector-loader";

export interface TestResult {
  ok: boolean;
  error?: string;
}

const TIMEOUT_MS = 8000;

async function timedFetch(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function buildAuthHeader(config: Record<string, unknown>, secret: Record<string, unknown>): Record<string, string> {
  const headerName = (config.header_name as string) || "Authorization";
  const headerPrefix = config.header_prefix !== undefined ? String(config.header_prefix) : "Bearer ";
  const value = (secret.api_key as string) ?? (secret.token as string) ?? "";
  if (!value) return {};
  return { [headerName]: `${headerPrefix}${value}` };
}

async function testLogin(config: Record<string, unknown>, secret: Record<string, unknown>): Promise<TestResult> {
  const loginUrl = config.login_url as string;
  if (!loginUrl) return { ok: false, error: "ยังไม่ได้ระบุ login_url" };
  const usernameField = (config.username_field as string) || "username";
  const passwordField = (config.password_field as string) || "password";

  const res = await timedFetch(loginUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      [usernameField]: secret.username ?? "",
      [passwordField]: secret.password ?? "",
    }),
  });

  if (!res.ok) return { ok: false, error: `login_url ตอบกลับ HTTP ${res.status}` };
  return { ok: true };
}

/**
 * GitHub-specific real check (TASK-073, capability #62 STEP 7) — the one
 * new outbound execution call this task adds. GitHub's own REST docs
 * recommend `Accept: application/vnd.github+json` +
 * `X-GitHub-Api-Version` on every call, and a real GET /user response
 * always includes a "login" field — checking for it (rather than
 * trusting any HTTP 200) is what makes this a real GitHub-shaped check
 * instead of a generic ping that happens to reuse GitHub's URL: a
 * misconfigured test_url that still returns 200 with an unrelated body
 * must NOT be reported as ok:true.
 */
async function testGithubUser(testUrl: string, accessToken: string): Promise<TestResult> {
  const res = await timedFetch(testUrl, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!res.ok) return { ok: false, error: `GitHub API (${testUrl}) ตอบกลับ HTTP ${res.status}` };
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { ok: false, error: "GitHub API ไม่ตอบกลับเป็น JSON ที่ถูกต้อง" };
  }
  const login = body && typeof body === "object" ? (body as Record<string, unknown>).login : undefined;
  if (typeof login !== "string" || !login) {
    return { ok: false, error: 'GitHub API ตอบกลับ 200 แต่ body ไม่ใช่ user object จริง (ไม่มี field "login") — ปฏิเสธเพื่อกันผลบวกลวง' };
  }
  return { ok: true };
}

/**
 * Railway-specific real check — mirrors the GitHub-shaped check above
 * (TASK-073) and reuses this SAME [id]/test route pattern, never a
 * parallel test mechanism. Railway's Public API is GraphQL-only
 * (POST https://backboard.railway.com/graphql/v2): the generic GET ping
 * can never honestly pass against it, AND a bare HTTP 200 is insufficient
 * evidence — Railway's real error convention is HTTP 200 + a non-empty
 * errors[] array. So the real check is a GraphQL `me { id }` query whose
 * body must contain data.me.id — a wrong/missing token is reported
 * failed, never silently 200-passed.
 */
async function testRailwayGraphql(testUrl: string, accessToken: string): Promise<TestResult> {
  const res = await timedFetch(testUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify({ query: "query { me { id } }" }),
  });
  if (!res.ok) return { ok: false, error: `Railway API (${testUrl}) ตอบกลับ HTTP ${res.status}` };
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { ok: false, error: "Railway API ไม่ตอบกลับเป็น JSON ที่ถูกต้อง" };
  }
  const b = body as { errors?: { message?: string }[]; data?: { me?: { id?: unknown } } } | null;
  if (b?.errors?.length) {
    return { ok: false, error: `Railway API ปฏิเสธการเข้าถึง: ${b.errors[0]?.message ?? "unknown error"}` };
  }
  const id = b?.data?.me?.id;
  if (typeof id !== "string" || !id) {
    return { ok: false, error: 'Railway API ตอบกลับ 200 แต่ไม่ใช่ identity จริง (ไม่มี data.me.id) — ปฏิเสธเพื่อกันผลบวกลวง' };
  }
  return { ok: true };
}

async function testOAuth(config: Record<string, unknown>, secret: Record<string, unknown>): Promise<TestResult> {
  const accessToken = secret.access_token as string | undefined;
  if (!accessToken) {
    return { ok: false, error: "ยังไม่ได้ทำ OAuth authorize — กดปุ่ม Connect เพื่อเริ่ม flow" };
  }
  const expiresAt = secret.expires_at as string | undefined;
  if (expiresAt && new Date(expiresAt).getTime() < Date.now()) {
    return { ok: false, error: "access_token หมดอายุแล้ว — ต้อง refresh หรือ authorize ใหม่" };
  }
  const testUrl = config.test_url as string | undefined;
  if (!testUrl) return { ok: true };

  // GitHub-specific real check — reuses this SAME [id]/test route
  // pattern, never a new/parallel test mechanism (registered by
  // scripts/register-github-oauth-connector.ts's config.test_url, exactly
  // like every other provider's test_url handled generically below).
  if (testUrl.includes("api.github.com")) {
    return await testGithubUser(testUrl, accessToken);
  }

  const res = await timedFetch(testUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return { ok: false, error: `test_url ตอบกลับ HTTP ${res.status}` };
  return { ok: true };
}

async function testApiKeyOrToken(config: Record<string, unknown>, secret: Record<string, unknown>): Promise<TestResult> {
  const baseUrl = config.base_url as string;
  if (!baseUrl) return { ok: false, error: "ยังไม่ได้ระบุ base_url" };
  const testPath = (config.test_path as string) || "";
  const url = testPath ? `${baseUrl.replace(/\/$/, "")}/${testPath.replace(/^\//, "")}` : baseUrl;

  // Railway-shaped real check (same reasoning as the GitHub check in
  // testOAuth above): GraphQL POST + body-level identity, because the
  // generic GET ping cannot honestly test a GraphQL-only provider.
  if (url.includes("backboard.railway")) {
    return await testRailwayGraphql(url, (secret.api_key as string) ?? (secret.token as string) ?? "");
  }

  const res = await timedFetch(url, {
    method: "GET",
    headers: buildAuthHeader(config, secret),
  });
  if (!res.ok) return { ok: false, error: `${url} ตอบกลับ HTTP ${res.status}` };
  return { ok: true };
}

async function testUri(config: Record<string, unknown>, secret: Record<string, unknown>): Promise<TestResult> {
  const url = config.url as string;
  if (!url) return { ok: false, error: "ยังไม่ได้ระบุ url" };
  const method = (config.method as string) || "GET";

  const res = await timedFetch(url, {
    method,
    headers: buildAuthHeader(config, secret),
  });
  if (!res.ok) return { ok: false, error: `${url} ตอบกลับ HTTP ${res.status}` };
  return { ok: true };
}

async function testMcp(config: Record<string, unknown>, secret: Record<string, unknown>): Promise<TestResult> {
  const url = config.url as string;
  if (!url) return { ok: false, error: "ยังไม่ได้ระบุ MCP server url" };

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const authToken = secret.auth_token as string | undefined;
  if (authToken) headers.Authorization = `Bearer ${authToken}`;

  const res = await timedFetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "dna-os-connectors", version: "1.0.0" },
      },
    }),
  });

  if (!res.ok) return { ok: false, error: `MCP server ตอบกลับ HTTP ${res.status}` };
  try {
    const body = await res.json();
    if (body.error) return { ok: false, error: `MCP error: ${body.error.message ?? JSON.stringify(body.error)}` };
    return { ok: true };
  } catch {
    return { ok: false, error: "MCP server ไม่ตอบกลับเป็น JSON-RPC ที่ถูกต้อง" };
  }
}

async function testWebhook(config: Record<string, unknown>): Promise<TestResult> {
  // Webhook เป็นทิศทาง inbound — ไม่มี handshake ขาออกให้ทดสอบ
  // "เชื่อมสำเร็จ" หมายถึง endpoint รับ event พร้อมใช้งานแล้ว
  if (!config.receiving_path) return { ok: false, error: "ยังไม่มี receiving_path — สร้าง Connector ใหม่อีกครั้ง" };
  return { ok: true };
}

export async function testConnector(
  authType: ConnectorAuthType,
  config: Record<string, unknown>,
  secret: Record<string, unknown>
): Promise<TestResult> {
  try {
    switch (authType) {
      case "login": return await testLogin(config, secret);
      case "oauth": return await testOAuth(config, secret);
      case "api_key": return await testApiKeyOrToken(config, secret);
      case "token": return await testApiKeyOrToken(config, secret);
      case "uri": return await testUri(config, secret);
      case "mcp": return await testMcp(config, secret);
      case "webhook": return await testWebhook(config);
      default: return { ok: false, error: `ไม่รู้จัก auth_type: ${authType}` };
    }
  } catch (e) {
    const err = e as Error;
    if (err.name === "AbortError") return { ok: false, error: `หมดเวลา (${TIMEOUT_MS / 1000}s) — บริการปลายทางไม่ตอบสนอง` };
    return { ok: false, error: err.message };
  }
}
