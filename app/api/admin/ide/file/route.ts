/**
 * GET /api/admin/ide/file?path=<relative path> — real file content.
 * PUT /api/admin/ide/file — real, conflict-safe write (owner, 2026-08-05,
 * Phase 2). No create/rename/move/delete — PUT only ever replaces the
 * bytes of a file that already exists at the given path (a nonexistent
 * path fails NOT_FOUND, same as resolveSafeRelativePath's normal
 * behavior — there is no separate "create" branch here).
 *
 * GET now also returns a sha256 `hash` alongside `modified_at` — the
 * client must send both back as `expectedHash`/`expectedLastModified` on
 * PUT; either mismatching what's actually on disk at write time means
 * someone/something changed the file since it was opened, and the write
 * is refused with FILE_CONFLICT rather than silently overwriting it.
 */
import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { resolveSafeRelativePath, looksBinary, MAX_FILE_BYTES, IdeFsError, auditLog, auditFileWriteLog, type IdeErrorCode } from "../_lib/fsSecurity";
import { sha256Hex, detectNewlineInfo, applyNewlineInfo, writeFileAtomic } from "../_lib/fileWrite";
import { classifyFile, CATEGORY_LABELS } from "../_lib/classification";
import { startRun } from "../_lib/executionRuntime";
import { citeStandard } from "../_lib/standards";
import { recordCompletedJob } from "../_lib/queueRuntime";
import { createInspection } from "../_lib/inspectionRuntime";
import { getInspectionTypeDefinition } from "../_lib/inspectionRegistry";
import { createQueueJobArtifact, createEditorSaveArtifact, createInspectionResultArtifact, createRuntimeBehaviorArtifact, linkArtifacts } from "../_lib/artifactRuntime";
import { AUTO_SAVE_DEBOUNCE_MS } from "../_lib/autoSaveRuntime";
import { loadIdeSettings, IDE_SETTINGS_KEYS } from "@/core/config/ide-settings";

function errorResponse(code: IdeErrorCode, message: string, status: number) {
  return NextResponse.json({ ok: false, code, message }, { status });
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;

  const clientPath = req.nextUrl.searchParams.get("path");
  if (clientPath === null) {
    return errorResponse("INVALID_PATH", "path is required", 400);
  }

  try {
    const { absPath, relPath } = await resolveSafeRelativePath(clientPath);

    const stat = await fs.stat(absPath).catch(() => null);
    if (!stat) {
      auditLog("ide.file.read", relPath, "NOT_FOUND", { actor: auth.email });
      return errorResponse("NOT_FOUND", "file does not exist", 404);
    }
    if (!stat.isFile()) {
      auditLog("ide.file.read", relPath, "INVALID_PATH", { actor: auth.email });
      return errorResponse("INVALID_PATH", "path is not a file", 400);
    }
    if (stat.size > MAX_FILE_BYTES) {
      auditLog("ide.file.read", relPath, "FILE_TOO_LARGE", { actor: auth.email });
      return errorResponse("FILE_TOO_LARGE", `file is ${stat.size} bytes, max ${MAX_FILE_BYTES}`, 413);
    }

    const buf = await fs.readFile(absPath);
    if (looksBinary(buf)) {
      auditLog("ide.file.read", relPath, "UNSUPPORTED_FILE", { actor: auth.email });
      return errorResponse("UNSUPPORTED_FILE", "binary file — not viewable as text", 415);
    }

    const classification = classifyFile(relPath);
    const hash = sha256Hex(buf);
    const newlineInfoForDisplay = detectNewlineInfo(buf);
    auditLog("ide.file.read", relPath, "ok", { actor: auth.email, hash });
    // Production Queue (Step 3) — every Editor open becomes a real,
    // already-completed OPEN_FILE Job. File reading itself already
    // happened above; this only records it.
    const openJob = recordCompletedJob("OPEN_FILE", auth.email, auth.id, relPath, { ok: true, result: `${stat.size} bytes`, error: null });
    return NextResponse.json({
      ok: true,
      path: relPath,
      content: buf.toString("utf-8"),
      size_bytes: stat.size,
      modified_at: stat.mtime.toISOString(),
      hash,
      encoding: newlineInfoForDisplay?.hadBOM ? "UTF-8 with BOM" : "UTF-8",
      line_ending: newlineInfoForDisplay?.style ?? "mixed",
      read_only: classification.riskLevel === "LOCKED",
      classification: {
        category: classification.category,
        categoryLabel: CATEGORY_LABELS[classification.category],
        capability: classification.capability,
        riskLevel: classification.riskLevel,
        evidence: classification.evidence,
        requiredChecks: classification.requiredChecks,
        purposeTh: classification.purposeTh,
      },
      job_id: openJob.jobId,
    });
  } catch (e) {
    if (e instanceof IdeFsError) {
      auditLog("ide.file.read", clientPath, e.code, { actor: auth.email });
      recordCompletedJob("OPEN_FILE", auth.email, auth.id, clientPath, { ok: false, result: null, error: e.code });
      const status = e.code === "NOT_FOUND" ? 404 : e.code === "ACCESS_DENIED" ? 403 : 400;
      return errorResponse(e.code, e.message, status);
    }
    auditLog("ide.file.read", clientPath, "INTERNAL_ERROR", { actor: auth.email });
    return errorResponse("INTERNAL_ERROR", "unexpected error", 500);
  }
}

export async function PUT(req: NextRequest) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;

  let body: { path?: unknown; content?: unknown; expectedHash?: unknown; expectedLastModified?: unknown; trigger?: unknown };
  try {
    body = await req.json();
  } catch {
    return errorResponse("INVALID_PATH", "invalid JSON body", 400);
  }

  const { path: clientPath, content, expectedHash, expectedLastModified, trigger } = body;
  if (typeof clientPath !== "string") return errorResponse("INVALID_PATH", "path is required", 400);
  if (typeof content !== "string") return errorResponse("INVALID_PATH", "content must be a string", 400);
  if (typeof expectedHash !== "string" || typeof expectedLastModified !== "string") {
    return errorResponse("INVALID_PATH", "expectedHash and expectedLastModified are required", 400);
  }
  // Real, defensive default (owner, 2026-08-10, TASK-069 — Auto-save real
  // debounce runtime) — `trigger` affects ONLY which real audit evidence
  // gets recorded below, never write permission: LOCKED/CRITICAL/conflict
  // checks below are identical regardless of trigger, so a client can never
  // use this field to bypass anything.
  const saveTrigger: "manual" | "autosave" = trigger === "autosave" ? "autosave" : "manual";
  // Byte length, not JS string length — a 1MB cap means 1MB of real UTF-8
  // bytes on disk, not 1M UTF-16 code units.
  if (Buffer.byteLength(content, "utf-8") > MAX_FILE_BYTES) {
    return errorResponse("FILE_TOO_LARGE", `content is over ${MAX_FILE_BYTES} bytes`, 413);
  }

  let relPath = clientPath;
  try {
    const resolved = await resolveSafeRelativePath(clientPath);
    relPath = resolved.relPath;
    const absPath = resolved.absPath;

    const stat = await fs.stat(absPath).catch(() => null);
    if (!stat) {
      auditFileWriteLog(relPath, null, "NOT_FOUND", { actor: auth.email });
      recordCompletedJob("SAVE_FILE", auth.email, auth.id, relPath, { ok: false, result: null, error: "NOT_FOUND" });
      return errorResponse("NOT_FOUND", "file does not exist — this endpoint only edits existing files", 404);
    }
    if (!stat.isFile()) {
      auditFileWriteLog(relPath, null, "INVALID_PATH", { actor: auth.email });
      recordCompletedJob("SAVE_FILE", auth.email, auth.id, relPath, { ok: false, result: null, error: "INVALID_PATH" });
      return errorResponse("INVALID_PATH", "path is not a file", 400);
    }

    // Real, server-side enforcement — LOCKED is not a client-side cosmetic
    // state. Checked before any read of the current bytes, so a LOCKED file
    // is refused identically regardless of what the client claims about it.
    const classification = classifyFile(relPath);
    if (classification.riskLevel === "LOCKED") {
      auditFileWriteLog(relPath, null, "LOCKED_FILE", { actor: auth.email, error: "file is LOCKED" });
      recordCompletedJob("SAVE_FILE", auth.email, auth.id, relPath, { ok: false, result: null, error: "LOCKED_FILE" });
      return errorResponse("LOCKED_FILE", "this file is classified LOCKED (registry/CONSTITUTION.json declares it immutable) — read-only, no write path exists", 403);
    }

    const originalBuf = await fs.readFile(absPath);
    if (looksBinary(originalBuf)) {
      auditFileWriteLog(relPath, null, "UNSUPPORTED_FILE", { actor: auth.email, error: "binary file" });
      recordCompletedJob("SAVE_FILE", auth.email, auth.id, relPath, { ok: false, result: null, error: "UNSUPPORTED_FILE" });
      return errorResponse("UNSUPPORTED_FILE", "binary file — not editable here", 415);
    }

    const currentHash = sha256Hex(originalBuf);
    const currentModifiedAt = stat.mtime.toISOString();
    if (currentHash !== expectedHash || currentModifiedAt !== expectedLastModified) {
      auditFileWriteLog(relPath, null, "FILE_CONFLICT", { actor: auth.email, beforeHash: expectedHash, afterHash: currentHash, error: "disk hash/mtime diverged from expected" });
      recordCompletedJob("SAVE_FILE", auth.email, auth.id, relPath, { ok: false, result: null, error: "FILE_CONFLICT" });
      return NextResponse.json({
        ok: false,
        code: "FILE_CONFLICT",
        message: "file changed on disk since it was opened",
        disk_content: originalBuf.toString("utf-8"),
        disk_hash: currentHash,
        disk_modified_at: currentModifiedAt,
      }, { status: 409 });
    }

    const newlineInfo = detectNewlineInfo(originalBuf);
    if (!newlineInfo) {
      auditFileWriteLog(relPath, null, "UNSUPPORTED_FILE", { actor: auth.email, error: "mixed line endings" });
      recordCompletedJob("SAVE_FILE", auth.email, auth.id, relPath, { ok: false, result: null, error: "UNSUPPORTED_FILE" });
      return errorResponse("UNSUPPORTED_FILE", "file has mixed line endings (both LF and CRLF) — cannot safely preserve format, refusing to guess", 415);
    }

    const finalContent = applyNewlineInfo(content, newlineInfo);
    const finalBuf = Buffer.from(finalContent, "utf-8");
    if (finalBuf.byteLength > MAX_FILE_BYTES) {
      auditFileWriteLog(relPath, finalBuf.byteLength, "FILE_TOO_LARGE", { actor: auth.email, beforeHash: currentHash, error: "content exceeds MAX_FILE_BYTES" });
      recordCompletedJob("SAVE_FILE", auth.email, auth.id, relPath, { ok: false, result: null, error: "FILE_TOO_LARGE" });
      return errorResponse("FILE_TOO_LARGE", `content is over ${MAX_FILE_BYTES} bytes after applying original newline style`, 413);
    }

    // Real file mode preserved across the atomic rename (see
    // writeFileAtomic's doc comment) — the original file's real permission
    // bits, never a guessed/default mode.
    await writeFileAtomic(absPath, finalBuf, stat.mode);

    const newStat = await fs.stat(absPath);
    const afterHash = sha256Hex(finalBuf);
    auditFileWriteLog(relPath, finalBuf.byteLength, "ok", { actor: auth.email, beforeHash: currentHash, afterHash });

    // CRITICAL files declare requiredChecks in the classification registry
    // (e.g. ["typecheck"]) — a save doesn't just warn, it REALLY triggers
    // them via the Phase 4 Execution Runtime, fire-and-forget (a save
    // request must not hang for however long typecheck takes). The client
    // gets the real runIds back and can watch them in the Execution
    // console; this never blocks or reverses the write that already
    // succeeded above.
    const triggeredChecks: { commandId: string; runId: string }[] = [];
    if (classification.riskLevel === "CRITICAL") {
      for (const commandId of classification.requiredChecks) {
        try {
          const run = startRun(commandId, undefined, auth.id, { actor: auth.email });
          triggeredChecks.push({ commandId: run.commandId, runId: run.runId });
        } catch {
          // A required check that couldn't even start (e.g. concurrency
          // limit) is surfaced to the client as an empty triggeredChecks
          // entry never silently fabricated — the save itself still
          // succeeded and is reported as such.
        }
      }
    }

    // Real evidence chain — every stage below reflects data actually
    // computed THIS request (no fabricated steps), so a consumer (this
    // IDE's UI, or a future AI/Documentation/Governance caller) can see
    // exactly why the save behaved the way it did, not just an error
    // string. Citations only ever come from citeStandard(), which refuses
    // to invent a source for an id registry/standards.json doesn't have.
    const constitutionCitation = citeStandard("DNA_Constitution");
    const evidenceChain: { stage: string; detail: string; source: string | null }[] = [
      {
        stage: "Classification",
        detail: `${CATEGORY_LABELS[classification.category]}${classification.capability ? ` / ${classification.capability}` : ""}`,
        source: "app/api/admin/ide/_lib/classification.ts (registry/module-registry.json + real path evidence)",
      },
      {
        stage: "Risk",
        detail: classification.riskLevel,
        source: classification.riskLevel === "CRITICAL"
          ? (constitutionCitation?.source ?? "registry/CONSTITUTION.json")
          : "baseline — no elevated-risk evidence found",
      },
    ];
    if (classification.riskLevel === "CRITICAL" && classification.requiredChecks.length > 0) {
      evidenceChain.push({ stage: "Required Checks", detail: classification.requiredChecks.join(", "), source: "classification.requiredChecks (declared per Risk evidence above)" });
    }
    if (triggeredChecks.length > 0) {
      evidenceChain.push({
        stage: "Execution Runtime",
        detail: triggeredChecks.map((c) => `${c.commandId} (run ${c.runId})`).join(", "),
        source: "app/api/admin/ide/_lib/executionRuntime.ts",
      });
    }
    evidenceChain.push({ stage: "Result", detail: "write succeeded", source: "app/api/admin/ide/file/route.ts" });

    // Production Queue (Step 3) — every Editor Save becomes a real,
    // already-completed SAVE_FILE Job. The write itself already happened
    // above; this only records it.
    const saveJob = recordCompletedJob("SAVE_FILE", auth.email, auth.id, relPath, { ok: true, result: `${finalBuf.byteLength} bytes`, error: null });

    // Real Artifact Pipeline (Step 5) — every successful SAVE_FILE Job
    // becomes a real, immutable QUEUE_JOB artifact, and the save itself a
    // real EDITOR_SAVE artifact chained as its child. Never blocks the
    // response; a failure here never reverses the write that already
    // succeeded.
    let editorSaveArtifactId: string | null = null;
    try {
      const jobArtifact = createQueueJobArtifact(saveJob, auth.email, auth.id);
      const saveArtifact = createEditorSaveArtifact(saveJob.jobId, relPath, afterHash, auth.email, auth.id);
      linkArtifacts(jobArtifact.artifactId, saveArtifact.artifactId, auth.id, auth.email);
      editorSaveArtifactId = saveArtifact.artifactId;
    } catch { /* artifact wrapping never blocks or reverses a real save */ }

    // Real RUNTIME_BEHAVIOR_VERIFIED evidence (owner, 2026-08-10, TASK-069
    // — Auto-save real debounce runtime, capability #61) — recorded ONLY
    // when this write was really triggered by the real auto-save debounce
    // timer (components/ide-shell/IDEWorkspace.tsx), never for a manual
    // save. `expectedOnValue` is a real, freshly-loaded app_configs read
    // (never the client's unverified claim) — makeEvidence's
    // RUNTIME_BEHAVIOR_VERIFIED case cross-checks it against the live cache
    // again before marking verifiedReal, so this can never be fabricated
    // even if this handler's own read were somehow stale. Best-effort,
    // logged, never blocks/reverses the real write that already succeeded.
    if (saveTrigger === "autosave") {
      try {
        const ideSettings = await loadIdeSettings();
        const expectedOnValue = String(ideSettings.autoSaveEnabled);
        createRuntimeBehaviorArtifact(
          IDE_SETTINGS_KEYS.autoSaveEnabled,
          expectedOnValue,
          `Auto-save consumer saveFile() (components/ide-shell/IDEWorkspace.tsx) invoked via the real ${AUTO_SAVE_DEBOUNCE_MS}ms debounce timer for path "${relPath}" — write succeeded, ${finalBuf.byteLength} bytes`,
          auth.email, auth.id
        );
      } catch (evidenceError: unknown) {
        console.error("ide/file PUT: real autosave write succeeded but RUNTIME_BEHAVIOR_VERIFIED evidence recording failed:", evidenceError);
      }
    }

    // Real Inspection Pipeline (Step 4) — triggered ONLY for the file just
    // saved, ONLY on a successful write, never blocking this response
    // (fire-and-forget; results are fetched later via
    // /api/admin/ide/inspection/job/[jobId]). Each check function is
    // in-process (no second child process spawned) and validates its own
    // allowedFileTypes, so an unsupported extension is simply skipped here
    // rather than guessed at.
    const ext = relPath.slice(relPath.lastIndexOf("."));
    const inspectionTypesForSave = (["SYNTAX_CHECK", "IMPORT_CHECK", "SECURITY_POLICY_CHECK", "REGISTRY_CHECK"] as const).filter((t) => {
      const def = getInspectionTypeDefinition(t);
      return def && def.status === "IMPLEMENTED" && (def.allowedFileTypes === null || def.allowedFileTypes.includes(ext));
    });
    for (const inspectionType of inspectionTypesForSave) {
      createInspection(inspectionType, relPath, auth.email, auth.id, { jobId: saveJob.jobId })
        .then((record) => {
          // Real Artifact Pipeline (Step 5) — every finished Inspection
          // becomes a real INSPECTION_RESULT artifact, chained as a child
          // of the EDITOR_SAVE artifact that triggered it (SAVE_FILE →
          // Inspection Artifact lineage).
          try {
            createInspectionResultArtifact(record, auth.email, auth.id, editorSaveArtifactId ? [editorSaveArtifactId] : []);
          } catch { /* artifact wrapping never blocks a real inspection result */ }
        })
        .catch(() => {
          // A failed-to-start inspection never blocks or reverses the save
          // that already succeeded — it simply won't appear under this jobId.
        });
    }

    return NextResponse.json({
      ok: true,
      path: relPath,
      size_bytes: newStat.size,
      modified_at: newStat.mtime.toISOString(),
      hash: afterHash,
      triggered_checks: triggeredChecks,
      evidence_chain: evidenceChain,
      job_id: saveJob.jobId,
    });
  } catch (e) {
    if (e instanceof IdeFsError) {
      auditFileWriteLog(relPath, null, e.code, { actor: auth.email, error: e.message });
      recordCompletedJob("SAVE_FILE", auth.email, auth.id, relPath, { ok: false, result: null, error: e.code });
      const status = e.code === "NOT_FOUND" ? 404 : e.code === "ACCESS_DENIED" ? 403 : e.code === "WRITE_FAILED" ? 500 : 400;
      return errorResponse(e.code, e.message, status);
    }
    auditFileWriteLog(relPath, null, "INTERNAL_ERROR", { actor: auth.email, error: e instanceof Error ? e.message : String(e) });
    recordCompletedJob("SAVE_FILE", auth.email, auth.id, relPath, { ok: false, result: null, error: "INTERNAL_ERROR" });
    return errorResponse("INTERNAL_ERROR", "unexpected error", 500);
  }
}
