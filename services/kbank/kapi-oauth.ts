// KBank K API OAuth2 client (sandbox).
//
// KBank K API (apiportal.kasikornbank.com) OAuth2 spec for the sandbox:
//   Token endpoint: POST ${KBANK_KGP_BASE_URL}/v2/oauth/token
//   Auth: Basic base64(consumer_id:consumer_secret)
//   Body: grant_type=client_credentials
//   Headers: Content-Type: application/x-www-form-urlencoded
//           x-test-mode: "true"
//           env-id: ${KBANK_KGP_ENV_ID}
//   Response: { access_token, token_type, expires_in, ... }
//
// NOTHING HERE IS PRODUCTION READY. This is a sandbox-first client.

const tokenCache = new Map<string, { token: string; expiresAt: number }>();

let baseUrl: string | undefined;
let consumerId: string | undefined;
let consumerSecret: string | undefined;
let envId: string | undefined;

function loadEnv(): void {
  if (baseUrl) return;
  baseUrl = process.env.KBANK_KGP_BASE_URL;
  consumerId = process.env.KBANK_KGP_CONSUMER_ID;
  consumerSecret = process.env.KBANK_KGP_CONSUMER_SECRET;
  envId = process.env.KBANK_KGP_ENV_ID;
}

function getCredentials(slug: string) {
  loadEnv();
  if (
    !consumerId || !consumerSecret ||
    consumerId.trim() === "" || consumerSecret.trim() === ""
  ) {
    throw new Error(`KBank credentials not configured for: ${slug}`);
  }
  if (!baseUrl || baseUrl.trim() === "") {
    throw new Error(`KBank base URL not configured for: ${slug}`);
  }
  return { baseUrl, consumerId, consumerSecret, envId };
}

export function getKBankOAuthConfig() {
  loadEnv();
  return { baseUrl, consumerId, consumerSecret, envId };
}

export function isTokenValid(slug: string): boolean {
  const cached = tokenCache.get(slug);
  if (!cached) return false;
  return Date.now() < cached.expiresAt;
}

export function clearKBankTokenCache(slug?: string): void {
  if (slug) {
    tokenCache.delete(slug);
  } else {
    tokenCache.clear();
  }
}

export async function getKBankAccessToken(slug: "kbiz" | "kplus" | "truemoney"): Promise<string> {
  const cached = tokenCache.get(slug);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.token;
  }

  const { baseUrl, consumerId, consumerSecret, envId } = getCredentials(slug);

  const encoded = Buffer.from(`${consumerId}:${consumerSecret}`).toString("base64");
  const body = new URLSearchParams({
    grant_type: "client_credentials",
  }).toString();

  const headers = new Headers({
    Authorization: `Basic ${encoded}`,
    "Content-Type": "application/x-www-form-urlencoded",
    "x-test-mode": "true",
    "env-id": envId!,
  });

  const url = `${baseUrl}/v2/oauth/token`;

  const res = await fetch(url, {
    method: "POST",
    headers,
    body,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`KBank OAuth failed: ${res.status} ${text}`);
  }

  let json: Record<string, unknown>;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`KBank OAuth failed: invalid JSON response`);
  }

  const rawExpires = json.expires_in;
  const expiresIn = typeof rawExpires === "number"
    ? rawExpires
    : parseInt(String(rawExpires), 10) || 3600;

  const accessToken = json.access_token as string | undefined;
  if (!accessToken) {
    throw new Error(`KBank OAuth failed: no access_token in response`);
  }

  tokenCache.set(slug, {
    token: accessToken,
    expiresAt: Date.now() + (expiresIn - 60) * 1000,
  });
  return accessToken;
}
