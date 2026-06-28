/**
 * DNA OS Shared Types — Single Source of Truth
 * ทุก Layer import จากที่นี่เท่านั้น ห้ามสร้าง type ซ้ำในไฟล์อื่น
 */

// ── Command Types (V1-Input + UI) ──

export interface Command {
  action: string;
  target?: string;
  payload?: Record<string, unknown>;
}

export interface CommandResult {
  ok: boolean;
  command: Command;
  data?: unknown;
  error?: string;
}

export type ViewMode = "json" | "table" | "text";

// ── Runtime Types (Runtime Engine) ──

export interface RuntimeCommand {
  version: number;
  command: string;
  args: Record<string, unknown>;
  traceId?: string;
}

export interface RuntimeResult {
  success: boolean;
  command: string;
  traceId: string;
  timestamp: string;
  source: string;
  data?: unknown;
  error?: string;
  events: RuntimeEvent[];
}

export interface RuntimeEvent {
  id: string;
  type: string;
  source: string;
  timestamp: string;
  traceId: string;
  data?: unknown;
}

// ── Workflow Types ──

export type AppStatus = "running" | "focused" | "background" | "closed";

export interface StepResult {
  ok: boolean;
  step: string;
  app: string;
  data?: unknown;
  error?: string;
  durationMs: number;
}

export interface WorkflowResult {
  ok: boolean;
  workflow: string;
  app: string;
  steps: { step: string; status: string; durationMs: number; data?: unknown; error?: string }[];
  totalMs: number;
  error?: string;
}

export interface AppDriver {
  appName: string;
  bundleId: string;
  launch(): Promise<StepResult>;
  focus(): Promise<StepResult>;
  close(): Promise<StepResult>;
  search(query: string): Promise<StepResult>;
  click(target: string): Promise<StepResult>;
  type(text: string): Promise<StepResult>;
  read(): Promise<StepResult>;
  status(): Promise<AppStatus>;
}

export interface CommandMatch {
  workflow: string;
  args: Record<string, string>;
}

export interface CommandEntry {
  patterns: string[];
  workflow: string;
  app?: string;
}

export interface WorkflowDef {
  steps: string[];
  confirm: boolean;
}

export interface AuditEntry {
  id: number;
  workflow: string;
  app: string;
  step: string;
  result: "success" | "failed";
  durationMs: number;
  timestamp: number;
  error?: string;
}

// ── Debt Types ──

export type DebtStatus =
  | "ACTIVE_CREDIT"
  | "WAIT_PAYMENT"
  | "OVERDUE"
  | "DEBT"
  | "COLLECTION"
  | "PARTIAL_PAYMENT"
  | "CLOSED";

// ── Audit Types ──

export interface AuditTrail {
  engine: string;
  inputs: Record<string, unknown>;
  rules_used: Record<string, unknown>;
  result: Record<string, unknown>;
  calculated_at: string;
}

// ── Utility ──

export function round(n: number): number {
  return Math.round(n * 100) / 100;
}
