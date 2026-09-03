import type { AgentAdapter, ExecutionRequest, WorkOrder } from "../types";
import { submitWriteRequest } from "../../ai-write-control/contract";
import { toRegistrationCandidate } from "../../ai-write-control/contract";
import { evaluateWriteIntent } from "../../../permissions/write-gate/contract";
import { executeFileWrite, executeFileWriteSandboxed } from "../../../execution/file-write/contract";
import { validateSandboxReadback, validateWorkOrder } from "../work-order-validator";
import { runRegistrationPipeline } from "../../registration-pipeline/contract";
import { createPersistentFileStore } from "../../../software/registry-database/adapters/persistent-file-store";

export const aiWriteAdapter: AgentAdapter = {
  adapter_id: "ai-write-control-adapter",
  describe() {
    return { adapter_id: "ai-write-control-adapter", capabilities: ["code_change_work_order"] };
  },
  async execute(request: ExecutionRequest) {
    const workOrder = request.input.work_order as WorkOrder | undefined;
    if (!workOrder) return { ok: false, output: null, error: "MISSING_WORK_ORDER" };
    const validation = validateWorkOrder(workOrder);
    if (!validation.ok) return { ok: false, output: { validation }, error: `VALIDATOR_FAILED:${validation.reason_codes.join(",")}` };

    const pauseMs = Number(process.env.DNA_OS_SURVIVAL_TEST_PAUSE_MS ?? "0");
    if (pauseMs > 0) await new Promise((resolve) => setTimeout(resolve, pauseMs));

    const identity = {
      identity_id: "agent-gateway-ai-write",
      acting_as_account_id: "account-dna-os-infrastructure",
      acting_as_tenant_id: "tenant-dna-os-infrastructure",
      software_id: "dna-os-agent-gateway",
      kind: "ai_agent" as const,
    };
    const intentResult = submitWriteRequest({
      operation: workOrder.operation,
      capability: "code_change_work_order",
      target_type: workOrder.target_type,
      target_path: workOrder.target_path,
      requested_change: workOrder.requested_change,
      evidence: workOrder.evidence,
    }, identity);
    if (!intentResult.ok) return { ok: false, output: { validation }, error: `INTENT_REJECTED:${intentResult.reason}` };

    // Resolve the existing registrar at execution time. Keeping this import
    // lazy avoids a module cycle: command-router already owns the public
    // registrar projection and also owns this worker list.
    const { getWriteOwnershipIndex } = await import("../../../software/capability-registrar/contract");
    const decision = evaluateWriteIntent(intentResult.intent, { registryIndex: getWriteOwnershipIndex() });
    if (decision.decision !== "ALLOW_CREATE" && decision.decision !== "ALLOW_MODIFY") {
      return { ok: false, output: { validation, decision }, error: `WRITE_GATE_${decision.decision}` };
    }
    // 2026-08-22 (Owner: "Filesystem Jail & Admission Gate" — see
    // /Users/tam/.claude/plans/zesty-spinning-ripple.md): AGENT_HOST_SANDBOXED_WRITES=1
    // routes this one write through a real, kernel-confined child process
    // (../../../control/agent-host/) instead of executor.ts's in-process
    // fs.writeFileSync — default OFF until proven in this environment; the
    // unsandboxed path below is unchanged for every existing caller.
    const writeRequest = {
      correlation_id: intentResult.intent.correlation_id,
      intent_id: intentResult.intent.intent_id,
      gate_decision_id: decision.decision_id,
      operation: workOrder.operation,
      target_type: workOrder.target_type,
      target_path: workOrder.target_path,
      content: workOrder.content,
      requesting_identity_id: identity.identity_id,
    };
    const write = process.env.AGENT_HOST_SANDBOXED_WRITES === "1"
      ? await executeFileWriteSandboxed(writeRequest, decision, workOrder.workspace_scope)
      : executeFileWrite(writeRequest, decision);
    if (write.status !== "completed") return { ok: false, output: { validation, decision, write }, error: `WRITE_${write.refusal_code}` };

    const fs = await import("node:fs/promises");
    const actual = await fs.readFile(write.resolved_path!, "utf8").catch(() => null);
    const readback = validateSandboxReadback(workOrder, actual);
    if (!readback.ok) {
      return { ok: false, output: { validation, decision, write, readback }, error: `VALIDATOR_FAILED:${readback.reason_codes.join(",")}` };
    }

    // PHASE 8 — close the file-write orphan gap: a genuinely successful,
    // real (non-sandbox) write must become a real RegistrationCandidate
    // and enter the SAME registration pipeline every other real software
    // write already goes through. Today, EVERY real WorkOrder this
    // system can produce is confined to tests/__sandbox__/ (see
    // work-order-validator.ts's own SANDBOX_ROOT) — toRegistrationCandidate()
    // honestly, deliberately refuses to register a temporary workspace
    // artifact, so this branch is real and ready, not fabricating today's
    // system as more capable than it is.
    const eligibility = toRegistrationCandidate({
      write,
      decision,
      target_path: workOrder.target_path,
      requesting_identity_id: identity.identity_id,
      requested_change: workOrder.requested_change,
      evidence: workOrder.evidence,
    });
    const registration = eligibility.eligible ? runRegistrationPipeline(eligibility.candidate, createPersistentFileStore(), intentResult.intent.correlation_id) : null;

    return {
      ok: true,
      output: { validation, decision, write, readback, registration_eligibility: eligibility.reason, registration },
      error: undefined,
    };
  },
};
