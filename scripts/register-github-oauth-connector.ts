/**
 * Register GitHub OAuth Connector (TASK-073, capability #62 STEP 7 —
 * /admin/ide Connections rail, GitHub minimal slice, 2026-08-10). Mirrors
 * scripts/register-tiktok-connector.ts's exact real pattern.
 *
 * Idempotently creates the real GitHub OAuth connector row via
 * gateway/connectors.ts:createConnector (the one sanctioned writer —
 * registry/connector-lifecycle.json Guard A). Only runs when a real
 * GITHUB_OAUTH_CLIENT_ID / GITHUB_OAUTH_CLIENT_SECRET / NEXT_PUBLIC_APP_URL
 * are present in .env.local — never writes a placeholder/fake secret, and
 * never prints/logs the real secret values themselves (only whether they
 * are present, and non-secret metadata like slug/status/redirect_uri).
 *
 * GitHub's real OAuth endpoints (https://github.com/login/oauth/authorize,
 * https://github.com/login/oauth/access_token) use the standard
 * "client_id" query param name already — no client_id_param override
 * needed (unlike TikTok's non-standard "client_key"). config.test_url is
 * set to the real https://api.github.com/user endpoint, which
 * engines/connectors/tester.ts's testOAuth() now recognizes with a real
 * GitHub-specific shape check (see that file).
 *
 * This creates the connector row only (Connect + auto-Register stage). It
 * does NOT authorize (Owner does that personally in a browser by clicking
 * "Connect" in the real /admin/ide Connections panel or /admin/connectors
 * — no credential automation), and does NOT enable (Enable is always a
 * manual owner action, no exceptions, registry/connector-lifecycle.json).
 *
 * Run: npx tsx scripts/register-github-oauth-connector.ts
 */

import { readFileSync } from "fs";
import { join } from "path";

const ROOT = join(__dirname, "..");

try {
  const envFile = readFileSync(join(ROOT, ".env.local"), "utf8");
  for (const line of envFile.split("\n")) {
    if (!line.includes("=") || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    const key = line.slice(0, i);
    if (!process.env[key]) process.env[key] = line.slice(i + 1);
  }
} catch {
  console.error("[register-github-oauth-connector] .env.local not found — aborting");
  process.exit(1);
}

import { listConnectors, createConnector } from "../gateway/connectors";

async function main() {
  const clientId = process.env.GITHUB_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GITHUB_OAUTH_CLIENT_SECRET;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;

  if (!clientId || !clientSecret) {
    console.log("SKIP github — GITHUB_OAUTH_CLIENT_ID / GITHUB_OAUTH_CLIENT_SECRET not in .env.local (the Owner has not yet created a real GitHub OAuth App)");
    return;
  }
  if (!appUrl) {
    console.log("SKIP github — NEXT_PUBLIC_APP_URL not in .env.local (required so the generated redirect_uri is a real, absolute, reachable HTTPS URL — GitHub will reject a relative one)");
    return;
  }

  const existing = await listConnectors();
  const already = existing.find((c) => c.slug.startsWith("github"));
  if (already) {
    console.log(`SKIP github — already registered as "${already.name}" (${already.slug}), status=${already.status}, enabled=${already.enabled}`);
    console.log(`Registered redirect_uri: ${(already.config as Record<string, unknown>).redirect_uri}`);
    return;
  }

  const connector = await createConnector({
    name: "GitHub",
    auth_type: "oauth",
    config: {
      authorize_url: "https://github.com/login/oauth/authorize",
      token_url: "https://github.com/login/oauth/access_token",
      client_id: clientId,
      // GitHub uses the standard "client_id" param name — no
      // client_id_param override needed (contrast with TikTok's
      // non-standard "client_key", see register-tiktok-connector.ts).
      scope: "read:user",
      test_url: "https://api.github.com/user",
    },
    secret: { client_secret: clientSecret },
  });

  console.log(`REGISTERED  ${connector.name} (${connector.slug}) — status=${connector.status}, enabled=${connector.enabled}`);
  console.log(`\nreal redirect_uri (register this EXACT value as the GitHub OAuth App's "Authorization callback URL" in github.com/settings/developers before authorizing):\n  ${(connector.config as Record<string, unknown>).redirect_uri}`);
  console.log(`\nOwner authorize URL (visit in browser once the redirect_uri above is registered on GitHub's side — or click "Connect" in the real /admin/ide Connections panel / /admin/connectors):\n  ${appUrl}/api/connectors/oauth/authorize/${connector.slug}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[register-github-oauth-connector] failed:", err);
    process.exit(1);
  });
