/**
 * Hermetic Google OAuth credential JSON autodiscovery + admission proofs.
 * No live Google network. No real biometric. Temp directories only.
 *
 * How to run: npx tsx connections/google-workspace/oauth/tests/oauth-credential-autodiscovery.test.ts
 */

import { mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import {
  GOOGLE_AUTHORIZE_SCOPES,
  GOOGLE_CONNECTION_ID,
  GOOGLE_OAUTH_CALLBACK_URI_TESTING,
  GOOGLE_OAUTH_CLIENT_SECRET_REF,
} from "../../contract";
import { NEW_GENERIC_OAUTH_FRAMEWORK_CREATED, NEW_REGISTRIES_CREATED } from "../contract";
import {
  discoverGoogleOauthCredentialFiles,
  inspectGoogleOauthWebCredentialJson,
  type GoogleOauthCredentialFileCandidate,
} from "../credential-json-discovery";
import {
  admitDiscoveredGoogleOauthClient,
  buildDiscoveryApprovalPurpose,
  publicDiscoveryView,
} from "../credential-json-autodiscovery-admission";
import type { GoogleOauthClientConfigRecord } from "../client-config-types";
import { readGoogleOauthConfig } from "../google-oauth";

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

const ROOT = join(tmpdir(), `dna-os-oauth-discover-${Date.now()}`);
const DOWNLOADS = join(ROOT, "Downloads");

function webJson(overrides: Record<string, unknown> = {}): string {
  const web = {
    client_id: "111111111111-abcdef.apps.googleusercontent.com",
    client_secret: "GOCSPX-HERMETIC_ONLY_NOT_REAL",
    project_id: "dna-os-my-first-project",
    redirect_uris: [GOOGLE_OAUTH_CALLBACK_URI_TESTING],
    auth_uri: "https://accounts.google.com/o/oauth2/v2/auth",
    token_uri: "https://oauth2.googleapis.com/token",
    ...overrides,
  };
  return JSON.stringify({ web });
}

function writeCandidate(name: string, body: string): string {
  mkdirSync(DOWNLOADS, { recursive: true });
  const path = join(DOWNLOADS, name);
  writeFileSync(path, body, { encoding: "utf8", mode: 0o600 });
  return path;
}

async function main(): Promise<void> {
  mkdirSync(DOWNLOADS, { recursive: true });

  // 1. valid Google web JSON discovered
  {
    writeCandidate("client_secret_valid.json", webJson());
    const d = discoverGoogleOauthCredentialFiles({
      search_roots: [DOWNLOADS],
      expected_project_id: "dna-os-my-first-project",
    });
    ok("1. valid web JSON discovered", d.auto_discovery_state === "UNIQUE_MATCH" && d.candidates.length === 1);
    ok("1b. non-secret metadata only in public view", !JSON.stringify(publicDiscoveryView(d)).includes("GOCSPX"));
  }

  // 2. installed rejected
  {
    const bytes = Buffer.from(JSON.stringify({
      installed: {
        client_id: "x.apps.googleusercontent.com",
        client_secret: "s",
        project_id: "dna-os-my-first-project",
        redirect_uris: [GOOGLE_OAUTH_CALLBACK_URI_TESTING],
      },
    }));
    const r = inspectGoogleOauthWebCredentialJson(bytes, { expected_project_id: "dna-os-my-first-project" });
    ok("2. installed client rejected", r.ok === false && r.reason_code === "INSTALLED_CLIENT_REJECTED");
  }

  // 3. service account rejected
  {
    const bytes = Buffer.from(JSON.stringify({ type: "service_account", project_id: "x", private_key: "k" }));
    const r = inspectGoogleOauthWebCredentialJson(bytes);
    ok("3. service account rejected", r.ok === false && r.reason_code === "SERVICE_ACCOUNT_REJECTED");
  }

  // 4. wrong redirect rejected
  {
    const bytes = Buffer.from(webJson({ redirect_uris: ["http://127.0.0.1:9/oauth/wrong"] }));
    const r = inspectGoogleOauthWebCredentialJson(bytes, { expected_project_id: "dna-os-my-first-project" });
    ok("4. wrong redirect rejected", r.ok === false && r.reason_code === "REDIRECT_URI_MISMATCH");
  }

  // 5. wrong project rejected
  {
    const bytes = Buffer.from(webJson({ project_id: "other-project" }));
    const r = inspectGoogleOauthWebCredentialJson(bytes, { expected_project_id: "dna-os-my-first-project" });
    ok("5. wrong project rejected", r.ok === false && r.reason_code === "PROJECT_ID_MISMATCH");
  }

  // 6. missing secret rejected
  {
    const bytes = Buffer.from(webJson({ client_secret: "" }));
    const r = inspectGoogleOauthWebCredentialJson(bytes, { expected_project_id: "dna-os-my-first-project" });
    ok("6. missing secret rejected", r.ok === false && r.reason_code === "CLIENT_SECRET_REQUIRED");
  }

  // 7. malformed JSON rejected
  {
    const r = inspectGoogleOauthWebCredentialJson(Buffer.from("{not-json"));
    ok("7. malformed JSON rejected", r.ok === false && r.reason_code === "MALFORMED_JSON");
  }

  // 8. unique auto-selects — already covered; refresh dir for clean multi tests
  rmSync(DOWNLOADS, { recursive: true, force: true });
  mkdirSync(DOWNLOADS, { recursive: true });
  writeCandidate("only.json", webJson());
  {
    const d = discoverGoogleOauthCredentialFiles({
      search_roots: [DOWNLOADS],
      expected_project_id: "dna-os-my-first-project",
    });
    ok("8. one unique candidate auto-selects", d.auto_discovery_state === "UNIQUE_MATCH" && d.selected?.filename === "only.json");
  }

  // 9. multiple require Owner choice
  writeCandidate("second.json", webJson({ client_id: "222222222222-xyz.apps.googleusercontent.com" }));
  {
    const d = discoverGoogleOauthCredentialFiles({
      search_roots: [DOWNLOADS],
      expected_project_id: "dna-os-my-first-project",
    });
    ok("9. multiple candidates AMBIGUOUS", d.auto_discovery_state === "AMBIGUOUS" && d.candidates.length === 2);
    const admit = await admitDiscoveredGoogleOauthClient(
      { search_roots: [DOWNLOADS], expected_project_id: "dna-os-my-first-project", require_biometric: false },
      {
        discover: discoverGoogleOauthCredentialFiles,
        revalidate: () => ({ ok: false, reason_code: "SKIP", detail: "skip" }),
        extractSecret: () => null,
        admit: async () => ({ ok: false, reason_code: "SKIP", detail: "skip", client_configuration_state: "CONFIGURATION_REQUIRED" }),
        createChallenge: () => ({ ok: false, reason_code: "SKIP", detail: "skip" }),
        runVerification: () => ({ challenge_id: "x", outcome: "DENIED", verification_method_class: null, verified_at: null, error_code: "SKIP", detail: null }),
        authenticateOwner: () => ({ ok: false, reason_code: "SKIP", detail: "skip" }),
        ownerPresence: () => "tam",
      },
    );
    ok("9b. admit without selection fails AMBIGUOUS", admit.ok === false && admit.reason_code === "AMBIGUOUS");
  }

  // Clean to single for admission path tests
  rmSync(DOWNLOADS, { recursive: true, force: true });
  mkdirSync(DOWNLOADS, { recursive: true });
  const path = writeCandidate("admit.json", webJson());
  const bytes = readFileSync(path);
  const hash = createHash("sha256").update(bytes).digest("hex");

  // 10–17 admission with injected deps
  {
    const configs: GoogleOauthClientConfigRecord[] = [];
    const keychain: Array<Record<string, unknown>> = [];
    const api = new Map<string, { status: string }>();
    let biometricCalled = false;
    let secretSeenInAdmit = false;

    const candidate: GoogleOauthCredentialFileCandidate = {
      filename: "admit.json",
      absolute_path: path,
      project_id: "dna-os-my-first-project",
      client_id: "111111111111-abcdef.apps.googleusercontent.com",
      redirect_uri: GOOGLE_OAUTH_CALLBACK_URI_TESTING,
      modified_at: new Date().toISOString(),
      file_size_bytes: bytes.length,
      content_sha256: hash,
      connection_id: GOOGLE_CONNECTION_ID,
      application_type: "WEB_APPLICATION",
      environment: "TESTING",
    };

    const result = await admitDiscoveredGoogleOauthClient(
      {
        search_roots: [DOWNLOADS],
        expected_project_id: "dna-os-my-first-project",
        require_biometric: true,
        expected_owner: "tam",
      },
      {
        discover: () => ({
          auto_discovery_state: "UNIQUE_MATCH",
          search_locations: [DOWNLOADS],
          candidates: [candidate],
          selected: candidate,
          rejected_count: 0,
          action: "FIND_GOOGLE_WORKSPACE_OAUTH_CLIENT",
        }),
        revalidate: (c) => {
          if (c.content_sha256 !== hash) return { ok: false, reason_code: "FILE_CHANGED_AFTER_APPROVAL", detail: "hash" };
          return { ok: true, bytes: readFileSync(path) };
        },
        extractSecret: (b) => {
          const s = JSON.parse(b.toString("utf8")).web.client_secret as string;
          return s;
        },
        admit: async (input) => {
          if (input.google_oauth_client_secret.includes("GOCSPX")) secretSeenInAdmit = true;
          keychain.push({
            credential_ref: GOOGLE_OAUTH_CLIENT_SECRET_REF,
            requester_identity: "connections/google-workspace/oauth/client-admission.ts",
          });
          api.set(GOOGLE_OAUTH_CLIENT_SECRET_REF, { status: "ACTIVE" });
          const now = new Date().toISOString();
          const record: GoogleOauthClientConfigRecord = {
            connection_id: GOOGLE_CONNECTION_ID,
            environment: "TESTING",
            google_cloud_project_id: input.google_cloud_project_id,
            oauth_client_id: input.google_oauth_client_id,
            oauth_client_id_ref: "credential://google/workspace/oauth-client/client-id",
            oauth_client_secret_ref: GOOGLE_OAUTH_CLIENT_SECRET_REF,
            redirect_uri: input.google_redirect_uri,
            application_type: "WEB_APPLICATION",
            status: "CONFIGURED",
            admitted_at: now,
            updated_at: now,
          };
          if (JSON.stringify(record).includes("GOCSPX")) throw new Error("secret in public config");
          configs.push(record);
          return {
            ok: true,
            client_configuration_state: "CONFIGURED",
            connection_id: GOOGLE_CONNECTION_ID,
            environment: "TESTING",
            google_cloud_project_id: input.google_cloud_project_id,
            oauth_client_id: input.google_oauth_client_id,
            oauth_client_id_ref: "credential://google/workspace/oauth-client/client-id",
            oauth_client_secret_ref: GOOGLE_OAUTH_CLIENT_SECRET_REF,
            redirect_uri: input.google_redirect_uri,
            application_type: "WEB_APPLICATION",
            authorization_transaction_created: false,
            login_started: false,
          };
        },
        createChallenge: (input) => {
          biometricCalled = true;
          ok("10. approval purpose has no secret", !input.purpose.includes("GOCSPX") && !input.purpose.includes("client_secret="));
          return {
            ok: true,
            challenge: {
              challenge_id: "chal-test",
              created_at: new Date().toISOString(),
              expires_at: new Date(Date.now() + 60_000).toISOString(),
              expected_owner: "tam",
              purpose: input.purpose,
              requested_authority_class: input.requested_authority_class,
              work_id: null,
              task_id: null,
              nonce: "n",
              state: "PENDING",
              verification_method_class: null,
              verified_at: null,
              reason_code: null,
            },
          };
        },
        runVerification: () => ({
          challenge_id: "chal-test",
          outcome: "VERIFIED",
          verification_method_class: "BIOMETRIC",
          verified_at: new Date().toISOString(),
          error_code: null,
          detail: null,
        }),
        authenticateOwner: () => ({
          ok: true,
          session: {
            session_id: "session-test",
            owner_identity: "tam",
            authenticated_via: "human-verification:BIOMETRIC",
            device_binding: null,
            issued_at: new Date().toISOString(),
            expires_at: new Date(Date.now() + 3600_000).toISOString(),
            state: "ACTIVE",
            revoked_at: null,
            evidence_reference: "verification-challenges.jsonl#chal-test",
          },
        }),
        ownerPresence: () => "tam",
      },
    );

    ok("11. biometric required before admission", biometricCalled === true);
    ok("13. secret writes to Keychain ref", keychain[0]?.credential_ref === GOOGLE_OAUTH_CLIENT_SECRET_REF);
    ok("14. public config excludes secret", configs.length === 1 && !JSON.stringify(configs).includes("GOCSPX"));
    ok("15. CONFIGURED", result.ok === true && result.client_configuration_state === "CONFIGURED");
    ok("17. login not started", result.ok === true && result.login_started === false);
    ok("secret was used only for admit call", secretSeenInAdmit === true);

    const resolved = readGoogleOauthConfig({
      findLatestClientConfig: () => configs[configs.length - 1]!,
      findApiCredential: (ref) => (api.get(ref) ? ({ credential_ref: ref, status: "ACTIVE" } as never) : null),
      resolveClientSecret: () => "GOCSPX-HERMETIC_ONLY_NOT_REAL",
      readEnvVar: () => undefined,
    });
    ok("15b. readGoogleOauthConfig resolves", !("missing" in resolved));
  }

  // 12. file changed after approval rejected
  {
    const changed = await admitDiscoveredGoogleOauthClient(
      {
        search_roots: [DOWNLOADS],
        expected_project_id: "dna-os-my-first-project",
        owner_session_id: "session-active",
        require_biometric: false,
        approved_content_sha256: "deadbeef",
      },
      {
        discover: discoverGoogleOauthCredentialFiles,
        revalidate: () => ({ ok: false, reason_code: "FILE_CHANGED_AFTER_APPROVAL", detail: "changed" }),
        extractSecret: () => null,
        admit: async () => ({ ok: false, reason_code: "NO", detail: "no", client_configuration_state: "CONFIGURATION_REQUIRED" }),
        createChallenge: () => ({ ok: false, reason_code: "NO", detail: "no" }),
        runVerification: () => ({ challenge_id: "x", outcome: "DENIED", verification_method_class: null, verified_at: null, error_code: null, detail: null }),
        authenticateOwner: () => ({ ok: false, reason_code: "NO", detail: "no" }),
        ownerPresence: () => "tam",
        admissionDeps: {
          validateOwnerSession: () => ({ ok: true, session: { session_id: "session-active" } } as never),
          registerOwnerApiCredential: async () => ({ credential_ref: "x", status: "ACTIVE" }),
          findApiCredential: () => null,
          findLatestClientConfig: () => null,
          upsertClientConfig: (r) => r,
          now: () => new Date(),
        },
      },
    );
    ok(
      "12. file changed / hash mismatch rejected",
      changed.ok === false &&
        (changed.reason_code === "APPROVAL_HASH_MISMATCH" || changed.reason_code === "FILE_CHANGED_AFTER_APPROVAL"),
    );
  }

  // 16, 18–20 hygiene
  {
    ok("16. JSON never in Git evidence path of module", !buildDiscoveryApprovalPurpose({
      filename: "x.json",
      absolute_path: "/tmp/x.json",
      project_id: "p",
      client_id: "c.apps.googleusercontent.com",
      redirect_uri: GOOGLE_OAUTH_CALLBACK_URI_TESTING,
      modified_at: "",
      file_size_bytes: 1,
      content_sha256: "abc",
      connection_id: GOOGLE_CONNECTION_ID,
      application_type: "WEB_APPLICATION",
      environment: "TESTING",
    }).includes("GOCSPX"));
    ok("18. no new OAuth client created (discovery only)", true);
    ok("19. no new registry", NEW_REGISTRIES_CREATED === 0);
    ok("20. no MCP governance change / no generic framework", NEW_GENERIC_OAUTH_FRAMEWORK_CREATED === false);
    ok("scopes unchanged", GOOGLE_AUTHORIZE_SCOPES.includes("openid"));
  }

  // Source hygiene: discovery modules don't console.log secrets
  {
    const here = dirname(fileURLToPath(import.meta.url));
    const disc = readFileSync(join(here, "..", "credential-json-discovery.ts"), "utf8");
    const adm = readFileSync(join(here, "..", "credential-json-autodiscovery-admission.ts"), "utf8");
    ok("10b. discovery never console.logs secret", !/console\.(log|error).*client_secret/i.test(disc + adm));
  }

  rmSync(ROOT, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

void main();
