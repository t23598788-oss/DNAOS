export interface Command {
  action: string;
  target?: string;
  payload?: any;
}

export interface CommandResult {
  ok: boolean;
  command: Command;
  data?: any;
  error?: string;
}

export type ViewMode = "json" | "table" | "text";
