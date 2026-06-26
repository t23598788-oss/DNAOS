/**
 * Shared Types — Browser + Node ใช้ร่วมกันได้
 * ห้ามมี import จาก runtime/
 */

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
