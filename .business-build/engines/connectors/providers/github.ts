/**
 * Connect Core — GitHub provider contract (SECOND provider; STEP 8's
 * provider-neutrality proof).
 *
 * This file is the ONLY thing that had to exist to plug a second provider into
 * the Connect Core pre-layer: no central route, gateway, catalog or UI file was
 * touched. Every method delegates to code that already exists:
 *
 *   detect()            -> real workspace artifacts (register-github-oauth-connector.ts,
 *                          integration-gateway/adapters/github.ts, the observe ingress, the
 *                          generic OAuth authorize/callback routes, the tester's own
 *                          GitHub-shaped check) read through injected DetectDeps.
 *   inspect()           -> the live connectors row through injected ConnectRuntimeDeps
 *                          (status/enabled/config + secret FIELD NAMES only).
 *   prepareConnect()    -> the exact field set scripts/register-github-oauth-connector.ts
 *                          already writes, plus the callback URL the system derives once the
 *                          connector row exists (before that, honestly, nothing).
 *   discoverResources() -> honestly NOT_SUPPORTED: this repo has no GitHub resource-discovery
 *                          implementation (the gateway's GitHub adapter is a webhook
 *                          *normalizer*, not a lister), so manual input stays available exactly
 *                          as the discovery route already documents. Nothing is invented.
 *   test()              -> the canonical Test stage injected by the caller
 *                          (gateway/connectors.ts#runConnectorTest) — the same function the
 *                          Railway contract uses and the admin Test route uses.
 *
 * Why NONE (no Owner-approval gate): GitHub's own consent screen already requires the
 * Owner to authorize personally in a browser — the registration script's own comment
 * states "no credential automation" and the authorize route refuses anyone outside
 * ADMIN_TIER, so the system cannot obtain this credential by itself and an extra approval
 * record would gate nothing real. (Railway is the opposite: a provider-minted API token
 * with no interactive consent, hence OWNER_REQUIRED.)
 *
 * Language rule: identifiers and `label_key`s only, no display literals.
 */
import { ADAPTERS } from "@/engines/integration-gateway/selfDescription";
import type {
  ApprovalRequirement,
  AuthMode,
  CapabilityMetadata,
  ConnectContract,
  ConnectPreparation,
  ConnectRuntimeDeps,
  ConnectTestResult,
  DetectDeps,
  DiscoverResourcesResult,
  EvidenceRef,
  FieldSpec,
  InspectionResult,
} from "../contract";

const PROVIDER_ID = "github";
const CONNECTOR_SLUG = "github";

/** Real GitHub OAuth endpoints, verbatim from the already-existing registration
 *  script (scripts/register-github-oauth-connector.ts:76-86) — declared once here
 *  instead of being re-derived or typed by hand in the form. */
const AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const TOKEN_URL = "https://github.com/login/oauth/access_token";
const TEST_URL = "https://api.github.com/user";
const DEFAULT_SCOPE = "read:user";

const APPROVAL: ApprovalRequirement = "NONE";

/** client_secret is the only secret GitHub issues; client_id is public and lives
 *  in config — so exactly one secret field, no aliases. */
const REQUIRED_SECRET_KEYS: readonly string[] = ["client_secret"];
const REQUIRED_CONFIG_KEYS: readonly string[] = ["client_id"];

function ev(source: string, detail: string): EvidenceRef {
  return { source, detail, captured_at: new Date().toISOString() };
}

function capabilityMetadata(): CapabilityMetadata[] {
  // Only ids engines/integration-gateway/adapters/github.ts actually emits
  // (canonical GatewayCapability values) — never derived by mangling another
  // string. What the adapter *observes* on GitHub's side is reported as evidence
  // in detect() instead of being turned into invented capability ids.
  return [
    { id: "source.change.detected", label_key: "connect.capability.githubChangeDetected", direction: "INBOUND" },
    { id: "source.workflow.status", label_key: "connect.capability.githubWorkflowStatus", direction: "INBOUND" },
  ];
}

function detect(deps: DetectDeps): EvidenceRef[] {
  const out: EvidenceRef[] = [];
  const artifacts: [string, string][] = [
    ["scripts/register-github-oauth-connector.ts", "real, idempotent registration path — writes the connector only when a real client id/secret exist, and never automates the credential"],
    ["engines/integration-gateway/adapters/github.ts", "real webhook normalizer (push / pull_request / workflow_run) with HMAC-SHA256 signature verification"],
    ["app/api/gateway/observe/github/route.ts", "real observe ingress (signature verified before the payload is touched)"],
    ["app/api/connectors/oauth/authorize/[slug]/route.ts", "generic OAuth authorize route, provider-neutral by design (only the Google host gets extra params) — GitHub needs no branch"],
    ["engines/connectors/tester.ts", "lifecycle Test already has a GitHub-shaped check (GET api.github.com/user must return a real \"login\" field)"],
  ];
  for (const [relPath, detail] of artifacts) {
    if (deps.fileExists(relPath)) out.push(ev(`workspace_file:${relPath}`, detail));
  }
  const adapter = ADAPTERS.find((a) => a.provider === "github");
  if (adapter) {
    out.push(
      ev("integration_gateway:selfDescription", `declared observer adapter present (ingress=${adapter.ingress}, observes=[${adapter.observes.join(",")}])`),
    );
  }
  for (const name of ["GITHUB_OAUTH_CLIENT_ID", "GITHUB_OAUTH_CLIENT_SECRET"]) {
    if (deps.envNames().includes(name)) out.push(ev(`env_var_name:${name}`, "credential-shaped env var name present (value never read)"));
  }
  return out;
}
async function inspect(deps: ConnectRuntimeDeps): Promise<InspectionResult> {
  const summary = await deps.getConnectorSummary(CONNECTOR_SLUG);
  if (!summary) {
    return {
      credential_status: "MISSING",
      missing_field_keys: [...REQUIRED_CONFIG_KEYS, ...REQUIRED_SECRET_KEYS],
      evidence: [ev("connectors_table:slug=github", "no connector row exists yet — Connect -> Register has not happened for this provider")],
    };
  }

  const missing = [
    ...REQUIRED_CONFIG_KEYS.filter((k) => {
      const v = summary.config[k];
      return v === undefined || v === null || String(v).length === 0;
    }),
    ...REQUIRED_SECRET_KEYS.filter((k) => !summary.secret_keys.includes(k)),
  ];
  const credentialStatus: InspectionResult["credential_status"] =
    summary.status === "error"
      ? "INVALID"
      : summary.status === "connected" && summary.enabled && missing.length === 0
        ? "CONFIGURED"
        : "MISSING";

  return {
    credential_status: credentialStatus,
    missing_field_keys: missing,
    evidence: [
      ev(
        "connectors_table:slug=github",
        `status=${summary.status} enabled=${summary.enabled} secret_field_names=[${summary.secret_keys.join(",")}] (names only, never values)`,
      ),
    ],
  };
}

function fieldSpecs(): FieldSpec[] {
  return [
    { key: "client_id", label_key: "connect.field.githubClientId", target: "config", secret: false, required: true },
    { key: "client_secret", label_key: "connect.field.githubClientSecret", target: "secret", secret: true, required: true },
  ];
}

async function prepareConnect(deps: ConnectRuntimeDeps): Promise<ConnectPreparation> {
  const evidence: EvidenceRef[] = [
    ev(
      "scripts/register-github-oauth-connector.ts:76-86",
      "declared connector record: config.authorize_url / token_url / client_id / scope / test_url plus secret.client_secret",
    ),
    ev(
      "engines/connectors/tester.ts:151-160",
      "lifecycle Test for an api.github.com test_url asserts a real \"login\" field in the body — a bare HTTP 200 is refused",
    ),
    ev(
      "app/api/connectors/oauth/authorize/[slug]/route.ts:44-58",
      "the authorize URL the system builds is derived from this record (client_id / redirect_uri / scope / state), never typed by the app",
    ),
  ];

  // The callback URL only exists once the row exists (createConnector derives
  // config.redirect_uri from the generated slug), so it is surfaced read-only
  // only when it is real — no placeholder URL is ever invented here.
  const derived: ConnectPreparation["derived"] = [];
  const summary = await deps.getConnectorSummary(CONNECTOR_SLUG).catch(() => null);
  const redirectUri = summary?.config.redirect_uri;
  if (typeof redirectUri === "string" && redirectUri.length > 0) {
    derived.push({ key: "callback_url", value: redirectUri });
  } else {
    evidence.push(
      ev(
        "engines/connectors/registry.ts#github",
        "callback_url is produced by Register (gateway/connectors.ts#createConnector derives config.redirect_uri from the generated slug) — it is shown here, read-only, as soon as the row exists",
      ),
    );
  }

  return {
    provider_id: PROVIDER_ID,
    fields: fieldSpecs(),
    defaults: [
      { key: "authorize_url", value: AUTHORIZE_URL },
      { key: "token_url", value: TOKEN_URL },
      { key: "test_url", value: TEST_URL },
      { key: "scope", value: DEFAULT_SCOPE },
    ],
    derived,
    required_secret_field_keys: [...REQUIRED_SECRET_KEYS],
    approval: APPROVAL,
    evidence,
  };
}

async function discoverResources(): Promise<DiscoverResourcesResult> {
  // No GitHub resource-listing implementation exists in this repo (the gateway's
  // GitHub adapter normalizes inbound webhooks; it does not list anything), so
  // this answers NOT_SUPPORTED — which the discovery route already renders as
  // "manual input allowed" — instead of inventing a resource list.
  return {
    ok: false,
    code: "NOT_SUPPORTED",
    error: "github_resource_discovery_not_implemented",
  };
}

async function test(deps: ConnectRuntimeDeps): Promise<ConnectTestResult> {
  const summary = await deps.getConnectorSummary(CONNECTOR_SLUG);
  if (!summary) {
    return {
      ok: false,
      error: "connector_not_registered — Connect -> Register must run before Test",
      evidence: [ev("connectors_table:slug=github", "no connector row to test yet")],
    };
  }

  const updated = await deps.runCanonicalTest(summary.id);
  const connected = updated.status === "connected";
  return {
    ok: connected,
    error: connected ? undefined : updated.last_error ?? `status=${updated.status}`,
    evidence: [
      ev(
        "gateway/connectors.ts:runConnectorTest",
        `canonical Test recorded status=${updated.status} — auto-disable on failure and audit_logs behaviour unchanged`,
      ),
    ],
  };
}

export const githubConnectContract: ConnectContract = {
  providerId: PROVIDER_ID,
  authModes: ["oauth"] as readonly AuthMode[],
  approvalRequirement: APPROVAL,
  capabilityMetadata,
  detect,
  inspect,
  prepareConnect,
  discoverResources,
  test,
};

