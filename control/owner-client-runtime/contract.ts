/**
 * Public boundary of control/owner-client-runtime/.
 */

export {
  UNIVERSAL_CLIENT_SCHEMA,
  OWNER_RESOURCE_ENVIRONMENT_SCHEMA,
  RESOURCE_HANDLE_SCHEMA,
  OWNER_INTENT_REQUEST_SCHEMA,
  WORK_CONTEXT_SCHEMA,
  OWNER_COMPUTE_FIRST_SCHEMA,
  MCP_PROTOCOL_COMPAT,
} from "./types";
export type {
  UniversalClientV1,
  OwnerResourceEnvironmentV1,
  ResourceHandleV1,
  OwnerIntentRequestV1,
  WorkContextV1,
  ClientFamily,
} from "./types";

export {
  listUniversalClients,
  getUniversalClient,
  registerUniversalClient,
  authenticateUniversalClient,
  enableUniversalClient,
  markClientUnavailable,
  disconnectClient,
  evaluateUniversalClient,
  getClientStatus,
} from "./clients";
export { listOwnerEnvironments, getOwnerEnvironment, environmentForResource } from "./environments";
export { createResourceHandle, getResourceHandle, listResourceHandles } from "./handles";
export { decideOwnerComputeFirst } from "./compute-first";
export { normalizeOwnerIntent } from "./intent";
export { getWorkContext, listWorkContexts, upsertWorkContext, handoffWorkContext } from "./work-context";
export { submitOwnerIntent, approveOwnerIntent } from "./execute";
export {
  AI_QUEEN_CLIENT,
  AI_QUEEN_CLIENT_ID,
  AI_QUEEN_DEFAULT_TOOLS,
  AI_QUEEN_DNA_OS_CAPABILITY_CONSUMER,
  AI_QUEEN_WORK_ASSISTANT,
  EXTERNAL_PARITY_CLIENT_ID,
  OWNER_AI_QUEEN_PROFILE,
  RAW_RAILWAY_MCP_TOOLS,
  aiQueenAttemptDirect,
  aiQueenGrantSelfScope,
  aiQueenRequestRegisteredDeploy,
  answerOwnerWorkQuestion,
  enableAiQueenAsOwnerClient,
  externalParityCaller,
  getAiQueenCapabilityProfile,
  getAiQueenStatus,
  grantedToolsForAiClient,
  ownerAiQueenProfile,
  preferLocalQueenForPrivateSummary,
  queenCaller,
  registerAiQueenClient,
  registerExternalParityClient,
  toolsVisibleToAiQueen,
} from "./ai-queen";
export type { AiQueenClientV1 } from "./ai-queen";
