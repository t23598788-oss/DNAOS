/**
 * DNA OS Execution Registry — Validator
 * Validates any execution registry object against the schema contracts
 */

import type { ValidationResult } from "./_schema";

export function validateExecutionRegistry(name: string, data: unknown): ValidationResult {
  const errors: Array<{ field: string; message: string; code: string }> = [];
  const warnings: Array<{ field: string; message: string }> = [];

  if (data === null || typeof data !== "object") {
    errors.push({ field: "root", message: "Registry must be a non-null object", code: "INVALID_TYPE" });
    return { valid: false, name, errors, warnings };
  }

  const rec = data as Record<string, unknown>;

  // Detect what type of registry this is
  if ("pipelines" in rec) {
    // Pipeline registry validation
    const pipelines = rec.pipelines as Record<string, unknown>;
    for (const [pipelineId, pipeline] of Object.entries(pipelines)) {
      if (!pipeline || typeof pipeline !== "object") {
        errors.push({ field: `pipelines.${pipelineId}`, message: "Pipeline must be an object", code: "INVALID_TYPE" });
        continue;
      }
      const p = pipeline as Record<string, unknown>;
      for (const required of ["id", "name", "channel", "trigger", "steps", "status", "policy"]) {
        if (!(required in p) || p[required] === undefined || p[required] === null) {
          errors.push({
            field: `pipelines.${pipelineId}.${required}`,
            message: `Required field "${required}" is missing`,
            code: "MISSING_REQUIRED_FIELD",
          });
        }
      }
      // Validate steps
      if (Array.isArray(p.steps)) {
        for (const step of p.steps as unknown[]) {
          if (!step || typeof step !== "object") continue;
          const s = step as Record<string, unknown>;
          for (const required of ["id", "label", "status"]) {
            if (!(required in s) || s[required] === undefined || s[required] === null) {
              errors.push({
                field: `pipelines.${pipelineId}.steps[${s.id ?? "?"}].${required}`,
                message: `Required step field "${required}" is missing`,
                code: "MISSING_REQUIRED_FIELD",
              });
            }
          }
        }
      }
    }
  } else if ("engines" in rec) {
    // Engine registry validation
    const engines = rec.engines as Record<string, unknown>;
    for (const [engineId, engine] of Object.entries(engines)) {
      if (!engine || typeof engine !== "object") {
        errors.push({ field: `engines.${engineId}`, message: "Engine must be an object", code: "INVALID_TYPE" });
        continue;
      }
      const e = engine as Record<string, unknown>;
      for (const required of ["id", "label", "type", "status", "purpose"]) {
        if (!(required in e) || e[required] === undefined || e[required] === null) {
          errors.push({
            field: `engines.${engineId}.${required}`,
            message: `Required field "${required}" is missing`,
            code: "MISSING_REQUIRED_FIELD",
          });
        }
      }
    }
  } else if ("stages" in rec) {
    // Stage registry validation
    const stages = rec.stages as Record<string, unknown>;
    for (const [stageId, stage] of Object.entries(stages)) {
      if (!stage || typeof stage !== "object") {
        errors.push({ field: `stages.${stageId}`, message: "Stage must be an object", code: "INVALID_TYPE" });
        continue;
      }
      const s = stage as Record<string, unknown>;
      for (const required of ["id", "label", "description", "next_stages", "terminal"]) {
        if (!(required in s) || s[required] === undefined || s[required] === null) {
          errors.push({
            field: `stages.${stageId}.${required}`,
            message: `Required field "${required}" is missing`,
            code: "MISSING_REQUIRED_FIELD",
          });
        }
      }
    }
  } else if ("trace_config" in rec) {
    // Trace config validation
    const tc = rec.trace_config as Record<string, unknown>;
    for (const required of ["enabled", "storage_table", "span_types"]) {
      if (!(required in tc) || tc[required] === undefined) {
        errors.push({
          field: `trace_config.${required}`,
          message: `Required field "${required}" is missing`,
          code: "MISSING_REQUIRED_FIELD",
        });
      }
    }
  } else {
    warnings.push({ field: "root", message: "Could not detect registry type (no pipelines/engines/stages/trace_config key)" });
  }

  return { valid: errors.length === 0, name, errors, warnings };
}
