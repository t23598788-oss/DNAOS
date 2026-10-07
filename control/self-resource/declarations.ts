/**
 * หน้าที่: declare, for each execution method this repository actually has,
 * WHICH files constitute proof of it and HOW MANY matching rows are required —
 * so that the method's state is measured rather than asserted (Owner,
 * 2026-09-02).
 *
 * WHAT IS DECLARED HERE AND WHAT IS NOT. A declaration names the boundary, the
 * authority, the credential mode, what can be observed, what can be verified,
 * which dimensions are recorded, and which evidence files would prove the
 * method works. It does NOT name the state. Nothing in this file can say
 * RUNTIME_PROVEN; only `deriveRuntimeState` can, and only by counting rows in
 * the paths below. If an evidence file is deleted or empties, every claim that
 * rested on it collapses at the next derivation.
 *
 * WHY EACH METHOD'S PROOF RULE IS WHAT IT IS. The rule for each method is the
 * narrowest thing that would distinguish "this works" from "this exists in
 * source". For LOCAL_PROCESS that is a real audited execution with an exit
 * code. For API_OUTBOUND_PROVIDER it is a connection declaration that reached
 * `PROVEN` — deliberately not "an adapter file exists", because adapters do
 * exist and no authenticated call has ever been recorded. That asymmetry is the
 * point: the rule is set by what would be convincing, not by what is available.
 *
 * MEASURED AND UNMEASURED DIMENSIONS ARE BOTH DECLARED. Listing
 * `TOKEN_USAGE` under unmeasured is a fact about this system, and keeping it
 * present in the record is what stops a later reader assuming zero.
 *
 * Input: none — this is data.
 * Output: SELF_RESOURCE_DECLARATIONS.
 * Dependency ที่อนุญาต: ./contract (types only).
 * สิ่งที่ห้ามแตะ: ห้ามเขียน runtime state ลงในไฟล์นี้, ห้ามอ้าง path หลักฐานที่ไม่มีอยู่จริง,
 * ห้ามลดจำนวนแถวที่ต้องการเพื่อให้ผ่าน.
 */
import type { SelfResourceDeclaration } from "./contract";

const OS_UI = "capability-0de653bb-c968-4168-85c6-9d67beef2b5a";

export const SELF_RESOURCE_DECLARATIONS: readonly SelfResourceDeclaration[] = Object.freeze([
  {
    method_id: "method-local-process",
    method_kind: "LOCAL_PROCESS",
    capability_id: null, capability_canonical_name: "execution-run",
    implementation_boundary: "execution/run/process-gate.ts",
    authority_requirement: "PROCESS_GATE_POLICY",
    credential_mode: "KEYCHAIN_REFERENCE",
    observation_support: true, observation_source: "audit/command-audit/execution-audit.jsonl",
    verification_support: true, verification_source: "execution-audit verification_result field",
    measured_dimensions: ["DURATION_MS", "EXIT_CODE"],
    unmeasured_dimensions: ["TOKEN_USAGE", "NETWORK_BYTES", "GPU_RUNTIME", "EXECUTION_MONETARY_COST", "CPU_TIME"],
    // A real audited execution that reached an exit code. Anything less is source.
    proof_rules: [{ path: "audit/command-audit/execution-audit.jsonl", kind: "JSONL", min_rows: 1, must_contain: '"exit_code"', timestamp_field: "started_at" }],
    state_when_satisfied: "RUNTIME_PROVEN", state_when_unsatisfied: "DECLARED",
    known_limitations: [],
  },
  {
    method_id: "method-file-write",
    method_kind: "FILE",
    capability_id: null, capability_canonical_name: "file-write-execution",
    implementation_boundary: "execution/file-write/executor.ts",
    authority_requirement: "WRITE_GATE_DECISION",
    credential_mode: "NOT_APPLICABLE",
    observation_support: true, observation_source: "execution/file-write/write-audit-log.json",
    verification_support: true, verification_source: "permissions/write-gate/rules.ts",
    measured_dimensions: ["BYTES_WRITTEN"],
    unmeasured_dimensions: ["TOKEN_USAGE", "NETWORK_BYTES", "GPU_RUNTIME", "EXECUTION_MONETARY_COST", "CPU_TIME"],
    // A write that COMPLETED — refusals are also logged here and must not count.
    proof_rules: [{ path: "execution/file-write/write-audit-log.json", kind: "JSON_ARRAY_FILE", min_rows: 1, must_contain: '"status":"completed"', timestamp_field: "recorded_at" }],
    state_when_satisfied: "RUNTIME_PROVEN", state_when_unsatisfied: "DECLARED",
    known_limitations: [],
  },
  {
    method_id: "method-computer-use",
    method_kind: "COMPUTER_USE",
    capability_id: OS_UI, capability_canonical_name: "os-ui",
    implementation_boundary: "control/computer-use-executor/executor.ts",
    authority_requirement: "COMPUTER_USE_LEASE",
    credential_mode: "NOT_APPLICABLE",
    observation_support: true, observation_source: "control/computer-use-executor/observation.ts",
    verification_support: true, verification_source: "control/computer-use-executor/effect-verdict.ts",
    measured_dimensions: ["DURATION_MS"],
    unmeasured_dimensions: ["TOKEN_USAGE", "NETWORK_BYTES", "GPU_RUNTIME", "EXECUTION_MONETARY_COST", "CPU_TIME"],
    // An authorised execution that actually ran. Note this proves the METHOD
    // dispatches, not that any particular effect occurred — the effect verdict
    // is a separate per-execution fact and is not consulted here.
    proof_rules: [{ path: "control/computer-use-executor/data/execution-evidence.jsonl", kind: "JSONL", min_rows: 1, must_contain: '"executed":true', timestamp_field: "completed_at" }],
    state_when_satisfied: "RUNTIME_PROVEN", state_when_unsatisfied: "DECLARED",
    known_limitations: [],
  },
  {
    method_id: "method-http-inbound-control",
    method_kind: "HTTP_INBOUND_CONTROL",
    capability_id: null, capability_canonical_name: "owner-command-http",
    implementation_boundary: "transport/owner-command-http/server.ts",
    authority_requirement: "NETWORK_AUTH_GATE_SECRET",
    credential_mode: "ENV_SHARED_SECRET",
    observation_support: true, observation_source: "control/runtime-control/data/operations.jsonl",
    verification_support: true, verification_source: "runtime-control health + duplicate-listener check",
    measured_dimensions: ["READINESS_WAIT_MS", "HTTP_STATUS"],
    unmeasured_dimensions: ["TOKEN_USAGE", "NETWORK_BYTES", "GPU_RUNTIME", "EXECUTION_MONETARY_COST", "CPU_TIME"],
    proof_rules: [{ path: "control/runtime-control/data/operations.jsonl", kind: "JSONL", min_rows: 1, must_contain: '"http_status":200', timestamp_field: "timestamp_completed" }],
    state_when_satisfied: "RUNTIME_PROVEN", state_when_unsatisfied: "DECLARED",
    known_limitations: [],
  },
  {
    method_id: "method-email-read",
    method_kind: "EMAIL_READ",
    capability_id: null, capability_canonical_name: "email-alert-source",
    implementation_boundary: "connections/email-alert-source/adapter.ts",
    authority_requirement: "CALLER_AUTHENTICATED",
    credential_mode: "KEYCHAIN_REFERENCE",
    observation_support: true, observation_source: "connections/expense-ingestion/data/expenses.jsonl",
    verification_support: false, verification_source: null,
    measured_dimensions: [],
    unmeasured_dimensions: ["TOKEN_USAGE", "NETWORK_BYTES", "GPU_RUNTIME", "EXECUTION_MONETARY_COST", "CPU_TIME"],
    proof_rules: [{ path: "connections/expense-ingestion/data/expenses.jsonl", kind: "JSONL", min_rows: 1, must_contain: '"source_message_id"', timestamp_field: "ingested_at" }],
    state_when_satisfied: "RUNTIME_PROVEN", state_when_unsatisfied: "DECLARED",
    // Reading is proven; sending has no implementation anywhere, and the read
    // itself goes through an upstream reader rather than a credential here.
    known_limitations: ["CANNOT_SEND_ONLY_READ", "DEPENDS_ON_UPSTREAM_READER"],
  },
  {
    method_id: "method-webhook-outbound",
    method_kind: "WEBHOOK_OUTBOUND",
    capability_id: null, capability_canonical_name: "n8n-workflow-control",
    implementation_boundary: "connections/n8n/outbound-webhook.ts",
    authority_requirement: "PROVIDER_CREDENTIAL",
    credential_mode: "KEYCHAIN_REFERENCE",
    observation_support: true, observation_source: "connections/n8n/evidence/",
    verification_support: true, verification_source: "round-trip contract match",
    measured_dimensions: ["ROUND_TRIP_MS", "HTTP_STATUS"],
    unmeasured_dimensions: ["TOKEN_USAGE", "NETWORK_BYTES", "GPU_RUNTIME", "EXECUTION_MONETARY_COST", "CPU_TIME"],
    proof_rules: [{ path: "connections/n8n/evidence/outbound-proof-1787777479804.json", kind: "FILE_EXISTS", min_rows: 1, must_contain: '"HTTP_STATUS":200' }],
    state_when_satisfied: "RUNTIME_PROVEN", state_when_unsatisfied: "DECLARED",
    // The historical proof is real AND a later probe disagreed. Drift outranks
    // the proof precisely so an old success cannot speak for a current channel.
    drift_rule: { path: "connections/n8n/evidence/configuration-drift-reconciliation-2026-09-01.json", kind: "FILE_EXISTS", min_rows: 1 },
    known_limitations: ["CURRENT_DECLARATION_DRIFTED"],
  },
  {
    method_id: "method-api-outbound-provider",
    method_kind: "API_OUTBOUND_PROVIDER",
    capability_id: null, capability_canonical_name: "connection-registry",
    implementation_boundary: "connections/{github,digitalocean,railway}/…-adapter.ts",
    authority_requirement: "PROVIDER_CREDENTIAL",
    credential_mode: "KEYCHAIN_REFERENCE",
    observation_support: true, observation_source: "control/agent-gateway/data/evidence.jsonl",
    verification_support: false, verification_source: null,
    measured_dimensions: [],
    unmeasured_dimensions: ["TOKEN_USAGE", "NETWORK_BYTES", "GPU_RUNTIME", "EXECUTION_MONETARY_COST", "CPU_TIME"],
    // Adapters exist and reachability probes returned statuses; what has never
    // been recorded is an AUTHENTICATED call. Only a declaration that reached
    // PROVEN would show that, so that is the rule.
    proof_rules: [{ path: "connections/connection-registry/data/connection-declarations.jsonl", kind: "JSONL", min_rows: 1, must_contain: '"PROVEN"', timestamp_field: "declared_at" }],
    state_when_satisfied: "RUNTIME_PROVEN", state_when_unsatisfied: "PARTIAL",
    known_limitations: ["AUTHENTICATED_EXECUTION_NOT_PROVEN", "REACHABILITY_PROBE_ONLY"],
  },
  {
    method_id: "method-connector",
    method_kind: "CONNECTOR",
    capability_id: null, capability_canonical_name: "connector-execution-boundary",
    implementation_boundary: "control/connector-execution-boundary/contract.ts",
    authority_requirement: "PROVIDER_CREDENTIAL",
    credential_mode: "KEYCHAIN_REFERENCE",
    observation_support: true, observation_source: "control/agent-gateway/data/evidence.jsonl",
    verification_support: false, verification_source: null,
    measured_dimensions: [],
    unmeasured_dimensions: ["TOKEN_USAGE", "NETWORK_BYTES", "GPU_RUNTIME", "EXECUTION_MONETARY_COST", "CPU_TIME"],
    // Two invokers are registered and routing reached the boundary; what is
    // missing is an outcome row showing a connector call that succeeded.
    proof_rules: [{ path: "control/agent-gateway/data/evidence.jsonl", kind: "JSONL", min_rows: 1, must_contain: '"connector_status":"SUCCEEDED"', timestamp_field: "recorded_at" }],
    state_when_satisfied: "RUNTIME_PROVEN", state_when_unsatisfied: "PARTIAL",
    known_limitations: ["SUCCESSFUL_EXECUTION_NOT_PROVEN"],
  },
  {
    method_id: "method-database",
    method_kind: "DATABASE",
    capability_id: null, capability_canonical_name: "registry-writer",
    implementation_boundary: "software/registry-database/adapters/postgres-store.ts",
    authority_requirement: "PROVIDER_CREDENTIAL",
    credential_mode: "KEYCHAIN_REFERENCE",
    observation_support: false, observation_source: null,
    verification_support: true, verification_source: "postgres-schema-contract.test.ts (SQL text only)",
    measured_dimensions: [],
    unmeasured_dimensions: ["TOKEN_USAGE", "NETWORK_BYTES", "GPU_RUNTIME", "EXECUTION_MONETARY_COST", "CPU_TIME"],
    // A live round trip would leave a row naming a real query result. The
    // canonical path currently uses the file store, so this rule is expected to
    // fail — which is the honest state, not a bug in the rule.
    proof_rules: [{ path: "software/live-census/data/verification-ledger.jsonl", kind: "JSONL", min_rows: 1, must_contain: "postgres live round trip", timestamp_field: "verified_at" }],
    state_when_satisfied: "RUNTIME_PROVEN", state_when_unsatisfied: "PARTIAL",
    known_limitations: ["LIVE_ROUND_TRIP_NOT_PROVEN"],
  },
  {
    method_id: "method-remote-service",
    method_kind: "REMOTE_SERVICE",
    capability_id: null, capability_canonical_name: "railway-connector",
    implementation_boundary: "connections/railway/router-invoker.ts",
    authority_requirement: "PROVIDER_CREDENTIAL",
    credential_mode: "KEYCHAIN_REFERENCE",
    observation_support: true, observation_source: "observability/joint-monitor/data/joints.jsonl",
    verification_support: true, verification_source: "software/live-census/data/verification-ledger.jsonl",
    measured_dimensions: ["HTTP_STATUS"],
    unmeasured_dimensions: ["TOKEN_USAGE", "NETWORK_BYTES", "GPU_RUNTIME", "EXECUTION_MONETARY_COST", "CPU_TIME"],
    // One deployed service was verified rendering. That proves a remote service
    // was reached and observed; it does not prove an authenticated provider API
    // call, which is why the limitation below stays attached.
    proof_rules: [{ path: "software/live-census/data/verification-ledger.jsonl", kind: "JSONL", min_rows: 1, must_contain: "railway.app", timestamp_field: "verified_at" }],
    state_when_satisfied: "OBSERVED", state_when_unsatisfied: "PARTIAL",
    known_limitations: ["AUTHENTICATED_EXECUTION_NOT_PROVEN"],
  },
  {
    method_id: "method-webhook-inbound",
    method_kind: "WEBHOOK_INBOUND",
    capability_id: null, capability_canonical_name: null,
    implementation_boundary: "NONE",
    authority_requirement: "NONE",
    credential_mode: "NOT_APPLICABLE",
    observation_support: false, observation_source: null,
    verification_support: false, verification_source: null,
    measured_dimensions: [],
    unmeasured_dimensions: ["TOKEN_USAGE", "NETWORK_BYTES", "GPU_RUNTIME", "EXECUTION_MONETARY_COST", "CPU_TIME"],
    // No rules, because there is nothing that could be measured. An empty rule
    // set is how NOT_IMPLEMENTED is reached; it is never asserted.
    proof_rules: [],
    state_when_satisfied: "NOT_IMPLEMENTED", state_when_unsatisfied: "NOT_IMPLEMENTED",
    known_limitations: ["NO_IMPLEMENTATION", "NO_INBOUND_RECEIVER"],
  },
  {
    method_id: "method-browser-dom",
    method_kind: "BROWSER_DOM",
    capability_id: null, capability_canonical_name: null,
    implementation_boundary: "NONE",
    authority_requirement: "NONE",
    credential_mode: "NOT_APPLICABLE",
    observation_support: false, observation_source: null,
    verification_support: false, verification_source: null,
    measured_dimensions: [],
    unmeasured_dimensions: ["TOKEN_USAGE", "NETWORK_BYTES", "GPU_RUNTIME", "EXECUTION_MONETARY_COST", "CPU_TIME"],
    proof_rules: [],
    state_when_satisfied: "NOT_IMPLEMENTED", state_when_unsatisfied: "NOT_IMPLEMENTED",
    known_limitations: ["NO_IMPLEMENTATION"],
  },
]) as readonly SelfResourceDeclaration[];
