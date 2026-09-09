/**
 * หน้าที่: the Owner's one command surface — turns Owner intent text into
 * a `CommandEnvelope`, hands it to `../command-router/`'s
 * `routeOwnerCommand` (the only capability boundary it is allowed to
 * cross), tracks the resulting `CommandLifecycleState`
 * (`../command-status/lifecycle.ts`), and renders the combined
 * `OwnerSurfaceState`. Never scans files, never reasons about permissions
 * itself, never executes a shell command, never touches a business DB —
 * matches ./README.md's stated boundary and this round's Owner spec
 * verbatim (`OWNER → owner-command → command-router → capability →
 * result → owner-command → OWNER`).
 *
 * Input: Owner command text + the Owner's `EnvelopeIdentity`
 * (`kind: "human"` — asserted, not trusted from elsewhere), optionally an
 * explicit multi-worker plan / execution-policy context to pass through
 * to the router unchanged.
 * Output: `OwnerSurfaceState` (see ./types.ts), the underlying
 * `CommandLifecycleState` for anything that wants the raw history,
 * `output_contract` — the SYSTEM_STATE/WORK_ITEM Output Contract lane
 * (`../../contracts/command/output-contract.ts`) this result belongs to
 * — and `output_routing` — which REGISTERED consumer(s), if any, claimed
 * it (`../output-routing/contract.ts`; never a hardcoded/guessed
 * destination).
 * Dependency ที่อนุญาต: `../../contracts/command/`,
 * `../command-router/contract.ts`, `../command-status/lifecycle.ts`,
 * `../output-routing/contract.ts`, `./types.ts`, `./host-runtime.ts`.
 * สิ่งที่ห้ามแตะ: never call `../command-router/router.ts` or
 * `../command-router/capability-registry.ts` directly — only
 * `../command-router/contract.ts`. Never let `issued_by.kind` be anything
 * other than `"human"` here — a non-human caller does not come through
 * this folder (matches ./README.md's own stated boundary).
 *
 * NOT_YET_BUILT: no runtime transport (CLI/HTTP/etc.) wires Owner input
 * into `submitOwnerCommand` yet — see ./tests/owner-command.test.ts,
 * which drives this module directly by hand.
 */

import type { CommandEnvelope } from "../../contracts/command/command-envelope";
import type { EnvelopeIdentity } from "../../contracts/identity/envelope-identity";
import type { CapabilityResult } from "../../contracts/command/capability-result";
import type { DnaOsOutput } from "../../contracts/command/output-contract";
import { classifyCommand, classifyOutput, listCapabilities, routeOwnerCommand } from "../command-router/contract";
import { recordCommandTaskId, recordOwnerVisibleResult, resolveOwnerCommandSemantics, type SemanticDeps } from "../owner-command-semantics/contract";
import { requiredCapabilitiesFor, selectResourcesFor, recordResolution } from "../resource-selection/contract";
import { resolveEntryContext } from "../entry-context/contract";
import { resolveOutputConsumers } from "../output-routing/contract";
import { recordCommandLineage } from "./input-gateway";
import { loadAllTasks, loadEvidenceForTask, ownerDecision, DEFAULT_AGENT_WORKERS } from "../agent-gateway/contract";
import type { Task } from "../agent-gateway/contract";
import type { OutputRoutingResult } from "../output-routing/contract";
import type { RouteOptions } from "../command-router/contract";
import type { CommandLifecycleStage, CommandLifecycleState } from "../command-status/lifecycle";
import { hostNowIso, hostRandomId } from "./host-runtime";
import type { OwnerCapabilityStatus, OwnerSurfaceState } from "./types";
import {
  fingerprintOwnerAction,
  isCanonicalWorkId,
  isTerminalWorkStatus,
  latestWorkForIdentity,
  rememberLatestWork,
  resolveCanonicalWorkId,
  workStatusFromCapability,
  type CanonicalWorkPointer,
} from "./work-identity";

function pushStage(state: CommandLifecycleState, stage: CommandLifecycleStage, note?: string): void {
  state.stage = stage;
  state.history.push({ stage, at: hostNowIso(), note });
}

/**
 * Builds the command's lifecycle strictly along `LEGAL_TRANSITIONS`
 * (`../command-status/lifecycle.ts`) — never skips `evidenced` before
 * `responded`, and a policy stop (`BLOCKED`/`OWNER_REVIEW`) always ends at
 * `rejected` with the router's own reason as the note, never fabricated
 * as a success.
 */
function deriveLifecycle(commandId: string, result: CapabilityResult): CommandLifecycleState {
  const state: CommandLifecycleState = { command_id: commandId, stage: "received", history: [{ stage: "received", at: hostNowIso() }] };

  pushStage(state, "authenticated");
  pushStage(state, "authorized");
  pushStage(state, "classified");

  if (result.status === "BLOCKED" || result.status === "OWNER_REVIEW") {
    pushStage(state, "rejected", result.summary);
    return state;
  }

  pushStage(state, "routed");
  pushStage(state, "executing");

  if (result.status === "PENDING" || result.status === "RUNNING") {
    return state; // still in flight — no responded/rejected yet
  }
  if (result.status === "FAILED") {
    pushStage(state, "failed", result.summary);
    pushStage(state, "responded");
    return state;
  }

  // COMPLETED
  pushStage(state, "evidenced", `${result.evidence.length} evidence item(s) recorded before responding`);
  pushStage(state, "responded");
  return state;
}

function toProgress(stage: CommandLifecycleStage): OwnerSurfaceState["progress"] {
  if (stage === "responded" || stage === "rejected") return "DONE";
  if (stage === "received") return "PENDING";
  return "IN_PROGRESS";
}

function availableCapabilities(): readonly OwnerCapabilityStatus[] {
  return listCapabilities().map((cap) => ({
    capability_id: cap.capability_id,
    status: cap.endpoint.kind === "not_yet_built" ? "BLOCKED" : cap.health_status === "CONNECTED" ? "EXECUTABLE" : "REGISTERED",
    connected: cap.health_status === "CONNECTED",
  }));
}

/** How the semantic layer is run for this submission. `enabled: false` is for suites that must not spawn a model — the pre-2026-08-26 behavior, unchanged. */
export interface SemanticOptions {
  enabled?: boolean;
  deps?: SemanticDeps;
}

export interface SubmitOwnerCommandOutcome {
  envelope: CommandEnvelope;
  lifecycle: CommandLifecycleState;
  result: CapabilityResult;
  surface: OwnerSurfaceState;
  /** SYSTEM_STATE (read straight by a UI, no AI mediation) or WORK_ITEM (dispatched to a Worker/Agent, comes back only through DNA OS's own Verify/Register/Next Decision path) — see ../../contracts/command/output-contract.ts. */
  output_contract: DnaOsOutput;
  /** Which REGISTERED consumer(s) — if any — claimed this output's lane+capability_id. Never a guessed destination — see ../output-routing/. */
  output_routing: OutputRoutingResult;
  /**
   * ตัวตนของงานที่คำสั่งนี้เปิดขึ้น — namespace เดียวกับ control/owner-backbone
   * (`work-<uuid>`) ที่ /owner/events?work_id= และ eventsForWork ใช้อยู่แล้ว
   *
   * มีเสมอสำหรับคำสั่งที่ถูกรับ ไม่ว่าผลจะเป็น BLOCKED หรือไม่ — การมี work_id
   * ไม่ได้แปลว่างานได้รับอนุญาต มีขอบเขต หรือมี baseline แล้ว ทั้งสามยังไม่ถูก
   * ผูกในสไลซ์นี้ และงานอาจถูกบล็อกทันที
   */
  work_id: string;
}

/**
 * The single public entry point of `control/owner-command/`. Builds the
 * envelope, routes it, tracks lifecycle, and returns the rendered
 * surface — one call, one Owner-visible task, regardless of how many
 * capabilities it took to answer.
 */
/**
 * งานของเจ้าของคนนี้ที่ค้างรอคำตอบอยู่ ถ้ามี (Owner, USE_EXISTING_CONTINUATION_MODEL ข้อ 5)
 *
 * ตัวเชื่อมระหว่าง "คำตอบ" กับ "คำถาม" ไม่ใช่สโตร์ใหม่ แต่เป็นสถานะที่ระบบมีอยู่แล้ว:
 * งานที่ status เป็น WAITING_OWNER_DECISION คืองานที่ถามแล้วยังไม่ได้คำตอบ
 * และเป็นสถานะเดียวที่ `ownerDecision()` ยอมรับ
 *
 * tasks.jsonl เป็น append-only ดังนั้นแถวหลังสุดของ task_id หนึ่งคือสถานะปัจจุบัน
 * — ต้องยุบก่อนกรอง ไม่งั้นงานที่ถูกตอบไปแล้วจะยังโผล่มาเป็นค้างอยู่
 */
export function findOpenOwnerQuestion(identityId: string): Task | null {
  const latest = new Map<string, Task>();
  for (const task of loadAllTasks()) latest.set(task.task_id, task);
  const hasDescendant = (taskId: string): boolean => [...latest.values()].some((candidate) => candidate.memory.parent_task_id === taskId);
  const open = [...latest.values()].filter(
    (t) => t.status === "WAITING_OWNER_DECISION"
      && t.memory.user_id === identityId
      && !hasDescendant(t.task_id)
      && agentActuallyAsked(t),
  );
  return open.sort((a, b) => a.updated_at.localeCompare(b.updated_at)).at(-1) ?? null;
}

/**
 * "งานรอเจ้าของ" กับ "Agent ถามคำถาม" ไม่ใช่สิ่งเดียวกัน และการรวมสองอย่างนี้
 * เข้าด้วยกันคือบั๊กจริงที่เจอตอนรัน: งานค้างจาก 2026-08-24 ที่ `next_action`
 * เป็นสตริงสถานะ ("OWNER_REVIEW") ถูกนับเป็นคำถามค้าง แล้วข้อความแรกของ Owner
 * ก็ถูกกลืนไปเป็น "คำตอบ" ของงานที่เขาไม่เคยเห็น
 *
 * เกณฑ์ที่ตรวจได้จริง: ต้องมี Agent พูดออกมาจริงในงานนั้น — evidence ที่ Agent
 * Host บันทึกไว้ด้วย source `#agent-message` ไม่ใช่แค่ router สรุปสถานะ
 * ไม่ใช้กรอบเวลาเพราะเวลาเป็นการเดา ส่วนคำพูดของ Agent เป็นหลักฐาน
 */
function agentActuallyAsked(task: Task): boolean {
  if (typeof task.next_action !== "string" || task.next_action.trim() === "") return false;
  // "agent" = คำที่ Agent พูดเอง, "decision-engine" = คำถามที่คำนวณจาก evidence จริง
  // งานค้างเก่าที่ `next_action` เป็นแค่สตริงสถานะไม่มีสองแหล่งนี้ จึงไม่ถูกนับ
  return loadEvidenceForTask(task.task_id).some((e) => e.source === "agent" || e.source === "decision-engine" || e.source.endsWith("#agent-message"));
}

/**
 * ข้อความตั้งต้นจริงของสายงานนี้ — ตัดรอบถาม/ตอบก่อนหน้าออก
 *
 * ถ้าไม่ตัด ข้อความจะซ้อนตัวเองทุกครั้งที่ตอบ (เจอจากการรันจริง) จนคำสั่งเดิม
 * จมอยู่ใต้ประวัติของตัวเอง สายเลือดที่ตามกลับได้อยู่ที่ `parent_task_id` แล้ว
 * ไม่จำเป็นต้องแบกไว้ในข้อความด้วย
 */
function rootIntentOf(intentText: string): string {
  const marker = intentText.indexOf("\n\n[คำถามก่อนหน้า:");
  return marker === -1 ? intentText : intentText.slice(0, marker);
}

/** ปฏิเสธเท่านั้นที่ทำให้งานหยุด — ทุกคำตอบอื่นคือ "ทำต่อ" พร้อมคำตอบนั้นติดไปด้วย */
function isRefusal(text: string): boolean {
  return /^(ไม่|ยกเลิก|หยุด|no\b|cancel|stop|abort)/i.test(text.trim());
}

function workIdForPendingTask(task: Task, identityId: string): string | null {
  const fromTask = task.route_context?.work_id;
  if (isCanonicalWorkId(fromTask)) return fromTask;
  const latest = latestWorkForIdentity(identityId);
  return latest && isCanonicalWorkId(latest.work_id) ? latest.work_id : null;
}

function replayCapabilityResult(pointer: CanonicalWorkPointer | null, workId: string): CapabilityResult {
  const status = pointer
    ? pointer.status === "completed" ? "COMPLETED"
      : pointer.status === "failed" ? "FAILED"
        : pointer.status === "waiting_owner" ? "OWNER_REVIEW"
          : pointer.status === "started" || pointer.status === "created" ? "RUNNING"
            : "BLOCKED"
    : "BLOCKED";
  return {
    task_id: pointer?.task_id ?? "(none)",
    capability_id: pointer?.capability_id ?? "owner-command",
    status,
    summary: pointer?.summary ?? `canonical work ${workId}`,
    evidence: [{ source: "control/owner-command/work-identity.ts", note: `reused_work_id=${workId}` }],
    artifacts: [{ kind: "work_id", ref: workId }],
    warnings: [],
    next_action: status === "OWNER_REVIEW" ? "OWNER_REVIEW" : null,
  };
}

function persistLatestWork(input: {
  readonly identity_id: string;
  readonly work_id: string;
  readonly command_id: string;
  readonly fingerprint: string;
  readonly status: CanonicalWorkPointer["status"];
  readonly execution_stage?: string;
  readonly result?: CapabilityResult | null;
}): void {
  rememberLatestWork({
    identity_id: input.identity_id,
    work_id: input.work_id,
    command_id: input.command_id,
    task_id: input.result?.task_id && input.result.task_id !== "(none)" ? input.result.task_id : null,
    status: input.status,
    action_fingerprint: input.fingerprint,
    summary: input.result?.summary ?? null,
    capability_id: input.result?.capability_id ?? null,
    execution_stage: input.execution_stage ?? input.status,
    updated_at: hostNowIso(),
  });
}

function executionStageFromResult(result: CapabilityResult): string {
  const notes = result.evidence.map((row) => row.note).join("\n");
  if (notes.includes("github_publish_status=VERIFIED")) return "github_publish_verified";
  if (notes.includes("github_publish_status=BLOCKED")) return "github_publish_blocked";
  if (notes.includes("engineering_status=VERIFIED") || notes.includes("engineering_status=COMPLETED")) return "engineering_verified";
  if (notes.includes("coding_write_applied=true")) return "build_test";
  if (notes.includes("engineering_status=")) return "engineering_execution";
  return result.status.toLowerCase();
}

export async function submitOwnerCommand(commandText: string, ownerIdentity: EnvelopeIdentity, options: RouteOptions = {}, semanticOptions: SemanticOptions = {}): Promise<SubmitOwnerCommandOutcome> {
  if (ownerIdentity.kind !== "human") {
    throw new Error(`control/owner-command/ only accepts issued_by.kind "human", got "${ownerIdentity.kind}"`);
  }

  /**
   * OWNER REPLY (Owner, USE_EXISTING_CONTINUATION_MODEL ข้อ 5)
   *
   * ถ้ามีงานของเจ้าของคนนี้ค้างรอคำตอบอยู่ ข้อความนี้คือ "คำตอบ" ไม่ใช่คำสั่งใหม่
   * ประตูที่รับคำตอบมีอยู่แล้วคือ `ownerDecision()` ซึ่งบันทึกการอนุมัติเป็น evidence
   * ก่อนทำอะไรต่อ และเป็นทางเดียวที่ WAITING_OWNER_DECISION ออกจากสถานะรอได้
   *
   * จากนั้นงานต่อถูกสร้างด้วย `parent_task_id` ของงานเดิม — สายเลือดเดียวกับที่
   * corrective loop ใช้อยู่แล้ว ไม่ใช่ระบบ continuation ตัวที่สอง โปรเซส Agent
   * เป็นคนละตัวแน่นอน (one-shot เหมือนเดิมทุกประการ) แต่บริบทไม่หาย เพราะคำสั่ง
   * เดิมและคำตอบของเจ้าของถูกส่งเข้าไปด้วยกัน
   *
   * `parentTaskId` ที่ส่งต่อทำให้ recursion นี้จบแน่นอน: `ownerDecision` ย้ายงานเดิม
   * ออกจากสถานะรอไปแล้ว รอบถัดไปจึงหา pending ตัวเดิมไม่เจออีก
   */
  const pending = findOpenOwnerQuestion(ownerIdentity.identity_id);
  if (pending) {
    const refused = isRefusal(commandText);
    await ownerDecision(pending.task_id, refused ? "ไม่ทำ" : "ทำ", DEFAULT_AGENT_WORKERS);
    if (!refused) {
      const rootIntent = rootIntentOf(pending.intent_text);
      const continuationText = `${rootIntent}\n\n[คำถามก่อนหน้า: ${pending.next_action}]\n[คำตอบของ Owner: ${commandText}]`;
      /**
       * งานต่อต้องไปที่ capability เดิม ไม่ใช่ให้จำแนกข้อความที่ยาวขึ้นใหม่
       *
       * เจอจากการรันจริง: พอเอาคำถามกับคำตอบต่อท้ายเข้าไป ข้อความรวมไปชนคำของ
       * capability อื่น (คำว่า "dispatch" ในคำถาม) การจำแนกจึงกำกวมและงานต่อ
       * ไปไม่ถึง Agent เลย — ทั้งที่คำสั่งตั้งต้นชัดเจนอยู่แล้ว
       *
       * จึงจำแนกจาก "คำสั่งตั้งต้น" ซึ่งเป็นสิ่งที่ Owner พูดจริง แล้วส่งข้อความ
       * เต็ม (พร้อมคำถามและคำตอบ) เป็น intent ของ step นั้น ผ่าน `steps` ที่
       * RouteOptions มีอยู่แล้ว ไม่ได้แก้ keyword และไม่ได้เพิ่มตัวจำแนกใหม่
       */
      const rooted = classifyCommand(rootIntent);
      const pendingWorkId = workIdForPendingTask(pending, ownerIdentity.identity_id);
      const continuationOptions: RouteOptions = rooted.status === "MATCHED"
        ? { ...options, parentTaskId: pending.task_id, work_id: pendingWorkId ?? options.work_id, steps: [{ capability_id: rooted.capability.capability_id, intent: continuationText, payload: {} }] }
        : { ...options, parentTaskId: pending.task_id, work_id: pendingWorkId ?? options.work_id };
      return submitOwnerCommand(continuationText, ownerIdentity, continuationOptions, semanticOptions);
    }
  }

  const existingPointer = latestWorkForIdentity(ownerIdentity.identity_id);
  const resolution = resolveCanonicalWorkId({
    identity_id: ownerIdentity.identity_id,
    command_text: commandText,
    requested_work_id: options.work_id ?? null,
  });
  const workId = resolution.work_id;
  const actionFingerprint = resolution.continuation || resolution.status_query
    ? (existingPointer?.action_fingerprint ?? fingerprintOwnerAction(commandText))
    : fingerprintOwnerAction(commandText);

  const envelope: CommandEnvelope = {
    command_id: `cmd_${hostRandomId()}`,
    issued_by: ownerIdentity,
    intent: commandText,
    payload: { ...(options.envelope_payload ?? {}), canonical_work_id: workId },
    issued_at: hostNowIso(),
  };

  // SEMANTIC RESOLUTION (Owner, 2026-08-26) — sits here, between this
  // envelope and ../entry-context/, because this is the first point where a
  // real command_id exists and the last point before the router is asked to
  // do anything. The model only labels the Owner's words; every id below was
  // proven by ../owner-command-semantics/resolver.ts against a real registry.
  //
  // Fail-open by design: if the model process cannot run (not installed, no
  // weights, sandbox refused), the command still goes through on exactly the
  // path it took before this layer existed. A translation aid must never be
  // the reason an Owner command cannot be issued.
  let routeOptions = options;
  const semantics = semanticOptions.enabled === false
    ? undefined
    : resolveOwnerCommandSemantics(envelope.command_id, commandText, { identity_id: ownerIdentity.identity_id, kind: ownerIdentity.kind }, semanticOptions.deps ?? {});

  /**
   * RESOURCE RESOLUTION (Owner, 2026-09-05) — อยู่ตรงนี้เพราะที่นี่คือจุดแรกที่
   * เจตนาถูก resolve แล้ว และเป็นจุดสุดท้ายก่อนขอให้ router ลงมือ
   *
   * ลำดับเป็นข้อบังคับ ไม่ใช่ธรรมเนียม: ถ้า `semantics.ok` ไม่จริง บล็อกนี้ไม่ทำงาน
   * เลย จึงไม่มีการค้นทะเบียน ไม่มีการเลือกทรัพยากร และไม่มีการเตรียม tool
   * ล่วงหน้า — ตรงตามข้อ 2 ที่ห้ามเตรียมเครื่องมือก่อนเข้าใจคำสั่ง
   *
   * ตัวเลือกทรัพยากรเป็นของ DNA OS: ความสามารถที่ต้องใช้มาจากตารางใน
   * ../resource-selection/intent-capabilities.ts และตัวทรัพยากรมาจากทะเบียนกลาง
   * ไม่มีจุดใดที่ Agent หรือโมเดลเป็นผู้เลือก
   *
   * บล็อกนี้ไม่เรียกทรัพยากรใด ๆ มันบันทึกว่า "ต้องใช้อะไร และมีอะไร" เท่านั้น
   * การเรียก connector จริงยังทำจากฝั่ง DNA OS ไม่ได้ เพราะ connector เหล่านี้
   * เข้าถึงผ่าน MCP client ที่ถือ OAuth ของ Owner ซึ่ง DNA OS ไม่มีเส้นทางถึง
   * (ตรวจแล้ว 2026-09-05: connections/dna-os-mcp/ เป็น MCP server ไม่ใช่ client)
   * จึงบันทึกเป็น BLOCKED:NO_CREDENTIAL_PATH ไม่ใช่แกล้งว่าเรียกสำเร็จ
   */
  if (semantics && semantics.ok) {
    try {
      const need = requiredCapabilitiesFor(commandText);
      if (need.status === "RESOLVED") {
        const selection = selectResourcesFor(need.required_capabilities);
        recordResolution({
          selection_id: `sel_${hostRandomId()}`,
          command_id: envelope.command_id,
          work_id: workId,
          intent_status: "RESOLVED",
          required_capabilities: need.required_capabilities,
          selected_resources: selection.selected.map((r) => ({
            resource_id: r.resource_id, capability_id: r.capability, canonical_name: r.resource_name,
            access_method: "CONNECTOR",
            reason_selected: `ทะเบียนกลางประกาศความสามารถ "${r.capability}" ไว้ที่ทรัพยากรนี้ และสถานะยัง REGISTERED`,
          })),
          unresolved_capabilities: selection.missing,
          executions: selection.selected.map((r) => ({
            resource_execution_id: `rex_${hostRandomId()}`,
            resource_id: r.resource_id, capability_id: r.capability, tool_name: r.capability,
            started_at: hostNowIso(), finished_at: hostNowIso(), duration_ms: 0,
            status: "BLOCKED" as const, read_write_class: "READ_ONLY",
            result_summary: null, error_code: "NO_CREDENTIAL_PATH",
          })),
          agent_invoked: false,
          recorded_at: hostNowIso(),
        });
      }
    } catch { /* การหาทรัพยากรล้มต้องไม่ทำให้คำสั่งของ Owner ออกไม่ได้ */ }

    let context = semantics.context;

    // Requirement 6/7: ../entry-context/ is called for real, with the real
    // registered command_id this command resolved to — never the literal
    // "unknown" a caller used to hand in. Only when a descriptor actually
    // matched; an unproven command_id would defeat the point.
    //
    // The call is recorded in `source_trace` rather than left to be inferred:
    // "the entry context ran" is a claim about runtime, and a reader of the
    // resulting payload should be able to see it happened without reading
    // this file.
    if (context.policy_command_id && options.executionRequestBase) {
      const resolution = resolveEntryContext({
        identity_id: options.executionRequestBase.identity_id,
        account_id: options.executionRequestBase.account_id,
        workspace_id: options.executionRequestBase.workspace_id,
        command_id: context.policy_command_id,
      });
      routeOptions = { ...options, executionPolicyContext: resolution.context };
      context = {
        ...context,
        source_trace: [
          ...context.source_trace,
          {
            field: "execution_policy_context",
            provenance: "RUNTIME",
            detail: `control/entry-context/contract.ts#resolveEntryContext command_id=${context.policy_command_id} identity_resolved=${resolution.context.identity !== undefined} account_resolved=${resolution.account !== undefined} workspace_resolved=${resolution.workspace !== undefined} memberships=${resolution.context.memberships.length}`,
          },
        ],
      };
    }

    // Requirement 8/9: the router no longer receives a bare string. The
    // structured context rides on the envelope's own payload, which
    // ../command-router/ already forwards verbatim into every RouterStep.
    envelope.payload = { ...(options.envelope_payload ?? {}), structured_owner_context: context, canonical_work_id: workId };
  }

  recordCommandLineage({
    command_id: envelope.command_id, work_id: workId, task_id: null,
    stage: "command_received",
    detail: `control/owner-command/owner-command.ts#submitOwnerCommand identity=${ownerIdentity.identity_id} reused=${resolution.reused} duplicate_action=${resolution.duplicate_action} continuation=${resolution.continuation}`,
  });

  const pointerForReplay = existingPointer && existingPointer.work_id === workId ? existingPointer : latestWorkForIdentity(ownerIdentity.identity_id);
  const skipDispatch = resolution.status_query
    || (resolution.duplicate_action && pointerForReplay !== null && pointerForReplay.work_id === workId && isTerminalWorkStatus(pointerForReplay.status));

  if (!resolution.reused) {
    persistLatestWork({ identity_id: ownerIdentity.identity_id, work_id: workId, command_id: envelope.command_id, fingerprint: actionFingerprint, status: "created" });
  }
  if (!skipDispatch) {
    persistLatestWork({ identity_id: ownerIdentity.identity_id, work_id: workId, command_id: envelope.command_id, fingerprint: actionFingerprint, status: "started" });
  }

  const result = skipDispatch
    ? replayCapabilityResult(pointerForReplay, workId)
    : await routeOwnerCommand(envelope, commandText, { ...routeOptions, work_id: workId });
  const lifecycle = deriveLifecycle(envelope.command_id, result);

  persistLatestWork({
    identity_id: ownerIdentity.identity_id,
    work_id: workId,
    command_id: envelope.command_id,
    fingerprint: actionFingerprint,
    status: workStatusFromCapability(result.status),
    execution_stage: executionStageFromResult(result),
    result,
  });

  // ผูก task เข้ากับ work ทันทีที่ task มีตัวตนจริง — ไม่เขียนค่าแทนก่อนหน้านั้น
  recordCommandLineage({
    command_id: envelope.command_id, work_id: workId, task_id: result.task_id ?? null,
    // ขั้นมาจากผลของ capability จริง ไม่ใช่จาก lifecycle stage (คนละคำศัพท์)
    stage: result.status === "BLOCKED" ? "blocked" : result.status === "FAILED" ? "failed" : "admitted",
    detail: `routed capability=${result.capability_id} status=${result.status}`,
  });

  // Closes the STATE read loop: the next command by this identity can ask
  // ../agent-gateway/ what actually became of this one. Recorded only when
  // routing produced a real task_id — never a placeholder, and never before
  // the task exists.
  // `result.task_id` is the Owner-visible task the router admitted — see
  // contracts/command/capability-result.ts:56.
  if (semantics && semantics.ok && result.task_id) {
    recordCommandTaskId(envelope.command_id, ownerIdentity.identity_id, result.task_id);
  }

  const surface: OwnerSurfaceState = {
    current_command: commandText,
    current_worker: result.capability_id,
    current_status: lifecycle.stage,
    progress: toProgress(lifecycle.stage),
    result,
    evidence: result.evidence,
    warnings: result.warnings,
    available_capabilities: availableCapabilities(),
  };

  const output_contract = classifyOutput(result);

  /**
   * ผลกลับถึงบทสนทนาของ Owner (Owner, CLOSE_EXISTING_OWNER_RESULT_RETURN_PATH).
   *
   * `control/owner-command-semantics/resolver.ts` มี writer สามพี่น้องที่เขียนลง
   * semantic-history ไฟล์เดียวกัน และหน้า :5181 อ่านผ่าน /owner/history:
   *   kind RESOLUTION  <- resolveOwnerCommandSemantics (เส้นนี้เรียกแล้วข้างบน)
   *   kind TASK_LINK   <- recordCommandTaskId          (เส้นนี้เรียกแล้วข้างบน)
   *   kind OWNER_RESULT <- recordOwnerVisibleResult    <- ไม่เคยถูกเรียกบนเส้นนี้
   *
   * ผลคือคำสั่งที่สำเร็จจริงขึ้นในบทสนทนาว่า "ไม่มีผลลัพธ์ที่บันทึกไว้" เพราะ
   * `chat.mjs` เรนเดอร์ผลจาก kind === "OWNER_RESULT" เท่านั้น วัดแล้วกับ
   * cmd_0277e184…: มี RESOLUTION + TASK_LINK แต่ไม่มี OWNER_RESULT
   *
   * ใช้ writer ตัวที่สามซึ่งอยู่ไฟล์เดียวกันและ import อยู่แล้ว — ไม่ใช้
   * `agent-result-return#returnAgentResult` เพราะสัญญาของมันบังคับ
   * `assignment_id` ซึ่งเส้นทางนี้ไม่มี (worker=LOCAL ไม่มี assignment) การเรียก
   * มันจะต้องปลอม assignment_id ขึ้นมา
   *
   * บันทึกทุกสถานะ ไม่ใช่เฉพาะที่สำเร็จ — งานที่ล้มต้องเห็นในบทสนทนาเช่นกัน
   */
  recordOwnerVisibleResult(envelope.command_id, ownerIdentity.identity_id, commandText, {
    command_id: envelope.command_id,
    work_id: workId,
    task_id: result.task_id,
    capability_id: result.capability_id,
    status: result.status,
    summary: result.summary,
    next_action: result.next_action,
    warnings: result.warnings,
    // `CapabilityResultEvidence` คือ {source, note} ส่วน {kind, ref} คือรูปของ
    // `artifacts` — ก่อนหน้านี้แมปด้วยรูปของ artifacts ทำให้ทุกแถวกลายเป็น
    // "undefined:undefined" และของจริงที่ Owner ต้องเห็น (repository_id,
    // branch_ref, worktree_path) หายไปทั้งหมดโดยไม่มีใครรู้
    evidence_refs: result.evidence.map((item) => `${item.source}:${item.note}`),
  });

  return { envelope, lifecycle, result, surface, output_contract, output_routing: resolveOutputConsumers(output_contract), work_id: workId };
}

/** Read-only preview — classifies without routing, so a caller (or a confirmation prompt) can show the Owner which capability a command WOULD go to before it actually runs. */
export function previewOwnerCommand(commandText: string) {
  return classifyCommand(commandText);
}

/** Minimal print/render function — a formatted string, never a UI component (see ./types.ts's header). */
export function renderOwnerSurface(surface: OwnerSurfaceState): string {
  const lines = [
    `Current Command : ${surface.current_command}`,
    `Current Worker  : ${surface.current_worker}`,
    `Current Status  : ${surface.current_status}`,
    `Progress        : ${surface.progress}`,
    `Result          : ${surface.result ? `${surface.result.status} — ${surface.result.summary}` : "(none yet)"}`,
    `Evidence        : ${surface.evidence.length === 0 ? "(none)" : surface.evidence.map((e) => `[${e.source}] ${e.note}`).join(" | ")}`,
    `Warnings        : ${surface.warnings.length === 0 ? "(none)" : surface.warnings.join(" | ")}`,
    `Capabilities    : ${surface.available_capabilities.map((c) => `${c.capability_id}=${c.connected ? "CONNECTED" : "OFFLINE"}`).join(", ")}`,
  ];
  return lines.join("\n");
}
