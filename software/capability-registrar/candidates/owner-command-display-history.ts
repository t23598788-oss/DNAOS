/**
 * หน้าที่: register the existing Owner Command display/history relationship as
 * a read-only knowledge node. It is data about an already-observed path, not a
 * router capability and not an execution surface.
 *
 * The detailed relationship and Owner readback answers live in
 * governance/system-knowledge/owner-command-display-history.knowledge.json.
 * Closed registry relationship vocabulary is intentionally not extended here;
 * the relationship is carried as the knowledge record, like the existing
 * accounting-system knowledge node.
 */
import type { RegistrationCandidate } from "../../../control/event-pipeline/registration-contract";

export const OWNER_COMMAND_DISPLAY_HISTORY_CANDIDATE: RegistrationCandidate = {
  candidate_id: "candidate-owner-command-display-history-v1",
  name: "OWNER_COMMAND_DISPLAY_HISTORY",
  kind: "capability",
  source_location: "governance/system-knowledge/owner-command-display-history.knowledge.json",
  owner: "DNA-OS-INFRASTRUCTURE/software/capability-registrar/candidates/owner-command-display-history.ts",
  input: ["Owner's read-only question about the #command display/history relationship"],
  output: ["registered relationship knowledge and a Thai read-only answer"],
  side_effects: ["none — knowledge/readback only; does not route, execute, write history, or dispatch an agent"],
  dependencies: [
    "resource:control/owner-command-semantics/data/semantic-history.jsonl",
    "resource:~/Developer/DNA-OS/source/dna-os-control-workspace/features/control-chat/chat.mjs",
    "resource:~/Developer/DNA-OS/source/dna-os-control-workspace/core-connection/core-client.mjs",
  ],
  behavior: "read_registered_owner_command_display_history_relationship_without_source_search_or_execution",
  version: "1.0.0",
  evidence_refs: [
    "governance/system-knowledge/owner-command-display-history.knowledge.json",
    "~/Developer/DNA-OS/source/dna-os-control-workspace/core-connection/core-client.mjs:117#getOwnerHistory",
    "~/Developer/DNA-OS/source/dna-os-control-workspace/features/control-chat/chat.mjs:140-159#history_projection_and_renderer",
    "control/command-router/router.ts:812-813#runAgentHostStep",
    "control/owner-command/owner-command.ts:422-428#recordOwnerVisibleResult",
    "control/owner-command-semantics/data/semantic-history.jsonl",
    "transport/owner-command-http/server.ts:1141-1158#GET_/owner/history",
    "transport/owner-command-http/server.ts:631-650#GET_/owner/language-events",
  ],
  domain: "SOFTWARE_CONTROL_PLANE",
  resource_type: "CAPABILITY",
  data_classification: "INTERNAL",
  source_system: "dna-os-infrastructure",
  scope: "owner-command/display-history-knowledge",
  origin: {
    origin_kind: "OWNER_DIRECTIVE",
    origin_reference: "TASK:REGISTER_OWNER_COMMAND_DISPLAY_HISTORY_KNOWLEDGE",
    introduced_by: "software/capability-registrar/register-owner-command-display-history.ts",
  },
};
