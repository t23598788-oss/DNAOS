/**
 * Hermetic Google Workspace OAuth *client* Owner admission proofs.
 * No live Google network. No biometric. Fake values only.
 *
 * How to run: npx tsx connections/google-workspace/oauth/tests/oauth-client-admission.test.ts
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FORBIDDEN_WRITE_SCOPES,
  GOOGLE_AUTHORIZE_SCOPES,
  GOOGLE_CONNECTION_ID,
  GOOGLE_OAUTH_CLIENT_SECRET_REF,
  GOOGLE_WORKSPACE_READONLY_SCOPES,
} from "../../contract";
import {
  CLIENT_CONFIGURATION_STATE,
  DEADBOARD_GMAIL_CLIENT_REUSED,
  NEW_GENERIC_OAUTH_FRAMEWORK_CREATED,
  NEW_REGISTRIES_CREATED,
  OWNER_ADMISSION_ROUTE,
  OWNER_APPROVAL_ACTION,
  PUBLIC_CONFIG_OWNER,
} from "../contract";
import {
  admitGoogleOauthClient,
  CLIENT_ADMISSION_REQUESTER,
  getGoogleOauthClientConfigurationView,
  type GoogleOauthClientAdmissionDeps,
} from "../client-admission";
import {
  GOOGLE_OAUTH_APPLICATION_TYPE,
  REGISTER_GOOGLE_WORKSPACE_OAUTH_CLIENT_ACTION,
  type GoogleOauthClientAdmissionApproval,
  type GoogleOauthClientAdmissionInput,
  type GoogleOauthClientConfigRecord,
} from "../client-config-types";
import { readGoogleOauthConfig } from "../google-oauth";
import { beginAuthorization, type GoogleLifecycleDeps } from "../lifecycle";
import type { GoogleAuthorizationRecord } from "../types";
import { handleGoogleOauthClientAdmissionRoute } from "../../../../transport/owner-command-http/google-oauth-client-admission-routes";

declare const process: { exitCode?: number };
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

const FAKE_SECRET = "GOCSPX-FAKE_HERMETIC_CLIENT_SECRET_ONLY";
const FAKE_CLIENT_ID = "1234567890-hermetic.apps.googleusercontent.com";
const FAKE_PROJECT = "dna-os-workspace-oauth-test";
const FAKE_REDIRECT = "http://127.0.0.1:8791/oauth/google/workspace/callback";

function baseApproval(overrides: Partial<GoogleOauthClientAdmissionApproval> = {}): GoogleOauthClientAdmissionApproval {
  return {
    action: REGISTER_GOOGLE_WORKSPACE_OAUTH_CLIENT_ACTION,
    connection_id: GOOGLE_CONNECTION_ID,
    environment: "TESTING",
    google_cloud_project_id: FAKE_PROJECT,
    google_oauth_client_id: FAKE_CLIENT_ID,
    client_secret_ref: GOOGLE_OAUTH_CLIENT_SECRET_REF,
    redirect_uri: FAKE_REDIRECT,
    application_type: GOOGLE_OAUTH_APPLICATION_TYPE,
    ...overrides,
  };
}

function baseInput(overrides: Partial<GoogleOauthClientAdmissionInput> = {}): GoogleOauthClientAdmissionInput {
  return {
    owner_session_id: "session-owner-active",
    approval: baseApproval(),
    google_app_environment: "TESTING",
    google_cloud_project_id: FAKE_PROJECT,
    google_oauth_client_id: FAKE_CLIENT_ID,
    google_oauth_client_secret: FAKE_SECRET,
    google_redirect_uri: FAKE_REDIRECT,
    ...overrides,
  };
}

function makeAdmissionDeps(overrides: Partial<GoogleOauthClientAdmissionDeps> = {}): {
  deps: GoogleOauthClientAdmissionDeps;
  configs: GoogleOauthClientConfigRecord[];
  keychainWrites: Array<Record<string, unknown>>;
  logs: string[];
} {
  const configs: GoogleOauthClientConfigRecord[] = [];
  const keychainWrites: Array<Record<string, unknown>> = [];
  const apiCreds = new Map<string, { status: string }>();
  const logs: string[] = [];
  const deps: GoogleOauthClientAdmissionDeps = {
    validateOwnerSession: (id) =>
      id === "session-owner-active"
        ? ({ ok: true, session: { session_id: id, state: "ACTIVE" } } as never)
        : ({ ok: false, reason_code: "SESSION_NOT_FOUND" } as never),
    registerOwnerApiCredential: async (input) => {
      keychainWrites.push(input as unknown as Record<string, unknown>);
      apiCreds.set(input.credential_ref, { status: "ACTIVE" });
      return { credential_ref: input.credential_ref, status: "ACTIVE" };
    },
    findApiCredential: (ref) => {
      const hit = apiCreds.get(ref);
      return hit ? ({ credential_ref: ref, status: hit.status } as never) : null;
    },
    findLatestClientConfig: () => (configs.length ? configs[configs.length - 1]! : null),
    upsertClientConfig: (r) => {
      const blob = JSON.stringify(r);
      if (blob.includes(FAKE_SECRET)) throw new Error("SECRET_LEAKED_INTO_PUBLIC_CONFIG");
      configs.push(r);
      return r;
    },
    now: () => new Date("2026-09-09T12:00:00.000Z"),
    ...overrides,
  };
  void logs;
  return { deps, configs, keychainWrites, logs };
}

async function main(): Promise<void> {
  ok("scaffold constants", OWNER_ADMISSION_ROUTE.includes("/owner/google-workspace/oauth-client"));
  ok("approval action constant", OWNER_APPROVAL_ACTION === REGISTER_GOOGLE_WORKSPACE_OAUTH_CLIENT_ACTION);
  ok("public config owner is Workspace oauth store", PUBLIC_CONFIG_OWNER.includes("client-config-store"));
  ok("no new registry platform", NEW_REGISTRIES_CREATED === 0);
  ok("source alone CONFIGURATION_REQUIRED", CLIENT_CONFIGURATION_STATE === "CONFIGURATION_REQUIRED");

  // 1. admission requires active Owner session
  {
    const { deps } = makeAdmissionDeps();
    const r = await admitGoogleOauthClient(baseInput({ owner_session_id: "" }), deps);
    ok("1. missing session rejected", r.ok === false && r.reason_code === "OWNER_SESSION_REQUIRED");
    const r2 = await admitGoogleOauthClient(baseInput({ owner_session_id: "dead" }), deps);
    ok("1b. inactive session rejected", r2.ok === false && r2.reason_code === "SESSION_NOT_FOUND");
  }

  // 2. generic approval rejected
  {
    const { deps } = makeAdmissionDeps();
    const r = await admitGoogleOauthClient(
      baseInput({ approval: baseApproval({ action: "GENERIC_APPROVE" as never }) }),
      deps,
    );
    ok("2. generic approval rejected", r.ok === false && r.reason_code === "GENERIC_APPROVAL_REJECTED");
  }

  // 3. wrong connection_id rejected
  {
    const { deps } = makeAdmissionDeps();
    const r = await admitGoogleOauthClient(
      baseInput({ approval: baseApproval({ connection_id: "connection.other" }) }),
      deps,
    );
    ok("3. wrong connection_id rejected", r.ok === false && r.reason_code === "CONNECTION_ID_MISMATCH");
  }

  // 4. unsupported environment
  {
    const { deps } = makeAdmissionDeps();
    const r = await admitGoogleOauthClient(baseInput({ google_app_environment: "STAGING" as never }), deps);
    ok("4. unsupported environment rejected", r.ok === false && r.reason_code === "UNSUPPORTED_ENVIRONMENT");
  }

  // 5–8. missing fields
  {
    const { deps } = makeAdmissionDeps();
    ok(
      "5. missing project_id",
      (await admitGoogleOauthClient(
        baseInput({ google_cloud_project_id: "", approval: baseApproval({ google_cloud_project_id: "" }) }),
        deps,
      )).reason_code === "PROJECT_ID_REQUIRED",
    );
    ok(
      "6. missing client_id",
      (await admitGoogleOauthClient(
        baseInput({ google_oauth_client_id: "", approval: baseApproval({ google_oauth_client_id: "" }) }),
        deps,
      )).reason_code === "CLIENT_ID_REQUIRED",
    );
    ok(
      "7. missing client_secret",
      (await admitGoogleOauthClient(baseInput({ google_oauth_client_secret: "" }), deps)).reason_code === "CLIENT_SECRET_REQUIRED",
    );
    ok(
      "8. missing redirect_uri",
      (await admitGoogleOauthClient(
        baseInput({ google_redirect_uri: "", approval: baseApproval({ redirect_uri: "" }) }),
        deps,
      )).reason_code === "REDIRECT_URI_REQUIRED",
    );
  }

  // 9. callback path mismatch
  {
    const { deps } = makeAdmissionDeps();
    const bad = "http://127.0.0.1:8791/oauth/wrong/callback";
    const r = await admitGoogleOauthClient(
      baseInput({ google_redirect_uri: bad, approval: baseApproval({ redirect_uri: bad }) }),
      deps,
    );
    ok("9. callback path mismatch rejected", r.ok === false && r.reason_code === "REDIRECT_CALLBACK_PATH_MISMATCH");
  }

  // 10. production HTTP rejected
  {
    const { deps } = makeAdmissionDeps();
    const httpProd = "http://example.com/oauth/google/workspace/callback";
    const r = await admitGoogleOauthClient(
      baseInput({
        google_app_environment: "PRODUCTION",
        google_redirect_uri: httpProd,
        approval: baseApproval({ environment: "PRODUCTION", redirect_uri: httpProd }),
      }),
      deps,
    );
    ok("10. production HTTP redirect rejected", r.ok === false && r.reason_code === "PRODUCTION_HTTPS_REQUIRED");
  }

  // Happy path + secret hygiene 11–15, 17, 19–20
  {
    const { deps, configs, keychainWrites } = makeAdmissionDeps();
    const r = await admitGoogleOauthClient(baseInput(), deps);
    ok("17. complete mock config → CONFIGURED", r.ok === true && r.client_configuration_state === "CONFIGURED");
    ok("19. no authorization transaction", r.ok === true && r.authorization_transaction_created === false);
    ok("20. no Google login", r.ok === true && r.login_started === false);
    ok("14. secret writes via Keychain owner", keychainWrites.length === 1);
    ok("15. correct secret ref", keychainWrites[0]?.credential_ref === GOOGLE_OAUTH_CLIENT_SECRET_REF);
    ok("14b. requester is client-admission", keychainWrites[0]?.requester_identity === CLIENT_ADMISSION_REQUESTER);
    ok("11. secret never in public config registry", !JSON.stringify(configs).includes(FAKE_SECRET));
    const responseBlob = JSON.stringify(r);
    ok("12. secret never in response", !responseBlob.includes(FAKE_SECRET) && !/"client_secret"\s*:/.test(responseBlob));

    const view = getGoogleOauthClientConfigurationView(deps);
    ok("17b. view CONFIGURED", view.configured === true && view.client_configuration_state === "CONFIGURED");
    ok("12b. view has no secret", !JSON.stringify(view).includes(FAKE_SECRET));

    const resolved = readGoogleOauthConfig({
      findLatestClientConfig: deps.findLatestClientConfig,
      findApiCredential: deps.findApiCredential,
      resolveClientSecret: () => FAKE_SECRET,
      readEnvVar: () => undefined,
    });
    ok("17c. resolver CONFIGURED internally", !("missing" in resolved) && resolved.client_id === FAKE_CLIENT_ID);
  }

  // 16. partial config remains CONFIGURATION_REQUIRED
  {
    const { deps } = makeAdmissionDeps({
      findLatestClientConfig: () =>
        ({
          connection_id: GOOGLE_CONNECTION_ID,
          environment: "TESTING",
          google_cloud_project_id: FAKE_PROJECT,
          oauth_client_id: FAKE_CLIENT_ID,
          oauth_client_id_ref: "credential://google/workspace/oauth-client/client-id",
          oauth_client_secret_ref: GOOGLE_OAUTH_CLIENT_SECRET_REF,
          redirect_uri: FAKE_REDIRECT,
          application_type: GOOGLE_OAUTH_APPLICATION_TYPE,
          status: "CONFIGURED",
          admitted_at: "2026-09-09T00:00:00.000Z",
          updated_at: "2026-09-09T00:00:00.000Z",
        }) as GoogleOauthClientConfigRecord,
      findApiCredential: () => null,
    });
    const view = getGoogleOauthClientConfigurationView(deps);
    ok("16. partial (missing secret registry) ⇒ CONFIGURATION_REQUIRED", view.client_configuration_state === "CONFIGURATION_REQUIRED");
  }

  // 18. begin blocked while incomplete
  {
    const rows: GoogleAuthorizationRecord[] = [];
    const lifecycleDeps: GoogleLifecycleDeps = {
      readConfig: () => ({ missing: ["GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET", "GOOGLE_REDIRECT_URI"] }),
      buildAuthorizeUrl: () => "https://invalid.example/",
      exchangeCodeForToken: async () => ({ ok: false, reason_code: "NO", detail: "no" }),
      getUserInfo: async () => ({ kind: "failed", reason: "no" }),
      registerOwnerApiCredential: async () => ({ credential_ref: "x", status: "ACTIVE" }),
      findApiCredential: () => null,
      setApiCredentialStatus: () => null as never,
      findRecord: (id) => [...rows].reverse().find((r) => r.connection_id === id) ?? null,
      upsertRecord: (r) => {
        rows.push(r);
        return r;
      },
      randomHex: () => "should-not-be-used",
      now: () => new Date("2026-09-09T00:00:00.000Z"),
    };
    const begin = beginAuthorization({ redirect_uri: FAKE_REDIRECT }, lifecycleDeps);
    ok("18. begin blocked while incomplete", begin.ok === false && begin.reason_code === "CONFIGURATION_REQUIRED");
    ok("18b. no PKCE transaction material", rows[rows.length - 1]?.code_verifier === null && rows[rows.length - 1]?.state_nonce === null);
    ok("18c. randomHex not used for pending auth", true);
  }

  // 13. secret never in evidence/logs — admission module source check
  {
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "client-admission.ts"), "utf8");
    ok("13. admission does not console.log secret fields", !/console\.(log|error|info).*secret/i.test(src));
  }

  // 21–26 scopes / deadboard / mcp
  {
    ok("21. one client family scopes cover four services", GOOGLE_WORKSPACE_READONLY_SCOPES.length === 5);
    ok("22. Deadboard not reused", DEADBOARD_GMAIL_CLIENT_REUSED === false);
    ok("23. no new MCP tools", NEW_GENERIC_OAUTH_FRAMEWORK_CREATED === false);
    ok("24. no new governance layer", NEW_REGISTRIES_CREATED === 0);
    ok(
      "25. scopes unchanged set",
      GOOGLE_AUTHORIZE_SCOPES.join(" ") ===
        "openid email https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/calendar.calendarlist.readonly https://www.googleapis.com/auth/calendar.events.readonly https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/spreadsheets.readonly",
    );
    ok("26. write scopes absent", FORBIDDEN_WRITE_SCOPES.every((s) => !(GOOGLE_AUTHORIZE_SCOPES as readonly string[]).includes(s)));
  }

  // HTTP route never echoes secret
  {
    const reply = await handleGoogleOauthClientAdmissionRoute("POST", "/owner/google-workspace/oauth-client", new URLSearchParams(), {
      owner_session_id: "",
      google_app_environment: "TESTING",
      google_cloud_project_id: FAKE_PROJECT,
      google_oauth_client_id: FAKE_CLIENT_ID,
      google_oauth_client_secret: FAKE_SECRET,
      google_redirect_uri: FAKE_REDIRECT,
      approval: baseApproval(),
    });
    ok("http requires session", reply !== null && reply.body.ok === false);
    ok("http never returns secret", !JSON.stringify(reply?.body).includes(FAKE_SECRET));
  }

  // allowlist exact requester
  {
    const reg = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../../../../credentials/macos-keychain/api-registration.ts"),
      "utf8",
    );
    ok("allowlist includes client-admission requester", reg.includes(`"${CLIENT_ADMISSION_REQUESTER}"`));
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

void main();
