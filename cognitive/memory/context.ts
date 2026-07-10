/**
 * DNA OS Cognitive Layer — Module 2: CONTEXT ENGINE
 *
 * จำสถานะปัจจุบัน — กำลังทำอะไร กับใคร ถึงขั้นตอนไหน
 *
 * ข้อมูลเข้า:
 *   - goal_output จาก Goal Engine
 *   - executor_results จาก Executor (feedback loop)
 *
 * ข้อมูลออก:
 *   - context ที่อัปเดตแล้ว
 *
 * กฎ:
 *   - is_continuation = true → เก็บ who เดิม เพิ่ม what ใหม่
 *   - is_continuation = false → ล้าง context สร้างใหม่
 *   - executor ส่ง who_id กลับมา → จำไว้ ไม่ต้องหาอีก
 */

// ── Types ──

export interface Context {
  who: string | null;
  who_id: string | null;
  who_source: string | null;
  what: string | null;
  stage: string;
  history: string[];
  workspace_data: Record<string, unknown>;
  updated_at: number;
}

export interface GoalOutput {
  goal: string;
  entities: {
    who?: string;
    what?: string;
    action?: string;
    detail?: string;
  };
  is_continuation: boolean;
  is_general: boolean;
}

export interface ExecutorResult {
  tool: string;
  success: boolean;
  data: any;
  resolved_id?: string;
  resolved_name?: string;
  resolved_source?: string;
}

// ── Empty Context ──

function empty(): Context {
  return {
    who: null,
    who_id: null,
    who_source: null,
    what: null,
    stage: "idle",
    history: [],
    workspace_data: {},
    updated_at: Date.now(),
  };
}

// ── Context Engine ──

let _current: Context = empty();

export function get(): Readonly<Context> {
  return { ..._current };
}

export function clear(): Context {
  _current = empty();
  return get();
}

export function updateFromGoal(goal: GoalOutput): Context {
  if (goal.is_general) {
    return get();
  }

  if (!goal.is_continuation) {
    _current = empty();
  }

  if (goal.entities.who) {
    _current.who = goal.entities.who;
    _current.who_id = null;
    _current.who_source = null;
  }

  if (goal.entities.what) {
    _current.what = goal.entities.what;
  }

  if (goal.entities.action) {
    const entry = `${goal.entities.action}:${goal.entities.what ?? _current.what ?? ""}`;
    _current.history.push(entry);
  }

  _current.stage = resolveStage(goal);
  _current.updated_at = Date.now();

  return get();
}

export function updateFromExecutor(results: ExecutorResult[]): Context {
  for (const r of results) {
    if (!r.success) continue;

    if (r.resolved_id && !_current.who_id) {
      _current.who_id = r.resolved_id;
      _current.who_source = r.resolved_source ?? r.tool;
      if (r.resolved_name) {
        _current.who = r.resolved_name;
      }
    }

    if (r.data && typeof r.data === "object") {
      _current.workspace_data[r.tool] = r.data;
    }

    _current.history.push(`executed:${r.tool}`);
  }

  _current.stage = advanceStage(_current.stage, results);
  _current.updated_at = Date.now();

  return get();
}

export function hasWho(): boolean {
  return _current.who !== null;
}

export function hasWhoId(): boolean {
  return _current.who_id !== null;
}

export function isSameSubject(name: string): boolean {
  if (!_current.who) return false;
  const current = _current.who.toLowerCase();
  const incoming = name.toLowerCase().replace(/^คุณ\s*/, "").trim();
  return current.includes(incoming) || incoming.includes(current);
}

export function isStale(): boolean {
  const fiveMinutes = 5 * 60 * 1000;
  return Date.now() - _current.updated_at > fiveMinutes;
}

// ── Stage Resolution ──

function resolveStage(goal: GoalOutput): string {
  const action = goal.entities.action;

  if (!action) return "viewing";

  switch (action) {
    case "ดู":
    case "หา":
    case "ค้นหา":
      return "viewing";
    case "สร้าง":
    case "ออก":
      return "creating";
    case "แก้":
    case "เปลี่ยน":
      return "editing";
    case "ลบ":
      return "deleting";
    default:
      return "viewing";
  }
}

function advanceStage(current: string, results: ExecutorResult[]): string {
  const hasIdentity = results.some(r => r.tool === "identity.resolve" && r.success);
  const hasData = results.some(r => r.success && r.tool !== "identity.resolve");

  if (current === "viewing") {
    if (hasIdentity && hasData) return "reviewing";
    if (hasIdentity) return "identified";
  }

  if (current === "creating") {
    const created = results.some(r => r.tool.includes("create") && r.success);
    if (created) return "created";
  }

  if (current === "deleting") {
    const deleted = results.some(r => r.tool.includes("delete") && r.success);
    if (deleted) return "deleted";
  }

  return current;
}
