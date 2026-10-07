import { rmSync } from "node:fs";
import { createCoordinationStore } from "../../work-coordination/coordination";
import { startTaskController } from "../controller";
import type { AgentAdapter, Task, WorkOrder } from "../types";

const root = "/tmp/dna-os-parallel-controller-test"; rmSync(root, { recursive: true, force: true });
const coordination = createCoordinationStore(root); const intervals: Record<string, { start: number; end: number }> = {};
const adapter = {} as AgentAdapter; const order = (path: string, extra: Partial<WorkOrder> = {}): WorkOrder => ({ operation: "CREATE", target_type: "FILE", target_path: path, requested_change: "sandbox probe", content: "probe", workspace_scope: "tests/__sandbox__/", mode: "sandbox", required_tests: ["sandbox.write"], forbidden_files: [], evidence: [], ...extra });
const submit = async (intent: string, memory: any, client: string, adapters: readonly AgentAdapter[], workOrder?: WorkOrder): Promise<Task> => { const key = workOrder?.target_path ?? intent; intervals[key] = { start: Date.now(), end: 0 }; await new Promise((resolve) => setTimeout(resolve, 80)); intervals[key].end = Date.now(); return { task_id: `task-${key.replace(/[^a-z0-9]/gi, "-")}`, memory: { ...memory, task_id: `task-${key}`, created_at: new Date().toISOString() }, intent_text: intent, submitted_by_client: client, status: "COMPLETED", created_at: new Date().toISOString(), updated_at: new Date().toISOString(), work_order: workOrder }; };
async function main(): Promise<void> {
  const ctl = startTaskController({ maxConcurrency: 2, coordination, submit });
  const independent = await Promise.all([ctlTask("ind-a.txt"), ctlTask("ind-b.txt")]);
  if (!(intervals["tests/__sandbox__/ind-a.txt"].start < intervals["tests/__sandbox__/ind-b.txt"].end && intervals["tests/__sandbox__/ind-b.txt"].start < intervals["tests/__sandbox__/ind-a.txt"].end)) throw new Error("independent tasks did not overlap");
  await Promise.all([ctlTask("same.txt"), ctlTask("same.txt", "conflict")]);
  const events = coordination.events().map((e) => e.event_type); if (!events.includes("LOCK_RELEASED") || !events.includes("DISPATCHED")) throw new Error("missing dispatch or lock release event");
  ctl.stop(); console.log(JSON.stringify({ parallel: "PASS", independent_task_ids: independent.map((x) => x.task_id), overlap_ms: Math.min(intervals["tests/__sandbox__/ind-a.txt"].end, intervals["tests/__sandbox__/ind-b.txt"].end) - Math.max(intervals["tests/__sandbox__/ind-a.txt"].start, intervals["tests/__sandbox__/ind-b.txt"].start), event_trace: events }));
}
main().catch((error) => { console.error(error); process.exitCode = 1; });

function ctlTask(file: string, suffix = ""): Promise<Task> { return (globalThis as any).__controllerDispatch?.(file, suffix) ?? dispatch(file, suffix); }
async function dispatch(file: string, suffix: string): Promise<Task> { const mod = await import("../controller"); return mod.dispatchTask(`ตรวจ ${file}${suffix}`, { user_id: "test", workspace_id: "test", conversation_id: `cmd-${file}-${suffix}-${Date.now()}-${Math.random()}`, parent_task_id: null }, "parallel-test", [adapter], order(`tests/__sandbox__/${file}`)); }
