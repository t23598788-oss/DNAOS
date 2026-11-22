/** Only allow user OAuth for providers whose upstream hosts are explicitly known. */
const PROVIDER_HOSTS: Record<string, readonly string[]> = {
  github: ["github.com", "api.github.com"],
  google: ["accounts.google.com", "oauth2.googleapis.com", "openidconnect.googleapis.com", "www.googleapis.com"],
  gmail: ["accounts.google.com", "oauth2.googleapis.com", "openidconnect.googleapis.com", "www.googleapis.com"],
  "google-maps": ["accounts.google.com", "oauth2.googleapis.com", "openidconnect.googleapis.com", "www.googleapis.com"],
  cloudflare: ["dash.cloudflare.com", "api.cloudflare.com"],
  digitalocean: ["cloud.digitalocean.com", "api.digitalocean.com"],
  vercel: ["vercel.com", "api.vercel.com"],
  supabase: ["supabase.com", "api.supabase.com"],
  line: ["access.line.me", "api.line.me"],
  runpod: ["runpod.io", "api.runpod.io"],
  railway: ["railway.app", "backboard.railway.app"],
};

export function assertUserOAuthUrl(providerId: string, raw: unknown): URL {
  if (typeof raw !== "string") throw new Error("OAUTH_ENDPOINT_MISSING");
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error("OAUTH_ENDPOINT_INVALID"); }
  if (url.protocol !== "https:" || !PROVIDER_HOSTS[providerId]?.includes(url.hostname)) {
    throw new Error("OAUTH_ENDPOINT_NOT_ALLOWED");
  }
  return url;
}

export function isUserOAuthProvider(providerId: string): boolean {
  return Object.hasOwn(PROVIDER_HOSTS, providerId);
}

export function oauthProviderIdentity(connector: { slug: string; config: Record<string, unknown> }): string | null {
  const declared = String(connector.config.provider ?? "").trim().toLowerCase();
  if (declared && isUserOAuthProvider(declared)) return declared;
  const slug = connector.slug.toLowerCase();
  const identities = Object.keys(PROVIDER_HOSTS).filter((id) => slug === id || slug.startsWith(`${id}-`));
  return identities.length === 1 ? identities[0] : null;
}

export function userOAuthCookieName(connectorId: string): string {
  return `dnaos_user_connector_oauth_${connectorId}`;
}
