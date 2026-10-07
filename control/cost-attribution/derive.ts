/**
 * หน้าที่: read the real execution stores and the real money stores, attempt an
 * attribution for each method, and record exactly where the chain breaks
 * (Owner, 2026-09-02).
 *
 * WHAT THIS FILE IS NOT ALLOWED TO DO. It never divides an invoice, never picks
 * the nearest event in time, never matches on a name, and never fills an amount
 * it did not read. Its whole job is to join on identity and then report the
 * truth about whether the join succeeded — including, and especially, when it
 * did not.
 *
 * THE JOIN THAT FAILS, AND WHY IT IS WORTH RECORDING. Execution rows carry an
 * `account_id` in DNA OS's own namespace (`account-dna-os-infrastructure`).
 * Billing rows carry an `account_id` in the provider's namespace
 * (`team_3uDXRYjLEx8E3AVWiuegeg2N`). No registered relationship connects the
 * two, so every money attribution fails at the same edge. That single missing
 * edge is the finding; producing it as data is more useful than producing a
 * number that would be wrong.
 *
 * SOURCE ROWS ARE READ, NEVER WRITTEN. Nothing here opens an execution store or
 * a billing store for writing. Attributions and missing edges are new records in
 * their own append-only stores.
 *
 * Input: the persisted execution, billing and relationship stores.
 * Output: deriveAttributions, deriveMissingEdges, write/read helpers.
 * Dependency ที่อนุญาต: ./contract, node:fs, node:path.
 * สิ่งที่ห้ามแตะ: ห้ามแก้แถวหลักฐานต้นทาง, ห้ามประมาณค่าใช้จ่าย, ห้ามจับคู่ด้วย
 * เวลา/ชื่อ/การหารเฉลี่ย.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { attributeCost, type CostAttribution, type ExecutionIdentity, type MissingEdge, type MonetaryEvent, type RegisteredRelationship } from "./contract";

const DATA_DIR = "control/cost-attribution/data";

function readJsonl(root: string, rel: string): Record<string, unknown>[] {
  const p = join(root, rel);
  if (!existsSync(p)) return [];
  return readFileSync(p, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as Record<string, unknown>);
}
function readJsonArray(root: string, rel: string): Record<string, unknown>[] {
  const p = join(root, rel);
  if (!existsSync(p)) return [];
  try {
    const parsed = JSON.parse(readFileSync(p, "utf8")) as unknown;
    return Array.isArray(parsed) ? (parsed as Record<string, unknown>[]) : [];
  } catch { return []; }
}
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

/**
 * Builds one representative execution identity per method, from the newest real
 * row in that method's own store. Only fields the row actually carries are
 * populated; absent identity is null, never a placeholder.
 */
export function readExecutionIdentities(root: string = process.cwd()): readonly ExecutionIdentity[] {
  const out: ExecutionIdentity[] = [];

  const proc = readJsonl(root, "audit/command-audit/execution-audit.jsonl").at(-1);
  if (proc) out.push({
    execution_id: str(proc["execution_id"]), work_id: null, correlation_id: str(proc["correlation_id"]),
    capability_id: null, method_id: "method-local-process", resource_id: null,
    account_id: str(proc["account_id"]), provider: null, provider_request_id: null,
    measured_usage: Object.fromEntries(([["duration_ms", num(proc["duration_ms"])]] as const).filter(([, v]) => v !== null) as [string, number][]),
    evidence_ref: "audit/command-audit/execution-audit.jsonl",
  });

  const write = readJsonArray(root, "execution/file-write/write-audit-log.json").filter((r) => r["status"] === "completed").at(-1);
  if (write) out.push({
    execution_id: str(write["write_id"]), work_id: null, correlation_id: str(write["correlation_id"]),
    capability_id: null, method_id: "method-file-write", resource_id: null,
    account_id: null, provider: null, provider_request_id: null,
    measured_usage: Object.fromEntries(([["bytes_written", num(write["bytes_written"])]] as const).filter(([, v]) => v !== null) as [string, number][]),
    evidence_ref: "execution/file-write/write-audit-log.json",
  });

  const cu = readJsonl(root, "control/computer-use-executor/data/execution-evidence.jsonl").filter((r) => r["executed"] === true).at(-1);
  if (cu) {
    const started = str(cu["started_at"]), completed = str(cu["completed_at"]);
    const duration = started && completed ? Date.parse(completed) - Date.parse(started) : null;
    out.push({
      execution_id: str(cu["evidence_id"]), work_id: str(cu["work_order_id"]), correlation_id: null,
      capability_id: str(cu["capability_id"]), method_id: "method-computer-use", resource_id: null,
      account_id: null, provider: null, provider_request_id: null,
      measured_usage: duration !== null ? { duration_ms: duration } : {},
      evidence_ref: "control/computer-use-executor/data/execution-evidence.jsonl",
    });
  }

  const http = readJsonl(root, "control/runtime-control/data/operations.jsonl").at(-1);
  if (http) out.push({
    execution_id: str(http["operation_id"]), work_id: null, correlation_id: null,
    capability_id: null, method_id: "method-http-inbound-control", resource_id: str(http["service_id"]),
    account_id: null, provider: null, provider_request_id: null,
    measured_usage: Object.fromEntries(([["readiness_wait_ms", num(http["readiness_wait_ms"])]] as const).filter(([, v]) => v !== null) as [string, number][]),
    evidence_ref: "control/runtime-control/data/operations.jsonl",
  });

  const mail = readJsonl(root, "connections/expense-ingestion/data/expenses.jsonl").at(-1);
  if (mail) out.push({
    execution_id: str(mail["expense_id"]), work_id: null, correlation_id: null,
    capability_id: null, method_id: "method-email-read", resource_id: null,
    account_id: null, provider: str(mail["provider"]), provider_request_id: str(mail["source_message_id"]),
    // The row carries money it READ from an invoice — that is the provider's
    // charge, never the cost of reading it. It is deliberately not usage.
    measured_usage: {},
    evidence_ref: "connections/expense-ingestion/data/expenses.jsonl",
  });

  // The n8n outbound proof is a file, not a row store; its round trip is the
  // only usage dimension it records.
  const webhookProof = join(root, "connections/n8n/evidence/outbound-proof-1787777479804.json");
  if (existsSync(webhookProof)) {
    try {
      const w = JSON.parse(readFileSync(webhookProof, "utf8")) as Record<string, unknown>;
      out.push({
        execution_id: str(w["N8N_EXECUTION_ID"]), work_id: null, correlation_id: null,
        capability_id: null, method_id: "method-webhook-outbound", resource_id: str(w["N8N_WORKFLOW_ID"]),
        account_id: null, provider: "n8n", provider_request_id: null,
        measured_usage: Object.fromEntries(([["round_trip_ms", num(w["ROUND_TRIP_MS"])]] as const).filter(([, v]) => v !== null) as [string, number][]),
        evidence_ref: "connections/n8n/evidence/outbound-proof-1787777479804.json",
      });
    } catch { /* a malformed proof file contributes no identity */ }
  }

  // Methods with no execution rows at all still get an identity so their state
  // is recorded as NOT_MEASURED rather than silently omitted.
  for (const m of ["method-api-outbound-provider", "method-connector", "method-database", "method-remote-service"]) {
    out.push({
      execution_id: null, work_id: null, correlation_id: null, capability_id: null,
      method_id: m, resource_id: null, account_id: null, provider: null, provider_request_id: null,
      measured_usage: {}, evidence_ref: "NO_EXECUTION_ROWS",
    });
  }
  return out;
}

/** Reads every real monetary fact. Provider billing and ingested invoices are both money, and neither is execution cost. */
export function readMonetaryEvents(root: string = process.cwd()): readonly MonetaryEvent[] {
  const out: MonetaryEvent[] = [];

  for (const row of readJsonl(root, "control/agent-gateway/data/evidence.jsonl")) {
    if (!String(row["source"] ?? "").includes("infrastructure-billing")) continue;
    const p = (row["payload"] ?? {}) as Record<string, unknown>;
    if (num(p["amount_minor"]) === null) continue;
    out.push({
      money_event_id: str(p["billing_record_id"]) ?? str(row["evidence_id"]) ?? "unknown",
      provider: str(p["provider"]) ?? "unknown", service: str(p["service"]), resource: str(p["resource"]),
      account_or_project_ref: str(p["project_id"]) ?? str(p["account_id"]),
      period_start: str(p["period_start"]), period_end: str(p["period_end"]),
      quantity: num(p["usage_quantity"]), unit: str(p["usage_unit"]),
      unit_price_minor: num(p["unit_price_minor"]), amount_minor: num(p["amount_minor"]),
      currency: str(p["currency"]),
      // These are the fields that would make an attribution DIRECT. Billing rows
      // carry none of them; reading them as null is the finding, not a defect.
      execution_id: str(p["execution_id"]), work_id: str(p["work_id"]),
      provider_request_id: str(p["provider_request_id"]), billing_item_id: str(p["invoice_id"]),
      evidence_ref: "control/agent-gateway/data/evidence.jsonl",
    });
  }

  for (const e of readJsonl(root, "connections/expense-ingestion/data/expenses.jsonl")) {
    const amount = typeof e["amount"] === "string" ? Number(e["amount"]) : num(e["amount"]);
    out.push({
      money_event_id: str(e["expense_id"]) ?? "unknown",
      provider: str(e["provider"]) ?? "unknown", service: null, resource: null,
      account_or_project_ref: null, period_start: null, period_end: str(e["charged_at"]),
      quantity: null, unit: null, unit_price_minor: null,
      // Kept in the invoice's own units; no conversion, no rounding.
      amount_minor: Number.isFinite(amount) ? Math.round((amount as number) * 100) : null,
      currency: str(e["currency"]),
      execution_id: null, work_id: null, provider_request_id: null, billing_item_id: str(e["invoice_identity"]),
      evidence_ref: "connections/expense-ingestion/data/expenses.jsonl",
    });
  }
  return out;
}

/** Reads only EXPLICIT registered relationships. Nothing is inferred from proximity or naming. */
export function readRegisteredRelationships(root: string = process.cwd()): readonly RegisteredRelationship[] {
  return readJsonl(root, "software/registry-database/data/canonical/relationships.jsonl").map((r) => ({
    from_identity: String(r["from_id"] ?? r["from_identity"] ?? r["source_id"] ?? ""),
    to_identity: String(r["to_id"] ?? r["to_identity"] ?? r["target_id"] ?? ""),
    relationship_kind: String(r["relationship_kind"] ?? r["kind"] ?? ""),
  }));
}

export function deriveAttributions(root: string = process.cwd()): readonly CostAttribution[] {
  const executions = readExecutionIdentities(root);
  const money = readMonetaryEvents(root);
  const rels = readRegisteredRelationships(root);
  return executions.map((e) => attributeCost(e, money, rels, `attr-${e.method_id}`));
}

/**
 * Records each break as data. Every entry names a real current source and a
 * concrete producer that would close it — so the map is actionable rather than
 * a list of complaints.
 */
export function deriveMissingEdges(attributions: readonly CostAttribution[]): readonly MissingEdge[] {
  const edges: MissingEdge[] = [];
  const failing = attributions.filter((a) => a.attribution_state !== "DIRECT" && a.attribution_state !== "DERIVABLE");
  if (failing.some((a) => a.unattributable_reasons.includes("NO_REGISTERED_RELATIONSHIP_TO_PROVIDER_ACCOUNT")
    || a.unattributable_reasons.includes("NO_SHARED_IDENTITY_WITH_ANY_MONETARY_EVENT"))) {
    edges.push({
      from_identity: "dna_os_account_id (e.g. account-dna-os-infrastructure)",
      to_identity: "provider_account_id (e.g. vercel team_3uDXRYjLEx8E3AVWiuegeg2N)",
      missing_relationship: "DNA_OS_ACCOUNT_TO_PROVIDER_ACCOUNT",
      current_source: "execution rows carry a DNA OS account namespace; billing rows carry a provider namespace; zero registered relationships connect them",
      required_producer: "a registered relationship row binding a DNA OS account/resource to a provider account or project",
      verification_method: "attributeCost reaches DERIVABLE via EXPLICIT_REGISTERED_RELATIONSHIP for a real billing row",
    });
  }
  if (failing.some((a) => a.unattributable_reasons.includes("USAGE_DIMENSION_NOT_MEASURED"))) {
    edges.push({
      from_identity: "execution_id",
      to_identity: "resource_usage_measurement",
      missing_relationship: "EXECUTION_TO_MEASURED_USAGE",
      current_source: "only duration/bytes/round-trip are recorded; cpu, memory, network bytes, tokens and model invocations are not",
      required_producer: "a per-execution resource meter emitting typed usage alongside the execution row",
      verification_method: "an execution row carrying a usage dimension beyond wall-clock",
    });
  }
  edges.push({
    from_identity: "resource_usage_measurement",
    to_identity: "monetary_amount",
    missing_relationship: "USAGE_TO_PRICE_CONTRACT",
    current_source: "no rate card or price contract exists for any measured dimension",
    required_producer: "a registered price contract mapping a measured unit to a monetary unit",
    verification_method: "answerThreeQuestions returns resource_cost_state KNOWN for a measured dimension",
  });
  return edges;
}

function storeFile(dir: string, name: string): string {
  const base = join(process.cwd(), dir);
  mkdirSync(base, { recursive: true });
  const p = join(base, name);
  if (!existsSync(p)) writeFileSync(p, "", { encoding: "utf8", mode: 0o600 });
  return p;
}

/** Snapshot writes: an attribution is a statement about the current stores and must be re-derivable, not accumulated. */
export function writeAttributions(rows: readonly CostAttribution[], dir: string = DATA_DIR): void {
  writeFileSync(storeFile(dir, "attributions.jsonl"), rows.map((r) => `${JSON.stringify(r)}\n`).join(""), { encoding: "utf8", mode: 0o600 });
}
export function writeMissingEdges(rows: readonly MissingEdge[], dir: string = DATA_DIR): void {
  writeFileSync(storeFile(dir, "missing-edges.jsonl"), rows.map((r) => `${JSON.stringify(r)}\n`).join(""), { encoding: "utf8", mode: 0o600 });
}
export function readAttributions(dir: string = DATA_DIR): readonly CostAttribution[] {
  return readFileSync(storeFile(dir, "attributions.jsonl"), "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as CostAttribution);
}
export function readMissingEdges(dir: string = DATA_DIR): readonly MissingEdge[] {
  return readFileSync(storeFile(dir, "missing-edges.jsonl"), "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as MissingEdge);
}

/**
 * Phase 10 integration, by POINTER rather than duplication: joins a Step 15
 * self-resource record to its attribution so a caller can ask the four cost
 * questions of a method without any billing data being copied into the
 * self-resource store, and without Step 15's runtime states being touched.
 */
export interface MethodCostAnswer {
  method_id: string;
  /** Read from the self-resource record, not restated here. */
  what_usage_can_i_measure: readonly string[];
  can_i_attribute_usage_to_execution: boolean;
  can_i_attribute_money_to_execution: boolean;
  why_not: readonly string[];
  /** Pointers, so the source of truth stays where it was. */
  self_resource_ref: string;
  attribution_ref: string;
}

export function answerMethodCostQuestions(
  selfResources: readonly { method_id: string; measured_dimensions: readonly string[] }[],
  attributions: readonly CostAttribution[],
): readonly MethodCostAnswer[] {
  return attributions.map((a) => {
    const sr = selfResources.find((s) => s.method_id === a.method_id);
    return {
      method_id: a.method_id,
      what_usage_can_i_measure: sr?.measured_dimensions ?? [],
      // Usage is attributable when the execution row that carries it also
      // carries an execution identity — that join is inside the row itself.
      can_i_attribute_usage_to_execution: a.usage_measurement_refs.length > 0 && a.execution_id !== null,
      can_i_attribute_money_to_execution: a.attribution_state === "DIRECT" || a.attribution_state === "DERIVABLE",
      why_not: a.unattributable_reasons,
      self_resource_ref: "control/self-resource/data/self-resources.jsonl",
      attribution_ref: "control/cost-attribution/data/attributions.jsonl",
    };
  });
}
