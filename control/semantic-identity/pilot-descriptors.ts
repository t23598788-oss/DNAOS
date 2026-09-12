/**
 * Explicit Runtime Steps 1–8 pilot descriptors.
 * Paths/symbols are real code locations only — never invented.
 * SemanticId is stable; path is discovery provenance only.
 */

import type { SemanticDescriptor } from "./types";

export const INFRA_REPO_ID =
  "repository://t23598788-oss/-DNA-OS-INFRASTRUCTURE-" as const;

const SRC = {
  repositoryId: INFRA_REPO_ID,
  path: "control/semantic-identity/pilot-descriptors.ts",
  symbol: "PILOT_DESCRIPTORS",
} as const;

/** Ordered for deterministic emission. */
export const PILOT_DESCRIPTORS: readonly SemanticDescriptor[] = [
  {
    id: INFRA_REPO_ID,
    kind: "repository",
    title: "DNA OS Infrastructure Core",
    declaredCanonical: true,
    implementation: {
      repositoryId: INFRA_REPO_ID,
      path: "software/repository-registry/contract.ts",
      symbol: "buildRepositoryId",
    },
  },
  {
    id: "contract://runtime-node/v1",
    kind: "contract",
    title: "Runtime node + optional provider vocabulary",
    ownerRepository: INFRA_REPO_ID,
    declaredCanonical: true,
    implementation: {
      repositoryId: INFRA_REPO_ID,
      path: "contracts/architecture/runtime-node-and-optional-provider.ts",
      symbol: "lookupRuntimeNodeKind",
    },
  },
  {
    id: "contract://runtime-endpoint/v1",
    kind: "contract",
    title: "Runtime endpoint registry contract",
    ownerRepository: INFRA_REPO_ID,
    declaredCanonical: true,
    implementation: {
      repositoryId: INFRA_REPO_ID,
      path: "control/runtime-endpoint-registry/contract.ts",
      symbol: "resolveRuntimeEndpoint",
    },
  },
  {
    id: "contract://own-machine-core/v1",
    kind: "contract",
    title: "Own-machine Core Linux boot contract",
    ownerRepository: INFRA_REPO_ID,
    declaredCanonical: true,
    implementation: {
      repositoryId: INFRA_REPO_ID,
      path: "contracts/architecture/own-machine-core.ts",
      symbol: "OWN_MACHINE_CORE_CONTRACT_ID",
    },
  },
  {
    id: "policy://execution/default",
    kind: "policy",
    title: "Default execution permission policy",
    ownerRepository: INFRA_REPO_ID,
    implementation: {
      repositoryId: INFRA_REPO_ID,
      path: "control/permission-policy-resolution/resolver.ts",
      symbol: "resolvePolicy",
    },
  },
  {
    id: "capability://runtime/node-classification",
    kind: "capability",
    title: "Runtime node classification",
    ownerRepository: INFRA_REPO_ID,
    implements: ["contract://runtime-node/v1"],
    verifiedBy: ["test://runtime/node-classification"],
    declaredCanonical: true,
    implementation: {
      repositoryId: INFRA_REPO_ID,
      path: "contracts/architecture/runtime-node-and-optional-provider.ts",
      symbol: "lookupRuntimeNodeKind",
    },
  },
  {
    id: "capability://runtime/secret-resolution",
    kind: "capability",
    title: "Portable secret / credential resolution",
    ownerRepository: INFRA_REPO_ID,
    dependsOn: ["capability://runtime/node-classification"],
    verifiedBy: ["test://runtime/secret-resolution"],
    declaredCanonical: true,
    implementation: {
      repositoryId: INFRA_REPO_ID,
      path: "credentials/secret-resolver/node-credential-resolver.ts",
      symbol: "resolveNodeCredential",
    },
  },
  {
    id: "capability://runtime/process-supervision",
    kind: "capability",
    title: "Portable process supervision",
    ownerRepository: INFRA_REPO_ID,
    dependsOn: ["capability://runtime/node-classification"],
    verifiedBy: ["test://runtime/process-supervision"],
    declaredCanonical: true,
    implementation: {
      repositoryId: INFRA_REPO_ID,
      path: "control/runtime-control/portable-supervisor.ts",
      symbol: "PortableProcessSupervisor",
    },
  },
  {
    id: "capability://repository/checkout-resolution",
    kind: "capability",
    title: "Repository checkout resolution",
    ownerRepository: INFRA_REPO_ID,
    dependsOn: ["capability://runtime/node-classification"],
    verifiedBy: ["test://repository/checkout-resolution"],
    declaredCanonical: true,
    implementation: {
      repositoryId: INFRA_REPO_ID,
      path: "software/repository-registry/checkout-resolution.ts",
      symbol: "resolveRepositoryCheckout",
    },
  },
  {
    id: "capability://runtime/endpoint-resolution",
    kind: "capability",
    title: "Runtime endpoint resolution",
    ownerRepository: INFRA_REPO_ID,
    dependsOn: [
      "capability://repository/checkout-resolution",
      "capability://runtime/node-classification",
    ],
    implements: ["contract://runtime-endpoint/v1"],
    reachableAt: ["endpoint://owner-command-http/local"],
    verifiedBy: ["test://runtime/endpoint-registry"],
    declaredCanonical: true,
    implementation: {
      repositoryId: INFRA_REPO_ID,
      path: "control/runtime-endpoint-registry/resolver.ts",
      symbol: "resolveRuntimeEndpoint",
    },
  },
  {
    id: "capability://core/own-machine-linux",
    kind: "capability",
    title: "Own-machine Linux Core",
    ownerRepository: INFRA_REPO_ID,
    dependsOn: ["capability://runtime/node-classification"],
    implements: ["contract://own-machine-core/v1"],
    verifiedBy: ["test://core/own-machine-linux"],
    declaredCanonical: true,
    implementation: {
      repositoryId: INFRA_REPO_ID,
      path: "contracts/architecture/own-machine-core.ts",
      symbol: "OWN_MACHINE_CORE_CONTRACT_ID",
    },
  },
  {
    id: "capability://owner-command/submit",
    kind: "capability",
    title: "Owner command submit",
    ownerRepository: INFRA_REPO_ID,
    dependsOn: [
      "capability://runtime/endpoint-resolution",
      "capability://core/own-machine-linux",
    ],
    authorizedBy: ["policy://execution/default"],
    verifiedBy: ["test://owner-command/submit"],
    declaredCanonical: true,
    implementation: {
      repositoryId: INFRA_REPO_ID,
      path: "control/owner-command/owner-command.ts",
      symbol: "submitOwnerCommand",
    },
  },
  {
    id: "endpoint://owner-command-http/local",
    kind: "endpoint",
    title: "Local owner-command-http endpoint",
    ownerRepository: INFRA_REPO_ID,
    implementation: {
      repositoryId: INFRA_REPO_ID,
      path: "control/runtime-endpoint-registry/local-from-services.ts",
      symbol: "LOCAL_CORE_SERVICES",
    },
  },
  {
    id: "test://runtime/node-classification",
    kind: "test",
    title: "Runtime node classification tests",
    ownerRepository: INFRA_REPO_ID,
    implementation: {
      repositoryId: INFRA_REPO_ID,
      path: "contracts/architecture/runtime-node-and-optional-provider.test.ts",
    },
  },
  {
    id: "test://runtime/secret-resolution",
    kind: "test",
    title: "Core-node secret resolver tests",
    ownerRepository: INFRA_REPO_ID,
    implementation: {
      repositoryId: INFRA_REPO_ID,
      path: "credentials/secret-resolver/tests/core-node-secret-resolver.test.ts",
    },
  },
  {
    id: "test://runtime/process-supervision",
    kind: "test",
    title: "Portable supervisor tests",
    ownerRepository: INFRA_REPO_ID,
    implementation: {
      repositoryId: INFRA_REPO_ID,
      path: "control/runtime-control/tests/portable-supervisor.test.ts",
    },
  },
  {
    id: "test://repository/checkout-resolution",
    kind: "test",
    title: "Checkout resolution tests",
    ownerRepository: INFRA_REPO_ID,
    implementation: {
      repositoryId: INFRA_REPO_ID,
      path: "software/repository-registry/tests/checkout-portability.test.ts",
    },
  },
  {
    id: "test://runtime/endpoint-registry",
    kind: "test",
    title: "Runtime endpoint registry tests",
    ownerRepository: INFRA_REPO_ID,
    implementation: {
      repositoryId: INFRA_REPO_ID,
      path: "control/runtime-endpoint-registry/tests/runtime-endpoint-registry.test.ts",
    },
  },
  {
    id: "test://core/own-machine-linux",
    kind: "test",
    title: "Own-machine Core Linux tests",
    ownerRepository: INFRA_REPO_ID,
    implementation: {
      repositoryId: INFRA_REPO_ID,
      path: "contracts/architecture/own-machine-core-acceptance.test.ts",
    },
  },
  {
    id: "test://owner-command/submit",
    kind: "test",
    title: "Owner command tests",
    ownerRepository: INFRA_REPO_ID,
    implementation: {
      repositoryId: INFRA_REPO_ID,
      path: "control/owner-command/tests/owner-command.test.ts",
    },
  },
];

export { SRC as PILOT_DESCRIPTOR_SOURCE };
