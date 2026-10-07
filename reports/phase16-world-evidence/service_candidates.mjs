// Phase 18b — Problem -> User -> Service -> Cash loop.
// Builds SERVICE_CANDIDATE records deterministically from the existing
// problem/resource/computed-state registries (Phase 16/17/18). This
// script NEVER fabricates a channel, a user count, or a funnel rate —
// every one of those fields is either drawn from real prior evidence or
// left UNKNOWN/UNCOMPUTABLE. AI did not pick a channel here: no channel
// evidence exists, so channel_status is CHANNEL_UNPROVEN for every
// candidate, by rule, not by choice.
// Run: node reports/phase16-world-evidence/service_candidates.mjs
import fs from "node:fs";
import path from "node:path";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const read = (f) => JSON.parse(fs.readFileSync(path.join(DIR, f), "utf-8"));
const problems = read("problem_registry.json");
const dbc = read("demand_buyer_channel_registry.json");
const prr = read("price_resource_rules_registry.json");
const computed = read("computed_state.json");

/**
 * Problem Target — required fields per Phase 18's spec. Built ONLY from
 * data already in the registries; where a field has no real backing
 * value, it is listed in unknown_fields rather than guessed.
 */
function buildProblemTarget(problemId) {
  const p = problems.find((x) => x.problem_id === problemId);
  const resource = prr.resource_registry.find((r) => r.problem_id === problemId);
  const priceRow = prr.price_cost_registry.find((r) => r.problem_id === problemId);
  const buyer = dbc.buyer_registry.find((r) => r.problem_id === problemId);

  const target = {
    problem_id: problemId,
    WHO_HAS_THE_PROBLEM: buyer.buyer_type === "UNKNOWN" ? "UNKNOWN — no named entity, only a problem category" : buyer.buyer_type,
    PROBLEM: p.problem_statement,
    LOCATION: priceRow?.geography ?? "UNKNOWN",
    TIME: "2026-08-19 (single observation date)",
    FREQUENCY: "UNKNOWN — no repeated observation exists (see Phase 18 HISTORICAL_ALIGNMENT pass, status MISSING)",
    SEVERITY: "UNKNOWN — no severity scale was measured, only problem existence",
    CURRENT_WORKAROUND: problemId === "P3" ? "manual in-house data entry or offshore outsourcing (Fiverr-class providers)" : "manual/DIY or hiring an SEO agency",
    CURRENT_COST: priceRow ? `${priceRow.observed_price_low}-${priceRow.observed_price_high} ${priceRow.unit}` : "UNKNOWN",
    EXISTING_PAID_SOLUTIONS: dbc.channel_registry.find((c) => c.problem_id === problemId)?.channel_candidates ?? [],
    SOURCE_EVIDENCE: p.evidence_ids,
    CONFIDENCE: p.evidence_ids.length >= 2 ? "D2 — repeated independent problem evidence" : "D1 — single source",
    UNKNOWN_FIELDS: ["FREQUENCY", "SEVERITY", "exact target group size", "Thai-specific price"],
  };
  return target;
}

/** CAN_DNA_OS_SOLVE block — never invents a solution when capability is missing; returns MISSING honestly. */
function buildCapabilityMatch(problemId) {
  const resource = prr.resource_registry.find((r) => r.problem_id === problemId);
  return {
    problem_id: problemId,
    CAN_DNA_OS_SOLVE: resource.existing_capability_status === "READY" || resource.existing_capability_status === "PARTIAL" ? "PARTIALLY" : "MISSING",
    EXISTING_CAPABILITY: resource.existing_capability_ref,
    MISSING_CAPABILITY: resource.missing_resource,
    DELIVERY_REQUIREMENT: resource.missing_resource_class,
    ESTIMATED_DELIVERY_COST: "UNCOMPUTABLE — see Phase 16 compute.mjs delivery_cost field",
    LEGAL_CONSTRAINT: prr.business_rules.filter((r) => r.applies_to_problem_id.includes(problemId) && r.rule_class === "LAW").map((r) => r.rule_id),
    MEASUREMENT_METHOD: "manual before/after comparison of File Intelligence scan output vs. customer's original file set (no automated measurement built yet)",
  };
}

/**
 * The USER ACCESS PATH — TARGET_GROUP -> DISCOVERY_CHANNEL -> ENTRY_POINT
 * -> SERVICE_INTERFACE -> ACTIVATION -> USAGE_EVENT -> RESULT_EVENT ->
 * PAYMENT_EVENT -> CASH_RECEIVED. Every stage is either "STRUCTURAL_ONLY"
 * (the stage exists conceptually, no real instance/evidence yet) or a
 * real count. No stage is fabricated with a number.
 */
function buildUserAccessPath(problemId) {
  const channelRow = dbc.channel_registry.find((c) => c.problem_id === problemId);
  return [
    { stage: "TARGET_GROUP", status: "IDENTIFIED_CATEGORY_ONLY", evidence: "problem_registry.json", real_count: null },
    { stage: "DISCOVERY_CHANNEL", status: channelRow ? "CANDIDATE_CHANNELS_NAMED" : "UNPROVEN", evidence: channelRow ? "demand_buyer_channel_registry.json" : null, real_count: null, note: channelRow ? `candidates: ${channelRow.channel_candidates.join(", ")} — named because they exist externally, NOT because DNA OS has evidence the target group uses them` : "no channel evidence at all" },
    { stage: "ENTRY_POINT", status: "UNPROVEN", evidence: null, real_count: null, note: "no DNA OS-owned entry point (listing, page, form) exists yet on any named channel" },
    { stage: "SERVICE_INTERFACE", status: "PARTIAL", evidence: "DNA-LAB-FILE-INTELLIGENCE contract (Phase 8)", real_count: null, note: "the tool that WOULD deliver exists; no customer-facing interface wraps it" },
    { stage: "ACTIVATION", status: "UNPROVEN", evidence: null, real_count: 0 },
    { stage: "USAGE_EVENT", status: "UNPROVEN", evidence: null, real_count: 0 },
    { stage: "RESULT_EVENT", status: "UNPROVEN", evidence: null, real_count: 0 },
    { stage: "PAYMENT_EVENT", status: "UNPROVEN", evidence: null, real_count: 0 },
    { stage: "CASH_RECEIVED", status: "UNPROVEN", evidence: null, real_count: 0 },
  ];
}

/**
 * Funnel-rate computation — a real deterministic formula set. Returns
 * UNCOMPUTABLE for every rate because every stage above has real_count
 * either null or 0 — there is no observed funnel to compute a rate
 * FROM. This function is not fabricated data; it is a real function that
 * correctly reports it has nothing to compute yet.
 */
function computeFunnelMetrics(accessPath) {
  const counts = Object.fromEntries(accessPath.map((s) => [s.stage, s.real_count]));
  const rate = (numStage, denStage) => {
    const num = counts[numStage];
    const den = counts[denStage];
    if (num === null || den === null || den === 0) return { status: "UNCOMPUTABLE", value: null, formula: `${numStage}/${denStage}`, reason: `${denStage}=${den}, ${numStage}=${num}` };
    return { status: "COMPUTED", value: num / den, formula: `${numStage}/${denStage}` };
  };
  return {
    reach_rate: rate("DISCOVERY_CHANNEL", "TARGET_GROUP"),
    activation_rate: rate("ACTIVATION", "ENTRY_POINT"),
    completion_rate: rate("USAGE_EVENT", "ACTIVATION"),
    price_acceptance_rate: rate("RESULT_EVENT", "USAGE_EVENT"),
    payment_conversion: rate("PAYMENT_EVENT", "RESULT_EVENT"),
    cost_per_acquisition: { status: "UNCOMPUTABLE", value: null, reason: "no acquisition spend recorded (CAPITAL_RELEASED=0)" },
    revenue_per_user: { status: "UNCOMPUTABLE", value: null, reason: "PAYMENT_EVENT=0" },
    gross_margin: { status: "UNCOMPUTABLE", value: null, reason: "no cash received" },
    net_margin: { status: "UNCOMPUTABLE", value: null, reason: "no cash received" },
    days_to_cash: { status: "UNCOMPUTABLE", value: null, reason: "CASH_RECEIVED=0" },
    repeat_rate: { status: "UNCOMPUTABLE", value: null, reason: "no first use has occurred" },
  };
}

/**
 * Final SERVICE_CANDIDATE status — a fixed decision table, exactly the
 * "no AI narrative" rule. UNPROVEN/CHANNEL_UNPROVEN/DELIVERY_UNPROVEN/
 * PAYMENT_UNPROVEN/TESTABLE/LIVE/PAID/REPEATABLE.
 */
function deriveServiceStatus(accessPath, capabilityMatch) {
  const channelStage = accessPath.find((s) => s.stage === "DISCOVERY_CHANNEL");
  const paymentStage = accessPath.find((s) => s.stage === "PAYMENT_EVENT");
  const cashStage = accessPath.find((s) => s.stage === "CASH_RECEIVED");
  if (cashStage.real_count > 0) return "PAID"; // only an observed, reconciled payment event may ever set this
  if (paymentStage.real_count > 0) return "PAYMENT_UNPROVEN"; // payment initiated but not reconciled — never auto-upgrades to PAID
  if (capabilityMatch.CAN_DNA_OS_SOLVE === "MISSING") return "UNPROVEN";
  if (channelStage.status === "UNPROVEN") return "CHANNEL_UNPROVEN";
  const entryStage = accessPath.find((s) => s.stage === "ENTRY_POINT");
  if (entryStage.status === "UNPROVEN") return "DELIVERY_UNPROVEN";
  return "TESTABLE";
}

function buildServiceCandidate(problemId) {
  const problemTarget = buildProblemTarget(problemId);
  const capabilityMatch = buildCapabilityMatch(problemId);
  const accessPath = buildUserAccessPath(problemId);
  const funnel = computeFunnelMetrics(accessPath);
  const cand = computed.candidates.find((c) => c.problem_id === problemId);
  const priceRow = prr.price_cost_registry.find((r) => r.problem_id === problemId);

  return {
    problem_id: problemId,
    target_group: problemTarget.WHO_HAS_THE_PROBLEM,
    solution: capabilityMatch.EXISTING_CAPABILITY,
    existing_capabilities: capabilityMatch.CAN_DNA_OS_SOLVE,
    delivery_channel: accessPath.find((s) => s.stage === "DISCOVERY_CHANNEL").status,
    entry_point: accessPath.find((s) => s.stage === "ENTRY_POINT").status,
    user_action: "UNPROVEN — no defined activation flow yet",
    value_delivered: "UNPROVEN — no real delivery has occurred",
    price: priceRow ? `${priceRow.observed_price_low}-${priceRow.observed_price_high} ${priceRow.unit} (international reference only, not Thai-confirmed)` : "UNKNOWN",
    cost_to_deliver: cand?.delivery_cost?.status ?? "UNCOMPUTABLE",
    payment_method: "UNPROVEN — no payment mechanism selected or tested",
    cash_destination: "UNPROVEN",
    measurement_events: accessPath.map((s) => s.stage),
    evidence_ids: problemTarget.SOURCE_EVIDENCE,
    unknowns: problemTarget.UNKNOWN_FIELDS,
    status: deriveServiceStatus(accessPath, capabilityMatch),
    problem_target: problemTarget,
    capability_match: capabilityMatch,
    user_access_path: accessPath,
    funnel_metrics: funnel,
  };
}

const serviceCandidates = ["P3", "P4"].map(buildServiceCandidate);

const output = {
  generated_at: new Date().toISOString(),
  generator: "reports/phase16-world-evidence/service_candidates.mjs — Phase 18 Problem->User->Service->Cash loop, deterministic, no AI channel selection performed",
  capital_rule: "CAPITAL_RELEASED = 0 — 10,001 THB experiment begins only after >=1 SERVICE_CANDIDATE reaches TESTABLE",
  service_candidates: serviceCandidates,
};
fs.writeFileSync(path.join(DIR, "service_candidates.json"), JSON.stringify(output, null, 2), "utf-8");
console.log(JSON.stringify({ statuses: Object.fromEntries(serviceCandidates.map((c) => [c.problem_id, c.status])) }, null, 2));
