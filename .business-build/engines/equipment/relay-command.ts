/**
 * Equipment GPS/Relay Command Engine (owner spec, 2026-07-24).
 *
 * HONESTY NOTE — two real unknowns, not guessed, per this project's own
 * "ห้ามเดา" principle:
 * 1. No SMS gateway provider chosen yet. sendRelayCommand() below is real,
 *    structured code, but gates cleanly with a clear error until
 *    SMS_GATEWAY_API_URL / SMS_GATEWAY_API_KEY are set — same pattern as
 *    LINE_CHANNEL_ACCESS_TOKEN (TASK-017) and LONGDO_MAP_API_KEY
 *    (engines/geocoding.ts): build the real integration shape now, connect
 *    the real provider once chosen.
 * 2. The actual SMS command syntax for the real GPS box (GPSDD GDD070) is
 *    NOT confirmed against a real device manual — buildRelayCommandText()
 *    below is a clearly-marked placeholder shape, not a verified protocol.
 *    Do not trust this string format in production until checked against
 *    the box's real documentation.
 */

export type RelayAction = "unlock" | "lock"

export interface RelayCommandResult {
  ok: boolean
  error?: string
}

// PLACEHOLDER — not verified against a real GPSDD GDD070 command manual.
// Replace once the real device documentation is available.
export function buildRelayCommandText(action: RelayAction, boxPassword: string): string {
  const code = action === "unlock" ? "0" : "1"
  return `RELAY,${boxPassword},${code}#`
}

export async function sendRelayCommand(simNumber: string, commandText: string): Promise<RelayCommandResult> {
  const gatewayUrl = process.env.SMS_GATEWAY_API_URL
  const apiKey = process.env.SMS_GATEWAY_API_KEY
  if (!gatewayUrl || !apiKey) {
    return { ok: false, error: "ยังไม่ได้ตั้งค่า SMS Gateway (SMS_GATEWAY_API_URL / SMS_GATEWAY_API_KEY) — ดู .env.local.example" }
  }

  try {
    const res = await fetch(gatewayUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ to: simNumber, message: commandText }),
    })
    if (!res.ok) {
      return { ok: false, error: `SMS Gateway ตอบกลับผิดพลาด: HTTP ${res.status}` }
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: `เรียก SMS Gateway ไม่สำเร็จ: ${(e as Error).message}` }
  }
}
