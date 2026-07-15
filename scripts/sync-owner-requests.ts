/**
 * Runtime Demand Synchronization (MISSION, registry/CHANGELOG.json DNA-000042).
 *
 * Connects registry/existence.json#owner_requests to registry/TASK_QUEUE.json,
 * per the real gap found and reported in the immediately preceding turn:
 * OR-001 existed with no corresponding task anywhere. Reuses both existing
 * structures — no new registry, no new task schema, just a real field
 * (owner_request_ref) linking task entries back to the request that produced
 * them, and reused conventions (id numbering, priority scheme) already
 * present in TASK_QUEUE.json.
 *
 * Two directions, both real, both idempotent:
 *   1. open owner_request with no linked task -> create one (items 1-6 of the mission)
 *   2. linked task now done, owner_request still open -> close the owner_request
 *      and note it in registry/existence.json (item 8 of the mission)
 * Never deletes anything. Never silently overwrites a human-edited task.
 */
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

const ROOT = join(__dirname, "..");
const TASK_QUEUE_PATH = join(ROOT, "registry/TASK_QUEUE.json");
const EXISTENCE_PATH = join(ROOT, "registry/existence.json");

function readJSON<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf-8"));
}
function writeJSON(path: string, data: unknown) {
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

interface Task {
  id: string;
  title: string;
  priority: string;
  status: string;
  detail: string;
  owner_request_ref?: string;
  blocked_on?: string;
  context_sources?: string[];
  [key: string]: unknown;
}

interface OwnerRequest {
  id: string;
  category: string;
  reason: string;
  evidence: string;
  priority: string;
  impact: string;
  suggested_resolution: string;
  owner_approval_required: boolean;
  status: string;
  runtime_task_ref?: string;
  [key: string]: unknown;
}

const DONE_STATUSES = new Set(["done", "DONE", "resolved", "complete", "completed"]);

function nextTaskId(tasks: Task[]): string {
  const max = Math.max(0, ...tasks.map((t) => parseInt(t.id.replace("TASK-", ""), 10) || 0));
  return `TASK-${String(max + 1).padStart(3, "0")}`;
}

function main() {
  const tasks = readJSON<Task[]>(TASK_QUEUE_PATH);
  const existence = readJSON<any>(EXISTENCE_PATH);
  const requests: OwnerRequest[] = existence.owner_requests?.requests ?? [];

  let created = 0;
  let closed = 0;

  // Direction 1: open owner_request with no linked task -> create one.
  for (const req of requests) {
    if (req.status !== "open") continue;
    const alreadyLinked = tasks.some((t) => t.owner_request_ref === req.id);
    if (alreadyLinked) continue;

    const id = nextTaskId(tasks);
    const task: Task = {
      id,
      title: `[Runtime Demand] ${req.category}: ${req.reason.slice(0, 100)}${req.reason.length > 100 ? "..." : ""}`,
      priority: req.priority,
      status: req.owner_approval_required ? "blocked_owner_approval" : "open",
      detail: `Auto-created from registry/existence.json#owner_requests.${req.id} by scripts/sync-owner-requests.ts (Runtime Demand Synchronization, DNA-000042). Reason: ${req.reason} Impact: ${req.impact} Suggested resolution: ${req.suggested_resolution}`,
      owner_request_ref: req.id,
      blocked_on: req.owner_approval_required ? "Owner approval required per registry/existence.json#owner_requests." + req.id : undefined,
      context_sources: [req.evidence],
    };
    tasks.push(task);
    req.runtime_task_ref = id;
    created++;
    console.log(`+ Created ${id} from ${req.id}`);
  }

  // Direction 2: linked task now done, owner_request still open -> close it.
  for (const req of requests) {
    if (req.status !== "open" || !req.runtime_task_ref) continue;
    const linkedTask = tasks.find((t) => t.id === req.runtime_task_ref);
    if (linkedTask && DONE_STATUSES.has(linkedTask.status)) {
      req.status = "resolved";
      req.resolved_note = `Closed by scripts/sync-owner-requests.ts because linked task ${linkedTask.id} reached status "${linkedTask.status}".`;
      closed++;
      console.log(`~ Closed ${req.id} (linked task ${linkedTask.id} is done)`);
    }
  }

  writeJSON(TASK_QUEUE_PATH, tasks);
  writeJSON(EXISTENCE_PATH, existence);

  console.log(`\nRuntime Demand Sync complete: +${created} task(s) created, ~${closed} owner_request(s) closed.`);
}

main();
