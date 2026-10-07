/**
 * Public boundary of control/local-resource-access/.
 * Other folders may import only from this file.
 */

export { LOCAL_RESOURCE_SCHEMA, OS_RESOURCE_SCHEMA, APPLICATION_RESOURCE_SCHEMA, LOCAL_PROCESS_GATE_SCHEMA, OWNER_MACHINE_POLICY_SCHEMA, EVERYDAY_DATA_ACTIONS_SCHEMA, REMOTE_RESOURCE_ACTION_SCHEMA, MACHINE_CAPABILITY_INVENTORY_SCHEMA, REMOTE_SERVICE_CAPABILITY_BINDING_SCHEMA, OWNER_CAPABILITY_BINDING_POLICY_SCHEMA } from "./types";
export type {
  AccessClass,
  AnomalyClass,
  AnomalyObservation,
  ApplicationActionType,
  ApplicationResourceV1,
  AuthorityDecision,
  AuthorityRequest,
  AuthorityResult,
  DataClassification,
  DataEgressRecord,
  DataResourceClass,
  EverydayActionDescriptor,
  EverydayActionId,
  HumanPermissionState,
  InvokeLocalCapabilityInput,
  InvokeLocalCapabilityResult,
  LocalAccessGrant,
  LocalCapabilityDescriptor,
  LocalCapabilityName,
  LocalExecutionEnvelope,
  LocalObservabilityEvent,
  LocalObservabilityEventType,
  LocalProcessJobV1,
  LocalResourceType,
  LocalResourceV1,
  NetworkEgressPolicy,
  OwnerMachinePolicyV1,
  SummarizeByteEvidence,
  TransferIntegrityRecord,
  BindableActionId,
  CapabilityAtomState,
  MachineCapabilityInventoryV1,
  OwnerCapabilityBindingPolicyV1,
  RemoteServiceCapabilityBindingV1,
} from "./types";

export { getEverydayAction, listEverydayActions, EVERYDAY_DATA_ACTIONS } from "./everyday-actions";
export { describeRemoteResourceAction, REMOTE_SERVICE_ACTION_MAP } from "./remote-resource-contract";
export { listTransferIntegrity } from "./transfer-integrity";

export { getLocalCapability, listLocalCapabilities, FORBIDDEN_CAPABILITY_NAMES, LOCAL_CAPABILITY_CATALOG } from "./capability-catalog";
export { getRegisteredLocalResource, listRegisteredLocalResources, publicResourceView, registerLocalResource, resourceAbsoluteRoot } from "./resource-registry";
export { resolveLogicalPath } from "./path-scope";
export { evaluateLocalAuthority, issueLocalAccessGrant, listLocalAccessGrants, resourcesVisibleToSession } from "./authority";
export { issueOwnerMachinePolicy, listOwnerMachinePolicies, evaluateOwnerMachinePolicy } from "./machine-policy";
export { discoverInstalledApplications, getRegisteredApplication, invokeRegisteredApplicationAction, listRegisteredApplications, mapEverydayApplicationAction, registerApplication } from "./application-adapter";
export { evaluateProcessJobRequest, getLocalProcessJob, listRegisteredJobs } from "./process-adapter";
export { classifyAnomaly } from "./anomaly";
export { createScopedLocalWorkspace, listScopedWorkspaces } from "./workspace-scope";
export { decideLocalFirst } from "./local-first";
export { listDataEgress, recordDataEgress, classifyEgressPayload } from "./egress";
export {
  capabilitiesPublicView,
  getLocalExecutionEvidence,
  getLocalExecutionStatus,
  getLocalResourceForSession,
  invokeLocalCapability,
  listLocalResourcesForSession,
} from "./gateway";
export { listLocalResourceEvents, emitLocalResourceEvent } from "./events";
export { filesMetadata } from "./filesystem-adapter";
export { listLocalExecutions, getLocalExecution } from "./evidence-store";
export { refreshMachineInventory, listPersistedInventory, listApplicationInventory, getApplicationCapabilities, getCapabilityBindingStatus } from "./machine-inventory";
export { listRemoteServiceBindings, getRemoteServiceBinding, publicRemoteServiceView } from "./remote-service-binding";
export { resolveCapabilityBindings } from "./capability-route";
export { issueOwnerCapabilityBindingPolicy, evaluateOwnerCapabilityBinding, matchingCapabilityBindingPolicy } from "./owner-capability-policy";
export { capabilityInvocable } from "./capability-states";
