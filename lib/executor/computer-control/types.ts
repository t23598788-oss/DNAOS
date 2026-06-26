/**
 * DNA OS V6 — Computer Control Layer Types
 *
 * ทุก action ที่สั่ง macOS ต้องมี status กลับมา
 * ทุกขั้นตอนต้อง observable
 */

export type ActionStatus =
  | "running"
  | "waiting"
  | "success"
  | "failed"
  | "retry"
  | "cancelled";

export interface ActionResult {
  status: ActionStatus;
  action: string;
  target?: string;
  currentWindow?: string;
  currentApp?: string;
  durationMs: number;
  result?: unknown;
  error?: string;
}

export interface DeviceAction {
  type: "device";
  command:
    | "launch"
    | "activate"
    | "close"
    | "focus_window"
    | "switch_window"
    | "minimize"
    | "maximize";
  app: string;
  windowIndex?: number;
}

export interface KeyboardAction {
  type: "keyboard";
  command:
    | "type_text"
    | "paste_text"
    | "press_key"
    | "press_shortcut"
    | "key_combination"
    | "hold_key"
    | "release_key"
    | "submit"
    | "escape"
    | "tab";
  text?: string;
  key?: string;
  modifiers?: MacModifier[];
}

export type MacModifier = "command" | "option" | "control" | "shift" | "fn";

export interface MouseAction {
  type: "mouse";
  command:
    | "move"
    | "click"
    | "double_click"
    | "right_click"
    | "drag"
    | "drop"
    | "scroll"
    | "hover";
  x?: number;
  y?: number;
  toX?: number;
  toY?: number;
  scrollDirection?: "up" | "down" | "left" | "right";
  scrollAmount?: number;
}

export interface ScreenAction {
  type: "screen";
  command:
    | "read_window_list"
    | "read_active_window"
    | "capture_screenshot"
    | "read_window_title"
    | "read_app_state"
    | "wait_window_exists"
    | "wait_ui_change";
  app?: string;
  windowName?: string;
  savePath?: string;
  timeoutMs?: number;
}

export interface ClipboardAction {
  type: "clipboard";
  command: "copy" | "paste" | "store" | "restore" | "transfer";
  text?: string;
  sourceApp?: string;
  targetApp?: string;
}

export type ComputerAction =
  | DeviceAction
  | KeyboardAction
  | MouseAction
  | ScreenAction
  | ClipboardAction;

export interface QueuedAction {
  id: string;
  action: ComputerAction;
  status: ActionStatus;
  result?: ActionResult;
  retryCount: number;
  maxRetries: number;
  timeoutMs: number;
}

export type ExecutionMode =
  | "sequential"
  | "conditional"
  | "parallel";

export interface ExecutionStep {
  mode: ExecutionMode;
  actions: ComputerAction[];
  condition?: (prev: ActionResult) => boolean;
  onFail?: "retry" | "rollback" | "skip" | "abort";
  maxRetries?: number;
  timeoutMs?: number;
}

export interface ExecutionPlan {
  id: string;
  name: string;
  steps: ExecutionStep[];
  createdAt: number;
  status: ActionStatus;
  results: ActionResult[];
}

export interface AppController {
  appName: string;
  bundleId: string;
  actions: Record<string, (args: Record<string, unknown>) => Promise<ActionResult>>;
}

export interface WindowInfo {
  app: string;
  title: string;
  index: number;
  position?: { x: number; y: number };
  size?: { width: number; height: number };
  minimized?: boolean;
}
