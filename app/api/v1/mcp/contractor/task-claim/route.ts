/**
 * POST /api/v1/mcp/contractor/task-claim — contractor task intake (NEW-1, 2026-09-23).
 *
 * The App-side half of the contractor boundary. It owns the contract TYPES
 * (re-exported from the Universal Worker Contract — never copied) and delegates
 * every piece of state to runtimes that already exist:
 *   - task identity/scope  → workerTaskOrchestrator.createJobContract (JobContract)
 *   - job lifecycle        → queueRuntime.startWorkerInvokeJob
 * No new store, no new authority, no business/canonical write.
 *
 * Auth: the existing governance token mechanism (services/supabase/api-tokens via
 * app/api/v1/mcp/governance/_lib/auth.ts) — a contractor PROPOSES work, so it
 * needs the same scope a proposal needs. No new auth mechanism.
 */
import { NextResponse } from "next/server"
import { authenticate } from "@/app/api/v1/mcp/governance/_lib/auth"
import { createJobContract, type JobContract } from "@/app/api/admin/ide/_lib/workerTaskOrchestrator"
import { startWorkerInvokeJob } from "@/app/api/admin/ide/_lib/queueRuntime"
import type { WorkerRequest, WorkerAdapterType, PrivacyLevel, NetworkPolicy, ApprovalPolicy } from "@/app/api/admin/ide/_lib/workerContract"

interface ClaimBody {
  ownerId?: string
  capabilityRequired?: string
  taskDescription?: string
  acceptanceCriteria?: string[]
  permittedReadScope?: string[]
  permittedWriteScope?: string[]
  permittedTools?: string[]
  forbiddenTools?: string[]
  expectedOutputSchema?: string
  timeoutMs?: number
  privacyLevel?: PrivacyLevel
  networkPolicy?: NetworkPolicy
  approvalPolicy?: ApprovalPolicy
  workerType?: WorkerAdapterType
}

export async function POST(req: Request) {
  const auth = await authenticate(req, "governance:propose")
  if (!auth.ok) return auth.response

  let body: ClaimBody
  try {
    body = (await req.json()) as ClaimBody
  } catch {
    return NextResponse.json({ error: "unparseable JSON body" }, { status: 400 })
  }

  const ownerId = body.ownerId?.trim()
  const capabilityRequired = body.capabilityRequired?.trim()
  const taskDescription = body.taskDescription?.trim()
  if (!ownerId || !capabilityRequired || !taskDescription) {
    return NextResponse.json(
      { error: "ownerId, capabilityRequired and taskDescription are required" },
      { status: 400 },
    )
  }

  // Real scope defaults: a contractor may only touch what it was given, and an
  // empty write scope is honoured as "read-only" rather than widened.
  const permittedReadScope = body.permittedReadScope ?? []
  const permittedWriteScope = body.permittedWriteScope ?? []
  const acceptanceCriteria = body.acceptanceCriteria ?? []

  const actor = `mcp:contractor:${auth.token.id ?? "token"}`
  const contract: JobContract = createJobContract({
    taskDescription,
    acceptanceCriteria,
    permittedReadScope,
    permittedWriteScope,
    ownerId,
    actor,
    ...(body.permittedTools ? { permittedTools: body.permittedTools } : {}),
    ...(body.forbiddenTools ? { forbiddenTools: body.forbiddenTools } : {}),
  })

  const job = startWorkerInvokeJob(actor, ownerId, contract.jobContractId)

  const workerRequest: WorkerRequest = {
    workerRequestId: contract.jobContractId,
    workspaceSessionId: job.jobId,
    executionPlanId: null,
    stepId: "contractor.claim",
    workerType: body.workerType ?? "API",
    capabilityRequired,
    contextPackageId: null,
    contextFingerprint: null,
    permittedReadScope,
    permittedWriteScope,
    permittedTools: body.permittedTools ?? [],
    forbiddenTools: body.forbiddenTools ?? contract.forbiddenTools,
    expectedOutputSchema: body.expectedOutputSchema ?? "WorkerResponse",
    timeoutMs: body.timeoutMs ?? 120_000,
    maxCalls: contract.maxAttempts,
    maxTokens: 0,
    maxCost: null,
    privacyLevel: body.privacyLevel ?? "CLOUD_ALLOWED",
    networkPolicy: body.networkPolicy ?? "OUTBOUND_ALLOWED",
    approvalPolicy: body.approvalPolicy ?? "OWNER_APPROVAL_REQUIRED",
    actor,
    createdAt: new Date().toISOString(),
    taskDescription,
    acceptanceCriteria,
    fileContents: [],
  }

  return NextResponse.json({ ok: true, jobId: job.jobId, jobContractId: contract.jobContractId, workerRequest })
}
