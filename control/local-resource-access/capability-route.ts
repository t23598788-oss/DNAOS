/**
 * Deterministic capability routing. Authority before cost/provider preference.
 * LOCAL_FIRST when a local equivalent is eligible. Routing never executes.
 */

import { capabilityInvocable } from "./capability-states";
import { emitLocalResourceEvent } from "./events";
import { evaluateOwnerCapabilityBinding } from "./owner-capability-policy";
import { listRemoteServiceBindings } from "./remote-service-binding";
import type { BindableActionId, CostClass, ExecutionLocality, NetworkEgressPolicy } from "./types";

export interface CapabilityRouteQuery {
  readonly action: BindableActionId;
  readonly resource_type?: string;
  readonly required_locality?: "LOCAL" | "REMOTE" | "ANY";
  readonly network_egress?: NetworkEgressPolicy;
  readonly cost_class?: CostClass;
  readonly ai_identity: string;
  readonly session_id: string;
  readonly work_id?: string;
}

export interface RankedCapabilityBinding {
  readonly binding_id: string;
  readonly locality: ExecutionLocality;
  readonly provider: string;
  readonly action: BindableActionId;
  readonly eligible: boolean;
  readonly score: number;
  readonly reasons: readonly string[];
  readonly cost_class: CostClass;
  readonly owner_authority_state: "ALLOW" | "DENY" | "OWNER_APPROVAL_REQUIRED";
}

function localFilesystemBinding(action: BindableActionId, query: CapabilityRouteQuery): RankedCapabilityBinding | null {
  const supported: BindableActionId[] = ["SEARCH", "READ", "CREATE", "WRITE", "COPY", "MOVE", "RENAME", "DELETE", "SUMMARIZE", "EXTRACT", "CONVERT"];
  if (!supported.includes(action)) return null;
  const auth = evaluateOwnerCapabilityBinding({
    ai_identity: query.ai_identity,
    session_id: query.session_id,
    binding_id: "resource://local/files/fixture-corpus",
    action,
    remote: false,
  });
  const states = {
    DECLARED: true,
    ADAPTER_PRESENT: true,
    AUTHENTICATION_READY: true,
    RUNTIME_VERIFIED: ["SEARCH", "READ", "COPY", "SUMMARIZE", "EXTRACT"].includes(action),
    OWNER_ENABLED: auth.owner_enabled || auth.reason_code === "NO_BINDING_POLICY",
  };
  const eligible = capabilityInvocable({ ...states, OWNER_ENABLED: states.OWNER_ENABLED }) && auth.decision !== "DENY";
  // Without a binding policy, local filesystem stays grant-gated at invoke time; routing still
  // treats proven local adapters as eligible for LOCAL_FIRST comparison.
  const routingEligible = auth.reason_code === "NO_BINDING_POLICY"
    ? states.DECLARED && states.ADAPTER_PRESENT && states.RUNTIME_VERIFIED
    : eligible;
  const reasons = [
    `authority:${auth.reason_code}`,
    "locality:LOCAL",
    "cost:TRIVIAL",
    routingEligible ? "eligible:true" : "eligible:false",
  ];
  return {
    binding_id: "resource://local/files/fixture-corpus",
    locality: "LOCAL",
    provider: "macos-filesystem",
    action,
    eligible: routingEligible,
    score: 0,
    reasons,
    cost_class: "TRIVIAL",
    owner_authority_state: auth.decision,
  };
}

function texteditBinding(action: BindableActionId, query: CapabilityRouteQuery): RankedCapabilityBinding | null {
  if (action !== "READ") return null;
  const auth = evaluateOwnerCapabilityBinding({
    ai_identity: query.ai_identity,
    session_id: query.session_id,
    binding_id: "app://macos/textedit",
    action,
    remote: false,
  });
  const ownerOn = auth.owner_enabled || auth.reason_code === "NO_BINDING_POLICY";
  const routingEligible = ownerOn && auth.decision !== "DENY";
  return {
    binding_id: "app://macos/textedit",
    locality: "LOCAL",
    provider: "macos-application",
    action,
    eligible: routingEligible,
    score: 0,
    reasons: [`authority:${auth.reason_code}`, "locality:LOCAL", "cost:TRIVIAL"],
    cost_class: "TRIVIAL",
    owner_authority_state: auth.decision,
  };
}

export function resolveCapabilityBindings(query: CapabilityRouteQuery): readonly RankedCapabilityBinding[] {
  const candidates: RankedCapabilityBinding[] = [];
  const localFs = localFilesystemBinding(query.action, query);
  if (localFs) candidates.push(localFs);
  const textedit = texteditBinding(query.action, query);
  if (textedit) candidates.push(textedit);

  for (const service of listRemoteServiceBindings(query.ai_identity, query.session_id)) {
    const mapped = service.canonical_action_mapping.find((row) => row.action === query.action || row.canonical === query.action);
    if (!mapped) continue;
    const auth = evaluateOwnerCapabilityBinding({
      ai_identity: query.ai_identity,
      session_id: query.session_id,
      binding_id: service.service_id,
      action: query.action,
      remote: true,
    });
    const invocable = capabilityInvocable({ ...mapped.states, OWNER_ENABLED: auth.owner_enabled });
    const eligible = invocable && auth.decision === "ALLOW";
    candidates.push({
      binding_id: service.service_id,
      locality: "EXTERNAL_AI",
      provider: service.provider,
      action: query.action,
      eligible,
      score: 0,
      reasons: [
        `authority:${auth.reason_code}`,
        `availability:${service.availability}`,
        "locality:REMOTE",
        "cost:OWNER_REVIEW",
        eligible ? "eligible:true" : "eligible:false",
        "provider_preference:ignored",
      ],
      cost_class: "TRIVIAL",
      owner_authority_state: auth.decision,
    });
  }

  const localityFiltered = candidates.filter((row) => {
    if (query.required_locality === "LOCAL") return row.locality === "LOCAL";
    if (query.required_locality === "REMOTE") return row.locality !== "LOCAL";
    return true;
  });

  const ranked = [...localityFiltered].sort((a, b) => {
    if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
    const aLocal = a.locality === "LOCAL" ? 0 : 1;
    const bLocal = b.locality === "LOCAL" ? 0 : 1;
    if (aLocal !== bLocal) return aLocal - bLocal;
    const costRank = (c: CostClass) => (c === "TRIVIAL" ? 0 : c === "LOCAL_CPU" ? 1 : 2);
    if (costRank(a.cost_class) !== costRank(b.cost_class)) return costRank(a.cost_class) - costRank(b.cost_class);
    return a.binding_id.localeCompare(b.binding_id);
  }).map((row, index) => ({ ...row, score: index + 1 }));

  emitLocalResourceEvent("CAPABILITY_ROUTE_RESOLVED", query.work_id ?? null, query.action, undefined, {
    session_id: query.session_id, locality: "LOCAL", action: query.action,
  });
  return ranked;
}
