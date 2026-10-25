/**
 * DNA OS Trace Registry — Validator
 * Validates any trace registry object against the schema contracts
 */

import type { ValidationResult } from "./_schema";

export function validateTraceRegistry(name: string, data: unknown): ValidationResult {
  const errors: Array<{ field: string; message: string; code: string }> = [];
  const warnings: Array<{ field: string; message: string }> = [];

  if (data === null || typeof data !== "object") {
    errors.push({ field: "root", message: "Registry must be a non-null object", code: "INVALID_TYPE" });
    return { valid: false, name, errors, warnings };
  }

  const rec = data as Record<string, unknown>;

  if ("trace_schema" in rec) {
    // Trace schema validation
    const ts = rec.trace_schema as Record<string, unknown>;
    for (const required of ["trace_id_field", "span_id_field", "storage_table", "spans"]) {
      if (!(required in ts) || ts[required] === undefined || ts[required] === null) {
        errors.push({
          field: `trace_schema.${required}`,
          message: `Required field "${required}" is missing`,
          code: "MISSING_REQUIRED_FIELD",
        });
      }
    }
    // Validate each span
    if (ts.spans && typeof ts.spans === "object") {
      const spans = ts.spans as Record<string, unknown>;
      for (const [spanId, span] of Object.entries(spans)) {
        if (!span || typeof span !== "object") {
          errors.push({ field: `trace_schema.spans.${spanId}`, message: "Span must be an object", code: "INVALID_TYPE" });
          continue;
        }
        const s = span as Record<string, unknown>;
        for (const required of ["id", "label", "storage_field", "status_field"]) {
          if (!(required in s) || s[required] === undefined || s[required] === null) {
            errors.push({
              field: `trace_schema.spans.${spanId}.${required}`,
              message: `Required span field "${required}" is missing`,
              code: "MISSING_REQUIRED_FIELD",
            });
          }
        }
      }
    }
  } else if ("metrics" in rec) {
    // Metrics registry validation
    const metrics = rec.metrics as Record<string, unknown>;
    for (const [metricId, metric] of Object.entries(metrics)) {
      if (!metric || typeof metric !== "object") {
        errors.push({ field: `metrics.${metricId}`, message: "Metric must be an object", code: "INVALID_TYPE" });
        continue;
      }
      const m = metric as Record<string, unknown>;
      for (const required of ["id", "label", "unit", "type", "source", "aggregation"]) {
        if (!(required in m) || m[required] === undefined || m[required] === null) {
          errors.push({
            field: `metrics.${metricId}.${required}`,
            message: `Required metric field "${required}" is missing`,
            code: "MISSING_REQUIRED_FIELD",
          });
        }
      }
    }
  } else {
    warnings.push({ field: "root", message: "Could not detect trace registry type (no trace_schema/metrics key)" });
  }

  return { valid: errors.length === 0, name, errors, warnings };
}
