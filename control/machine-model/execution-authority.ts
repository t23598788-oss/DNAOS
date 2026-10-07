/**
 * หน้าที่: จำแนกว่าการลงมือแต่ละครั้งเกิดขึ้นโดยชอบธรรมจากอำนาจสายไหน
 *
 * ── Owner คือรากของอำนาจ ──
 * DNA OS ทำงานได้เฉพาะในขอบเขตที่ Owner มอบให้ ทรัพยากร ซอฟต์แวร์ AI ตัวแทน
 * บริการ เทสต์ และระบบภายนอก ไม่ใช่ผู้มีอำนาจสั่ง สิ่งเหล่านั้นเป็นผู้ถูกเรียก
 * ผู้ลงมือ หรือตัวกระตุ้น — ไม่มีเส้นทางใดในไฟล์นี้ที่สร้างอำนาจย้อนขึ้นจากการ
 * ถูกเรียกใช้
 *
 * ── เทสต์ต้องแยกออกจากสายอำนาจจริง ──
 * ตัวรันเทสต์ไม่ใช่ Owner และไม่ใช่ DNA OS การรันจากเทสต์จึงถูกจัดเป็น
 * `TEST_EXECUTION` ก่อนเงื่อนไขอื่นเสมอ เพื่อไม่ให้มันกลายเป็นหลักฐานว่าอะไร
 * ได้รับอนุญาตในการใช้งานจริง
 *
 * ── หนึ่งการลงมือ หนึ่งบริบทเท่านั้น ──
 * แถวหนึ่งถูกนับครั้งเดียว ลำดับการตัดสินประกาศไว้ใน `CLASSIFICATION_ORDER`
 * ผลรวมของทุกบริบทบวกกับที่สืบไม่ได้ ต้องเท่ากับจำนวนการลงมือที่สังเกตได้พอดี
 *
 * ── พิสูจน์ไม่ได้ ไม่ใช่ "น่าจะ" ──
 * แถวที่ตัวชี้ขาดจะได้ `UNTRACEABLE_EXECUTION_ORIGIN` ไม่ใช่ถูกเดาให้เข้าสักกล่อง
 *
 * Input: หลักฐานการรันที่มีอยู่ + ทะเบียนที่มีอยู่
 * Output: `classifyExecutions`, `authorityTraceOf`, `aiResourceModel`
 * Dependency ที่อนุญาต: ./invocation.ts, agent-gateway/owner-command/agent-registry (อ่าน)
 * สิ่งที่ห้ามแตะ: ห้ามสร้างสิทธิ์ต่อความสามารถ ห้ามเปิดประตู ห้าม dispatch ห้ามเขียน
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveOwnershipForPath } from "../owner-error-lane/contract";

const EVIDENCE = "control/agent-gateway/data/evidence.jsonl";
const TASKS = "control/agent-gateway/data/tasks.jsonl";
const HANDOFFS = "control/agent-gateway/data/handoffs.jsonl";
const ENVELOPES = "control/owner-command/data/envelopes.jsonl";
const AGENTS = "connections/agent-registry/data/agents.jsonl";

function readJsonl(rel: string): readonly Record<string, any>[] {
  const path = join(process.cwd(), rel);
  if (!existsSync(path)) return [];
  const out: Record<string, any>[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const s = line.trim();
    if (s.length === 0) continue;
    try { out.push(JSON.parse(s)); } catch { /* แถวเสียไม่ทำให้ทั้งชุดหาย */ }
  }
  return out;
}

export type ExecutionContext =
  | "OWNER_REQUEST"
  | "DNA_OS_INTERNAL_OPERATION"
  | "DNA_OS_DELEGATED_WORK"
  | "TEST_EXECUTION"
  | "EXTERNAL_INPUT_PROCESSING"
  | "UNTRACEABLE_EXECUTION_ORIGIN";

/** ลำดับการตัดสิน — ประกาศไว้ให้โต้แย้งได้ ไม่ใช่ผลข้างเคียงของโค้ด */
export const CLASSIFICATION_ORDER: readonly ExecutionContext[] = [
  "TEST_EXECUTION",              // แยกออกก่อนเสมอ ไม่ให้ปนกับอำนาจจริง
  "OWNER_REQUEST",               // มีซองคำสั่งของ Owner ผูกอยู่
  "DNA_OS_DELEGATED_WORK",       // DNA OS ตัดสินแล้วมอบงานให้ทรัพยากรที่มันจัดการ
  "DNA_OS_INTERNAL_OPERATION",   // DNA OS ลงมือเองภายใต้อำนาจที่ได้รับมอบ
  "EXTERNAL_INPUT_PROCESSING",   // สิ่งกระตุ้นจากภายนอกที่ผ่านการรับเข้า
  "UNTRACEABLE_EXECUTION_ORIGIN",
];

export interface AuthorityTrace {
  readonly root_authority: string | null;
  readonly delegated_authority: string | null;
  readonly dna_os_decision: string | null;
  readonly execution_scope: string | null;
  readonly execution_boundary: string | null;
  readonly executor_resource: string | null;
  readonly result_boundary: string | null;
  readonly verification_boundary: string | null;
}

export interface ExecutionRecord {
  readonly evidence_id: string;
  readonly capability_id: string;
  readonly task_id: string;
  readonly context: ExecutionContext;
  readonly basis: string;
  readonly trace: AuthorityTrace;
}

export interface ClassificationResult {
  readonly total: number;
  readonly counts: Readonly<Record<ExecutionContext, number>>;
  readonly records: readonly ExecutionRecord[];
  /** การรันจากเทสต์ที่ดันมีสายอำนาจจริงปนอยู่ — ต้องเป็นศูนย์ */
  readonly test_mixed_with_operational: number;
  readonly external_inputs_with_control_authority: number;
}

/** ผู้ส่งงานที่ประกาศตัวว่าเป็นตัวรันเทสต์ */
function isTestClient(client: string): boolean {
  return /(^|[-.])test($|[-.])|\.test\.ts$|^e2e|-test$|test-client|fixture/i.test(client);
}

const VERIFICATION_KINDS = new Set([
  "verification", "post_commit_verification", "post_commit_check",
  "test_verification", "contract_verification", "security_verification", "candidate_verification",
]);

let cache: ClassificationResult | null = null;

/**
 * จำแนกการลงมือทุกครั้งที่สังเกตได้ ทีละแถว
 *
 * นับจากแถวหลักฐานจริง ไม่ใช่จากจำนวนความสามารถ แถวที่ `source` ไม่ผูกกับ
 * ความสามารถใดในทะเบียน จะไม่เข้าชุดนี้ตั้งแต่แรก — เพราะมันไม่ใช่การลงมือของ
 * ความสามารถที่ระบบรู้จัก
 */
export function classifyExecutions(): ClassificationResult {
  if (cache !== null) return cache;

  const ownerTaskIds = new Set(readJsonl(ENVELOPES).map((e) => String(e.task_id)));
  const taskById = new Map(readJsonl(TASKS).map((t) => [String(t.task_id), t]));
  const handoffsByTask = new Map<string, Record<string, any>[]>();
  for (const h of readJsonl(HANDOFFS)) {
    const id = String(h.task_id);
    const list = handoffsByTask.get(id) ?? [];
    list.push(h);
    handoffsByTask.set(id, list);
  }
  const managedAgents = new Set(readJsonl(AGENTS).map((a) => String(a.provider)));

  // capability ของแต่ละ source — ถามทะเบียนครั้งเดียวต่อ path
  const capBySource = new Map<string, string | null>();
  const capabilityOf = (source: string): string | null => {
    const path = source.split("#")[0].split(" ")[0];
    if (!path.includes("/")) return null;
    if (capBySource.has(path)) return capBySource.get(path)!;
    const owned = resolveOwnershipForPath(path);
    capBySource.set(path, owned.capability_id);
    return owned.capability_id;
  };

  // verification ของแต่ละ task — ประกาศโดยผู้ผลิตหลักฐานเอง
  const verificationByTask = new Map<string, string[]>();
  const rows = readJsonl(EVIDENCE);
  for (const e of rows) {
    if (!VERIFICATION_KINDS.has(String(e.kind))) continue;
    const id = String(e.task_id);
    const list = verificationByTask.get(id) ?? [];
    list.push(String(e.kind));
    verificationByTask.set(id, list);
  }

  const records: ExecutionRecord[] = [];
  const counts: Record<ExecutionContext, number> = {
    OWNER_REQUEST: 0, DNA_OS_INTERNAL_OPERATION: 0, DNA_OS_DELEGATED_WORK: 0,
    TEST_EXECUTION: 0, EXTERNAL_INPUT_PROCESSING: 0, UNTRACEABLE_EXECUTION_ORIGIN: 0,
  };
  let testMixed = 0;
  let externalWithAuthority = 0;

  for (const e of rows) {
    const source = typeof e.source === "string" ? e.source : "";
    const capability = capabilityOf(source);
    if (capability === null) continue;      // ไม่ใช่การลงมือของความสามารถที่ทะเบียนรู้จัก

    const taskId = String(e.task_id ?? "");
    const task = taskById.get(taskId) ?? null;
    const client = typeof task?.submitted_by_client === "string" ? task.submitted_by_client : "";
    const handoffs = handoffsByTask.get(taskId) ?? [];
    const delegated = handoffs.filter((h) => managedAgents.has(String(h.agent_id))
      || String(h.agent_id).includes("claude") || String(h.agent_id).includes("codex"));

    const hasOwnerEnvelope = ownerTaskIds.has(taskId);

    let context: ExecutionContext;
    let basis: string;
    if (task !== null && isTestClient(client)) {
      context = "TEST_EXECUTION";
      basis = `tasks.submitted_by_client=${client}`;
      // ตัวรันเทสต์ไม่ใช่ Owner — ถ้ามันมีซองคำสั่งจริงปนอยู่ ต้องรายงาน
      if (hasOwnerEnvelope) testMixed += 1;
    } else if (hasOwnerEnvelope) {
      context = "OWNER_REQUEST";
      basis = `owner-command:envelopes.task_id=${taskId}`;
    } else if (delegated.length > 0) {
      context = "DNA_OS_DELEGATED_WORK";
      basis = `handoff.agent_id=${delegated[0].agent_id}`;
    } else if (client.startsWith("control/") || client === "command-router") {
      context = "DNA_OS_INTERNAL_OPERATION";
      basis = `tasks.submitted_by_client=${client}`;
    } else if (task !== null && client.length > 0) {
      // ผู้ส่งงานที่ประกาศตัวไว้ แต่ไม่ใช่ Owner ไม่ใช่ภายใน และไม่ใช่เทสต์
      context = "EXTERNAL_INPUT_PROCESSING";
      basis = `tasks.submitted_by_client=${client}`;
      // ตัวกระตุ้นภายนอกต้องไม่มีอำนาจสั่ง — วัด ไม่ใช่สมมติ
      if (hasOwnerEnvelope) externalWithAuthority += 1;
    } else {
      context = "UNTRACEABLE_EXECUTION_ORIGIN";
      basis = taskId.length === 0 ? "หลักฐานไม่มี task_id" : `task_id=${taskId} ไม่มีแถวในทะเบียนงาน`;
    }
    counts[context] += 1;

    const trace: AuthorityTrace = {
      // รากของอำนาจมีได้ค่าเดียว: Owner หรือไม่มีเลย
      root_authority: context === "OWNER_REQUEST" ? "OWNER"
        : context === "DNA_OS_INTERNAL_OPERATION" || context === "DNA_OS_DELEGATED_WORK" ? "OWNER_DELEGATED"
        : null,
      delegated_authority: context === "DNA_OS_DELEGATED_WORK" ? String(delegated[0]?.agent_id ?? "") : null,
      dna_os_decision: client.length > 0 ? client : null,
      execution_scope: typeof task?.output_lane === "string" ? task.output_lane : null,
      execution_boundary: source.length > 0 ? source : null,
      executor_resource: source.length > 0 ? source.split("#")[0] : null,
      result_boundary: typeof task?.output_lane === "string" ? task.output_lane : null,
      verification_boundary: (verificationByTask.get(taskId) ?? []).join(",") || null,
    };

    records.push({ evidence_id: String(e.evidence_id ?? ""), capability_id: capability,
      task_id: taskId, context, basis, trace });
  }

  cache = { total: records.length, counts, records,
    test_mixed_with_operational: testMixed,
    external_inputs_with_control_authority: externalWithAuthority };
  return cache;
}

/** สายอำนาจของการลงมือครั้งหนึ่ง */
export function authorityTraceOf(evidenceId: string): AuthorityTrace | null {
  return classifyExecutions().records.find((r) => r.evidence_id === evidenceId)?.trace ?? null;
}

// ─────────────────────────── AI ในฐานะทรัพยากรที่ถูกจัดการ ───────────────────────────

export interface AiResource {
  readonly ai_resource_id: string;
  readonly function_role: string | null;
  readonly local_or_remote: string | null;
  readonly execution_location: string | null;
  readonly allowed_input: string | null;
  readonly allowed_output: string | null;
  readonly visible_data_scope: string | null;
  readonly work_scope: readonly string[];
  readonly resource_requirements: string | null;
  readonly result_contract: string | null;
  readonly evidence: readonly string[];
  readonly current_state: string | null;
  /** ขอบเขตถูกจำกัดไว้จริงไหม — คำนวณจากคำประกาศ ไม่ใช่สมมติ */
  readonly scope_bounded: boolean;
  readonly has_global_system_authority: boolean;
  readonly missing_facts: readonly string[];
}

const UNBOUNDED_SCOPES = new Set(["*", "/", "", "ALL", "GLOBAL"]);

/**
 * AI/ตัวแทน อ่านจากทะเบียนที่ประกาศไว้แล้ว ไม่ใช่จากการไล่หาชื่อผู้ให้บริการ
 *
 * `has_global_system_authority` ถูกคำนวณจาก `permission_state` และขอบเขตพื้นที่
 * ทำงานที่ประกาศไว้ ไม่ได้ตั้งเป็นเท็จไว้ล่วงหน้า ถ้ามีตัวไหนประกาศขอบเขตแบบไม่จำกัด
 * มันจะโผล่ออกมาเอง
 */
export function aiResourceModel(): readonly AiResource[] {
  return readJsonl(AGENTS).map((a) => {
    const scope = typeof a.workspace_scope === "string" ? a.workspace_scope : null;
    const permission = typeof a.permission_state === "string" ? a.permission_state : null;
    const bounded = scope !== null && !UNBOUNDED_SCOPES.has(scope.trim())
      && permission !== null && permission !== "unrestricted";
    const missing: string[] = [];
    if (a.allowed_input === undefined) missing.push("ALLOWED_INPUT");
    if (a.allowed_output === undefined) missing.push("ALLOWED_OUTPUT");
    if (a.result_contract === undefined) missing.push("RESULT_CONTRACT");
    return {
      ai_resource_id: String(a.agent_id),
      function_role: typeof a.role === "string" ? a.role : null,
      local_or_remote: typeof a.transport === "string" ? a.transport : null,
      execution_location: scope,
      allowed_input: typeof a.allowed_input === "string" ? a.allowed_input : null,
      allowed_output: typeof a.allowed_output === "string" ? a.allowed_output : null,
      visible_data_scope: scope,
      work_scope: Array.isArray(a.capability) ? a.capability.map(String) : [],
      resource_requirements: typeof a.execution_worker_kind === "string" ? a.execution_worker_kind : null,
      result_contract: typeof a.result_contract === "string" ? a.result_contract : null,
      evidence: Array.isArray(a.execution_binding_evidence) ? a.execution_binding_evidence.map(String)
        : typeof a.execution_binding_evidence === "string" ? [a.execution_binding_evidence] : [],
      current_state: [a.health, a.availability, permission].filter((x) => typeof x === "string").join("/") || null,
      scope_bounded: bounded,
      // อำนาจทั้งระบบ = ขอบเขตไม่ถูกจำกัด ไม่ใช่ "เป็น AI"
      has_global_system_authority: !bounded && permission === "unrestricted",
      missing_facts: missing,
    };
  });
}

// ─────────────────────────── ช่องว่างของแบบจำลองอำนาจ ───────────────────────────

export interface AuthorityModelGap {
  readonly gap: string;
  readonly affected_executions: number;
  readonly canonical_authority: string;
  readonly required_fact: string;
}

/** สิ่งที่ยังพิสูจน์ไม่ได้ในสายอำนาจ พร้อมแหล่งที่ควรเป็นเจ้าของข้อเท็จจริงนั้น */
export function authorityModelGaps(result: ClassificationResult): readonly AuthorityModelGap[] {
  const gaps: AuthorityModelGap[] = [];
  const untraceable = result.counts.UNTRACEABLE_EXECUTION_ORIGIN;
  if (untraceable > 0) {
    gaps.push({ gap: "UNTRACEABLE_EXECUTION_ORIGIN", affected_executions: untraceable,
      canonical_authority: "control/agent-gateway/data/tasks.jsonl",
      required_fact: "หลักฐานการรันต้องมี task_id ที่ชี้ไปยังแถวงานที่มีอยู่จริง" });
  }
  const noScope = result.records.filter((r) => r.trace.execution_scope === null).length;
  if (noScope > 0) {
    gaps.push({ gap: "NO_EXECUTION_SCOPE", affected_executions: noScope,
      canonical_authority: "tasks.output_lane",
      required_fact: "งานทุกใบต้องประกาศช่องผลลัพธ์ของตัวเอง" });
  }
  const noVerification = result.records.filter((r) => r.trace.verification_boundary === null).length;
  if (noVerification > 0) {
    gaps.push({ gap: "NO_VERIFICATION_BOUNDARY", affected_executions: noVerification,
      canonical_authority: "agent-gateway:evidence.kind (ตระกูล verification)",
      required_fact: "การลงมือทุกครั้งต้องมีผู้ตรวจผลที่ประกาศไว้" });
  }
  const noRoot = result.records.filter((r) => r.trace.root_authority === null).length;
  if (noRoot > 0) {
    gaps.push({ gap: "NO_ROOT_AUTHORITY", affected_executions: noRoot,
      canonical_authority: "control/owner-command/data/envelopes.jsonl",
      required_fact: "การลงมือที่ไม่ใช่เทสต์ ต้องสืบกลับไปถึงคำขอของ Owner หรืออำนาจที่ Owner มอบไว้" });
  }
  return gaps;
}
