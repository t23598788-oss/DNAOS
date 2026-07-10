/**
 * DNA OS Execution Registry — Resolver
 * Resolution API — use these functions instead of importing JSON directly.
 * All consumers must go through the Registry, never access JSON files directly.
 */

import {
  loadPipeline,
  loadEngine,
  loadStage,
  loadTraceConfig,
  getExecutionManifest,
} from "./_loader";
import type {
  PipelineStep,
  EngineDefinition,
  StageDefinition,
  TraceConfig,
} from "./_schema";

// ─── Pipeline Resolvers ──────────────────────────────────────────────────────

/**
 * Returns the list of active pipeline ids from the manifest.
 */
export function resolveActivePipelines(): string[] {
  return getExecutionManifest().active_pipelines;
}

/**
 * Returns the default pipeline id from the manifest.
 */
export function resolveDefaultPipeline(): string | null {
  return getExecutionManifest().default_pipeline;
}

/**
 * Returns the steps array for the given pipeline id, or null if not found.
 */
export function resolvePipelineSteps(pipelineId: string): PipelineStep[] | null {
  return loadPipeline(pipelineId)?.steps ?? null;
}

/**
 * Returns true if the pipeline exists and has status ACTIVE.
 */
export function isPipelineActive(pipelineId: string): boolean {
  return loadPipeline(pipelineId)?.status === "ACTIVE";
}

// ─── Engine Resolvers ────────────────────────────────────────────────────────

/**
 * Resolve an engine definition by id.
 */
export function resolveEngine(engineId: string): EngineDefinition | null {
  return loadEngine(engineId);
}

/**
 * Returns true if the engine exists and has status ACTIVE.
 */
export function isEngineActive(engineId: string): boolean {
  return loadEngine(engineId)?.status === "ACTIVE";
}

/**
 * Look up the engine for a given step in a pipeline.
 * Returns the EngineDefinition if the step has an engine reference, otherwise null.
 */
export function getEngineForStep(pipelineId: string, stepId: string): EngineDefinition | null {
  const steps = resolvePipelineSteps(pipelineId);
  if (!steps) return null;
  const step = steps.find((s) => s.id === stepId);
  if (!step?.engine) return null;
  return loadEngine(step.engine);
}

// ─── Stage Resolvers ─────────────────────────────────────────────────────────

/**
 * Resolve a stage definition by id.
 */
export function resolveStage(stageId: string): StageDefinition | null {
  return loadStage(stageId);
}

/**
 * Returns the next_stages array for the given stage id.
 * Returns empty array if stage not found.
 */
export function resolveNextStages(stageId: string): string[] {
  return loadStage(stageId)?.next_stages ?? [];
}

// ─── Trace Config Resolver ───────────────────────────────────────────────────

/**
 * Resolve the execution trace configuration.
 */
export function resolveTraceConfig(): TraceConfig {
  return loadTraceConfig();
}
