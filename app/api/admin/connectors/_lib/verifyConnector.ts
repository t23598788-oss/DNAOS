/**
 * L1 (config) gate for the central Connector test endpoint.
 *
 * Level split (docs/INTEGRATION_PLUGIN_CONSOLE.md §4):
 *   L1 config     — this file. Shape/presence only, no network.
 *   L2 credential — gateway/connectors.ts#runConnectorTest (the canonical Test
 *                   stage: real outbound request per auth_type).
 *
 * Rules this file obeys:
 *   - No network, no database: it is pure so an acceptance test can prove it
 *     without a live connector (scripts/connector-verify-test.ts).
 *   - No secret VALUE ever leaves here: presence is answered with a boolean,
 *     and errors name FIELD KEYS only, never the value.
 *   - `ConnectorAuthType` is imported as a type from the one vocabulary
 *     (core/connector-loader.ts), never re-declared.
 */
import type { ConnectorAuthType } from "@/core/connector-loader"
import { resolveBearerCredential } from "@/engines/connectors/tester"

export interface ConfigCheck {
  ok: boolean
  /** Human-readable reason for a failed L1; never contains a secret value. */
  error?: string
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function isHttpsUrl(value: unknown): boolean {
  const raw = text(value)
  if (!raw) return false
  try {
    return new URL(raw).protocol === "https:"
  } catch {
    return false
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

// ── มิเตอร์ตัวที่ 1 (L1): วัดรูปแบบ config ไม่ยิง network ─────────────
// @io in  verifier.l1               meter=verify_calls
export function validateConnectorConfig(
  authType: ConnectorAuthType,
  rawConfig: unknown,
  rawSecret: unknown
): ConfigCheck {
  const config = asRecord(rawConfig)
  const secret = asRecord(rawSecret)

  switch (authType) {
    case "token":
    case "api_key": {
      if (!isHttpsUrl(config.base_url)) return { ok: false, error: "L1: base_url ต้องเป็น https URL" }
      // Presence is answered by the SAME resolver L2 uses to build the header,
      // so L1 can never accept a credential that the tester will not send.
      if (!resolveBearerCredential(secret)) {
        return { ok: false, error: "L1: ยังไม่มี bearer credential ที่ tester จะส่งได้ (ตั้ง secret ให้ตรงกับที่ connector ใช้งาน)" }
      }
      if (config.test_path !== undefined && typeof config.test_path !== "string") {
        return { ok: false, error: "L1: test_path ต้องเป็น string" }
      }
      return { ok: true }
    }
    case "oauth": {
      if (!text(secret.access_token)) {
        return { ok: false, error: "L1: ยังไม่ได้ทำ OAuth authorize — กด Connect เพื่อเริ่ม flow" }
      }
      if (config.test_url !== undefined && config.test_url !== "" && !isHttpsUrl(config.test_url)) {
        return { ok: false, error: "L1: test_url ต้องเป็น https URL" }
      }
      return { ok: true }
    }
    case "login": {
      if (!isHttpsUrl(config.login_url)) return { ok: false, error: "L1: login_url ต้องเป็น https URL" }
      if (!text(secret.username) || !text(secret.password)) {
        return { ok: false, error: "L1: ต้องมี username และ password" }
      }
      return { ok: true }
    }
    case "uri": {
      if (!isHttpsUrl(config.url)) return { ok: false, error: "L1: url ต้องเป็น https URL" }
      if (config.method !== undefined && !["GET", "POST", "PUT", "PATCH", "DELETE"].includes(text(config.method).toUpperCase())) {
        return { ok: false, error: "L1: method ไม่ถูกต้อง" }
      }
      return { ok: true }
    }
    case "mcp": {
      if (!isHttpsUrl(config.url)) return { ok: false, error: "L1: MCP server url ต้องเป็น https URL" }
      return { ok: true }
    }
    case "webhook": {
      if (!text(config.receiving_path)) return { ok: false, error: "L1: ยังไม่มี receiving_path" }
      if (!text(config.signature_header)) return { ok: false, error: "L1: webhook ต้องระบุ signature_header" }
      return { ok: true }
    }
    default:
      return { ok: false, error: `L1: ไม่รู้จัก auth_type: ${String(authType)}` }
  }
}
