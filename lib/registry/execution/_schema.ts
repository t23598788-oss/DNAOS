/**
 * DNA OS Execution Registry — TypeScript Contract
 * Schema interfaces for pipeline, engine, stage, and trace configuration
 */

export type ExecutionStatus = "ACTIVE" | "DISABLED" | "DEPRECATED" | "UNKNOWN";
export type EngineType = "ai_extraction" | "ai_translation" | "rule_engine" | "database" | "external_api" | "internal";
export type StageStatus = "PENDING" | "RUNNING" | "DONE" | "SKIPPED" | "ERROR";

export interface PipelineStep {
  id: string;
  label: string;
  engine?: string;       // references engines.registry.json key
  policy_gate?: string;  // lifecycle key that must be ACTIVE to run this step
  input_from?: string;   // id of previous step
  output_to?: string;    // table or next step
  timeout_ms?: number;
  status: ExecutionStatus;
  note?: string;
}

export interface PipelineDefinition {
  id: string;
  name: string;
  channel: string;       // "line", "email", etc.
  trigger: string;       // what triggers this pipeline
  steps: PipelineStep[];
  status: ExecutionStatus;
  policy: {
    allow_partial: boolean;
    stop_on_error: boolean;
    retry_count: number;
  };
}

export interface EngineDefinition {
  id: string;
  label: string;
  type: EngineType;
  model?: string;         // for AI engines
  env_key?: string;       // env var for API key
  endpoint?: string;      // API endpoint if applicable
  status: ExecutionStatus;
  purpose: string;
  used_by: string[];      // pipeline step ids that use this engine
  cost_per_call?: string;
}

export interface StageDefinition {
  id: string;
  label: string;
  description: string;
  next_stages: string[];
  terminal: boolean;
  timeout_ms?: number;
  on_timeout?: string;   // next stage if timeout
}

export interface TraceConfig {
  enabled: boolean;
  storage_table: string | null;
  span_types: string[];
  include_payload: boolean;
  sampling_rate: number;  // 0.0-1.0
  retention_days: number | null;
}

export interface ExecutionManifest {
  version: number;
  last_updated: string;
  registries: Record<string, { file: string; status: ExecutionStatus; description: string }>;
  active_pipelines: string[];
  default_pipeline: string | null;
}

export interface ValidationResult {
  valid: boolean;
  name: string;
  errors: Array<{ field: string; message: string; code: string }>;
  warnings: Array<{ field: string; message: string }>;
}
