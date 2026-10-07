/**
 * Search class routing. Provider preference is last. Local source is never attached to web search.
 */

import { decideLocalFirst, getRemoteServiceBinding, resolveCapabilityBindings } from "../local-resource-access/contract";
import { googleChromeGeminiAvailability } from "./bindings";
import type { SearchClass } from "./types";

export interface SearchRouteQuery {
  readonly intent: SearchClass | "AUTO";
  readonly query: string;
  readonly data_class?: string;
  readonly resource_type?: "FILE" | "CODE" | "WEB" | "GITHUB" | "REMOTE";
  readonly ai_identity: string;
  readonly session_id: string;
  readonly work_id?: string;
  readonly preferred_provider?: string;
  readonly local_source?: string;
}

export function routeSearch(query: SearchRouteQuery): Record<string, unknown> {
  const google = googleChromeGeminiAvailability();
  const ownerRanked = resolveCapabilityBindings({
    action: query.resource_type === "GITHUB" ? "SEARCH" : "SEARCH",
    ai_identity: query.ai_identity,
    session_id: query.session_id,
    work_id: query.work_id,
  });
  const ownerBlocksPreferred = query.preferred_provider
    ? ownerRanked.every((row) => row.provider !== query.preferred_provider || !row.eligible || row.owner_authority_state === "DENY")
    : false;

  let search_class: SearchClass = "LOCAL_SEARCH";
  if (query.intent === "REMOTE_WEB_SEARCH" || query.resource_type === "WEB") search_class = "REMOTE_WEB_SEARCH";
  else if (query.intent === "REMOTE_SERVICE_SEARCH" || query.resource_type === "GITHUB") search_class = "REMOTE_SERVICE_SEARCH";
  else if (query.resource_type === "FILE" || query.resource_type === "CODE" || query.intent === "LOCAL_SEARCH" || query.intent === "AUTO") {
    search_class = "LOCAL_SEARCH";
  }

  const localFirst = decideLocalFirst("local.folder.search", Buffer.byteLength(query.query, "utf8"));
  const github = getRemoteServiceBinding("service://github/source-authority", query.ai_identity, query.session_id);

  if (search_class === "REMOTE_WEB_SEARCH") {
    return {
      search_class,
      available: google.WEB_SEARCH === "AVAILABLE",
      status: google.WEB_SEARCH,
      local_source_attached: false,
      local_source_sent: false,
      provider_preference_applied: false,
      owner_policy_first: true,
      routing_order: ["OWNER_POLICY", "DATA_CLASSIFICATION", "LOCAL_FIRST", "CAPABILITY_AVAILABILITY", "COST", "PROVIDER_PREFERENCE"],
      reason: google.reason,
    };
  }

  if (search_class === "REMOTE_SERVICE_SEARCH") {
    const adapter = github?.canonical_action_mapping.find((row) => row.action === "SEARCH");
    return {
      search_class,
      available: Boolean(adapter?.states.ADAPTER_PRESENT && github?.owner_authority_state === "ALLOW"),
      status: adapter?.states.ADAPTER_PRESENT ? (github?.owner_authority_state === "ALLOW" ? "OWNER_ENABLED" : "NOT_OWNER_ENABLED") : "ADAPTER_ABSENT",
      local_source_attached: false,
      local_source_sent: false,
      provider: "github",
      provider_preference_applied: false,
      owner_policy_first: true,
      routing_order: ["OWNER_POLICY", "DATA_CLASSIFICATION", "LOCAL_FIRST", "CAPABILITY_AVAILABILITY", "COST", "PROVIDER_PREFERENCE"],
    };
  }

  return {
    search_class: "LOCAL_SEARCH",
    available: true,
    status: "LOCAL_FIRST",
    locality: localFirst.locality,
    local_source_attached: false,
    local_source_sent: false,
    preferred_provider_ignored: Boolean(query.preferred_provider),
    owner_policy_overrides_provider_preference: ownerBlocksPreferred || Boolean(query.preferred_provider),
    provider_preference_applied: false,
    routing_order: ["OWNER_POLICY", "DATA_CLASSIFICATION", "LOCAL_FIRST", "CAPABILITY_AVAILABILITY", "COST", "PROVIDER_PREFERENCE"],
    query: query.query.slice(0, 200),
  };
}
