/**
 * หน้าที่: the ONLY function in this repo allowed to perform a real file
 * write on behalf of a WriteIntent — Owner, 2026-08-19: "File-write
 * executor ต้องปฏิเสธ request ทุกกรณีถ้าไม่มี valid Write Gate decision...
 * ห้ามมี direct filesystem write function ที่ export ให้ caller เรียกข้าม
 * Gate ได้". This module exports exactly one write-capable function,
 * `executeFileWrite` — `./host-runtime.ts`'s real `writeFileReal` is never
 * re-exported by `./contract.ts`, so no caller outside this file can reach
 * the real fs write without going through the gate check below.
 *
 * IMPORTANT, honestly documented (Owner ข้อ 11): this only closes the path
 * that goes THROUGH this module. It does not and cannot stop a coding
 * agent (Claude Code, Codex, etc.) with direct filesystem tool access from
 * writing anywhere in this repo completely outside this call chain — see
 * `./tests/bypass-detection.test.ts`, which proves that gap still exists
 * for real, right now, in this exact checkout.
 *
 * Only `target_type: "FILE"` + `operation: "CREATE"` or `"MODIFY"` are
 * actually executable this round — DELETE/MOVE/RENAME and non-FILE target
 * types are refused with `UNSUPPORTED_OPERATION`/`UNSUPPORTED_TARGET_TYPE`,
 * never faked as completed (matches this repo's "never fake a call"
 * discipline, e.g. `control/command-router/router.ts`'s own
 * NOT_CONNECTED handling).
 *
 * Input: `FileWriteRequest` + the full `WriteGateDecision` object the
 * caller obtained from `permissions/write-gate/contract.ts`.
 * Output: `FileWriteResult`, durably audited via `./audit.ts`.
 * Dependency ที่อนุญาต: ./types.ts, ./host-runtime.ts, ./audit.ts,
 * `../../contracts/write-intent/write-intent.ts` (type only — this file
 * never evaluates a WriteIntent itself, only verifies an already-decided
 * WriteGateDecision).
 * สิ่งที่ห้ามแตะ: never call `writeFileReal` without first verifying
 * `decision.decision_id === request.gate_decision_id`,
 * `decision.intent_id === request.intent_id`, and
 * `decision.decision` matching the request's operation. Never export
 * `./host-runtime.ts`'s real fs primitives from `./contract.ts`.
 */

import { dirnamePath, ensureDirReal, fileExistsReal, joinPath, newWriteId, nowIso, repoRootDirname, writeFileReal } from "./host-runtime";
import { recordWriteAudit } from "./audit";
import type { FileWriteRefusalCode, FileWriteRequest, FileWriteResult } from "./types";
import type { WriteGateDecision } from "../../contracts/write-intent/write-intent";

function refuse(request: FileWriteRequest, writeId: string, code: FileWriteRefusalCode, gateDecisionValue: string): FileWriteResult {
  const result: FileWriteResult = {
    write_id: writeId,
    correlation_id: request.correlation_id,
    intent_id: request.intent_id,
    gate_decision_id: request.gate_decision_id,
    status: "refused",
    refusal_code: code,
    resolved_path: null,
    bytes_written: null,
    completed_at: nowIso(),
  };
  recordWriteAudit({
    write_id: writeId,
    correlation_id: request.correlation_id,
    requesting_identity_id: request.requesting_identity_id,
    intent_id: request.intent_id,
    gate_decision_id: request.gate_decision_id,
    gate_decision_value: gateDecisionValue,
    operation: request.operation,
    target_path: request.target_path,
    target_type: request.target_type,
    status: "refused",
    refusal_code: code,
    resolved_path: null,
    bytes_written: null,
  });
  return result;
}

/**
 * The single public entry point. Refuses (never writes, never throws) on
 * any missing/mismatched/non-ALLOW gate decision — matches Owner ข้อ 9's
 * "Execution ต้องรับงานที่มี valid gate decision เท่านั้น".
 */
export function executeFileWrite(request: FileWriteRequest, decision: WriteGateDecision | undefined): FileWriteResult {
  const writeId = newWriteId();

  if (!decision) {
    return refuse(request, writeId, "NO_GATE_DECISION", "absent");
  }
  if (decision.decision_id !== request.gate_decision_id || decision.intent_id !== request.intent_id) {
    return refuse(request, writeId, "GATE_DECISION_MISMATCH", decision.decision);
  }

  const allowedForOperation =
    (request.operation === "CREATE" && decision.decision === "ALLOW_CREATE") ||
    ((request.operation === "MODIFY" || request.operation === "DELETE" || request.operation === "MOVE" || request.operation === "RENAME") && decision.decision === "ALLOW_MODIFY");
  if (!allowedForOperation) {
    // Covers DENY, UNKNOWN, and REUSE_EXISTING alike — Owner ข้อ 6/9: UNKNOWN never enters
    // execution, and REUSE_EXISTING means the caller must use the existing capability instead.
    return refuse(request, writeId, "GATE_DECISION_NOT_ALLOW", decision.decision);
  }

  if (request.target_type !== "FILE") {
    return refuse(request, writeId, "UNSUPPORTED_TARGET_TYPE", decision.decision);
  }
  if (request.operation !== "CREATE" && request.operation !== "MODIFY") {
    return refuse(request, writeId, "UNSUPPORTED_OPERATION", decision.decision);
  }
  if (request.content === null || request.content === undefined) {
    return refuse(request, writeId, "MISSING_CONTENT", decision.decision);
  }

  const resolvedPath = joinPath(repoRootDirname(), request.target_path);

  try {
    if (request.operation === "CREATE" && fileExistsReal(resolvedPath)) {
      return refuse(request, writeId, "FS_ERROR", decision.decision);
    }
    ensureDirReal(dirnamePath(resolvedPath));
    const bytesWritten = writeFileReal(resolvedPath, request.content);

    const result: FileWriteResult = {
      write_id: writeId,
      correlation_id: request.correlation_id,
      intent_id: request.intent_id,
      gate_decision_id: request.gate_decision_id,
      status: "completed",
      refusal_code: null,
      resolved_path: resolvedPath,
      bytes_written: bytesWritten,
      completed_at: nowIso(),
    };
    recordWriteAudit({
      write_id: writeId,
      correlation_id: request.correlation_id,
      requesting_identity_id: request.requesting_identity_id,
      intent_id: request.intent_id,
      gate_decision_id: request.gate_decision_id,
      gate_decision_value: decision.decision,
      operation: request.operation,
      target_path: request.target_path,
      target_type: request.target_type,
      status: "completed",
      refusal_code: null,
      resolved_path: resolvedPath,
      bytes_written: bytesWritten,
    });
    return result;
  } catch {
    return refuse(request, writeId, "FS_ERROR", decision.decision);
  }
}
