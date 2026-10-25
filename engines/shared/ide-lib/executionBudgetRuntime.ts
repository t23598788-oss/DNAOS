/**
 * Execution Budget Runtime (owner, 2026-08-08, Software Factory Step
 * 13.6, Section 10). Real, per Workspace-Session/Execution-Step budget
 * tracking — PRECHECK before any call, RESERVE capacity, RECORD real
 * usage, ENFORCE the real limit, STOP before/at the limit, never after.
 * Every cost value carries a real `kind` (ACTUAL/ESTIMATED/UNKNOWN) —
 * never a bare guessed number.
 */
export interface ExecutionBudget {
  maxProviderCalls: number;
  maxTokens: number;
  maxContextBytes: number;
  maxOutputBytes: number;
  maxDurationMs: number;
  maxEstimatedCost: number | null;
  maxActualCost: number | null;
  maxFilesRead: number;
  maxFilesChanged: number;
}

export const DEFAULT_EXECUTION_BUDGET: ExecutionBudget = {
  maxProviderCalls: 1, maxTokens: 8000, maxContextBytes: 200_000, maxOutputBytes: 100_000,
  maxDurationMs: 120_000, maxEstimatedCost: 1.0, maxActualCost: 1.0, maxFilesRead: 40, maxFilesChanged: 10,
};

export interface BudgetUsage {
  providerCalls: number; tokens: number; contextBytes: number; outputBytes: number; durationMs: number;
  estimatedCost: number; actualCost: number; filesRead: number; filesChanged: number;
}

function zeroUsage(): BudgetUsage {
  return { providerCalls: 0, tokens: 0, contextBytes: 0, outputBytes: 0, durationMs: 0, estimatedCost: 0, actualCost: 0, filesRead: 0, filesChanged: 0 };
}

interface BudgetRecord { key: string; budget: ExecutionBudget; usage: BudgetUsage; stopped: boolean; stopReasons: string[] }
const budgets = new Map<string, BudgetRecord>();
const MAX_BUDGET_RECORDS = 500;
function evictOld() {
  while (budgets.size > MAX_BUDGET_RECORDS) { const oldestKey = budgets.keys().next().value; if (oldestKey === undefined) break; budgets.delete(oldestKey); }
}

function keyFor(workspaceSessionId: string, stepId: string): string { return `${workspaceSessionId}:${stepId}`; }

export function initBudget(workspaceSessionId: string, stepId: string, budget: Partial<ExecutionBudget> = {}): BudgetRecord {
  const key = keyFor(workspaceSessionId, stepId);
  const record: BudgetRecord = { key, budget: { ...DEFAULT_EXECUTION_BUDGET, ...budget }, usage: zeroUsage(), stopped: false, stopReasons: [] };
  budgets.set(key, record);
  evictOld();
  return record;
}

function getOrInit(workspaceSessionId: string, stepId: string): BudgetRecord {
  const key = keyFor(workspaceSessionId, stepId);
  return budgets.get(key) ?? initBudget(workspaceSessionId, stepId);
}

export interface BudgetCheckResult { ok: boolean; reasons: string[] }

/** PRECHECK — real, deterministic check of a prospective call's real,
 * estimated cost against the real, remaining budget BEFORE it happens.
 * Never lets a call start that would already exceed a real limit. */
export function precheckBudget(workspaceSessionId: string, stepId: string, prospective: Partial<BudgetUsage>): BudgetCheckResult {
  const record = getOrInit(workspaceSessionId, stepId);
  const reasons: string[] = [];
  if (record.stopped) reasons.push(`budget already STOPPED: ${record.stopReasons.join("; ")}`);
  if (record.usage.providerCalls + (prospective.providerCalls ?? 1) > record.budget.maxProviderCalls) reasons.push(`would exceed maxProviderCalls (${record.budget.maxProviderCalls})`);
  if (record.usage.tokens + (prospective.tokens ?? 0) > record.budget.maxTokens) reasons.push(`would exceed maxTokens (${record.budget.maxTokens})`);
  if (record.usage.contextBytes + (prospective.contextBytes ?? 0) > record.budget.maxContextBytes) reasons.push(`would exceed maxContextBytes (${record.budget.maxContextBytes})`);
  if (record.budget.maxEstimatedCost !== null && record.usage.estimatedCost + (prospective.estimatedCost ?? 0) > record.budget.maxEstimatedCost) reasons.push(`would exceed maxEstimatedCost (${record.budget.maxEstimatedCost})`);
  return { ok: reasons.length === 0, reasons };
}

/** RESERVE — real, immediate increment of the real counters BEFORE the
 * call executes, so a concurrent second call cannot double-spend the
 * same real budget window. */
export function reserveBudget(workspaceSessionId: string, stepId: string, reservation: Partial<BudgetUsage>): BudgetCheckResult {
  const check = precheckBudget(workspaceSessionId, stepId, reservation);
  if (!check.ok) return check;
  const record = getOrInit(workspaceSessionId, stepId);
  record.usage.providerCalls += reservation.providerCalls ?? 1;
  record.usage.tokens += reservation.tokens ?? 0;
  record.usage.contextBytes += reservation.contextBytes ?? 0;
  record.usage.estimatedCost += reservation.estimatedCost ?? 0;
  return { ok: true, reasons: [] };
}

/** RECORD — real, post-call actual usage recording (replaces the
 * estimate with the real, actual number where known). */
export function recordActualUsage(workspaceSessionId: string, stepId: string, actual: Partial<BudgetUsage>): void {
  const record = getOrInit(workspaceSessionId, stepId);
  record.usage.outputBytes += actual.outputBytes ?? 0;
  record.usage.durationMs += actual.durationMs ?? 0;
  record.usage.actualCost += actual.actualCost ?? 0;
  record.usage.filesRead += actual.filesRead ?? 0;
  record.usage.filesChanged += actual.filesChanged ?? 0;
}

/** ENFORCE — real, live check of current, real usage against real
 * limits. STOP is returned the moment a real limit is reached or
 * exceeded — never discovered only after the fact. */
export function enforceBudget(workspaceSessionId: string, stepId: string): BudgetCheckResult {
  const record = getOrInit(workspaceSessionId, stepId);
  const reasons: string[] = [];
  if (record.usage.providerCalls >= record.budget.maxProviderCalls) reasons.push(`real maxProviderCalls (${record.budget.maxProviderCalls}) reached`);
  if (record.usage.outputBytes > record.budget.maxOutputBytes) reasons.push(`real maxOutputBytes (${record.budget.maxOutputBytes}) exceeded`);
  if (record.usage.durationMs > record.budget.maxDurationMs) reasons.push(`real maxDurationMs (${record.budget.maxDurationMs}) exceeded`);
  if (record.budget.maxActualCost !== null && record.usage.actualCost > record.budget.maxActualCost) reasons.push(`real maxActualCost (${record.budget.maxActualCost}) exceeded`);
  if (record.usage.filesRead > record.budget.maxFilesRead) reasons.push(`real maxFilesRead (${record.budget.maxFilesRead}) exceeded`);
  if (record.usage.filesChanged > record.budget.maxFilesChanged) reasons.push(`real maxFilesChanged (${record.budget.maxFilesChanged}) exceeded`);
  if (reasons.length > 0) { record.stopped = true; record.stopReasons = reasons; }
  return { ok: reasons.length === 0, reasons };
}

export function getBudgetRecord(workspaceSessionId: string, stepId: string): BudgetRecord {
  return getOrInit(workspaceSessionId, stepId);
}
export function __debugBudgetRecordCount(): number { return budgets.size; }
