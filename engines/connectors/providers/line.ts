/**
 * Connect Core — LINE provider contract (capability A, 2026-09-23).
 *
 * Added to the EXISTING Connect Core pre-layer: no central route, gateway,
 * catalog or UI file changes to plug a provider in — registry.ts is the only
 * other edit (exactly how github proved provider-neutrality). Every method
 * delegates to code that already exists and is already in production:
 *
 *   detect()            -> real workspace artifacts (the LINE Edge Function that
 *                          receives the webhook, the gateway adapter + observe
 *                          ingress this capability added, the credential bridge)
 *                          read through injected DetectDeps.
 *   inspect()           -> the live connectors row through injected
 *                          ConnectRuntimeDeps (status/enabled/config + secret
 *                          FIELD NAMES only).
 *   prepareConnect()    -> the exact field set the RUNNING credential path
 *                          already requires: app/api/internal/line/token reads
 *                          `secret.channel_access_token` (fallback token/api_key)
 *                          for connector slug "line", and the lifecycle Test for
 *                          auth_type "token" needs config.base_url (+ test_path).
 *   discoverResources() -> honestly NOT_SUPPORTED: this repo has no LINE
 *                          resource-listing implementation (the gateway adapter
 *                          normalizes inbound webhooks; it lists nothing).
 *   test()              -> the canonical Test stage injected by the caller
 *                          (gateway/connectors.ts#runConnectorTest) — the same
 *                          function every other provider contract uses.
 *
 * Why OWNER_REQUIRED: the channel access token is minted inside the LINE
 * Developers console (the system cannot mint it itself), and what it unlocks is
 * a public webhook ingress that speaks to real customers — an Owner decision,
 * the same reasoning tier as the Railway precedent.
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

const PROVIDER_ID = "line";
/** The exact slug the running credential path resolves
 *  (app/api/internal/line/token/route.ts:34 — `const SLUG = "line"`). */
const CONNECTOR_SLUG = "line";

/** Real LINE Messaging API host the token auth-type Test must reach
 *  (developers.line.biz — GET /v2/bot/info returns the bot identity for the
 *  token, so a wrong token fails instead of passing silently). */
const API_BASE_URL = "https://api.line.me";
const TEST_PATH = "v2/bot/info";

const APPROVAL: ApprovalRequirement = "OWNER_REQUIRED";

/** One secret field, named exactly what the canonical credential bridge reads. */
const REQUIRED_SECRET_KEYS: readonly string[] = ["channel_access_token"];

function ev(source: string, detail: string): EvidenceRef {
  return { source, detail, captured_at: new Date().toISOString() };
}

function capabilityMetadata(): CapabilityMetadata[] {
  // Only the canonical GatewayCapability ids the provider's adapter actually
  // emits today (engines/integration-gateway/adapters/line.ts) — the same
  // discipline github's contract follows. Outbound send is intentionally NOT
  // declared yet: no outbound capability id exists until that path is built.
  return [
    { id: "message.received", label_key: "connect.capability.messageReceived", direction: "INBOUND" },
    { id: "document.received", label_key: "connect.capability.documentReceived", direction: "INBOUND" },
    { id: "location.received", label_key: "connect.capability.locationReceived", direction: "INBOUND" },
    { id: "identity.signal.received", label_key: "connect.capability.identitySignalReceived", direction: "INBOUND" },
    { id: "interaction.received", label_key: "connect.capability.interactionReceived", direction: "INBOUND" },
  ];
}

function detect(deps: DetectDeps): EvidenceRef[] {
  const out: EvidenceRef[] = [];
  const artifacts: [string, string][] = [
    ["supabase/functions/line-webhook-v2/index.ts", "real provider-side receiver: verifies the LINE signature and forwards the raw body to the gateway observe ingress"],
    ["engines/integration-gateway/adapters/line.ts", "the ONE place a raw LINE payload is translated into the canonical GatewayEvent contract"],
    ["app/api/gateway/observe/line/route.ts", "real observe ingress (signature verified before the payload is touched)"],
    ["app/api/internal/line/token/route.ts", "canonical credential path for connector slug \"line\" — resolves through core/connector-loader.ts and enforces the lifecycle Run gate"],
    ["engines/connectors/tester.ts", "lifecycle Test for auth_type \"token\" reaches base_url + test_path and refuses a bare HTTP 200 gone wrong"],
  ];
  for (const [relPath, detail] of artifacts) {
    if (deps.fileExists(relPath)) out.push(ev(`workspace_file:${relPath}`, detail));
  }
  const adapter = ADAPTERS.find((a) => a.provider === "line");
  if (adapter) {
    out.push(
      ev("integration_gateway:selfDescription", `declared observer adapter present (ingress=${adapter.ingress}, observes=[${adapter.observes.join(",")}])`),
    );
  }
  for (const name of ["LINE_CHANNEL_SECRET", "LINE_CHANNEL_ACCESS_TOKEN"]) {
    if (deps.envNames().includes(name)) out.push(ev(`env_var_name:${name}`, "provider-shaped env var name present (value never read)"));
  }
  return out;
}

async function inspect(deps: ConnectRuntimeDeps): Promise<InspectionResult> {
  const summary = await deps.getConnectorSummary(CONNECTOR_SLUG);
  if (!summary) {
    return {
      credential_status: "MISSING",
      missing_field_keys: [...REQUIRED_SECRET_KEYS],
      evidence: [ev("connectors_table:slug=line", "no connector row exists yet — Connect -> Register has not happened for this provider")],
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
        "connectors_table:slug=line",
        `status=${summary.status} enabled=${summary.enabled} secret_field_names=[${summary.secret_keys.join(",")}] (names only, never values)`,
      ),
    ],
  };
}

function fieldSpecs(): FieldSpec[] {
  return [
    {
      key: "channel_access_token",
      label_key: "connect.field.channelAccessToken",
      target: "secret",
      secret: true,
      required: true,
    },
  ];
}

async function prepareConnect(deps: ConnectRuntimeDeps): Promise<ConnectPreparation> {
  const evidence: EvidenceRef[] = [
    ev(
      "app/api/internal/line/token/route.ts:88-93",
      "the running credential path reads secret.channel_access_token (fallback token/api_key) for slug \"line\" — this is the field the form must collect, not a guessed name",
    ),
    ev(
      "engines/connectors/tester.ts#testApiKeyOrToken",
      "lifecycle Test for auth_type \"token\" builds base_url + test_path and sends the bearer credential — a wrong token fails instead of passing silently",
    ),
  ];

  const derived: ConnectPreparation["derived"] = [];
  const summary = await deps.getConnectorSummary(CONNECTOR_SLUG).catch(() => null);
  const appOrigin = deps.appOrigin();
  if (appOrigin) {
    // The webhook URL the Owner registers in the LINE Developers console must
    // point at THIS app's observe ingress. Shown read-only; never stored as a
    // credential and never auto-registered with the provider.
    derived.push({ key: "observe_webhook_url", value: `${appOrigin.replace(/\/+$/, "")}/api/gateway/observe/line` });
  } else {
    evidence.push(
      ev("app/api/gateway/observe/line/route.ts", "observe ingress path is /api/gateway/observe/line — the absolute URL is shown once this app's own origin is known"),
    );
  }
  if (summary) {
    evidence.push(ev("connectors_table:slug=line", "connector row exists — Connect -> Register has already run; Enable is still an Owner action"));
  }

  return {
    provider_id: PROVIDER_ID,
    fields: fieldSpecs(),
    defaults: [
      { key: "base_url", value: API_BASE_URL },
      { key: "test_path", value: TEST_PATH },
    ],
    derived,
    required_secret_field_keys: [...REQUIRED_SECRET_KEYS],
    approval: APPROVAL,
    evidence,
  };
}

async function discoverResources(): Promise<DiscoverResourcesResult> {
  // No LINE resource-listing implementation exists in this repo (the gateway
  // adapter normalizes inbound webhooks; it does not list anything), so this
  // answers NOT_SUPPORTED — which the discovery route already renders as
  // "manual input allowed" — instead of inventing a resource list.
  return {
    ok: false,
    code: "NOT_SUPPORTED",
    error: "line_resource_discovery_not_implemented",
  };
}

async function test(deps: ConnectRuntimeDeps): Promise<ConnectTestResult> {
  const summary = await deps.getConnectorSummary(CONNECTOR_SLUG);
  if (!summary) {
    return {
      ok: false,
      error: "connector_not_registered — Connect -> Register must run before Test",
      evidence: [ev("connectors_table:slug=line", "no connector row to test yet")],
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
        `canonical Test recorded status=${updated.status} against ${API_BASE_URL}/${TEST_PATH} — auto-disable on failure and audit_logs behaviour unchanged`,
      ),
    ],
  };
}

export const lineConnectContract: ConnectContract = {
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

