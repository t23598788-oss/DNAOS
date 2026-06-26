/**
 * Event Monitor
 *
 * ทุก Step ส่ง Event กลับ — started / progress / waiting / success / failed
 * พร้อม timestamp, capability, step, application, duration
 */

export type EventType = "started" | "progress" | "waiting" | "success" | "failed";

export interface ExecutionEvent {
  type: EventType;
  timestamp: number;
  capability: string;
  step: string;
  application: string;
  duration: number;
  data?: unknown;
  error?: string;
}

type EventListener = (event: ExecutionEvent) => void;

const listeners: EventListener[] = [];
const eventLog: ExecutionEvent[] = [];
const MAX_LOG = 500;

export function onEvent(listener: EventListener): () => void {
  listeners.push(listener);
  return () => {
    const idx = listeners.indexOf(listener);
    if (idx >= 0) listeners.splice(idx, 1);
  };
}

export function emit(event: ExecutionEvent): void {
  eventLog.push(event);
  if (eventLog.length > MAX_LOG) eventLog.shift();
  for (const fn of listeners) {
    try { fn(event); } catch { /* listener error ไม่ crash monitor */ }
  }
}

export function emitStarted(capability: string, step: string, app: string): number {
  const ts = Date.now();
  emit({ type: "started", timestamp: ts, capability, step, application: app, duration: 0 });
  return ts;
}

export function emitProgress(capability: string, step: string, app: string, startTs: number, data?: unknown): void {
  emit({ type: "progress", timestamp: Date.now(), capability, step, application: app, duration: Date.now() - startTs, data });
}

export function emitWaiting(capability: string, step: string, app: string, startTs: number): void {
  emit({ type: "waiting", timestamp: Date.now(), capability, step, application: app, duration: Date.now() - startTs });
}

export function emitSuccess(capability: string, step: string, app: string, startTs: number, data?: unknown): void {
  emit({ type: "success", timestamp: Date.now(), capability, step, application: app, duration: Date.now() - startTs, data });
}

export function emitFailed(capability: string, step: string, app: string, startTs: number, error: string): void {
  emit({ type: "failed", timestamp: Date.now(), capability, step, application: app, duration: Date.now() - startTs, error });
}

export function getRecentEvents(count: number = 50): ExecutionEvent[] {
  return eventLog.slice(-count);
}

export function getEventsByCapability(capability: string): ExecutionEvent[] {
  return eventLog.filter((e) => e.capability === capability);
}

export function clearEvents(): void {
  eventLog.length = 0;
}
