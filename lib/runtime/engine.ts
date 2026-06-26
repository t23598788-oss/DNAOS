/**
 * DNA OS Runtime Engine
 *
 * โหลด Registry → Resolve Module → Execute Command → Dispatch Event → คืน Result
 * ทุกการ resolve ผ่าน Registry เท่านั้น ห้ามค้นหาไฟล์เอง
 */

import {
  getModule, getDriver, getEvent, getSchema, getService,
  listModules, listDrivers, listEvents, isRegistered,
} from "@/lib/registry";

// ── Types ──

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

// ── Event Log ──

const eventLog: RuntimeEvent[] = [];
const MAX_EVENTS = 500;

function emitEvent(type: string, source: string, traceId: string, data?: unknown): RuntimeEvent {
  const event: RuntimeEvent = {
    id: uuid(),
    type,
    source,
    timestamp: new Date().toISOString(),
    traceId,
    data,
  };
  eventLog.push(event);
  if (eventLog.length > MAX_EVENTS) eventLog.shift();
  return event;
}

// ── Registry Loader (Criteria 1) ──

export function loadRegistry() {
  return {
    modules: listModules(),
    drivers: listDrivers(),
    events: listEvents(),
    loaded: true,
  };
}

// ── Module Resolver (Criteria 2) ──

export function resolveModule(moduleId: string): { found: boolean; module: unknown } {
  if (!isRegistered(moduleId)) {
    return { found: false, module: null };
  }
  return { found: true, module: getModule(moduleId) };
}

// ── Command Executor (Criteria 3) ──

export async function executeCommand(cmd: RuntimeCommand): Promise<RuntimeResult> {
  const traceId = cmd.traceId ?? uuid();
  const timestamp = new Date().toISOString();
  const events: RuntimeEvent[] = [];

  // Validate command
  if (!cmd.command || !cmd.version) {
    return { success: false, command: cmd.command ?? "", traceId, timestamp, source: "runtime", error: "missing command or version", events };
  }

  // Emit start event
  events.push(emitEvent("command.received", "runtime", traceId, { command: cmd.command }));

  // Resolve handler
  const handler = commandHandlers[cmd.command];
  if (!handler) {
    events.push(emitEvent("command.unknown", "runtime", traceId, { command: cmd.command }));
    return { success: false, command: cmd.command, traceId, timestamp, source: "runtime", error: `unknown command: ${cmd.command}`, events };
  }

  // Execute
  try {
    const result = await handler(cmd.args, traceId);
    events.push(emitEvent("command.completed", "runtime", traceId, { command: cmd.command, success: true }));
    return { success: true, command: cmd.command, traceId, timestamp, source: "runtime", data: result, events };
  } catch (e) {
    const error = (e as Error).message;
    events.push(emitEvent("command.failed", "runtime", traceId, { command: cmd.command, error }));
    return { success: false, command: cmd.command, traceId, timestamp, source: "runtime", error, events };
  }
}

// ── Event Dispatcher (Criteria 4) ──

export function dispatchEvent(type: string, source: string, data?: unknown, traceId?: string): RuntimeEvent {
  const registeredEvent = getEvent(type);
  const trace = traceId ?? uuid();
  const event = emitEvent(type, source, trace, data);
  return event;
}

export function getRecentEvents(count = 20): RuntimeEvent[] {
  return eventLog.slice(-count);
}

export function getEventsByTrace(traceId: string): RuntimeEvent[] {
  return eventLog.filter(e => e.traceId === traceId);
}

// ── Standard Result (Criteria 5) ──

export function createResult(success: boolean, command: string, traceId: string, data?: unknown, error?: string): RuntimeResult {
  return {
    success,
    command,
    traceId,
    timestamp: new Date().toISOString(),
    source: "runtime",
    data,
    error,
    events: getEventsByTrace(traceId),
  };
}

// ── Command Handlers ──

type CommandHandler = (args: Record<string, unknown>, traceId: string) => Promise<unknown>;

const commandHandlers: Record<string, CommandHandler> = {
  "registry.load": async () => loadRegistry(),
  "registry.resolve": async (args) => resolveModule(String(args.moduleId ?? "")),
  "registry.list_modules": async () => listModules(),
  "registry.list_drivers": async () => listDrivers(),
  "registry.list_events": async () => listEvents(),
  "registry.get_module": async (args) => getModule(String(args.moduleId ?? "")),
  "registry.get_driver": async (args) => getDriver(String(args.name ?? "")),
  "registry.get_service": async (args) => getService(String(args.name ?? "")),
  "registry.get_schema": async (args) => getSchema(String(args.name ?? "")),
  "events.recent": async (args) => getRecentEvents(Number(args.count ?? 20)),
  "events.by_trace": async (args) => getEventsByTrace(String(args.traceId ?? "")),
};

export function registerCommand(name: string, handler: CommandHandler): void {
  commandHandlers[name] = handler;
}

// ── UUID ──

function uuid(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}
