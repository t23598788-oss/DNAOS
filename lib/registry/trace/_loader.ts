/**
 * DNA OS Trace Registry — Loader
 * Static imports — works in all Next.js environments (SSR, SSG, Edge)
 * All JSON files are imported at build time; no dynamic file system reads.
 */

import type {
  TraceSchema,
  SpanDefinition,
  MetricDefinition,
  TraceManifest,
  ValidationResult,
} from "./_schema";
import { validateTraceRegistry } from "./_validator";

import manifestRaw from "./_index.registry.json";
import traceRaw from "./trace.registry.json";
import metricsRaw from "./metrics.registry.json";

// ─── Internal Maps ───────────────────────────────────────────────────────────

const TRACE_SCHEMA: TraceSchema = traceRaw.trace_schema as unknown as TraceSchema;
const METRIC_MAP: Record<string, MetricDefinition> = metricsRaw.metrics as unknown as Record<string, MetricDefinition>;

// ─── Trace Schema Loader ─────────────────────────────────────────────────────

/**
 * Load the full trace schema definition.
 */
export function loadTraceSchema(): TraceSchema {
  return TRACE_SCHEMA;
}

// ─── Span Loaders ────────────────────────────────────────────────────────────

/**
 * Load a span definition by id.
 */
export function loadSpan(id: string): SpanDefinition | null {
  return TRACE_SCHEMA.spans[id] ?? null;
}

/**
 * List all registered span ids.
 */
export function listSpans(): string[] {
  return Object.keys(TRACE_SCHEMA.spans);
}

// ─── Metric Loaders ──────────────────────────────────────────────────────────

/**
 * Load a metric definition by id.
 */
export function loadMetric(id: string): MetricDefinition | null {
  return METRIC_MAP[id] ?? null;
}

/**
 * List all registered metric ids.
 */
export function listMetrics(): string[] {
  return Object.keys(METRIC_MAP);
}

// ─── Manifest ────────────────────────────────────────────────────────────────

/**
 * Return the trace manifest (_index.registry.json).
 */
export function getTraceManifest(): TraceManifest {
  return manifestRaw as unknown as TraceManifest;
}

// ─── Validate All ────────────────────────────────────────────────────────────

/**
 * Validate all loaded trace registries and return results.
 */
export function validateAllTrace(): ValidationResult[] {
  return [
    validateTraceRegistry("trace", traceRaw),
    validateTraceRegistry("metrics", metricsRaw),
  ];
}
