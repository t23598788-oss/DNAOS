/**
 * Hermetic Google Workspace OAuth lifecycle proofs.
 * No live Google calls. Injected deps only.
 *
 * How to run: npx tsx connections/google-workspace/oauth/tests/oauth-lifecycle.test.ts
 */

import { readFileSync } from "node:fs";
import { createHash as cryptoHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CALENDAR_SCOPES,
  DEADBOARD_GMAIL_CLIENT_ENV_NAMES,
  DRIVE_SCOPE,
  FORBIDDEN_WRITE_SCOPES,
  GMAIL_SCOPE,
  GOOGLE_AUTHORIZE_SCOPES,
  GOOGLE_CONNECTION_ID,
  GOOGLE_CREDENTIAL_REF,
  GOOGLE_IDENTITY_SCOPES,
  GOOGLE_OAUTH_AUTHORIZE_URL,
  GOOGLE_OAUTH_CLIENT_ID_REF,
  GOOGLE_OAUTH_CLIENT_SECRET_REF,
  GOOGLE_OAUTH_TOKEN_URL,
  GOOGLE_WORKSPACE_READONLY_SCOPES,
  SHEETS_SCOPE,
  WRITE_ENABLED,
} from "../../contract";
import {
  CLIENT_CONFIGURATION_STATE,
  DEADBOARD_GMAIL_CLIENT_REUSED,
  GOOGLE_PKCE_METHOD,
  NEW_GENERIC_OAUTH_FRAMEWORK_CREATED,
} from "../contract";
import { deriveCodeChallenge, buildAuthorizeUrl, GOOGLE_OAUTH_ENDPOINTS } from "../google-oauth";
import {
  beginAuthorization,
  completeAuthorization,
  REQUESTER_IDENTITY,
  type GoogleLifecycleDeps,
} from "../lifecycle";
import type { GoogleAuthorizationRecord } from "../types";
import { handleGoogleOauthRoute } from "../../../../transport/owner-command-http/google-oauth-routes";

declare const process: { exitCode?: number; cwd(): string };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

let passed = 0;
let failed = 0;

function ok(name: string, condition: boolean, detail = ""): void {
  if (condition) {
    passed++;
    console.log(`PASS  ${name}`);
  } else {
    failed++;
    console.log(`FAIL  ${name}${detail ? ` :: ${detail}` : ""}`);
  }
}

const FIXED_NOW = new Date("2026-09-09T00:00:00.000Z");
const CONFIG = {
  client_id: "google-test-client-id.apps.googleusercontent.com",
  client_secret: "GOOGLE_TEST_CLIENT_SECRET_VALUE",
  redirect_uri: "http://127.0.0.1:8791/oauth/google/workspace/callback",
};

const RFC7636_VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const RFC7636_CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

function makeDeps(overrides: Partial<GoogleLifecycleDeps> = {}): {
  deps: GoogleLifecycleDeps;
  rows: GoogleAuthorizationRecord[];
  keychainWrites: Array<Record<string, unknown>>;
  statusSets: [string, string][];
  logs: string[];
} {
  const rows: GoogleAuthorizationRecord[] = [];
  const keychainWrites: Array<Record<string, unknown>> = [];
  const statusSets: [string, string][] = [];
  const logs: string[] = [];
  const base: GoogleLifecycleDeps = {
    readConfig: () => CONFIG,
    buildAuthorizeUrl,
    exchangeCodeForToken: async () => ({
      ok: true,
      access_token: "ya29.ACCESS_TOKEN_SECRET",
      refresh_token: "1//REFRESH_TOKEN_SECRET",
      scope: GOOGLE_AUTHORIZE_SCOPES.join(" "),
      expires_in: 3600,
      token_type: "Bearer",
    }),
    getUserInfo: async () => ({ kind: "found", sub: "google-sub-123", email: "owner@example.com" }),
    registerOwnerApiCredential: async (input) => {
      keychainWrites.push(input as unknown as Record<string, unknown>);
      return { credential_ref: input.credential_ref, status: "ACTIVE" };
    },
    findApiCredential: () => null,
    setApiCredentialStatus: (ref, status) => {
      statusSets.push([ref, status]);
      return null as never;
    },
    findRecord: (id) => [...rows].reverse().find((r) => r.connection_id === id) ?? null,
    upsertRecord: (r) => {
      rows.push(r);
      return r;
    },
    randomHex: (bytes) => "ab".repeat(bytes),
    now: () => FIXED_NOW,
  };
  void logs;
  return { deps: { ...base, ...overrides }, rows, keychainWrites, statusSets, logs };
}

// 1. One client for Workspace family
{
  ok("1. one Workspace connection_id", GOOGLE_CONNECTION_ID === "connection.google.workspace.v1");
  ok("1b. one user credential_ref", GOOGLE_CREDENTIAL_REF === "credential://google/workspace/oauth");
  ok("1c. client id/secret refs are distinct from user token", GOOGLE_OAUTH_CLIENT_ID_REF !== GOOGLE_CREDENTIAL_REF && GOOGLE_OAUTH_CLIENT_SECRET_REF !== GOOGLE_CREDENTIAL_REF);
}

// 2–3. Endpoints
{
  ok("2. authorize URL uses Google endpoint", GOOGLE_OAUTH_ENDPOINTS.AUTHORIZE_URL === "https://accounts.google.com/o/oauth2/v2/auth");
  ok("2b. contract authorize matches", GOOGLE_OAUTH_AUTHORIZE_URL === GOOGLE_OAUTH_ENDPOINTS.AUTHORIZE_URL);
  ok("3. token URL uses Google endpoint", GOOGLE_OAUTH_ENDPOINTS.TOKEN_URL === "https://oauth2.googleapis.com/token");
  ok("3b. contract token matches", GOOGLE_OAUTH_TOKEN_URL === GOOGLE_OAUTH_ENDPOINTS.TOKEN_URL);
}

// 4–5. PKCE S256 base64url — not TikTok hex
{
  const challenge = deriveCodeChallenge(RFC7636_VERIFIER);
  ok("4. PKCE S256 base64url matches RFC 7636 vector", challenge === RFC7636_CHALLENGE, challenge);
  ok("4b. GOOGLE_PKCE_METHOD declared", GOOGLE_PKCE_METHOD === "S256_BASE64URL");
  const hex = cryptoHash("sha256").update(RFC7636_VERIFIER).digest("hex");
  ok("5. TikTok hex PKCE is not used", challenge !== hex && !/^[0-9a-f]{64}$/.test(challenge));
}

async function main(): Promise<void> {
  // 6. random state generated
  {
    const { deps, rows } = makeDeps();
    const r = beginAuthorization({ redirect_uri: CONFIG.redirect_uri }, deps);
    ok("6. begin succeeds with admitted client", r.ok === true);
    ok("6b. random state generated", r.ok === true && typeof r.state_nonce === "string" && r.state_nonce.length > 0);
    ok("6c. authorize URL is Google", r.ok === true && r.authorize_url.startsWith(GOOGLE_OAUTH_AUTHORIZE_URL));
    if (r.ok) {
      const url = new URL(r.authorize_url);
      ok("6d. code_challenge_method=S256", url.searchParams.get("code_challenge_method") === "S256");
      ok("6e. code_challenge is base64url", /^[A-Za-z0-9_-]+$/.test(url.searchParams.get("code_challenge") ?? ""));
      ok("6f. begin response does not include code_verifier", !JSON.stringify(r).includes(rows[rows.length - 1]!.code_verifier ?? "___"));
    }
  }

  // CONFIGURATION_REQUIRED when client missing
  {
    const { deps, rows } = makeDeps({
      readConfig: () => ({ missing: ["GOOGLE_WORKSPACE_OAUTH_CLIENT_ID", "GOOGLE_WORKSPACE_OAUTH_CLIENT_SECRET", "GOOGLE_WORKSPACE_OAUTH_REDIRECT_URI"] }),
    });
    const r = beginAuthorization({ redirect_uri: CONFIG.redirect_uri }, deps);
    ok("config missing → CONFIGURATION_REQUIRED", r.ok === false && r.reason_code === "CONFIGURATION_REQUIRED");
    ok("config missing → record CONFIGURATION_REQUIRED not CONNECTED", rows[rows.length - 1]?.state === "CONFIGURATION_REQUIRED");
    ok("CLIENT_CONFIGURATION_STATE constant", CLIENT_CONFIGURATION_STATE === "CONFIGURATION_REQUIRED");
  }

  // 7. missing state fails
  {
    const { deps } = makeDeps();
    beginAuthorization({ redirect_uri: CONFIG.redirect_uri }, deps);
    const r = await completeAuthorization({ connection_id: GOOGLE_CONNECTION_ID, code: "auth_code", state: "" }, deps);
    ok("7. missing state fails", r.ok === false && r.reason_code === "STATE_REQUIRED");
  }

  // 8. mismatched state fails
  {
    const { deps } = makeDeps();
    beginAuthorization({ redirect_uri: CONFIG.redirect_uri }, deps);
    const r = await completeAuthorization({ connection_id: GOOGLE_CONNECTION_ID, code: "auth_code", state: "WRONG" }, deps);
    ok("8. mismatched state fails", r.ok === false && r.reason_code === "STATE_MISMATCH");
  }

  // 9. expired state fails
  {
    const { deps } = makeDeps({
      now: (() => {
        let n = 0;
        return () => {
          n += 1;
          return n === 1 ? FIXED_NOW : new Date(FIXED_NOW.getTime() + 11 * 60 * 1000);
        };
      })(),
    });
    // Fix now: begin at T0, complete at T0+11m — need separate clocks
  }
  {
    let call = 0;
    const { deps } = makeDeps({
      now: () => {
        call += 1;
        // beginAuthorization calls now twice (iso + expiry calc) then complete calls now multiple times
        if (call <= 3) return FIXED_NOW;
        return new Date(FIXED_NOW.getTime() + 11 * 60 * 1000);
      },
    });
    beginAuthorization({ redirect_uri: CONFIG.redirect_uri }, deps);
    const pending = deps.findRecord(GOOGLE_CONNECTION_ID)!;
    const r = await completeAuthorization(
      { connection_id: GOOGLE_CONNECTION_ID, code: "auth_code", state: pending.state_nonce! },
      deps,
    );
    ok("9. expired state fails", r.ok === false && r.reason_code === "AUTHORIZE_EXPIRED");
  }

  // 10. reused state fails + successful complete
  {
    const { deps, rows, keychainWrites } = makeDeps();
    const begin = beginAuthorization({ redirect_uri: CONFIG.redirect_uri }, deps);
    const state = begin.ok ? begin.state_nonce : "";
    const first = await completeAuthorization({ connection_id: GOOGLE_CONNECTION_ID, code: "auth_code", state }, deps);
    ok("complete success → CONNECTED", first.ok === true && first.record.state === "CONNECTED");
    ok("19. token writes through Keychain registration", keychainWrites.length === 1);
    ok("19b. credential_ref is family pointer", keychainWrites[0]?.credential_ref === GOOGLE_CREDENTIAL_REF);
    ok("20. only Google lifecycle requester", keychainWrites[0]?.requester_identity === REQUESTER_IDENTITY);
    ok("account proven from provider", first.ok === true && first.account_verification.google_account_id === "google-sub-123");

    const serialized = JSON.stringify(rows);
    ok("14. code_verifier cleared after complete", first.ok === true && first.record.code_verifier === null);
    ok("15. client_secret never in records", !serialized.includes(CONFIG.client_secret));
    ok("16. authorization code never in records", !serialized.includes("auth_code"));
    ok("17. access token never in records", !serialized.includes("ya29.ACCESS_TOKEN_SECRET"));
    ok("18. refresh token never in records", !serialized.includes("1//REFRESH_TOKEN_SECRET"));

    const reuse = await completeAuthorization({ connection_id: GOOGLE_CONNECTION_ID, code: "auth_code_2", state }, deps);
    ok("10. reused state fails closed", reuse.ok === false && reuse.reason_code === "NO_PENDING_AUTHORIZATION");
  }

  // 11. missing code fails
  {
    const { deps } = makeDeps();
    beginAuthorization({ redirect_uri: CONFIG.redirect_uri }, deps);
    const pending = deps.findRecord(GOOGLE_CONNECTION_ID)!;
    const r = await completeAuthorization({ connection_id: GOOGLE_CONNECTION_ID, code: "", state: pending.state_nonce! }, deps);
    ok("11. missing code fails", r.ok === false && r.reason_code === "CODE_REQUIRED");
  }

  // 12. OAuth provider error returns bounded failure (HTTP route)
  {
    const reply = await handleGoogleOauthRoute(
      "GET",
      "/oauth/google/workspace/callback",
      new URLSearchParams({ error: "access_denied", error_description: "Owner denied" }),
      null,
    );
    ok("12. provider error bounded", reply !== null && reply.status === 400 && reply.body.reason_code === "OAUTH_PROVIDER_ERROR");
    ok("12b. no secret fields in error body", !JSON.stringify(reply?.body).includes("client_secret"));
  }

  // 13. redirect URI must match prepared transaction
  {
    const { deps } = makeDeps();
    const r = beginAuthorization({ redirect_uri: "https://evil.example/callback" }, deps);
    ok("13. begin rejects mismatched redirect_uri", r.ok === false && r.reason_code === "REDIRECT_URI_MISMATCH");
  }
  {
    const { deps } = makeDeps({
      exchangeCodeForToken: async (_c, params) => {
        if (params.redirect_uri !== CONFIG.redirect_uri) {
          return { ok: false, reason_code: "REDIRECT_URI_MISMATCH", detail: "mismatch" };
        }
        return {
          ok: true,
          access_token: "ya29.x",
          refresh_token: "1//x",
          scope: "openid",
          expires_in: 1,
          token_type: "Bearer",
        };
      },
    });
    beginAuthorization({ redirect_uri: CONFIG.redirect_uri }, deps);
    const pending = deps.findRecord(GOOGLE_CONNECTION_ID)!;
    ok("13b. pending stores exact redirect_uri", pending.redirect_uri === CONFIG.redirect_uri);
  }

  // 14b. begin HTTP never returns code_verifier
  {
    const { deps } = makeDeps();
    // Route uses production lifecycle; prove shape via beginAuthorization return
    const r = beginAuthorization({ redirect_uri: CONFIG.redirect_uri }, deps);
    const blob = JSON.stringify(r);
    ok("14b. begin result has no code_verifier field", !blob.includes("code_verifier"));
    ok("15b. begin result has no client_secret", !blob.includes("client_secret") && !blob.includes(CONFIG.client_secret));
  }

  // 21–25. four capabilities / independent scopes
  {
    ok("21. four readonly scopes in family set", GOOGLE_WORKSPACE_READONLY_SCOPES.length === 5); // gmail + 2 cal + drive + sheets
    ok("22. Gmail scope independent", GMAIL_SCOPE.includes("gmail.readonly") && !GMAIL_SCOPE.includes("drive"));
    ok("23. Calendar scopes independent", CALENDAR_SCOPES.every((s) => s.includes("calendar")) && !CALENDAR_SCOPES.some((s) => s.includes("gmail")));
    ok("24. Drive scope independent", DRIVE_SCOPE.includes("drive.readonly"));
    ok("25. Sheets scope independent", SHEETS_SCOPE.includes("spreadsheets.readonly"));
  }

  // 26. no write scopes
  {
    ok("26. WRITE_ENABLED false", WRITE_ENABLED === false);
    const requested = new Set(GOOGLE_AUTHORIZE_SCOPES);
    ok(
      "26b. no write scopes requested",
      FORBIDDEN_WRITE_SCOPES.every((s) => !requested.has(s as (typeof GOOGLE_AUTHORIZE_SCOPES)[number])),
    );
    ok("26c. no freebusy unless needed", !GOOGLE_AUTHORIZE_SCOPES.some((s) => s.includes("freebusy")));
  }

  // Identity scopes documented explicitly
  {
    ok("identity scopes explicit openid+email", GOOGLE_IDENTITY_SCOPES.includes("openid") && GOOGLE_IDENTITY_SCOPES.includes("email"));
  }

  // 27. Deadboard not reused
  {
    ok("27. DEADBOARD_GMAIL_CLIENT_REUSED = false", DEADBOARD_GMAIL_CLIENT_REUSED === false);
    const lifecycleSrc = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "lifecycle.ts"), "utf8");
    const oauthSrc = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "google-oauth.ts"), "utf8");
    for (const name of DEADBOARD_GMAIL_CLIENT_ENV_NAMES) {
      ok(`27b. oauth path does not reference ${name}`, !lifecycleSrc.includes(name) && !oauthSrc.includes(name));
    }
  }

  // 28. MCP authority unchanged — no new tool IDs in this module
  {
    ok("28. no generic OAuth framework", NEW_GENERIC_OAUTH_FRAMEWORK_CREATED === false);
    const mcpTooling = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../../../dna-os-mcp/tests/canonical-tooling.test.ts"),
      "utf8",
    );
    ok("28b. MCP regression fixture still present", mcpTooling.includes("dna_os.resolve_tool_grant"));
  }

  // Token exchange failure → bounded
  {
    const { deps } = makeDeps({
      exchangeCodeForToken: async () => ({ ok: false, reason_code: "invalid_grant", detail: "code expired" }),
    });
    const begin = beginAuthorization({ redirect_uri: CONFIG.redirect_uri }, deps);
    const state = begin.ok ? begin.state_nonce : "";
    const r = await completeAuthorization({ connection_id: GOOGLE_CONNECTION_ID, code: "bad", state }, deps);
    ok("exchange failure bounded", r.ok === false && r.reason_code === "invalid_grant");
  }

  // Allowlist source contains exact requester
  {
    const reg = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../../../../credentials/macos-keychain/api-registration.ts"),
      "utf8",
    );
    ok("20b. ALLOWED_REQUESTERS includes Google lifecycle only by exact path", reg.includes(`"${REQUESTER_IDENTITY}"`));
    ok("20c. no google/* wildcard allowlist", !reg.includes('"connections/google-workspace/*"') && !reg.includes('"google/*"'));
  }

  // Begin route shape (uses real lifecycle — may be CONFIGURATION_REQUIRED without env)
  {
    const reply = await handleGoogleOauthRoute(
      "POST",
      "/oauth/google/workspace/begin",
      new URLSearchParams(),
      { connection_id: GOOGLE_CONNECTION_ID, redirect_uri: CONFIG.redirect_uri },
    );
    ok("begin route returns non-secret body", reply !== null && typeof reply.body === "object");
    const blob = JSON.stringify(reply?.body ?? {});
    ok("begin route never returns code_verifier", !blob.includes("code_verifier"));
    ok(
      "begin route never returns client_secret value",
      !blob.includes("GOOGLE_TEST_CLIENT_SECRET_VALUE") && !/"client_secret"\s*:/.test(blob),
    );
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

void main();
