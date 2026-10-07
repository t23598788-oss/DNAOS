/**
 * หน้าที่: the contract for the multi-agent registry (Owner, 2026-08-20
 * MULTI-AGENT SANDBOX CONTROL). Tracks which external coding-agent
 * surfaces (Codex, Claude Code, Gemini, Kimi, Copilot) are actually
 * reachable on this machine — never assumes, always detects. Plugs into
 * the EXISTING `control/agent-gateway/` Controller/WorkOrder/handoff
 * pipeline (../../control/agent-gateway/handoff.ts's `HandoffRecord`
 * already carries `agent_id`/`role`) — this is not a second router.
 *
 * Input: none (pure type definitions).
 * Output: AgentRegistration, Availability, SandboxScopeCheck.
 * Dependency ที่อนุญาต: none — leaf contract.
 * สิ่งที่ห้ามแตะ: never add a "force_live" or "assume_available" field —
 * availability is always the output of a real check in ./detect.ts, never
 * a caller-supplied claim.
 */

export type AgentProvider = "codex" | "claude-code" | "gemini" | "kimi" | "copilot";

/**
 * runtime ที่ registration นี้ได้รับความไว้วางใจให้ "เป็นเจ้าของผล" เมื่อระบบ
 * ปล่อยงานผ่าน `control/agent-host/` — ค่าตรงกับ
 * `control/agent-host/worker-registry.ts#WorkerKind` ตัวต่อตัว
 *
 * ทำไมไม่ใช่ `provider`: provider คือ "นี่คือ agent เจ้าไหน" ส่วนค่านี้คือ
 * "registration นี้รับผิดชอบผลจากการรัน runtime ตัวไหน" — registration หนึ่ง
 * อาจไม่ใช่ execution principal เลยก็ได้ ซึ่งเป็นกรณีปกติ
 */
export type ExecutionWorkerKind = "CLAUDE" | "CODEX" | "GEMINI" | "LOCAL";

export type Availability = "LIVE" | "IDLE" | "WAITING_LOGIN" | "BLOCKED" | "UNKNOWN";

export type AgentRole = "inspect_test" | "code_review_build" | "research_review";

export interface AgentRegistration {
  agent_id: string;
  provider: AgentProvider;
  role: AgentRole;
  /** What this agent answers today — same convention as control/agent-gateway/types.ts's Capability.problem_type. */
  capability: string[];
  transport: "local_process" | "cli" | "extension_host" | "unknown";
  workspace_scope: string;
  permission_state: "not_evaluated" | "sandbox_only" | "denied";
  health: "OK" | "DEGRADED" | "UNREACHABLE";
  last_seen: string;
  availability: Availability;
  /** Free-text description of exactly what real check produced this availability — same "mechanism" discipline as connections/telemetry/collector.ts. Never "assumed"/"trusted". */
  detection_mechanism: string;
  /**
   * ADDITIVE (Owner, BIND_EXECUTION_WORKER_TO_TRUSTED_AGENT_PRINCIPAL).
   *
   * `null`/absent = registration นี้ **ไม่ใช่** execution principal — เป็นค่า
   * เริ่มต้นและเป็นความหมายของทุกแถวที่ถูกบันทึกก่อนวันที่เพิ่มฟิลด์นี้ แถวเดิม
   * ทั้งหมดจึงคงความหมายเดิมไว้ทุกประการ ไม่มีการตีความย้อนหลัง โดยเฉพาะ
   * registration ของ `claude-code` ซึ่ง `./detect.ts` นิยามไว้ว่าเป็น "โปรเซส
   * Claude Code ที่กำลังคุมเครื่องอยู่" — มันจะไม่กลายเป็นการอนุญาตให้
   * subprocess CLAUDE ตัวใดก็ได้ เพราะฟิลด์นี้ไม่ถูกเซ็ต
   *
   * เมื่อมีค่า `registerAgent` จะตรวจว่า executable ของ runtime นั้น resolve
   * ได้จริงบนเครื่องนี้ก่อนบันทึก (ไม่ใช่คำประกาศของผู้เรียก)
   */
  execution_worker_kind?: ExecutionWorkerKind | null;
  /** หลักฐานเชิงเครื่องว่าการผูก runtime ด้านบนถูกตรวจด้วยอะไร — null เมื่อไม่ใช่ execution principal */
  execution_binding_evidence?: string | null;
}

export interface SandboxScopeCheck {
  ok: boolean;
  reason: string;
}

/**
 * Roles allowed per provider (Owner, 2026-08-20): Codex =
 * inspect/test only; Claude Code = code review/build; Gemini/Kimi/Copilot
 * = research/review ONLY, and only when their own live provider check AND
 * permission_state pass — never given a build/inspect role even if a
 * caller asks.
 */
export const ALLOWED_ROLES_BY_PROVIDER: Record<AgentProvider, readonly AgentRole[]> = {
  codex: ["inspect_test"],
  "claude-code": ["code_review_build"],
  gemini: ["research_review"],
  kimi: ["research_review"],
  copilot: ["research_review"],
};
