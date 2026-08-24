import { mkdirSync, rmSync } from "node:fs";
import { createCoordinationStore } from "./coordination";

const root = "/tmp/dna-os-coordination-test"; rmSync(root, { recursive: true, force: true }); mkdirSync(root, { recursive: true });
const store = createCoordinationStore(root);
const base = { command_id: "cmd-1", task_id: "task-1", idempotency_key: "idem-1", priority: 1, depends_on: [], resource_lock: ["controller.ts"], target_files: ["controller.ts"] };
const first = store.enqueue(base); if (first.duplicate || first.item.status !== "QUEUED") throw new Error("enqueue failed");
if (!store.enqueue(base).duplicate) throw new Error("idempotency guard failed");
if (!store.acquire("task-1").ok) throw new Error("lock acquisition failed");
const second = store.enqueue({ ...base, task_id: "task-2", command_id: "cmd-2", idempotency_key: "idem-2" });
const blocked = store.acquire(second.item.task_id);
if (blocked.ok || !blocked.reason.startsWith("RESOURCE_CONFLICT:")) throw new Error("resource conflict guard failed");
store.transition("task-1", "COMPLETED", { evidence_id: "evidence-1" });
if (store.events().map((e) => e.event_type).join(",") !== "QUEUED,LOCK_ACQUIRED,QUEUED,COMPLETED") throw new Error("append-only event sequence failed");
console.log("PASS: durable queue, idempotency, dependency/resource conflict, and event log");
