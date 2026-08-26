/**
 * หน้าที่: the RESUME ENGINE. Given a `work_id` and the repository as it is
 * RIGHT NOW, it re-checks every step that claims to be done, decides what is
 * still executable, and hands a replacement worker a self-sufficient
 * `ResumeContext`. This is the file that makes the AI/agent replaceable: it
 * reads persisted state and the real filesystem, and nothing else.
 *
 * Input: `work_id`, the journal path, the repository root.
 * Output: `revalidateStep`, `buildResumeContext`, `renderResumeBriefing`.
 * Dependency ที่อนุญาต: Node built-ins, ./types.ts, ./store.ts.
 * สิ่งที่ห้ามแตะ:
 * - ห้ามเชื่อ `state: "COMPLETED"` โดยไม่ตรวจ `verification` — step ที่พิสูจน์
 *   ไม่ผ่าน ณ revision ปัจจุบันต้องออกมาเป็น STALE ไม่ใช่ถูกนับว่าเสร็จ
 * - ห้าม scan repo ทั้งก้อนเพื่อเดาว่างานถึงไหน — ตรวจเฉพาะ path ที่ checkpoint
 *   ประกาศไว้เท่านั้น นั่นคือเหตุผลที่ระบบนี้มีอยู่
 * - ห้ามให้ AI ตัดสิน next_action — บรรทัดถัดไปมาจาก step graph กับ blocker
 *   ที่บันทึกไว้ ด้วยกฎเดียวที่เขียนไว้ในไฟล์นี้
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ResumeContext, StepRevalidation, WorkStep, WorkSessionCheckpoint } from "./types";
import { currentCheckpoint, currentRevision, journalPath } from "./store";

function sha256OfFile(full: string): string | null {
  try {
    return createHash("sha256").update(readFileSync(full)).digest("hex");
  } catch {
    return null;
  }
}

/**
 * Re-checks one COMPLETED step against the repository as it is now.
 * A step whose proof cannot be re-derived is `UNVERIFIABLE` — deliberately NOT
 * the same as `STILL_VALID`, so nobody can launder an unprovable claim into a
 * verified one by omitting the verification.
 */
export function revalidateStep(step: WorkStep, repoRoot: string): StepRevalidation {
  const v = step.verification;
  if (v === null) {
    return { step_id: step.step_id, verdict: "UNVERIFIABLE", detail: "step recorded no verification — completion cannot be re-derived" };
  }
  if (v.kind === "NONE") {
    return { step_id: step.step_id, verdict: "UNVERIFIABLE", detail: v.why };
  }
  const full = resolve(repoRoot, v.path);
  if (v.kind === "PATH_EXISTS") {
    return existsSync(full)
      ? { step_id: step.step_id, verdict: "STILL_VALID", detail: `path exists: ${v.path}` }
      : { step_id: step.step_id, verdict: "STALE", detail: `path no longer exists: ${v.path}` };
  }
  if (!existsSync(full)) {
    return { step_id: step.step_id, verdict: "STALE", detail: `file no longer exists: ${v.path}` };
  }
  if (v.kind === "FILE_DIGEST") {
    const now = sha256OfFile(full);
    if (now === null) return { step_id: step.step_id, verdict: "UNVERIFIABLE", detail: `could not read ${v.path}` };
    return now === v.sha256
      ? { step_id: step.step_id, verdict: "STILL_VALID", detail: `sha256 unchanged: ${v.path}` }
      : { step_id: step.step_id, verdict: "STALE", detail: `sha256 changed: ${v.path} expected ${v.sha256.slice(0, 12)} got ${now.slice(0, 12)}` };
  }
  // FILE_CONTAINS
  let body = "";
  try { body = readFileSync(full, "utf8"); } catch {
    return { step_id: step.step_id, verdict: "UNVERIFIABLE", detail: `could not read ${v.path}` };
  }
  return body.includes(v.literal)
    ? { step_id: step.step_id, verdict: "STILL_VALID", detail: `literal still present in ${v.path}` }
    : { step_id: step.step_id, verdict: "STALE", detail: `literal no longer present in ${v.path}` };
}

/**
 * The one rule that picks the next action. Deterministic, in this order:
 *   1. an OPEN decision the Owner must answer wins over everything — an agent
 *      may not proceed past a decision that is not its to make;
 *   2. an OPEN blocker;
 *   3. the first PENDING step (or STALE step, which is pending again) whose
 *      `depends_on` are all still-valid;
 *   4. nothing pending -> COMPLETE.
 */
function decideNext(
  checkpoint: WorkSessionCheckpoint,
  stillValid: readonly WorkStep[],
  stale: readonly StepRevalidation[],
): { next_action: string; resume_status: ResumeContext["resume_status"]; pending: WorkStep[] } {
  const validIds = new Set(stillValid.map((s) => s.step_id));
  const staleIds = new Set(stale.map((s) => s.step_id));
  const pending = checkpoint.steps.filter((s) => s.state === "PENDING" || staleIds.has(s.step_id));

  const openDecision = checkpoint.decisions_required.find((d) => d.state === "OPEN");
  if (openDecision) {
    return { next_action: `DECISION_REQUIRED ${openDecision.decision_id}: ${openDecision.question} — options: ${openDecision.options.join(" | ")}`, resume_status: "DECISION_REQUIRED", pending };
  }
  const openBlocker = checkpoint.blockers.find((b) => b.state === "OPEN");
  if (openBlocker) {
    return { next_action: `BLOCKED ${openBlocker.blocker_id} at ${openBlocker.layer}: ${openBlocker.detail} — next action: ${openBlocker.next_action}`, resume_status: "BLOCKED", pending };
  }
  const runnable = pending.find((s) => s.depends_on.every((d) => validIds.has(d)));
  if (!runnable) {
    if (pending.length === 0) return { next_action: "NONE — every step is completed and still valid", resume_status: "COMPLETE", pending };
    const waiting = pending[0];
    return {
      next_action: `BLOCKED step ${waiting.step_id} waits on ${waiting.depends_on.filter((d) => !validIds.has(d)).join(", ")}`,
      resume_status: "BLOCKED",
      pending,
    };
  }
  return { next_action: `${runnable.step_id} — ${runnable.title}`, resume_status: "RESUMABLE", pending };
}

export function buildResumeContext(
  workId: string,
  options: { path?: string; repoRoot?: string; constraints?: readonly string[] } = {},
): ResumeContext {
  const path = options.path ?? journalPath();
  const repoRoot = options.repoRoot ?? process.cwd();
  const checkpoint = currentCheckpoint(workId, path);
  const nowRevision = currentRevision(repoRoot);

  if (checkpoint === null) {
    return {
      work_id: workId, objective: "", current_phase: "", completed_steps: [], stale_steps: [], pending_steps: [],
      affected_resource_ids: [], affected_paths: [], source_refs: [], evidence_refs: [], open_blockers: [],
      open_decisions: [], constraints: options.constraints ?? [], do_not_repeat: [],
      checkpoint_revision: "", current_revision: nowRevision, revision_drifted: false,
      next_action: `NO_SUCH_WORK — no checkpoint carries work_id ${workId} in ${path}`,
      resume_status: "NO_SUCH_WORK",
    };
  }

  const claimedDone = checkpoint.steps.filter((s) => s.state === "COMPLETED");
  const revalidated = claimedDone.map((s) => ({ step: s, result: revalidateStep(s, repoRoot) }));
  const stillValid = revalidated.filter((r) => r.result.verdict === "STILL_VALID").map((r) => r.step);
  // UNVERIFIABLE is reported beside STALE: both mean "a replacement worker may
  // not assume this is done", which is the whole point of re-checking.
  const notProven = revalidated.filter((r) => r.result.verdict !== "STILL_VALID").map((r) => r.result);

  const { next_action, resume_status, pending } = decideNext(checkpoint, stillValid, notProven);

  return {
    work_id: checkpoint.work_id,
    objective: checkpoint.objective,
    current_phase: checkpoint.current_phase,
    completed_steps: stillValid,
    stale_steps: notProven,
    pending_steps: pending,
    affected_resource_ids: checkpoint.affected_resource_ids,
    affected_paths: checkpoint.affected_paths,
    source_refs: checkpoint.affected_paths,
    evidence_refs: checkpoint.evidence_refs,
    open_blockers: checkpoint.blockers.filter((b) => b.state === "OPEN"),
    open_decisions: checkpoint.decisions_required.filter((d) => d.state === "OPEN"),
    constraints: options.constraints ?? [],
    do_not_repeat: checkpoint.do_not_repeat,
    checkpoint_revision: checkpoint.source_revision,
    current_revision: nowRevision,
    revision_drifted: checkpoint.source_revision !== nowRevision,
    next_action,
    resume_status,
  };
}

/** The briefing a replacement worker is handed. Plain text on purpose — it must be readable by a human, a script, or any model. */
export function renderResumeBriefing(ctx: ResumeContext): string {
  const lines: string[] = [];
  lines.push(`WORK_ID           ${ctx.work_id}`);
  lines.push(`OBJECTIVE         ${ctx.objective}`);
  lines.push(`CURRENT_PHASE     ${ctx.current_phase}`);
  lines.push(`RESUME_STATUS     ${ctx.resume_status}`);
  lines.push(`CHECKPOINT_REV    ${ctx.checkpoint_revision}`);
  lines.push(`CURRENT_REV       ${ctx.current_revision}${ctx.revision_drifted ? "  (DRIFTED)" : ""}`);
  lines.push(`COMPLETED_STEPS   ${ctx.completed_steps.map((s) => s.step_id).join(", ") || "(none)"}`);
  lines.push(`STALE_STEPS       ${ctx.stale_steps.map((s) => `${s.step_id}:${s.verdict}`).join(", ") || "(none)"}`);
  lines.push(`PENDING_STEPS     ${ctx.pending_steps.map((s) => s.step_id).join(", ") || "(none)"}`);
  lines.push(`AFFECTED_RESOURCES ${ctx.affected_resource_ids.join(", ") || "(none)"}`);
  lines.push(`SOURCE_REFS       ${ctx.source_refs.join(", ") || "(none)"}`);
  lines.push(`EVIDENCE_REFS     ${ctx.evidence_refs.join(", ") || "(none)"}`);
  lines.push(`BLOCKERS          ${ctx.open_blockers.map((b) => `${b.blocker_id}@${b.layer}`).join(", ") || "(none)"}`);
  lines.push(`DECISIONS         ${ctx.open_decisions.map((d) => d.decision_id).join(", ") || "(none)"}`);
  lines.push(`CONSTRAINTS       ${ctx.constraints.join(" · ") || "(none)"}`);
  lines.push(`DO_NOT_REPEAT     ${ctx.do_not_repeat.join(" · ") || "(none)"}`);
  lines.push(`NEXT_ACTION       ${ctx.next_action}`);
  return lines.join("\n");
}
