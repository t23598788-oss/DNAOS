import { submitTask } from "./gateway";
import type { AgentAdapter, MemoryReference, Task, WorkOrder } from "./types";
import { createCoordinationStore, type CoordinationStore } from "../work-coordination/coordination";

interface QueueItem { intentText: string; memory: Omit<MemoryReference, "task_id" | "created_at">; clientId: string; adapters: readonly AgentAdapter[]; workOrder?: WorkOrder; coordinationTaskId: string; resolve: (task: Task) => void; reject: (error: unknown) => void; }
export interface TaskControllerOptions { maxConcurrency?: number; coordination?: CoordinationStore; submit?: typeof submitTask; }

const configuredCapacity = Number(process.env.DNA_OS_MAX_CONCURRENCY);
const defaultMaxConcurrency = Number.isInteger(configuredCapacity) && configuredCapacity > 0 ? configuredCapacity : 1;
let activeController: TaskController | undefined;

function coordinationKey(memory: QueueItem["memory"], workOrder?: WorkOrder): string { return memory.conversation_id || (workOrder ? `work-order:${workOrder.target_path}:${workOrder.requested_change}` : `task:${crypto.randomUUID()}`); }

class TaskController {
  private readonly pending: QueueItem[] = [];
  private active = 0;
  private stopped = false;
  constructor(private readonly options: Required<Pick<TaskControllerOptions, "maxConcurrency" | "coordination" | "submit">>) {}
  enqueue(item: Omit<QueueItem, "coordinationTaskId" | "resolve" | "reject">): Promise<Task> {
    if (this.stopped) return Promise.reject(new Error("task controller is stopped"));
    return new Promise((resolve, reject) => { this.pending.push({ ...item, coordinationTaskId: coordinationKey(item.memory, item.workOrder), resolve, reject }); this.pump(); });
  }
  pump(): void {
    while (!this.stopped && this.active < this.options.maxConcurrency && this.pending.length) {
      const index = this.pending.findIndex((item) => this.admissible(item));
      if (index < 0) return;
      const item = this.pending.splice(index, 1)[0]; this.active++; void this.run(item).finally(() => { this.active--; this.pump(); });
    }
  }
  private admissible(item: QueueItem): boolean {
    const existing = this.options.coordination.items().find((x) => x.task_id === item.coordinationTaskId);
    if (existing?.status === "RUNNING") { this.options.coordination.ready(item.coordinationTaskId, { controller: "parallel-controller", pre_admitted: true }); return true; } // Input Gateway already acquired this same gate.
    if (existing?.status === "LOCKED") { this.options.coordination.ready(item.coordinationTaskId, { controller: "parallel-controller" }); return true; }
    const order = item.workOrder as (WorkOrder & { depends_on?: string[]; resource_lock?: string[]; target_files?: string[] }) | undefined;
    const reservation = this.options.coordination.enqueue({ command_id: item.coordinationTaskId, task_id: item.coordinationTaskId, idempotency_key: order ? `controller:${order.target_path}:${order.requested_change}` : item.coordinationTaskId, priority: 0, depends_on: order?.depends_on ?? [], resource_lock: order?.resource_lock ?? (order ? [order.target_path] : []), target_files: order?.target_files ?? (order ? [order.target_path] : []) });
    if (reservation.duplicate) return false;
    const lock = this.options.coordination.acquire(item.coordinationTaskId);
    if (!lock.ok) return false;
    this.options.coordination.ready(item.coordinationTaskId, { controller: "parallel-controller" }); return true;
  }
  private async run(item: QueueItem): Promise<void> {
    try {
      this.options.coordination.transition(item.coordinationTaskId, "RUNNING", { controller: "parallel-controller", dispatcher: "existing-controller" });
      this.options.coordination.markDispatched(item.coordinationTaskId, { dispatcher: "existing-controller" });
      const task = await this.options.submit(item.intentText, item.memory, item.clientId, item.adapters, item.workOrder);
      this.options.coordination.transition(item.coordinationTaskId, task.status === "COMPLETED" ? "COMPLETED" : task.status === "FAILED" || task.status === "BLOCKED" ? "FAILED" : "RUNNING", { dispatched_task_id: task.task_id, dispatcher_status: task.status });
      this.options.coordination.release(item.coordinationTaskId, { dispatched_task_id: task.task_id, evidence: "gateway task terminal state recorded" });
      item.resolve(task);
    } catch (error) {
      try { this.options.coordination.transition(item.coordinationTaskId, "FAILED", { error: error instanceof Error ? error.message : String(error) }); this.options.coordination.release(item.coordinationTaskId, { error: "dispatcher failure" }); } catch { /* preserve original failure */ }
      item.reject(error);
    }
  }
  stop(): void { this.stopped = true; const error = new Error("task controller stopped before dispatch"); while (this.pending.length) this.pending.shift()!.reject(error); }
  drain(): void { this.pump(); }
}

function getController(options: TaskControllerOptions = {}): TaskController {
  if (!activeController) activeController = new TaskController({ maxConcurrency: options.maxConcurrency ?? defaultMaxConcurrency, coordination: options.coordination ?? createCoordinationStore(), submit: options.submit ?? submitTask });
  return activeController;
}

export async function dispatchTask(intentText: string, memory: Omit<MemoryReference, "task_id" | "created_at">, clientId: string, adapters: readonly AgentAdapter[], workOrder?: WorkOrder): Promise<Task> {
  return getController().enqueue({ intentText, memory, clientId, adapters, workOrder });
}
export async function drainTaskQueue(): Promise<void> { getController().drain(); }
export function startTaskController(options: TaskControllerOptions = {}): { stop(): void; maxConcurrency: number } { const controller = new TaskController({ maxConcurrency: options.maxConcurrency ?? defaultMaxConcurrency, coordination: options.coordination ?? createCoordinationStore(), submit: options.submit ?? submitTask }); activeController = controller; controller.drain(); return { stop: () => controller.stop(), maxConcurrency: options.maxConcurrency ?? defaultMaxConcurrency }; }
