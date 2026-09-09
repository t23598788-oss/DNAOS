import type { VerificationGateV1 } from "./types";

export const VERIFICATION_GATES: readonly VerificationGateV1[] = [
  { gate_id: "typecheck", command: ["npm", "run", "typecheck"], classification: "SOURCE_REQUIRED", required_for_source_admission: true },
  { gate_id: "diverged-source-integration", command: ["npx", "tsx", "control/diverged-source-integration/tests/diverged-source-integration.test.ts"], classification: "HERMETIC_INTEGRATION_REQUIRED", required_for_source_admission: true },
  { gate_id: "integration-verification-closure", command: ["npx", "tsx", "control/integration-verification-closure/tests/integration-verification-closure.test.ts"], classification: "HERMETIC_INTEGRATION_REQUIRED", required_for_source_admission: true },
  { gate_id: "canonical-information", command: ["npx", "tsx", "control/canonical-information/tests/canonical-information.test.ts"], classification: "SOURCE_REQUIRED", required_for_source_admission: true },
  { gate_id: "canonical-view", command: ["npx", "tsx", "control/canonical-view/tests/canonical-view.test.ts"], classification: "SOURCE_REQUIRED", required_for_source_admission: true },
  { gate_id: "owner-notification", command: ["npx", "tsx", "control/owner-notification/tests/owner-notification.test.ts"], classification: "SOURCE_REQUIRED", required_for_source_admission: true },
  { gate_id: "production-checkpoint", command: ["npx", "tsx", "control/production-checkpoint/tests/production-checkpoint.test.ts"], classification: "SOURCE_REQUIRED", required_for_source_admission: true },
  { gate_id: "production-admission-closure", command: ["npx", "tsx", "control/production-checkpoint/tests/production-admission-closure.test.ts"], classification: "HERMETIC_INTEGRATION_REQUIRED", required_for_source_admission: true },
  { gate_id: "railway-adapter-source", command: ["npx", "tsx", "control/production-checkpoint/tests/railway-deploy-mutation.test.ts"], classification: "SOURCE_REQUIRED", required_for_source_admission: true },
  { gate_id: "remote-production-source", command: ["npx", "tsx", "control/production-checkpoint/tests/remote-production-discovery.test.ts"], classification: "HERMETIC_INTEGRATION_REQUIRED", required_for_source_admission: true },
  { gate_id: "ai-queen", command: ["npx", "tsx", "control/owner-client-runtime/tests/ai-queen-capability-consumer.test.ts"], classification: "SOURCE_REQUIRED", required_for_source_admission: true },
  { gate_id: "mcp-server", command: ["npx", "tsx", "connections/dna-os-mcp/tests/mcp-server.test.ts"], classification: "SOURCE_REQUIRED", required_for_source_admission: true },
  { gate_id: "mcp-code-knowledge", command: ["npx", "tsx", "control/mcp-code-knowledge/tests/mcp-code-knowledge.test.ts"], classification: "SOURCE_REQUIRED", required_for_source_admission: true },
  { gate_id: "owner-client-runtime", command: ["npx", "tsx", "control/owner-client-runtime/tests/owner-client-runtime.test.ts"], classification: "SOURCE_REQUIRED", required_for_source_admission: true },
  { gate_id: "semantic-finality", command: ["npx", "tsx", "control/conversation-runtime/tests/semantic-finality.test.ts"], classification: "SOURCE_REQUIRED", required_for_source_admission: true },
  { gate_id: "owner-runtime-projection", command: ["npx", "tsx", "control/conversation-runtime/tests/owner-response-projection.test.ts"], classification: "SOURCE_REQUIRED", required_for_source_admission: true },
  { gate_id: "github-branch-governance", command: ["npx", "tsx", "control/github-branch-governance/tests/github-branch-governance.test.ts"], classification: "HERMETIC_INTEGRATION_REQUIRED", required_for_source_admission: true },
  { gate_id: "owner-command-live", command: ["npx", "tsx", "connections/dna-os-mcp/tests/mcp-server-live.test.ts"], classification: "ENVIRONMENT_REQUIRED", required_for_source_admission: false },
  { gate_id: "canonical-information-live", command: ["npx", "tsx", "control/canonical-information/tests/canonical-information-live.test.ts"], classification: "ENVIRONMENT_REQUIRED", required_for_source_admission: false },
  { gate_id: "railway-provider-live", command: ["npx", "tsx", "control/production-checkpoint/tests/railway-provider-live.test.ts"], classification: "PROVIDER_REQUIRED", required_for_source_admission: false },
  { gate_id: "remote-production-live", command: ["npx", "tsx", "control/production-checkpoint/tests/remote-production-live.test.ts"], classification: "PROVIDER_REQUIRED", required_for_source_admission: false },
];

export function sourceAdmissionGates(): readonly VerificationGateV1[] {
  return VERIFICATION_GATES.filter((row) => row.required_for_source_admission);
}
