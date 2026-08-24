/**
 * หน้าที่: the ONE real GitHub OAuth Device Authorization Flow client —
 * requesting a device/user code, and polling for the resulting access
 * token. Endpoints, parameters, grant_type, and error codes below are
 * copied verbatim from GitHub's own official documentation
 * (docs.github.com/en/apps/oauth-apps/building-oauth-apps/
 * authorizing-oauth-apps, "Device flow" section, verified live via
 * WebFetch before writing this file) — nothing here is guessed.
 *
 * This is NOT GitHub execution (that stays in ../github/) — this file's
 * only job is turning "Owner approves in their browser" into a real
 * access_token, in memory, handed back to ./lifecycle.ts. It never writes
 * source, never touches a repository, never calls the Contents API.
 *
 * `GITHUB_OAUTH_CLIENT_ID` is a PUBLIC client identifier (GitHub's own
 * docs: device flow needs no client_secret at all) — not a secret, so an
 * env var is its permanent, canonical source, not a legacy fallback. It
 * names a real GitHub OAuth App the Owner must create at
 * https://github.com/settings/developers with "Device Flow" enabled — DNA
 * OS cannot create this App itself (that action requires the Owner's own
 * GitHub login, same discipline as the authorization flow itself).
 *
 * Input: none at call time beyond `scope` (device code request) / the
 * `device_code` from that response (polling).
 * Output: `requestDeviceCode`, `pollForAccessToken`,
 * `DeviceCodeResult`, `AccessTokenPollResult`.
 * Dependency ที่อนุญาต: ./host-runtime.ts only.
 * สิ่งที่ห้ามแตะ: ห้าม log หรือ persist ค่า access_token ในไฟล์นี้เกินกว่า
 * การ return กลับไปยัง caller หนึ่งครั้ง. ห้ามเดา endpoint/parameter อื่น
 * นอกจากที่ระบุไว้ข้างบน.
 */

import { hostFetchPost, readEnvVar } from "./host-runtime";

const DEVICE_CODE_URL = "https://github.com/login/device/code";
const ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token";
export const GITHUB_VERIFICATION_URI = "https://github.com/login/device";

export function readGithubOauthClientId(): string | undefined {
  const value = readEnvVar("GITHUB_OAUTH_CLIENT_ID");
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

export type DeviceCodeResult =
  | { ok: true; device_code: string; user_code: string; verification_uri: string; expires_in: number; interval: number }
  | { ok: false; reason_code: string; detail: string };

export async function requestDeviceCode(clientId: string, scope: string): Promise<DeviceCodeResult> {
  const outcome = await hostFetchPost(
    DEVICE_CODE_URL,
    { "content-type": "application/json", accept: "application/json" },
    JSON.stringify({ client_id: clientId, scope }),
    10_000
  );
  if (outcome.kind === "transport_error") return { ok: false, reason_code: "TRANSPORT_ERROR", detail: outcome.reason };
  const body = (await outcome.response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!outcome.response.ok || !body) return { ok: false, reason_code: "DEVICE_CODE_REQUEST_FAILED", detail: `HTTP ${outcome.response.status}` };
  if (typeof body.error === "string") return { ok: false, reason_code: body.error, detail: typeof body.error_description === "string" ? body.error_description : body.error };
  const { device_code, user_code, verification_uri, expires_in, interval } = body;
  if (typeof device_code !== "string" || typeof user_code !== "string" || typeof verification_uri !== "string" || typeof expires_in !== "number" || typeof interval !== "number") {
    return { ok: false, reason_code: "MALFORMED_DEVICE_CODE_RESPONSE", detail: JSON.stringify(body) };
  }
  return { ok: true, device_code, user_code, verification_uri, expires_in, interval };
}

export type AccessTokenPollResult =
  | { ok: true; access_token: string; scope: string; token_type: string }
  | { ok: false; reason_code: "authorization_pending" | "slow_down" | "expired_token" | "access_denied" | string; detail: string };

/** One single poll attempt — the caller (./lifecycle.ts) owns the interval/backoff/timeout loop, never this file. */
export async function pollForAccessToken(clientId: string, deviceCode: string): Promise<AccessTokenPollResult> {
  const outcome = await hostFetchPost(
    ACCESS_TOKEN_URL,
    { "content-type": "application/json", accept: "application/json" },
    JSON.stringify({ client_id: clientId, device_code: deviceCode, grant_type: "urn:ietf:params:oauth:grant-type:device_code" }),
    10_000
  );
  if (outcome.kind === "transport_error") return { ok: false, reason_code: "TRANSPORT_ERROR", detail: outcome.reason };
  const body = (await outcome.response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return { ok: false, reason_code: "MALFORMED_TOKEN_RESPONSE", detail: `HTTP ${outcome.response.status}` };
  if (typeof body.error === "string") return { ok: false, reason_code: body.error, detail: typeof body.error_description === "string" ? body.error_description : body.error };
  const { access_token, scope, token_type } = body;
  if (typeof access_token !== "string" || typeof scope !== "string" || typeof token_type !== "string") {
    return { ok: false, reason_code: "MALFORMED_TOKEN_RESPONSE", detail: JSON.stringify(body) };
  }
  return { ok: true, access_token, scope, token_type };
}
