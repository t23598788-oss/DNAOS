/**
 * DNA OS Execution Registry — Loader
 * Static imports — works in all Next.js environments (SSR, SSG, Edge)
 * All JSON files are imported at build time; no dynamic file system reads.
 */

import type {
  PipelineDefinition,
  EngineDefinition,
  StageDefinition,
  TraceConfig,
  ExecutionManifest,
  ValidationResult,
} from "./_schema";
import { validateExecutionRegistry } from "./_validator";

import manifestRaw from "./_index.registry.json";
import pipelineRaw from "./pipeline.registry.json";
import enginesRaw from "./engines.registry.json";
import stagesRaw from "./stages.registry.json";
import traceRaw from "./trace.registry.json";

// ─── Internal Maps ───────────────────────────────────────────────────────────

const PIPELINE_MAP: Record<string, PipelineDefinition> = pipelineRaw.pipelines as unknown as Record<string, PipelineDefinition>;
const ENGINE_MAP: Record<string, EngineDefinition> = enginesRaw.engines as unknown as Record<string, EngineDefinition>;
const STAGE_MAP: Record<string, StageDefinition> = stagesRaw.stages as unknown as Record<string, StageDefinition>;

// ─── Pipeline Loaders ────────────────────────────────────────────────────────

/**
 * Load a pipeline definition by id.
 */
export function loadPipeline(id: string): PipelineDefinition | null {
  return PIPELINE_MAP[id] ?? null;
}

/**
 * List all registered pipeline ids.
 */
export function listPipelines(): string[] {
  return Object.keys(PIPELINE_MAP);
}

// ─── Engine Loaders ──────────────────────────────────────────────────────────

/**
 * Load an engine definition by id.
 */
export function loadEngine(id: string): EngineDefinition | null {
  return ENGINE_MAP[id] ?? null;
}

/**
 * List all registered engine ids.
 */
export function listEngines(): string[] {
  return Object.keys(ENGINE_MAP);
}

// ─── Stage Loaders ───────────────────────────────────────────────────────────

/**
 * Load a stage definition by id.
 */
export function loadStage(id: string): StageDefinition | null {
  return STAGE_MAP[id] ?? null;
}

/**
 * List all registered stage ids.
 */
export function listStages(): string[] {
  return Object.keys(STAGE_MAP);
}

// ─── Trace Config Loader ─────────────────────────────────────────────────────

/**
 * Load the execution trace configuration.
 */
export function loadTraceConfig(): TraceConfig {
  return traceRaw.trace_config as unknown as TraceConfig;
}

// ─── Manifest ────────────────────────────────────────────────────────────────

/**
 * Return the execution manifest (_index.registry.json).
 */
export function getExecutionManifest(): ExecutionManifest {
  return manifestRaw as unknown as ExecutionManifest;
}

// ─── Validate All ────────────────────────────────────────────────────────────

/**
 * Validate all loaded execution registries and return results.
 */
export function validateAllExecution(): ValidationResult[] {
  return [
    validateExecutionRegistry("pipeline", pipelineRaw),
    validateExecutionRegistry("engines", enginesRaw),
    validateExecutionRegistry("stages", stagesRaw),
    validateExecutionRegistry("trace_config", { trace_config: traceRaw.trace_config }),
  ];
}
