import { AsyncLocalStorage } from "node:async_hooks";

/**
 * DNA OS Runtime Trace — ทุก request ต้องมี trace ที่ replay ได้
 *
 * User → Intent → Rule → Engine → Module → Response
 * ทุกขั้นตอนบันทึกลง trace chain
 */

export interface DataSource {
  table: string;
  operation: "read" | "write";
  columns?: string[];
}

export interface TraceStep {
  seq: number;
  layer: "cognitive" | "v2-rules" | "v3-engines" | "v4-ai" | "v5-presenter" | "v6-executor" | "runtime" | "supabase";
  module: string;
  action: string;
  input: Record<string, unknown>;
  output?: Record<string, unknown>;
  duration_ms: number;
  timestamp: string;
  rules_applied?: string[];
  data_sources?: DataSource[];
  error?: string;
}

export type ExecutionEventName =
  | "command.received"
  | "tool.selected"
  | "reader.started"
  | "reader.completed"
  | "result.ready"
  | "execution.failed"
  | "execution.completed";

export type ExecutionEventStatus =
  | "received"
  | "selected"
  | "started"
  | "completed"
  | "failed"
  | "denied"
  | "ready";

export interface ExecutionEvent {
  traceId: string;
  sequence: number;
  event: ExecutionEventName;
  actorId: string;
  scopeMode: "platform" | "organization" | "none";
  organizationIds: string[];
  toolId: string;
  timestamp: string;
  status: ExecutionEventStatus;
  sourceReference: string;
  durationMs?: number;
  recordCount?: number;
}

export type ExecutionEventInput = Omit<
  ExecutionEvent,
  "traceId" | "sequence" | "actorId" | "scopeMode" | "organizationIds" | "timestamp"
>;

export interface RequestTrace {
  trace_id: string;
  started_at: string;
  completed_at?: string;
  total_duration_ms?: number;
  user_input: string;
  intent?: string;
  status: "in_progress" | "completed" | "failed";
  steps: TraceStep[];
  events: ExecutionEvent[];
}

interface ExecutionContext {
  traceId: string;
  actorId: string;
  scopeMode: "platform" | "organization" | "none";
  organizationIds: string[];
  sequence: number;
  onEvent?: (event: ExecutionEvent) => void;
}

type ExecutionContextInput = Omit<ExecutionContext, "sequence">;

const traceStore = new Map<string, RequestTrace>();
const MAX_TRACES = 200;
const executionContext = new AsyncLocalStorage<ExecutionContext>();

export function startTrace(traceId: string, userInput: string): RequestTrace {
  const trace: RequestTrace = {
    trace_id: traceId,
    started_at: new Date().toISOString(),
    user_input: userInput,
    status: "in_progress",
    steps: [],
    events: [],
  };
  traceStore.set(traceId, trace);

  // Evict old traces
  if (traceStore.size > MAX_TRACES) {
    const oldest = traceStore.keys().next().value;
    if (oldest) traceStore.delete(oldest);
  }

  return trace;
}

export function withExecutionContext<T>(
  context: ExecutionContextInput,
  fn: () => T,
): T {
  return executionContext.run({ ...context, sequence: 0 }, fn);
}

export function emitExecutionEvent(event: ExecutionEventInput): void {
  const context = executionContext.getStore();
  if (!context) return;

  const sequence = ++context.sequence;
  const trace = traceStore.get(context.traceId);
  const recorded: ExecutionEvent = {
    ...event,
    traceId: context.traceId,
    sequence,
    actorId: context.actorId,
    scopeMode: context.scopeMode,
    organizationIds: [...context.organizationIds],
    timestamp: new Date().toISOString(),
  };
  trace?.events.push(recorded);
  context.onEvent?.(recorded);
}

export function addStep(traceId: string, step: Omit<TraceStep, "seq" | "timestamp">): void {
  const trace = traceStore.get(traceId);
  if (!trace) return;

  trace.steps.push({
    ...step,
    seq: trace.steps.length + 1,
    timestamp: new Date().toISOString(),
  });
}

export function setIntent(traceId: string, intent: string): void {
  const trace = traceStore.get(traceId);
  if (trace) trace.intent = intent;
}

export function completeTrace(traceId: string, status: "completed" | "failed"): RequestTrace | undefined {
  const trace = traceStore.get(traceId);
  if (!trace) return undefined;

  trace.status = status;
  trace.completed_at = new Date().toISOString();
  trace.total_duration_ms = new Date(trace.completed_at).getTime() - new Date(trace.started_at).getTime();
  return trace;
}

export function getTrace(traceId: string): RequestTrace | undefined {
  return traceStore.get(traceId);
}

export function getRecentTraces(count = 20): RequestTrace[] {
  return Array.from(traceStore.values()).slice(-count);
}

export function traceLineage(traceId: string): { tables: string[]; flow: string[] } {
  const trace = traceStore.get(traceId);
  if (!trace) return { tables: [], flow: ["Trace not found"] };

  const tables = new Set<string>();
  const flow: string[] = [
    `User: "${trace.user_input}"`,
    `Intent: ${trace.intent ?? "unknown"}`,
  ];

  for (const step of trace.steps) {
    flow.push(`→ [${step.layer}] ${step.module}.${step.action}`);
    if (step.rules_applied?.length) {
      flow.push(`  Rules: ${step.rules_applied.join(", ")}`);
    }
    if (step.data_sources?.length) {
      for (const ds of step.data_sources) {
        tables.add(ds.table);
        const cols = ds.columns?.length ? ` (${ds.columns.join(", ")})` : "";
        flow.push(`  ${ds.operation === "read" ? "READ" : "WRITE"} ← ${ds.table}${cols}`);
      }
    }
  }

  flow.push(`→ Response: ${trace.status}`);
  return { tables: Array.from(tables), flow };
}

export function replayTrace(traceId: string): string[] {
  const trace = traceStore.get(traceId);
  if (!trace) return ["Trace not found"];

  const lines: string[] = [
    `=== Trace ${trace.trace_id} ===`,
    `User Input: ${trace.user_input}`,
    `Intent: ${trace.intent ?? "unknown"}`,
    `Status: ${trace.status}`,
    `Duration: ${trace.total_duration_ms ?? "?"}ms`,
    `---`,
  ];

  for (const step of trace.steps) {
    const rules = step.rules_applied?.length ? ` [rules: ${step.rules_applied.join(", ")}]` : "";
    const err = step.error ? ` ERROR: ${step.error}` : "";
    lines.push(
      `${step.seq}. [${step.layer}] ${step.module}.${step.action} (${step.duration_ms}ms)${rules}${err}`
    );
  }

  return lines;
}
