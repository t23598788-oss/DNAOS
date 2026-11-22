/**
 * Connect Core contract for Kod Chat.
 *
 * Bot API v1 contract verified against the provider's public documentation.
 */
import { ADAPTERS } from "@/engines/integration-gateway/selfDescription";
import type {
  ApprovalRequirement, AuthMode, CapabilityMetadata, ConnectContract,
  ConnectPreparation, ConnectRuntimeDeps, ConnectTestResult, DetectDeps,
  DiscoverResourcesResult, EvidenceRef, FieldSpec, InspectionResult,
} from "../contract";

const PROVIDER_ID = "kodchat";
const CONNECTOR_SLUG = "kodchat";
const APPROVAL: ApprovalRequirement = "OWNER_REQUIRED";
const REQUIRED_SECRET_KEYS = ["api_key", "webhook_secret"] as const;
const REQUIRED_CONFIG_KEYS = ["base_url", "send_message_path", "test_path"] as const;

function evidence(source: string, detail: string): EvidenceRef {
  return { source, detail, captured_at: new Date().toISOString() };
}

function capabilityMetadata(): CapabilityMetadata[] {
  return [
    { id: "kodchat.webhook.receive", label_key: "connect.capability.kodchatWebhookReceive", direction: "INBOUND" },
    { id: "kodchat.message.send", label_key: "connect.capability.kodchatMessageSend", direction: "OUTBOUND" },
  ];
}

function detect(deps: DetectDeps): EvidenceRef[] {
  const artifacts = [
    "engines/integration-gateway/adapters/kodchat.ts",
    "app/api/gateway/observe/kodchat/route.ts",
    "engines/connectors/providers/kodchat.ts",
  ];
  return artifacts.filter((file) => deps.fileExists(file)).map((file) =>
    evidence(`workspace_file:${file}`, "Kod Chat Bot API v1 protocol is documented in the adapter; live readiness still follows Connector Test and Owner Enable"),
  );
}

async function inspect(deps: ConnectRuntimeDeps): Promise<InspectionResult> {
  const summary = await deps.getConnectorSummary(CONNECTOR_SLUG);
  if (!summary) {
    return {
      credential_status: "MISSING",
      missing_field_keys: [...REQUIRED_CONFIG_KEYS, ...REQUIRED_SECRET_KEYS],
      evidence: [evidence("connectors_table:slug=kodchat", "connector is not registered")],
    };
  }
  const missing = [
    ...REQUIRED_CONFIG_KEYS.filter((key) => !String(summary.config[key] ?? "").trim()),
    ...REQUIRED_SECRET_KEYS.filter((key) => !summary.secret_keys.includes(key)),
  ];
  const credentialStatus: InspectionResult["credential_status"] = summary.status === "error"
    ? "INVALID"
    : summary.status === "connected" && summary.enabled && missing.length === 0
      ? "CONFIGURED"
      : "MISSING";
  return {
    credential_status: credentialStatus,
    missing_field_keys: missing,
    evidence: [evidence("connectors_table:slug=kodchat", `status=${summary.status} enabled=${summary.enabled} missing_fields=[${missing.join(",")}] (secret values withheld)`)],
  };
}

function fields(): FieldSpec[] {
  return [
    { key: "base_url", label_key: "connect.field.kodchatApiBaseUrl", target: "config", secret: false, required: true },
    { key: "send_message_path", label_key: "connect.field.kodchatSendPath", target: "config", secret: false, required: true },
    { key: "test_path", label_key: "connect.field.kodchatTestPath", target: "config", secret: false, required: true },
    { key: "api_key", label_key: "connect.field.kodchatApiKey", target: "secret", secret: true, required: true },
    { key: "webhook_secret", label_key: "connect.field.kodchatWebhookSecret", target: "secret", secret: true, required: true },
  ];
}

async function prepareConnect(deps: ConnectRuntimeDeps): Promise<ConnectPreparation> {
  const summary = await deps.getConnectorSummary(CONNECTOR_SLUG).catch(() => null);
  const derived = deps.appOrigin()
    ? [{ key: "observe_webhook_url", value: `${deps.appOrigin()!.replace(/\/+$/, "")}/api/gateway/observe/kodchat` }]
    : [];
  return {
    provider_id: PROVIDER_ID,
    fields: fields(),
    defaults: [
      { key: "base_url", value: "https://kobchat.com/api/bot/v1" },
      { key: "send_message_path", value: "/messages" },
      { key: "test_path", value: "/me" },
      { key: "signature_header", value: "X-Kob-Signature" },
      { key: "signature_encoding", value: "base64" },
      { key: "signature_prefix", value: "" },
    ],
    derived,
    required_secret_field_keys: [...REQUIRED_SECRET_KEYS],
    approval: APPROVAL,
    evidence: [
      evidence("https://kobchat.com/docs/bot-api", "Bot API v1 documents HTTPS base URL, Bearer bot token, GET /me, POST /messages, PUT /webhook, and X-Kob-Signature Base64 HMAC-SHA256"),
      ...(summary ? [evidence("connectors_table:slug=kodchat", "connector row exists; status and secret field names are available through the existing Connect lifecycle")] : []),
    ],
  };
}

async function discoverResources(): Promise<DiscoverResourcesResult> {
  return { ok: false, code: "NOT_SUPPORTED", error: "kodchat_resource_discovery_not_implemented" };
}

async function test(deps: ConnectRuntimeDeps): Promise<ConnectTestResult> {
  const summary = await deps.getConnectorSummary(CONNECTOR_SLUG);
  if (!summary) return { ok: false, error: "connector_not_registered", evidence: [evidence("connectors_table:slug=kodchat", "register the provider before Test")] };
  for (const key of REQUIRED_CONFIG_KEYS) {
    if (!String(summary.config[key] ?? "").trim()) {
      return { ok: false, error: `missing_config:${key}`, evidence: [evidence("connectors_table:slug=kodchat", "provider API details must be confirmed before Test")] };
    }
  }
  const result = await deps.runCanonicalTest(summary.id);
  return {
    ok: result.status === "connected",
    error: result.status === "connected" ? undefined : result.last_error ?? `status=${result.status}`,
    evidence: [evidence("gateway/connectors.ts:runConnectorTest", `canonical connector test status=${result.status}; Owner Enable remains a separate required step`)],
  };
}

export const kodchatConnectContract: ConnectContract = {
  providerId: PROVIDER_ID,
  authModes: ["api_key"] as readonly AuthMode[],
  approvalRequirement: APPROVAL,
  capabilityMetadata,
  detect,
  inspect,
  prepareConnect,
  discoverResources,
  test,
};
