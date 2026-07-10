/**
 * DNA OS Trace Registry — TypeScript Contract
 * Schema interfaces for trace schema, span definitions, and metric definitions
 */

export type SpanStatus = "OK" | "ERROR" | "TIMEOUT" | "SKIPPED";
export type MetricType = "counter" | "gauge" | "histogram" | "summary";

export interface SpanDefinition {
  id: string;
  label: string;
  pipeline_step?: string;   // references execution/pipeline step id
  storage_field: string;    // field in storage_table where this span is logged
  status_field: string;
}

export interface MetricDefinition {
  id: string;
  label: string;
  unit: string;
  type: MetricType;
  source: string;           // "line_events.latency_ms" etc.
  aggregation: "sum" | "avg" | "max" | "min" | "count" | "p95";
  description: string;
}

export interface TraceSchema {
  trace_id_field: string;
  span_id_field: string;
  timestamp_field: string;
  node_field: string;
  latency_field: string;
  status_field: string;
  error_field: string;
  storage_table: string;
  retention_days: number | null;
  spans: Record<string, SpanDefinition>;
}

export interface TraceManifest {
  version: number;
  last_updated: string;
  registries: Record<string, { file: string; status: string; description: string }>;
  storage_table: string;
  enabled: boolean;
}

export interface ValidationResult {
  valid: boolean;
  name: string;
  errors: Array<{ field: string; message: string; code: string }>;
  warnings: Array<{ field: string; message: string }>;
}
