/**
 * Storage Intelligence — Command Gateway. The single HTTP entry point for all
 * 7 storage.* commands; the UI (app/admin/storage/page.tsx) never touches the
 * filesystem or engine directly, only this route. Every command runs through
 * requireAuth first — move_safe_to_trash is disabled pending an organization-scoped approval path, the rest
 * to the admin tier. Every mutating command defaults to dry-run.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuth, ADMIN_TIER, DISABLED_ROLE_TIER } from "@/core/auth";
import { supabaseAdmin } from "@/services/supabase/queries";
import {
  scanStorage,
  classifyScan,
  report,
  moveSafeToTrash,
  inspectDocker,
  verifySupabase,
  checkThreshold,
} from "@/engines/storage/engine";

const COMMAND_ROLES: Record<string, string[]> = {
  scan: ADMIN_TIER,
  classify: ADMIN_TIER,
  report: ADMIN_TIER,
  inspect_docker: ADMIN_TIER,
  verify_supabase: ADMIN_TIER,
  check_threshold: ADMIN_TIER,
  move_safe_to_trash: DISABLED_ROLE_TIER,
};

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: { code: "STORAGE_BAD_REQUEST", reason: "invalid JSON body", context: {}, recovery_action: "send { command, ...params }" } }, { status: 400 });
  }

  const command: string = body?.command;
  const roles = COMMAND_ROLES[command];
  if (!roles) {
    return NextResponse.json({ ok: false, error: { code: "STORAGE_UNKNOWN_COMMAND", reason: `unknown command: ${command}`, context: { validCommands: Object.keys(COMMAND_ROLES) }, recovery_action: "use one of storage.scan/classify/report/move_safe_to_trash/inspect_docker/verify_supabase/check_threshold" } }, { status: 400 });
  }

  const auth = await requireAuth(roles as any);
  if (auth instanceof NextResponse) return auth;

  const db = supabaseAdmin();

  try {
    switch (command) {
      case "scan": {
        const result = await scanStorage(db, auth.email);
        return NextResponse.json({ ok: true, ...result });
      }
      case "classify": {
        if (!body.scanRunId) return badRequest("scanRunId required");
        const result = await classifyScan(db, body.scanRunId, auth.email);
        return NextResponse.json({ ok: true, ...result });
      }
      case "report": {
        if (!body.scanRunId) return badRequest("scanRunId required");
        const result = await report(db, body.scanRunId);
        return NextResponse.json({ ok: true, ...result });
      }
      case "move_safe_to_trash": {
        if (!body.scanRunId) return badRequest("scanRunId required");
        const dryRun = body.dryRun !== false; // default true — explicit false required to act
        const result = await moveSafeToTrash(db, body.scanRunId, auth.email, { dryRun });
        return NextResponse.json({ ok: true, dryRun, ...result });
      }
      case "inspect_docker": {
        const result = inspectDocker();
        return NextResponse.json({ ok: true, result });
      }
      case "verify_supabase": {
        if (!body.bucket || !body.objectPath) return badRequest("bucket and objectPath required");
        const result = await verifySupabase(db, body.bucket, body.objectPath, body.expectedSha256);
        return NextResponse.json({ ok: true, result });
      }
      case "check_threshold": {
        const result = await checkThreshold(db, auth.email, body.reclaimableBytes ?? null);
        return NextResponse.json({ ok: true, ...result });
      }
      default:
        return badRequest("unhandled command");
    }
  } catch (e: any) {
    return NextResponse.json({
      ok: false,
      error: {
        code: e?.code ?? "STORAGE_OPERATION_FAILED",
        reason: e?.message ?? "unknown error",
        context: e?.context ?? {},
        recovery_action: "check logs, re-run storage.scan to get a fresh scanRunId",
      },
    }, { status: 500 });
  }
}

function badRequest(reason: string) {
  return NextResponse.json({ ok: false, error: { code: "STORAGE_BAD_REQUEST", reason, context: {}, recovery_action: "supply required params" } }, { status: 400 });
}
