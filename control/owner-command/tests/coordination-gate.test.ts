import { rmSync } from "node:fs";
import { createCoordinationStore } from "../../work-coordination/coordination";

const root = "/tmp/dna-os-coordination-gate-test"; rmSync(root, { recursive: true, force: true });
const store = createCoordinationStore(root);
const input = { command_id: "cmd-gate", task_id: "cmd-gate", idempotency_key: "idem-gate", priority: 0, depends_on: [], resource_lock: ["tests/__sandbox__/gate.txt"], target_files: ["tests/__sandbox__/gate.txt"] };
const queued = store.enqueue(input); if (queued.duplicate) throw new Error("real Work Order was not queued");
const locked = store.acquire(input.task_id); if (!locked.ok) throw new Error(`real Work Order was not locked: ${locked.reason}`);
const duplicate = store.enqueue(input); if (!duplicate.duplicate) throw new Error("duplicate Work Order was not blocked");
const conflict = store.enqueue({ ...input, command_id: "cmd-conflict", task_id: "cmd-conflict", idempotency_key: "idem-conflict" });
const blocked = store.acquire(conflict.item.task_id); if (blocked.ok || !blocked.reason.startsWith("RESOURCE_CONFLICT:")) throw new Error("resource conflict was not blocked");
console.log(JSON.stringify({ gate: "PASS", queued: queued.item.task_id, lock: locked.item.status, duplicate: duplicate.duplicate, conflict: blocked.reason, events: store.events().map((event) => event.event_type) }));
