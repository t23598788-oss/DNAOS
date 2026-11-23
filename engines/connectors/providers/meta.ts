/**
 * Connect Core — Meta app webhook contract.
 *
 * This contract covers only the real capability already present in DNA OS:
 * signature-verified inbound Page/Messenger and Instagram messaging events.
 * It configures the shared Meta App receiver through the existing Connect
 * lifecycle and central connectors.secret store. It does not claim Page
 * OAuth/account selection, catalog sync, publishing, or order management.
 */
import { ADAPTERS } from "@/engines/integration-gateway/selfDescription";
import type {
  ApprovalRequirement, AuthMode, CapabilityMetadata, ConnectContract,
  ConnectPreparation, ConnectRuntimeDeps, ConnectTestResult, DetectDeps,
  DiscoverResourcesResult, EvidenceRef, FieldSpec, InspectionResult,
} from "../contract";

const PROVIDER_ID = "meta";
const REQUIRED_CONFIG = ["app_id"] as const;
const REQUIRED_SECRET = ["app_secret", "verify_token"] as const;
const APPROVAL: ApprovalRequirement = "OWNER_REQUIRED";
const WEBHOOK_PATH = "/api/gateway/observe/meta";

function ev(source: string, detail: string): EvidenceRef {
  return { source, detail, captured_at: new Date().toISOString() };
}

function capabilityMetadata(): CapabilityMetadata[] {
  return [
    { id: "message.received", label_key: "connect.capability.messageReceived", direction: "INBOUND" },
    { id: "document.received", label_key: "connect.capability.documentReceived", direction: "INBOUND" },
    { id: "interaction.received", label_key: "connect.capability.interactionReceived", direction: "INBOUND" },
  ];
}

function detect(deps: DetectDeps): EvidenceRef[] {
  const artifacts: [string, string][] = [
    ["engines/integration-gateway/adapters/meta.ts", "validates Meta HMAC signatures and normalizes only inbound message/document/interaction evidence"],
    ["app/api/gateway/observe/meta/route.ts", "Meta verification and observe ingress using the registered Meta app connector"],
    ["engines/integration-gateway/event-bus/bus.ts", "one event bus for canonical Observe events; no direct business writes"],
  ];
  const evidence = artifacts
    .filter(([path]) => deps.fileExists(path))
    .map(([path, detail]) => ev(`workspace_file:${path}`, detail));
  if (ADAPTERS.some((adapter) => adapter.provider === "facebook") && ADAPTERS.some((adapter) => adapter.provider === "instagram")) {
    evidence.push(ev("integration_gateway:selfDescription", "Facebook and Instagram remain distinct inbound identities over the shared Meta adapter"));
  }
  return evidence;
}

async function inspect(deps: ConnectRuntimeDeps): Promise<InspectionResult> {
  const summary = await deps.getConnectorSummaryByProvider(PROVIDER_ID);
  if (!summary) {
    return {
      credential_status: "MISSING",
      missing_field_keys: [...REQUIRED_CONFIG, ...REQUIRED_SECRET],
      evidence: [ev("connectors_table:provider=meta", "no Meta app connector is registered")],
    };
  }
  const missing = [
    ...REQUIRED_CONFIG.filter((key) => !String(summary.config[key] ?? "").trim()),
    ...REQUIRED_SECRET.filter((key) => !summary.secret_keys.includes(key)),
  ];
  const status = summary.auth_type !== "webhook" || summary.status === "error"
    ? "INVALID"
    : summary.status === "connected" && summary.enabled && missing.length === 0
      ? "CONFIGURED"
      : "MISSING";
  return {
    credential_status: status,
    missing_field_keys: missing,
    evidence: [ev("connectors_table:provider=meta", `status=${summary.status} enabled=${summary.enabled} auth_type=${summary.auth_type} secret_field_names=[${summary.secret_keys.join(",")}] (names only)`)],
  };
}

function fieldSpecs(): FieldSpec[] {
  return [
    { key: "app_id", label_key: "connect.field.metaAppId", target: "config", secret: false, required: true },
    { key: "app_secret", label_key: "connect.field.metaAppSecret", target: "secret", secret: true, required: true },
    { key: "verify_token", label_key: "connect.field.metaWebhookVerifyToken", target: "secret", secret: true, required: true },
  ];
}

async function prepareConnect(deps: ConnectRuntimeDeps): Promise<ConnectPreparation> {
  const origin = deps.appOrigin();
  const derived = origin ? [{ key: "webhook_callback_url", value: `${origin}${WEBHOOK_PATH}` }] : [];
  const evidence = [
    ev("engines/integration-gateway/adapters/meta.ts", "the implemented path verifies X-Hub-Signature-256 over the raw request body and emits inbound evidence only"),
    ev("app/api/gateway/observe/meta/route.ts", "the registered app credentials are read server-side from the existing Connect connector secret store"),
    ev("https://developers.facebook.com/docs/graph-api/webhooks/getting-started/webhooks-for-pages/", "Page webhook installation uses Page-level authorization; Page discovery/subscription requires pages_show_list and pages_manage_metadata, and Messenger requires pages_messaging plus the assigned Page task"),
    ev("https://developers.facebook.com/docs/marketing-api/catalog/", "catalog_management is outside this receiver and must not be requested unless Catalog sync is separately implemented and approved"),
    ev("Meta App Review", "App ID/secret setup does not itself connect a Page or grant business data access; provider consent remains a separate action"),
  ];
  if (!origin) evidence.push(ev("environment:NEXT_PUBLIC_APP_URL", "public app origin is unset; callback URL cannot be derived yet"));
  return {
    provider_id: PROVIDER_ID,
    fields: fieldSpecs(),
    defaults: [
      { key: "signature_header", value: "x-hub-signature-256" },
      { key: "provider_ingress_path", value: WEBHOOK_PATH },
    ],
    derived,
    required_secret_field_keys: [...REQUIRED_SECRET],
    approval: APPROVAL,
    evidence,
  };
}

async function discoverResources(): Promise<DiscoverResourcesResult> {
  return { ok: false, code: "NOT_SUPPORTED", error: "meta_page_account_discovery_not_implemented" };
}

async function test(deps: ConnectRuntimeDeps): Promise<ConnectTestResult> {
  const summary = await deps.getConnectorSummaryByProvider(PROVIDER_ID);
  if (!summary) return { ok: false, error: "connector_not_registered", evidence: [ev("connectors_table:provider=meta", "no Meta app connector exists") ] };
  const updated = await deps.runCanonicalTest(summary.id);
  return {
    ok: updated.status === "connected",
    error: updated.status === "connected" ? undefined : updated.last_error ?? `status=${updated.status}`,
    evidence: [ev("gateway/connectors.ts#runConnectorTest", `canonical webhook lifecycle Test recorded status=${updated.status}; Meta signatures are verified at the dedicated Gateway ingress`)],
  };
}

export const metaConnectContract: ConnectContract = {
  providerId: PROVIDER_ID,
  authModes: ["webhook"] as readonly AuthMode[],
  approvalRequirement: APPROVAL,
  capabilityMetadata,
  detect,
  inspect,
  prepareConnect,
  discoverResources,
  test,
};
