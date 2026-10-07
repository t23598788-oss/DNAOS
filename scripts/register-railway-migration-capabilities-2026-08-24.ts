/**
 * หน้าที่: one-off registration of the real capabilities built/hardened
 * during the 2026-08-24 GitHub/Railway migration round — through the
 * real, unmodified `control/registration-pipeline/` -> Persistent
 * Software Registry, same pattern as
 * scripts/register-new-capabilities-2026-08-22.ts. Owner's registration
 * completeness check (item 14/B of the migration directive): "ทุก
 * capability/module/service ที่ REGISTERED แล้ว ต้องผ่าน Candidate ->
 * Duplicate Gate -> Registry Writer" — these three were real, VERIFIED
 * (per software/live-census), and UNREGISTERED before this script.
 *
 * How to run: npx tsx scripts/register-railway-migration-capabilities-2026-08-24.ts
 */

import { randomUUID } from "node:crypto";
import { runRegistrationPipeline } from "../control/registration-pipeline/contract";
import type { RegistrationCandidate } from "../control/event-pipeline/contract";
import { createPersistentFileStore } from "../software/registry-database/adapters/persistent-file-store";

const store = createPersistentFileStore();

const candidates: RegistrationCandidate[] = [
  {
    candidate_id: `candidate-${randomUUID()}`,
    name: "owner-command-http",
    kind: "capability",
    source_location: "transport/owner-command-http/server.ts",
    owner: "dna-os-infrastructure",
    input: ["POST /command body (commandText, optional WorkOrder, ownerIdentity)", "Authorization: Bearer <shared secret>"],
    output: ["SubmitOwnerCommandOutcome", "OwnerCommandLifecycle"],
    side_effects: ["binds a real HTTP server", "dispatches into control/owner-command -> control/agent-gateway", "writes registry/evidence records"],
    dependencies: ["control/owner-command/contract.ts", "control/agent-gateway/contract.ts", "permissions/network-auth-gate/contract.ts", "software/registry-database/adapters/persistent-file-store.ts"],
    behavior: "Real HTTP transport for the Owner Command pipeline (POST /command, /handoff, /registry/*, GET /health, /runtime/inventory, /task/:id). 2026-08-24: gated by permissions/network-auth-gate's fail-closed shared-secret enforcement on every non-GET route; deployed to Railway as a network service.",
    version: "1",
    evidence_refs: ["transport/owner-command-http/tests/wiring.test.ts", "transport/owner-command-http/tests/auth-gate.test.ts"],
    domain: "SOFTWARE_CONTROL_PLANE",
    resource_type: "CAPABILITY",
    data_classification: "internal",
    source_system: "dna-os-infrastructure",
    scope: "owner-command-network-transport",
  },
  {
    candidate_id: `candidate-${randomUUID()}`,
    name: "dna-os-circuit-runtime",
    kind: "capability",
    source_location: "dna-os-circuit/runtime/server.ts",
    owner: "dna-os-infrastructure",
    input: ["CircuitState", "HTTP requests (GET circuit UI/SSE/JSON, POST findings/evaluate/decide/gateway/resolve-problem)"],
    output: ["circuit-board UI", "SSE CircuitState stream", "findings/evaluation/decision JSON", "agent-gateway dispatch results"],
    side_effects: ["binds a real HTTP server", "dispatches into control/agent-gateway on /gateway/dna_submit_task", "runs a real Process Gate execution on /resolve-problem"],
    dependencies: ["control/agent-gateway/contract.ts", "permissions/network-auth-gate/contract.ts", "dna-os-circuit/definition/semantic-model.ts", "execution/run/contract.ts"],
    behavior: "Real HTTP+SSE server for the DNA OS Circuit Board UI and its evidence/evaluation/decision engines. 2026-08-24: gated by permissions/network-auth-gate on every non-GET route, explicit env-driven bind host (was implicit 0.0.0.0), PORT read before CIRCUIT_PORT; deployed to Railway.",
    version: "1",
    evidence_refs: ["dna-os-circuit/runtime/tests/server.test.ts", "dna-os-circuit/definition/tests/semantic-model.test.ts", "dna-os-circuit/definition/tests/sbgn-view-builder.test.ts"],
    domain: "SOFTWARE_CONTROL_PLANE",
    resource_type: "CAPABILITY",
    data_classification: "internal",
    source_system: "dna-os-infrastructure",
    scope: "circuit-board-ui-and-evidence-engine",
  },
  {
    candidate_id: `candidate-${randomUUID()}`,
    name: "network-auth-gate",
    kind: "capability",
    source_location: "permissions/network-auth-gate/contract.ts",
    owner: "dna-os-infrastructure",
    input: ["Authorization header value", "expected shared secret", "bind host"],
    output: ["boolean shared-secret verification result", "BindPolicyDecision (fail-closed bind-vs-secret decision)"],
    side_effects: [],
    dependencies: ["node:crypto"],
    behavior: "Shared-secret network auth gate for transport-layer HTTP servers built assuming loopback-only reachability (transport/owner-command-http, dna-os-circuit/runtime, observability/joint-monitor). Timing-safe compare; fail-closed bind policy (a non-loopback bind with no secret configured refuses to start rather than listening unauthenticated). Built 2026-08-24 during the Railway migration after two independent reviews found none of the four Railway-eligible services had any request authentication of their own.",
    version: "1",
    evidence_refs: ["permissions/network-auth-gate/tests/policy.test.ts"],
    domain: "SOFTWARE_CONTROL_PLANE",
    resource_type: "CAPABILITY",
    data_classification: "internal",
    source_system: "dna-os-infrastructure",
    scope: "network-request-authentication",
  },
];

for (const candidate of candidates) {
  const result = runRegistrationPipeline(candidate, store, `capability-registration-${candidate.name}`);
  console.log(JSON.stringify({ name: candidate.name, result }));
}
