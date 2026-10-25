/**
 * BUSINESS JOB ADAPTER (IntegrPASS 2 / G1) — CONTROL ENVELOPE only.
 *
 * Owner decision 2026-09-22 (CANONICAL_JOB_CONTRACT = INTEGRATION CONTRACT):
 *   job  = control envelope  →  adapter  →  existing canonical writer  →  result/evidence
 * The canonical writers stay the BUSINESS EXECUTORS and keep every ownership and
 * business semantics they already have. This file therefore:
 *
 *   ✗ never imports a database client (no supabaseAdmin, no SQL, no .from()/.insert())
 *   ✗ never computes money, never rewrites a result, never touches business tables
 *   ✗ never introduces a queue/worker/approval/cost/state system
 *   ✓ validates the envelope against the declared business capabilities in
 *     registry/CANONICAL_JOB_CONTRACT.json (unknown capability, write outside the
 *     declared scope, missing cost authorization, missing approval are all refused
 *     BEFORE the executor is called)
 *   ✓ calls the injected executor (a real canonical writer function) exactly once
 *   ✓ returns a control record (job id / timings / digest) for the EXISTING
 *     execution runtime to record — control-plane state is never business truth
 *
 * Wiring a real call site is deliberately NOT done here: PASS 3 (VERIFY) attaches the
 * acceptance contract + approval evidence that must exist before any production route
 * switches to running through this envelope.
 */
import { createHash, randomUUID } from "node:crypto";

import contract from "@/registry/CANONICAL_JOB_CONTRACT.json";

export interface BusinessCapabilityDeclaration {
  capability: string;
  executor: { module: string; export: string; family: string };
  data_read: string[];
  data_write: string[];
  approval: { required: boolean; kind: string };
  cost: { kind: "FREE" | "PAID" | "UNKNOWN_COST" };
  acceptance_default: string[];
  pass: string;
}

export interface BusinessJobEnvelope {
  contract_version: string;
  kind: "BUSINESS";
  capability: string;
  plane: "C_business";
  requested_by: { kind: "owner" | "staff" | "agent" | "system" | "customer"; id: string };
  idempotency_key: string;
  priority?: "P0" | "P1" | "P2" | "P3";
  scope: {
    data_read?: string[];
    data_write?: string[];
    capabilities?: string[];
    spend?: { kind: "FREE" | "PAID" | "UNKNOWN_COST"; authorized_ref?: string };
    forbidden?: string[];
  };
  approval?: { required: boolean; kind: string; ref?: string };
  acceptance?: string[];
  plan?: { steps?: string[] };
  exec_args: unknown;
}

export type BusinessJobStatus =
  | "BLOCKED_UNKNOWN_CAPABILITY"
  | "BLOCKED_WRITE_OUT_OF_SCOPE"
  | "BLOCKED_COST_AUTHORIZATION_MISSING"
  | "PENDING_APPROVAL"
  | "FAILED_FINAL"
  | "EXECUTED"
  | "VERIFIED"
  | "EXECUTED_REQUIRES_REVIEW"
  | "EXECUTED_OUT_OF_SCOPE_VIOLATION";

/** Injected by the CONTROL PLANE (keeps this file DB-free: control → domain only). */
export interface AcceptanceRunner {
  (ids: string[], ctx: { job_id: string; document_id?: string | null }): Promise<
    Array<{ acceptance_id: string; verifier_id: string; pass: boolean; observed_at: string; evidence_ref: string; detail: string }>
  >;
}

export interface ExecuteBusinessJobOptions {
  acceptanceRunner?: AcceptanceRunner;
}

export interface BusinessJobControlRecord {
  job_id: string;
  capability: string;
  executor: { module: string; export: string };
  envelope_digest: string;
  started_at: string;
  finished_at: string;
  /** reported by the executor itself; the adapter never inspects or writes business rows */
  observed_writes: string[];
  acceptance: string[];
}

export interface BusinessJobExecution<ExecResult> {
  status: BusinessJobStatus;
  job_id: string | null;
  capability: string;
  violations: string[];
  control: BusinessJobControlRecord | null;
  /** real acceptance outcomes (only present when a runner was injected) */
  acceptance?: Array<{ acceptance_id: string; verifier_id: string; pass: boolean; observed_at: string; evidence_ref: string; detail: string }>;
  result: ExecResult | null;
}

const DECLARED: BusinessCapabilityDeclaration[] = (contract as { business_capabilities: { items: BusinessCapabilityDeclaration[] } }).business_capabilities.items;

/** The single business-capability declaration (read from the approved contract). */
export function declaredBusinessCapabilities(): BusinessCapabilityDeclaration[] {
  return DECLARED;
}

export function findBusinessCapability(capability: string): BusinessCapabilityDeclaration | undefined {
  return DECLARED.find((c) => c.capability === capability);
}

const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export interface BuildBusinessJobInput {
  capability: string;
  requested_by: BusinessJobEnvelope["requested_by"];
  idempotency_key: string;
  exec_args: unknown;
  priority?: BusinessJobEnvelope["priority"];
  /** writes the caller intends to perform — must stay inside the declared scope */
  data_write?: string[];
  data_read?: string[];
  spend?: BusinessJobEnvelope["scope"]["spend"];
  approval_ref?: string;
  acceptance?: string[];
  plan?: { steps?: string[] };
}

/**
 * Builds a CONTROL ENVELOPE from a business request. It resolves the declared
 * capability, mirrors the declared scope/approval/cost defaults and never invents
 * business values (no money, no quantities, no parties).
 */
export function buildBusinessJob(input: BuildBusinessJobInput): { envelope: BusinessJobEnvelope | null; problems: string[] } {
  const decl = findBusinessCapability(input.capability);
  if (!decl) return { envelope: null, problems: [`unknown capability: ${input.capability}`] };

  const envelope: BusinessJobEnvelope = {
    contract_version: String((contract as { version: string }).version),
    kind: "BUSINESS",
    capability: decl.capability,
    plane: "C_business",
    requested_by: input.requested_by,
    idempotency_key: input.idempotency_key,
    priority: input.priority ?? "P2",
    scope: {
      data_read: input.data_read ?? decl.data_read,
      data_write: input.data_write ?? decl.data_write,
      capabilities: [decl.capability],
      spend: input.spend ?? { kind: decl.cost.kind },
      forbidden: ["สร้างยอดเงินจาก AI", "ลบเอกสาร/ledger", "ข้าม canonical writer"],
    },
    approval: { required: decl.approval.required, kind: decl.approval.kind, ...(input.approval_ref ? { ref: input.approval_ref } : {}) },
    acceptance: input.acceptance ?? decl.acceptance_default,
    plan: input.plan ?? { steps: ["validate", "execute:" + decl.executor.export, "record-control"] },
    exec_args: input.exec_args,
  };
  return { envelope, problems: [] };
}

/** Envelope validation against the declaration (pure: no I/O, no DB). */
export function validateBusinessJobEnvelope(envelope: BusinessJobEnvelope): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  const decl = findBusinessCapability(envelope.capability);
  if (!decl) return { ok: false, problems: [`unknown capability: ${envelope.capability}`] };
  if (envelope.kind !== "BUSINESS") problems.push("kind must be BUSINESS");
  if (envelope.plane !== "C_business") problems.push("plane must be C_business");
  if (!envelope.idempotency_key) problems.push("idempotency_key required");
  if (!envelope.requested_by?.kind || !envelope.requested_by?.id) problems.push("requested_by required");

  const declaredWrites = new Set(decl.data_write);
  for (const t of envelope.scope.data_write ?? []) {
    if (!declaredWrites.has(t)) problems.push(`data_write outside declared scope: ${t}`);
  }
  const declaredReads = new Set(decl.data_read);
  for (const t of envelope.scope.data_read ?? []) {
    if (!declaredReads.has(t) && !declaredWrites.has(t)) problems.push(`data_read outside declared scope: ${t}`);
  }
  const spendKind = envelope.scope.spend?.kind ?? decl.cost.kind;
  if (spendKind !== decl.cost.kind) problems.push(`spend.kind ${spendKind} != declared ${decl.cost.kind}`);
  if (spendKind !== "FREE" && !envelope.scope.spend?.authorized_ref) problems.push("cost authorization_ref required for paid/unknown cost");
  if (envelope.approval?.required && envelope.approval.kind === "gate_none") problems.push("approval.required with kind gate_none is contradictory");
  return { ok: problems.length === 0, problems };
}

/** What a real canonical writer reports back (evidence only — never inspected for business values). */
export interface BusinessJobExecOutcome<ExecResult> {
  result: ExecResult;
  /** tables the executor says it actually wrote — compared against the declared scope */
  observed_writes?: string[];
  evidence?: Array<{ kind: string; ref: string; sha256?: string }>;
}

export type BusinessExecutor<ExecResult> = (envelope: BusinessJobEnvelope) => Promise<BusinessJobExecOutcome<ExecResult>>;

/**
 * Runs one business job through the envelope. The executor is ALWAYS a real canonical
 * writer (injected). Refusals happen before the executor is called, and the result is
 * passed through untouched — the adapter adds control metadata only.
 */
export async function executeBusinessJob<ExecResult>(
  envelope: BusinessJobEnvelope,
  executor: BusinessExecutor<ExecResult>,
  options: ExecuteBusinessJobOptions = {}
): Promise<BusinessJobExecution<ExecResult>> {
  const decl = findBusinessCapability(envelope.capability);
  const base = { job_id: null as string | null, capability: envelope.capability, violations: [] as string[], control: null, result: null as ExecResult | null };

  if (!decl) return { ...base, status: "BLOCKED_UNKNOWN_CAPABILITY", violations: [`unknown capability: ${envelope.capability}`] };

  const validation = validateBusinessJobEnvelope(envelope);
  const writeOutOfScope = validation.problems.filter((p) => p.startsWith("data_write outside"));
  if (writeOutOfScope.length) return { ...base, status: "BLOCKED_WRITE_OUT_OF_SCOPE", violations: writeOutOfScope };
  if (validation.problems.some((p) => p.includes("authorization_ref"))) {
    return { ...base, status: "BLOCKED_COST_AUTHORIZATION_MISSING", violations: validation.problems };
  }
  if (!validation.ok) return { ...base, status: "BLOCKED_WRITE_OUT_OF_SCOPE", violations: validation.problems };

  const approval = envelope.approval ?? { required: decl.approval.required, kind: decl.approval.kind };
  if (approval.required && !approval.ref) {
    // Canonical writer is NOT called — the job waits for the owner decision recorded elsewhere.
    return { ...base, status: "PENDING_APPROVAL", violations: [`approval required (${approval.kind}) without ref`] };
  }

  const jobId = randomUUID();
  const startedAt = new Date().toISOString();
  let outcome: BusinessJobExecOutcome<ExecResult>;
  try {
    outcome = await executor(envelope);
  } catch (e: unknown) {
    // F: the business write may be half-done — report FAILED_FINAL with the real message.
    // Never roll back or delete a business row, never retry automatically.
    const message = e instanceof Error ? e.message : String(e);
    return {
      ...base, job_id: jobId, status: "FAILED_FINAL", violations: [message],
      control: {
        job_id: jobId, capability: envelope.capability,
        executor: { module: decl.executor.module, export: decl.executor.export },
        envelope_digest: digest(envelope), started_at: startedAt, finished_at: new Date().toISOString(),
        observed_writes: [], acceptance: envelope.acceptance ?? decl.acceptance_default,
      },
      result: null,
    };
  }
  const finishedAt = new Date().toISOString();
  const declaredWrites = new Set(decl.data_write);
  const observed = outcome.observed_writes ?? [];
  const violations = observed.filter((t) => !declaredWrites.has(t));

  // Acceptance runs AFTER the executor, from real business truth. A failure never reverses
  // the business row (no delete/rollback/retry) — it is reported for review instead.
  const acceptanceIds = envelope.acceptance ?? decl.acceptance_default;
  const documentId = (outcome.result as { document_id?: string } | null)?.document_id ?? null;
  const acceptance = options.acceptanceRunner
    ? await options.acceptanceRunner(acceptanceIds, { job_id: jobId, document_id: documentId })
    : [];
  const acceptanceFailed = acceptance.some((a) => !a.pass);

  const status: BusinessJobStatus = violations.length
    ? "EXECUTED_OUT_OF_SCOPE_VIOLATION"
    : acceptanceFailed
      ? "EXECUTED_REQUIRES_REVIEW"
      : options.acceptanceRunner
        ? "VERIFIED"
        : "EXECUTED";

  return {
    status,
    job_id: jobId,
    capability: envelope.capability,
    violations,
    control: {
      job_id: jobId, capability: envelope.capability,
      executor: { module: decl.executor.module, export: decl.executor.export },
      envelope_digest: digest(envelope), started_at: startedAt, finished_at: finishedAt,
      observed_writes: observed, acceptance: acceptance.length ? acceptance.map((a) => `${a.acceptance_id}:${a.pass ? "PASS" : "FAIL"}`) : acceptanceIds,
    },
    acceptance,
    // pass-through: the canonical writer's own result is returned exactly as-is
    result: outcome.result,
  };
}


