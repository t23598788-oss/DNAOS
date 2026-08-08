/**
 * POST /api/admin/ide/workers/select — real, deterministic Worker
 * Selection over the real Universal Worker Bridge (owner, 2026-08-08,
 * Software Factory Step 13.6, Section 8/20). Never executes anything —
 * selection only. Produces a real WORKER_SELECTION_REPORT artifact.
 */
import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { selectWorker } from "../../_lib/workerSelectorRuntime";
import { createOperationsArtifact } from "../../_lib/artifactRuntime";
import type { WorkerRequest, PrivacyLevel } from "../../_lib/workerContract";

export async function POST(req: Request) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  let body: Partial<{ capabilityRequired: string; workspaceSessionId: string; privacyLevel: PrivacyLevel; ownerPreference: string[] }>;
  try { body = await req.json(); } catch { body = {}; }
  const capabilityRequired = typeof body.capabilityRequired === "string" && body.capabilityRequired ? body.capabilityRequired : "code.generate";
  const workspaceSessionId = typeof body.workspaceSessionId === "string" ? body.workspaceSessionId : randomUUID();
  const privacyLevel: PrivacyLevel = body.privacyLevel === "LOCAL_ONLY" ? "LOCAL_ONLY" : "CLOUD_ALLOWED";
  const ownerPreference = Array.isArray(body.ownerPreference) ? body.ownerPreference.filter((p): p is string => typeof p === "string") : [];

  const request: WorkerRequest = {
    workerRequestId: randomUUID(), workspaceSessionId, executionPlanId: null, stepId: "adhoc-selection", workerType: "CODE_WORKER",
    capabilityRequired, contextPackageId: null, contextFingerprint: null, permittedReadScope: [], permittedWriteScope: [], permittedTools: [], forbiddenTools: [],
    expectedOutputSchema: "n/a", timeoutMs: 60_000, maxCalls: 1, maxTokens: 1000, maxCost: null, privacyLevel, networkPolicy: "OUTBOUND_ALLOWED",
    approvalPolicy: "OWNER_APPROVAL_REQUIRED", actor: auth.email, createdAt: new Date().toISOString(), taskDescription: "ad-hoc selection probe", acceptanceCriteria: [], fileContents: [],
  };

  const selection = await selectWorker(request, ownerPreference);
  const artifact = createOperationsArtifact({ artifactType: "WORKER_SELECTION_REPORT", content: JSON.stringify(selection), mimeType: "application/json", actor: auth.email, ownerId: auth.id, generatedFrom: request.workerRequestId, jobId: null, workspaceSessionId });
  return NextResponse.json({ ok: true, selection, artifactId: artifact.artifactId });
}
