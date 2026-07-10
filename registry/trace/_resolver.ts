/**
 * DNA OS Trace Registry — Resolver
 * Resolution API — use these functions instead of importing JSON directly.
 * All consumers must go through the Registry, never access JSON files directly.
 */

import {
  loadTraceSchema,
  loadSpan,
  loadMetric,
  listMetrics,
  getTraceManifest,
} from "./_loader";
import type {
  TraceSchema,
  SpanDefinition,
  MetricDefinition,
} from "./_schema";

// ─── Trace Schema Resolver ───────────────────────────────────────────────────

/**
 * Resolve the full trace schema.
 */
export function resolveTraceSchema(): TraceSchema {
  return loadTraceSchema();
}

// ─── Span Resolvers ──────────────────────────────────────────────────────────

/**
 * Resolve a span definition by id.
 */
export function resolveSpan(spanId: string): SpanDefinition | null {
  return loadSpan(spanId);
}

/**
 * Resolve all span definitions as a record.
 */
export function resolveAllSpans(): Record<string, SpanDefinition> {
  return loadTraceSchema().spans;
}

// ─── Metric Resolvers ────────────────────────────────────────────────────────

/**
 * Resolve a metric definition by id.
 */
export function resolveMetric(metricId: string): MetricDefinition | null {
  return loadMetric(metricId);
}

/**
 * Resolve all metric definitions as a record.
 */
export function resolveAllMetrics(): Record<string, MetricDefinition> {
  const result: Record<string, MetricDefinition> = {};
  for (const id of listMetrics()) {
    const m = loadMetric(id);
    if (m) result[id] = m;
  }
  return result;
}

// ─── Trace Config Resolvers ──────────────────────────────────────────────────

/**
 * Returns true if tracing is enabled.
 */
export function isTraceEnabled(): boolean {
  return getTraceManifest().enabled;
}

/**
 * Returns the storage table for trace data.
 */
export function resolveTraceStorageTable(): string {
  return getTraceManifest().storage_table;
}
