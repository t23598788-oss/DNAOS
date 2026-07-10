/**
 * DNA OS Runtime Engine
 *
 * โหลด Registry → Resolve Module → Execute Command → Dispatch Event → คืน Result
 * ทุกการ resolve ผ่าน Registry เท่านั้น ห้ามค้นหาไฟล์เอง
 */

import {
  getModule, getDriver, getEvent, getSchema, getService,
  listModules, listDrivers, listEvents, isRegistered,
} from "@/registry";
import type { RuntimeCommand, RuntimeResult, RuntimeEvent } from "@/core/shared/types";
import { startTrace, addStep, completeTrace, getTrace, getRecentTraces, replayTrace } from "@/core/runtime/trace";

export type { RuntimeCommand, RuntimeResult, RuntimeEvent };

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
  const traceStart = Date.now();

  // Start audit trace
  startTrace(traceId, cmd.command ?? "unknown");

  // Validate command
  if (!cmd.command || !cmd.version) {
    addStep(traceId, { layer: "runtime", module: "engine", action: "validate", input: { command: cmd.command, version: cmd.version }, duration_ms: Date.now() - traceStart, error: "missing command or version" });
    completeTrace(traceId, "failed");
    return { success: false, command: cmd.command ?? "", traceId, timestamp, source: "runtime", error: "missing command or version", events };
  }

  // Emit start event
  events.push(emitEvent("command.received", "runtime", traceId, { command: cmd.command }));
  addStep(traceId, { layer: "runtime", module: "engine", action: "command.received", input: { command: cmd.command, args: cmd.args }, duration_ms: Date.now() - traceStart });

  // Resolve handler
  const resolveStart = Date.now();
  const handler = commandHandlers[cmd.command];
  if (!handler) {
    events.push(emitEvent("command.unknown", "runtime", traceId, { command: cmd.command }));
    addStep(traceId, { layer: "runtime", module: "engine", action: "resolve.handler", input: { command: cmd.command }, duration_ms: Date.now() - resolveStart, error: `unknown command: ${cmd.command}` });
    completeTrace(traceId, "failed");
    return { success: false, command: cmd.command, traceId, timestamp, source: "runtime", error: `unknown command: ${cmd.command}`, events };
  }

  addStep(traceId, { layer: "runtime", module: "engine", action: "resolve.handler", input: { command: cmd.command }, duration_ms: Date.now() - resolveStart });

  // Execute
  const execStart = Date.now();
  try {
    const result = await handler(cmd.args, traceId);
    events.push(emitEvent("command.completed", "runtime", traceId, { command: cmd.command, success: true }));
    addStep(traceId, { layer: "runtime", module: "engine", action: "execute", input: cmd.args, output: result != null ? { result: typeof result === "object" ? result as Record<string, unknown> : { value: result } } : undefined, duration_ms: Date.now() - execStart });
    completeTrace(traceId, "completed");
    return { success: true, command: cmd.command, traceId, timestamp, source: "runtime", data: result, events };
  } catch (e) {
    const error = (e as Error).message;
    events.push(emitEvent("command.failed", "runtime", traceId, { command: cmd.command, error }));
    addStep(traceId, { layer: "runtime", module: "engine", action: "execute", input: cmd.args, duration_ms: Date.now() - execStart, error });
    completeTrace(traceId, "failed");
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
  "trace.get": async (args) => getTrace(String(args.traceId ?? "")),
  "trace.recent": async (args) => getRecentTraces(Number(args.count ?? 20)),
  "trace.replay": async (args) => replayTrace(String(args.traceId ?? "")),
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
