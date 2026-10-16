/**
 * GET/POST /api/admin/devices/compute-relay — the Business↔Compute RELAY
 * (Phase 2, 2026-10-16). Pure TRANSPORT over the existing device command
 * engine and authority: it creates NO second gateway, NO second permission
 * system, NO direct database surface for the compute server.
 *
 *   requireAuth(ADMIN_TIER)          — same session gate as every admin route
 *   createDeviceCommand()            — managed.run, closed tool_id, deny-by-
 *                                      default scoped_grants check inside
 *   ackCommand()                     — dispatched→running + scope RE-CHECK
 *                                      with jobId=command.id (job-bound)
 *   forwardToComputeDaemon()         — the ONLY network hop; bearer token
 *                                      from env; token never logged
 *   completeCommand()                — terminal EXACTLY ONCE, honest status
 *
 * Env contract (fail-closed, checked BEFORE any row is created):
 *   DNA_COMPUTE_DAEMON_URL, DNA_COMPUTE_TOKEN — see computeRelay.ts.
 * Workspace root is asserted SERVER-SIDE ONLY (this repo at process.cwd());
 * a token never widens it. GET probes daemon /health + /capabilities and
 * never claims a result that only a real completeCommand wrote.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { supabaseAdmin } from "@/services/supabase/queries";
import {
  createDeviceCommand, ackCommand, completeCommand,
} from "@/app/api/admin/devices/_lib/deviceCommands";
import {
  COMPUTE_TOOL_IDS, resolveRelayConfig, forwardToComputeDaemon,
  toolIdToDaemonKind, buildDaemonPayload, denseIdempotencyKey,
} from "@/app/api/admin/devices/_lib/computeRelay";
import { RELAY_STEP_ORDER } from "@/app/api/admin/devices/_lib/computeRelayRuntime";

function errStatus(code: string): number {
  const MAP: Record<string, number> = {
    META_TABLES_MISSING: 409, KIND_UNKNOWN: 400, DEVICE_NOT_FOUND: 404,
    DEVICE_REVOKED: 403, SCOPE_DENIED: 403, PAYLOAD_INVALID: 400,
    RELAY_NOT_CONFIGURED: 503, RELAY_UNREACHABLE: 502, TOOL_KIND_UNKNOWN: 400,
    NOT_ACKED: 409, CONFLICT: 409, WRONG_DEVICE: 403, EXPIRED: 410,
  };
  return MAP[code] ?? 500;
}

function failAble(err: { code?: string; message?: string }): NextResponse {
  const code = (err as { code?: string }).code ?? "INTERNAL_ERROR";
  const status = (err as { status?: number }).status ?? errStatus(code);
  return NextResponse.json({ ok: false, code, error: (err as { message?: string }).message ?? String(err) }, { status });
}

/** GET — real daemon probe (heartbeat + capabilities), honest config status. */
export async function GET() {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;

  const cfg = resolveRelayConfig();
  if (!cfg.ok) {
    return NextResponse.json({ ok: false, code: cfg.code, error: cfg.error, relaySteps: RELAY_STEP_ORDER }, { status: 503 });
  }
  try {
    const t0 = Date.now();
    const health = await fetch(`${cfg.config.url}/health`, { signal: AbortSignal.timeout(5000) });
    if (!health.ok) throw new Error(`HTTP ${health.status}`);
    const hb = (await health.json()) as { heartbeat?: { capabilities?: Record<string, unknown>; [k: string]: unknown } };
    let capabilities: Record<string, unknown> | null = null;
    try {
      const caps = await fetch(`${cfg.config.url}/capabilities`, { headers: { Authorization: `Bearer ${cfg.config.token}` }, signal: AbortSignal.timeout(5000) });
      if (caps.ok) capabilities = ((await caps.json()) as { capabilities?: Record<string, unknown> }).capabilities ?? null;
    } catch { /* capabilities is best-effort; health above is the real probe */ }
    return NextResponse.json({
      ok: true,
      daemon: hb.heartbeat ?? null,
      capabilities: capabilities ?? (hb.heartbeat as { capabilities?: unknown } | undefined)?.capabilities ?? null,
      probe: { httpMs: Date.now() - t0, configured: true },
      relaySteps: RELAY_STEP_ORDER,
    });
  } catch (error) {
    return failAble({ code: "RELAY_UNREACHABLE", message: `compute daemon not reachable at DNA_COMPUTE_DAEMON_URL: ${error instanceof Error ? error.message : String(error)}` });
  }
}

/** POST — orchestrate the EXACT six-step relay (config→create→ack→forward→
 * complete); the ordered steps are the acceptance-test contract too. */
export async function POST(req: NextRequest) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;

  let body: { deviceId?: unknown; toolId?: unknown; payload?: unknown; idempotencyKey?: unknown };
  try { body = await req.json(); } catch { body = {}; }
  const deviceId = typeof body.deviceId === "string" ? body.deviceId : "";
  const toolId = typeof body.toolId === "string" ? body.toolId : "";
  const payload = (typeof body.payload === "object" && body.payload !== null ? body.payload : {}) as Record<string, unknown>;
  const ownerId = auth.id;

  if (!COMPUTE_TOOL_IDS.includes(toolId as (typeof COMPUTE_TOOL_IDS)[number])) {
    return failAble({ code: "TOOL_KIND_UNKNOWN", message: `toolId '${toolId}' is not in the closed relay set: ${COMPUTE_TOOL_IDS.join(", ")}` });
  }
  if (typeof deviceId !== "string" || !deviceId.trim()) {
    return failAble({ code: "KIND_UNKNOWN", message: "deviceId is required (must be a registered device with a live scoped_grants grant for this toolId)" });
  }
  if (buildDaemonPayload(toolId, payload) === null) {
    return failAble({ code: "PAYLOAD_INVALID", message: `payload does not satisfy the '${toolId}' contract` });
  }
  // Step 1: env fail-closed BEFORE any row exists (no stale dispatched rows).
  const cfg = resolveRelayConfig();
  if (!cfg.ok) return failAble({ code: cfg.code, message: cfg.error });

  const idempotencyKey = typeof body.idempotencyKey === "string" && body.idempotencyKey.trim()
    ? body.idempotencyKey.trim()
    : denseIdempotencyKey(toolId, payload, deviceId, ownerId);
  // Workspace root asserted SERVER-SIDE ONLY (never from the client).
  const hasWorkspace = toolIdToDaemonKind(toolId) !== "ai.infer";
  const workspaceRoot = hasWorkspace ? process.cwd() : null;

  const db = supabaseAdmin();
  try {
    // Step 2+3: deny-by-default scoped_grants check + idempotent row create.
    const created = await createDeviceCommand(db, {
      deviceId,
      kind: "managed.run",
      payload: { tool_id: toolId, ...payload },
      idempotencyKey,
      createdBy: ownerId,
    });
    if (!created.ok) return failAble(created);
    const row = created.command;

    // Step 4: real ack (dispatched→running) — re-checks scope with jobId.
    const ack = await ackCommand(db, row.id, deviceId);
    if (!ack.ok) return failAble(ack);

    // Step 5: the only network hop to the compute daemon.
    const forward = await forwardToComputeDaemon({
      toolId, payload, commandId: row.id, workspaceRoot,
    }, cfg);
    if (!forward.ok) {
      // Honest terminal failure on the SAME lifecycle (heartbeat never counts).
      const complete = await completeCommand(db, row.id, deviceId, { ok: false, error: `${forward.code}: ${forward.error}` });
      const status = complete.ok ? 502 : errStatus(complete.code ?? "INTERNAL_ERROR");
      return NextResponse.json({ ok: false, commandId: row.id, code: forward.code, error: forward.error, lifecycle: complete }, { status });
    }

    // Step 6: terminal EXACTLY ONCE with the daemon's real result.
    const complete = await completeCommand(db, row.id, deviceId, {
      ok: forward.status === "SUCCEEDED",
      result: forward.result,
      error: forward.status === "SUCCEEDED"
        ? undefined
        : (typeof forward.result.error === "string" && forward.result.error
            ? forward.result.error
            : forward.status),
    });
    if (!complete.ok) return failAble(complete);

    return NextResponse.json({ ok: true, commandId: row.id, status: complete.status, result: forward.result, created: created.created, relaySteps: RELAY_STEP_ORDER });
  } catch (error) {
    return failAble({ message: error instanceof Error ? error.message : String(error) });
  }
}
