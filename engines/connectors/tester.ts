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
