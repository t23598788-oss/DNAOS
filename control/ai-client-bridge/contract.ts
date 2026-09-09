/**
 * Public boundary of control/ai-client-bridge/.
 */

export {
  AI_CLIENT_BINDING_SCHEMA,
  AI_CLIENT_RESULT_SCHEMA,
  AI_HANDOFF_SCHEMA,
  SITE_TOOL_ALLOWLIST,
  SIDE_EFFECT_CAPABILITIES,
} from "./types";
export type {
  AiClientBindingV1,
  AiClientResultV1,
  AiHandoffV1,
  SearchClass,
  AiClientBindingState,
} from "./types";

export {
  listAiClientBindings,
  latestAiClientBinding,
  discoverAiClient,
  connectAiClient,
  verifyAiClientToolDiscovery,
  enableAiClient,
  blockAiClient,
  evaluateAiClient,
  googleChromeGeminiAvailability,
} from "./bindings";
export { siteToolCatalog, getAiClientDiscovery } from "./discovery";
export { listSiteTools, invokeSiteTool } from "./site-tool";
export { inspectLocalForClient } from "./inspect";
export { routeSearch } from "./search-route";
export { createAiHandoff, listAiHandoffs } from "./handoff";
