import { selectAssignableWorkers } from "../worker-capacity-resolver";
import type { SessionRegistryEntry } from "../session-registry";

const entry = (overrides: Partial<SessionRegistryEntry>): SessionRegistryEntry => ({ agent_id: "agent", provider: "codex", runtime_id: "pid:1", session_id: "session-1", process_id: 1, capabilities: ["inspect"], current_task_id: null, current_work_order_id: null, status: "IDLE", started_at: null, last_activity_at: new Date().toISOString(), waiting_for_confirmation: false, blocker: null, files_in_use: [], safe_to_assign: true, heartbeat: new Date().toISOString(), ...overrides });
const selected = selectAssignableWorkers([entry({ agent_id: "ready-1" }), entry({ agent_id: "busy", status: "RUNNING" }), entry({ agent_id: "unsafe", safe_to_assign: false }), entry({ agent_id: "other", capabilities: ["review"] })], "inspect");
if (selected.length !== 1 || selected[0].agent_id !== "ready-1") throw new Error("capacity resolver selected an ineligible worker");
console.log("PASS: capacity resolver requires IDLE + safe_to_assign + exact capability");
