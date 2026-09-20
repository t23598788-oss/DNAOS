/**
 * Connect Core — Railway provider contract (FIRST_PROOF_PROVIDER).
 *
 * Every method DELEGATES to code that already exists and is already in use;
 * this file adds no new credential path, no new network call shape, and no new
 * lifecycle. Delegation map:
 *
 *   detect()            -> real workspace artifacts (engines/domains/railway-binding.ts,
 *                          engines/integration-gateway/adapters/railway.ts, the observe
 *                          ingress route) + provider-declared observer entry, read
 *                          through injected DetectDeps (no fs/env reach-in from here).
 *   inspect()           -> the live connectors row through injected ConnectRuntimeDeps
 *                          (status/enabled/config + secret FIELD NAMES only).
 *   prepareConnect()    -> the field set the EXISTING "railway" connector record needs
 *                          (engines/domains/railway-binding.ts:23-27 documents it) plus
 *                          the observe URL this app derives itself.
 *   discoverResources() -> engines/domains/railway-binding.ts#discoverResources 1:1
 *                          (that function owns the Run gate via getConnectedConnector).
 *   test()              -> the canonical Test stage injected by the caller
 *                          (gateway/connectors.ts#runConnectorTest), so engines never
 *                          import gateway and never touch a secret value.
 *
 * Why OWNER_REQUIRED: the binding's own source states it —
 * "API token the system cannot mint itself (OWNER_REQUIRED for creation)"
 * (engines/domains/railway-binding.ts:160), and the same file marks domain
 * mutations "Irreversible-adjacent ... must go through gateway/domains.ts's
 * confirm flow, never a UI direct call" (:206-207).
 *
 * Language rule: identifiers and `label_key`s only, no display literals.
 */
import { ADAPTERS } from "@/engines/integration-gateway/selfDescription";
import { discoverResources as railwayDiscoverResources } from "@/engines/domains/railway-binding";
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

const PROVIDER_ID = "railway";
const CONNECTOR_SLUG = "railway";

/** Real GraphQL endpoint the binding defaults to when config.base_url is unset
 *  (engines/domains/railway-binding.ts:38 — DEFAULT_API_URL). The lifecycle Test
 *  path needs it in config to reach the Railway-shaped check in
 *  engines/connectors/tester.ts, so it is offered as a non-secret default. */
const DEFAULT_API_URL = "https://backboard.railway.com/graphql/v2";

/** The observe ingress this app exposes for Railway deployment webhooks —
 *  app/api/gateway/observe/railway/route.ts:16 builds exactly this path and
 *  authenticates it with a ?key= secret the OWNER holds (never derived here). */
const OBSERVE_PATH = "/api/gateway/observe/railway";

/** The ONE canonical secret field for a Railway connector record —
 *  `secret.api_token`. It is the name the binding already reads
 *  (engines/domains/railway-binding.ts:51,66) and the name the lifecycle Test
 *  path now resolves as well (engines/connectors/tester.ts#resolveBearerCredential),
 *  so a single value travels Prepare -> Connect -> Register -> Test -> Run with
 *  no alias and no second copy stored anywhere. */
const CANONICAL_TOKEN_KEY = "api_token";
const REQUIRED_SECRET_KEYS: readonly string[] = [CANONICAL_TOKEN_KEY];

function ev(source: string, detail: string): EvidenceRef {
  return { source, detail, captured_at: new Date().toISOString() };
}

function capabilityMetadata(): CapabilityMetadata[] {
  // "deployment.status.observed" is the canonical id in
  // engines/integration-gateway/contracts/event.ts (GatewayCapability) produced by
  // engines/integration-gateway/adapters/railway.ts — declared here, never mangled
  // or guessed from another string.
  return [
    { id: "deployment.status.observed", label_key: "connect.capability.railwayDeploymentStatus", direction: "INBOUND" },
    { id: "domain.custom.manage", label_key: "connect.capability.railwayCustomDomain", direction: "BIDIRECTIONAL" },
    { id: "cloud.resource.discover", label_key: "connect.capability.railwayResourceDiscovery", direction: "INBOUND" },
  ];
}

function detect(deps: DetectDeps): EvidenceRef[] {
  const out: EvidenceRef[] = [];
  const artifacts: [string, string][] = [
    ["engines/domains/railway-binding.ts", "real Railway client: GraphQL domain CRUD + projects/services/environments discovery, credential resolved from the \"railway\" connector record only"],
    ["engines/integration-gateway/adapters/railway.ts", "real webhook normalizer for Railway deployment status into the canonical GatewayEvent"],
    ["app/api/gateway/observe/railway/route.ts", "real observe ingress (Railway does not sign payloads; secret-in-URL verification, fail-closed 503/401)"],
    ["engines/connectors/tester.ts", "lifecycle Test already knows a Railway-shaped check (GraphQL me { id } body assertion)"],
  ];
  for (const [relPath, detail] of artifacts) {
    if (deps.fileExists(relPath)) out.push(ev(`workspace_file:${relPath}`, detail));
  }
  if (ADAPTERS.some((a) => a.provider === "railway")) {
    out.push(ev("integration_gateway:selfDescription", "declared observer adapter present (ingress=webhook)"));
  }
  if (deps.envNames().includes("RAILWAY_WEBHOOK_SECRET")) {
    out.push(ev("env_var_name:RAILWAY_WEBHOOK_SECRET", "credential-shaped env var name present (value never read)"));
  }
  return out;
}
const APPROVAL: ApprovalRequirement = "OWNER_REQUIRED";

async function inspect(deps: ConnectRuntimeDeps): Promise<InspectionResult> {
  const summary = await deps.getConnectorSummary(CONNECTOR_SLUG);
  if (!summary) {
    return {
      credential_status: "MISSING",
      missing_field_keys: [...REQUIRED_SECRET_KEYS],
      evidence: [
        ev("connectors_table:slug=railway", "no connector row exists yet — Connect -> Register has not happened for this provider"),
      ],
    };
  }

  const missing = REQUIRED_SECRET_KEYS.filter((k) => !summary.secret_keys.includes(k));
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
        "connectors_table:slug=railway",
        `status=${summary.status} enabled=${summary.enabled} secret_field_names=[${summary.secret_keys.join(",")}] (names only, never values)`,
      ),
    ],
  };
}

function fieldSpecs(): FieldSpec[] {
  return [
    {
      key: CANONICAL_TOKEN_KEY,
      label_key: "connect.field.railwayApiToken",
      target: "secret",
      secret: true,
      required: true,
      placeholder: "railway.com/account/tokens",
    },
    { key: "base_url", label_key: "connect.field.apiBaseUrl", target: "config", secret: false, required: false },
    { key: "service_id", label_key: "connect.field.railwayServiceId", target: "config", secret: false, required: false },
    { key: "environment_id", label_key: "connect.field.railwayEnvironmentId", target: "config", secret: false, required: false },
  ];
}

async function prepareConnect(deps: ConnectRuntimeDeps): Promise<ConnectPreparation> {
  const origin = deps.appOrigin();
  const derived: ConnectPreparation["derived"] = [];
  if (origin) {
    // Read-only value the owner copies OUT to Railway. The ?key= secret itself is
    // the owner's own RAILWAY_WEBHOOK_SECRET and is never produced or stored here.
    derived.push({ key: "observe_url", value: `${origin}${OBSERVE_PATH}` });
  }

  const evidence: EvidenceRef[] = [
    ev(
      "engines/domains/railway-binding.ts:23-27",
      "declared connector record: secret.api_token, config.service_id, config.environment_id, config.base_url (optional override)",
    ),
    ev(
      "engines/connectors/tester.ts:155-172",
      "lifecycle Test for a backboard.railway URL asserts the GraphQL response body (data.me.id) — a bare HTTP 200 is refused",
    ),
    ev(
      "app/api/gateway/observe/railway/route.ts:16",
      "observe URL must carry the owner's own ?key=<RAILWAY_WEBHOOK_SECRET>; that value is never read or emitted by this contract",
    ),
    ev(
      "engines/domains/railway-binding.ts:160",
      "binding source states an API token the system cannot mint itself (OWNER_REQUIRED) — the reason this contract is OWNER_REQUIRED",
    ),
  ];
  if (!origin) {
    evidence.push(
      ev(
        "env_var:NEXT_PUBLIC_APP_URL",
        "not set in this environment, so the derived observe_url cannot be produced yet — a real, visible gap rather than an invented URL",
      ),
    );
  }

  return {
    provider_id: PROVIDER_ID,
    fields: fieldSpecs(),
    defaults: [{ key: "base_url", value: DEFAULT_API_URL }],
    derived,
    required_secret_field_keys: [...REQUIRED_SECRET_KEYS],
    approval: APPROVAL,
    evidence,
  };
}

async function discoverResources(): Promise<DiscoverResourcesResult> {
  const r = await railwayDiscoverResources();
  if (r.ok) return { ok: true, resources: r.resources };
  if ("stage" in r) return { ok: false, code: r.stage, error: r.error };
  return { ok: false, code: "PROVIDER_ERROR", error: r.error };
}

async function test(deps: ConnectRuntimeDeps): Promise<ConnectTestResult> {
  const summary = await deps.getConnectorSummary(CONNECTOR_SLUG);
  if (!summary) {
    return {
      ok: false,
      error: "connector_not_registered — Connect -> Register must run before Test",
      evidence: [ev("connectors_table:slug=railway", "no connector row to test yet")],
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

export const railwayConnectContract: ConnectContract = {
  providerId: PROVIDER_ID,
  authModes: ["token"] as readonly AuthMode[],
  approvalRequirement: APPROVAL,
  capabilityMetadata,
  detect,
  inspect,
  prepareConnect,
  discoverResources,
  test,
};

