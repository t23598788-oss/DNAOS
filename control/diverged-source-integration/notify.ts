import { evaluateCanonicalEvent, makeCanonicalEvent } from "../owner-notification/contract";
import { nowIso } from "./host-runtime";

export function notifyDivergedIntegration(subject: string, extra?: { readonly severity?: "INFO" | "WARN"; readonly owner_attention?: boolean }): void {
  evaluateCanonicalEvent(makeCanonicalEvent({
    event_id: `event:diverged-source-integration:${nowIso()}:${subject.slice(0, 48)}`,
    event_type: extra?.owner_attention ? "OWNER_APPROVAL_REQUIRED" : "CONNECTION_CHANGED",
    entity_id: "entity:repository:github-canonical-main",
    work_id: null,
    command_id: null,
    source_system: "diverged-source-integration",
    previous_state: "DIVERGED",
    current_state: "INTEGRATING",
    severity: extra?.severity ?? "INFO",
    owner_attention: extra?.owner_attention ?? false,
    action_required: extra?.owner_attention ?? false,
    evidence_refs: ["diverged-source-integration"],
  }), { subject });
}
