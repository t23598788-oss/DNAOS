/**
 * Hermetic expected-account rebind / login_hint proofs.
 * No live Google, Keychain, or production authorizations.jsonl mutation.
 *
 * How to run: npx tsx connections/google-workspace/oauth/tests/oauth-account-binding.test.ts
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  GOOGLE_AUTHORIZE_SCOPES,
  GOOGLE_CONNECTION_ID,
  GOOGLE_CREDENTIAL_REF,
} from "../../contract";
import { buildAuthorizeUrl } from "../google-oauth";
import {
  beginAuthorization,
  completeAuthorization,
  type GoogleLifecycleDeps,
} from "../lifecycle";
import type { GoogleAuthorizationRecord } from "../types";
import { handleGoogleOauthRoute } from "../../../../transport/owner-command-http/google-oauth-routes";

declare const process: { exitCode?: number; cwd(): string };
declare const console: { log(...args: unknown[]): void };

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

const EXPECTED = "dnaos.tech@gmail.com";
const WRONG = "t23598788@gmail.com";

function connectedFixture(email: string, sub: string): GoogleAuthorizationRecord {
  return {
    connection_id: GOOGLE_CONNECTION_ID,
    provider: "google_workspace",
    google_account_id: sub,
    account_email: email,
    state: "CONNECTED",
    credential_ref: GOOGLE_CREDENTIAL_REF,
    granted_scope: [...GOOGLE_AUTHORIZE_SCOPES],
    code_verifier: null,
    state_nonce: null,
    redirect_uri: null,
    authorize_expires_at: null,
    failure_reason: null,
    expected_account_email: null,
    prior_google_account_id: null,
    prior_account_email: null,
    prior_credential_ref: null,
    prior_granted_scope: null,
    created_at: FIXED_NOW.toISOString(),
    updated_at: FIXED_NOW.toISOString(),
  };
}

function makeDeps(
  overrides: Partial<GoogleLifecycleDeps> = {},
  seed: GoogleAuthorizationRecord[] = [],
): {
  deps: GoogleLifecycleDeps;
  rows: GoogleAuthorizationRecord[];
  keychainWrites: Array<Record<string, unknown>>;
  replaces: Array<Record<string, unknown>>;
  credentialRefs: Set<string>;
} {
  const rows: GoogleAuthorizationRecord[] = [...seed];
  const keychainWrites: Array<Record<string, unknown>> = [];
  const replaces: Array<Record<string, unknown>> = [];
  const credentialRefs = new Set<string>(
    seed.filter((r) => r.credential_ref).map((r) => r.credential_ref!),
  );
  let registered = seed.some((r) => r.credential_ref === GOOGLE_CREDENTIAL_REF);

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
    getUserInfo: async () => ({ kind: "found", sub: "google-sub-expected", email: EXPECTED }),
    registerOwnerApiCredential: async (input) => {
      keychainWrites.push({ ...input, secret: "<redacted>" });
      if (registered || credentialRefs.has(input.credential_ref)) {
        throw new Error("DUPLICATE_CREDENTIAL_REF");
      }
      registered = true;
      credentialRefs.add(input.credential_ref);
      return { credential_ref: input.credential_ref, status: "ACTIVE" };
    },
    findApiCredential: (ref) =>
      registered || credentialRefs.has(ref)
        ? {
            credential_ref: ref,
            provider: "google_workspace",
            account: "prior-sub",
            scope: [...GOOGLE_AUTHORIZE_SCOPES],
            status: "ACTIVE",
            created_at: FIXED_NOW.toISOString(),
            updated_at: FIXED_NOW.toISOString(),
            resolver_kind: "macos_keychain",
            resolver_service: "dna-os-google-workspace-oauth",
            resolver_account: "prior-sub",
          }
        : null,
    replaceApiCredential: (entry) => {
      replaces.push({ ...entry, secret: undefined });
      credentialRefs.add(entry.credential_ref);
      return {
        credential_ref: entry.credential_ref,
        provider: entry.provider,
        account: entry.account,
        scope: [...entry.scope],
        status: entry.status,
        created_at: FIXED_NOW.toISOString(),
        updated_at: entry.updated_at,
        resolver_kind: "macos_keychain",
        resolver_service: entry.resolver_service,
        resolver_account: entry.resolver_account,
      };
    },
    setApiCredentialStatus: () => null as never,
    findRecord: (id) => [...rows].reverse().find((r) => r.connection_id === id) ?? null,
    upsertRecord: (r) => {
      rows.push(r);
      return r;
    },
    randomHex: (bytes) => "ab".repeat(bytes),
    now: () => FIXED_NOW,
  };
  return { deps: { ...base, ...overrides }, rows, keychainWrites, replaces, credentialRefs };
}

function liveStoreHash(): string {
  const p = join(process.cwd(), "connections/google-workspace/oauth/data/authorizations.jsonl");
  if (!existsSync(p)) return "ABSENT";
  return createHash("sha256").update(readFileSync(p)).digest("hex");
}

async function main(): Promise<void> {
  const liveBefore = liveStoreHash();

  // 1–3. login_hint + not a global constant
  {
    const urlWith = buildAuthorizeUrl(CONFIG, {
      scope: GOOGLE_AUTHORIZE_SCOPES,
      state: "s",
      codeVerifier: "v".repeat(43),
      login_hint: EXPECTED,
    });
    const urlWithout = buildAuthorizeUrl(CONFIG, {
      scope: GOOGLE_AUTHORIZE_SCOPES,
      state: "s",
      codeVerifier: "v".repeat(43),
    });
    ok("1. login_hint included when supplied", urlWith.includes(`login_hint=${encodeURIComponent(EXPECTED)}`) || urlWith.includes("login_hint=dnaos.tech"));
    ok("2. no login_hint when none supplied", !urlWithout.includes("login_hint"));
    const contractSrc = readFileSync(join(process.cwd(), "connections/google-workspace/contract.ts"), "utf8");
    const oauthSrc = readFileSync(join(process.cwd(), "connections/google-workspace/oauth/google-oauth.ts"), "utf8");
    ok(
      "3. expected email is not a global provider constant",
      !contractSrc.includes("dnaos.tech@gmail.com") && !oauthSrc.includes("dnaos.tech@gmail.com"),
    );
  }

  // 4. expected account succeeds
  {
    const prior = connectedFixture(WRONG, "prior-sub");
    const { deps, rows, replaces, credentialRefs } = makeDeps({}, [prior]);
    beginAuthorization(
      {
        redirect_uri: CONFIG.redirect_uri,
        login_hint: EXPECTED,
        expected_account_email: EXPECTED,
      },
      deps,
    );
    const pending = deps.findRecord(GOOGLE_CONNECTION_ID)!;
    ok("4a. begin stores expected_account_email on transaction", pending.expected_account_email === EXPECTED);
    ok("4b. begin preserves prior snapshot", pending.prior_account_email === WRONG && pending.prior_credential_ref === GOOGLE_CREDENTIAL_REF);
    const complete = await completeAuthorization(
      { connection_id: GOOGLE_CONNECTION_ID, code: "auth-code", state: pending.state_nonce! },
      deps,
    );
    ok("4. callback exact expected account succeeds", complete.ok === true);
    ok("4c. rebound email", complete.ok && complete.record.account_email === EXPECTED);
    ok("8. successful flow replaces canonical binding", complete.ok && complete.record.credential_ref === GOOGLE_CREDENTIAL_REF);
    ok("9. no duplicate credential identity", credentialRefs.size === 1 && credentialRefs.has(GOOGLE_CREDENTIAL_REF));
    ok("8b. replace metadata used for existing ref", replaces.length === 1);
    void rows;
  }

  // 5–7. mismatch preserves binding
  {
    const prior = connectedFixture(WRONG, "prior-sub");
    const { deps, keychainWrites } = makeDeps(
      {
        getUserInfo: async () => ({ kind: "found", sub: "wrong-sub", email: WRONG }),
      },
      [prior],
    );
    beginAuthorization(
      {
        redirect_uri: CONFIG.redirect_uri,
        login_hint: EXPECTED,
        expected_account_email: EXPECTED,
      },
      deps,
    );
    const pending = deps.findRecord(GOOGLE_CONNECTION_ID)!;
    const complete = await completeAuthorization(
      { connection_id: GOOGLE_CONNECTION_ID, code: "auth-code", state: pending.state_nonce! },
      deps,
    );
    ok("5. different Google account returns ACCOUNT_MISMATCH", complete.ok === false && complete.reason_code === "ACCOUNT_MISMATCH");
    ok(
      "6. wrong-account does not replace binding",
      complete.ok === false
        && complete.record?.state === "CONNECTED"
        && complete.record.account_email === WRONG
        && complete.record.credential_ref === GOOGLE_CREDENTIAL_REF,
    );
    ok("7. previous credential remains usable after failed replacement", keychainWrites.length === 0);
    ok(
      "7b. prior granted scopes restored",
      complete.ok === false
        && Array.isArray(complete.record?.granted_scope)
        && complete.record!.granted_scope!.length === GOOGLE_AUTHORIZE_SCOPES.length,
    );
  }

  // 10. scopes unchanged on begin with expected account
  {
    const { deps } = makeDeps();
    const begin = beginAuthorization(
      {
        redirect_uri: CONFIG.redirect_uri,
        login_hint: EXPECTED,
        expected_account_email: EXPECTED,
      },
      deps,
    );
    ok("10. scopes remain unchanged", begin.ok === true);
    if (begin.ok) {
      const u = new URL(begin.authorize_url);
      const scopes = (u.searchParams.get("scope") || "").split(/\s+/).filter(Boolean);
      ok(
        "10b. authorize scopes match GOOGLE_AUTHORIZE_SCOPES",
        scopes.length === GOOGLE_AUTHORIZE_SCOPES.length
          && GOOGLE_AUTHORIZE_SCOPES.every((s) => scopes.includes(s)),
      );
      ok("1b. begin authorize_url includes login_hint", u.searchParams.get("login_hint") === EXPECTED);
    }
  }

  // 11. tokens/secrets never exposed on route begin/complete mismatch
  {
    const prior = connectedFixture(WRONG, "prior-sub");
    const { deps } = makeDeps(
      { getUserInfo: async () => ({ kind: "found", sub: "wrong-sub", email: WRONG }) },
      [prior],
    );
    const beginReply = await handleGoogleOauthRoute(
      "POST",
      "/oauth/google/workspace/begin",
      new URLSearchParams(),
      {
        connection_id: GOOGLE_CONNECTION_ID,
        redirect_uri: CONFIG.redirect_uri,
        login_hint: EXPECTED,
        expected_account_email: EXPECTED,
      },
      deps,
    );
    const beginBlob = JSON.stringify(beginReply?.body ?? {});
    ok("11a. begin route never exposes secrets", !beginBlob.includes("code_verifier") && !beginBlob.includes("GOOGLE_TEST_CLIENT_SECRET") && !beginBlob.includes("ya29."));
    const pending = deps.findRecord(GOOGLE_CONNECTION_ID)!;
    const complete = await completeAuthorization(
      { connection_id: GOOGLE_CONNECTION_ID, code: "auth-code", state: pending.state_nonce! },
      deps,
    );
    const failBlob = JSON.stringify(complete);
    ok(
      "11b. mismatch result never exposes tokens/secrets",
      !failBlob.includes("ya29.") && !failBlob.includes("1//REFRESH") && !failBlob.includes("GOOGLE_TEST_CLIENT_SECRET_VALUE"),
    );
    ok(
      "11c. route-shaped mismatch preserves CONNECTED",
      complete.ok === false && complete.record?.state === "CONNECTED" && complete.record.account_email === WRONG,
    );
  }

  // 12. live store untouched
  {
    const liveAfter = liveStoreHash();
    ok("12. tests do not touch live authorization store", liveBefore === liveAfter);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

void main();
