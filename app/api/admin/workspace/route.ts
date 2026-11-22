/**
 * Workspace Lock Manager + Dependency Registry + Resource Migration Engine —
 * Command Gateway. Same pattern as app/api/admin/storage-intelligence/route.ts.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuth, ADMIN_TIER, DISABLED_ROLE_TIER } from "@/core/auth";
import { supabaseAdmin } from "@/services/supabase/queries";
import { acquireLockWithRetry, releaseLock } from "@/engines/workspace/lockManager";
import { getDependents, analyzeImpact } from "@/engines/workspace/dependencyRegistry";
import { createMigrationPlan, approveMigrationPlan, executeMigration } from "@/engines/workspace/migrationEngine";

const COMMAND_ROLES: Record<string, string[]> = {
  acquire_lock: ADMIN_TIER,
  release_lock: ADMIN_TIER,
  list_locks: ADMIN_TIER,
  get_dependents: ADMIN_TIER,
  analyze_impact: ADMIN_TIER,
  create_migration_plan: ADMIN_TIER,
  approve_migration_plan: DISABLED_ROLE_TIER,
  execute_migration: DISABLED_ROLE_TIER,
  list_conflicts: ADMIN_TIER,
};

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return badRequest("invalid JSON body");
  }

  const command: string = body?.command;
  const roles = COMMAND_ROLES[command];
  if (!roles) return badRequest(`unknown command: ${command}`, Object.keys(COMMAND_ROLES));

  const auth = await requireAuth(roles as any);
  if (auth instanceof NextResponse) return auth;

  const db = supabaseAdmin();

  try {
    switch (command) {
      case "acquire_lock": {
        if (!body.resourceType || !body.resourcePath || !body.sessionId) return badRequest("resourceType, resourcePath, sessionId required");
        const result = await acquireLockWithRetry(db, body.resourceType, body.resourcePath, auth.email, body.sessionId, { maxAttempts: body.maxAttempts ?? 1 });
        return NextResponse.json({ ok: true, result });
      }
      case "release_lock": {
        if (!body.lockId) return badRequest("lockId required");
        await releaseLock(db, body.lockId);
        return NextResponse.json({ ok: true });
      }
      case "list_locks": {
        const { data } = await db.from("workspace_locks").select("*").is("released_at", null).order("acquired_at", { ascending: false });
        return NextResponse.json({ ok: true, locks: data ?? [] });
      }
      case "get_dependents": {
        if (!body.resourcePath) return badRequest("resourcePath required");
        return NextResponse.json({ ok: true, dependents: getDependents(body.resourcePath) });
      }
      case "analyze_impact": {
        if (!body.resourcePath) return badRequest("resourcePath required");
        return NextResponse.json({ ok: true, impact: analyzeImpact(body.resourcePath) });
      }
      case "create_migration_plan": {
        if (!body.resourcePath || !body.resourceType) return badRequest("resourcePath, resourceType required");
        const plan = await createMigrationPlan(db, body.resourcePath, body.resourceType, auth.email);
        return NextResponse.json({ ok: true, plan });
      }
      case "approve_migration_plan": {
        if (!body.planId) return badRequest("planId required");
        const result = await approveMigrationPlan(db, body.planId, auth.email);
        return NextResponse.json({ ok: result.ok, reason: result.reason });
      }
      case "execute_migration": {
        if (!body.planId) return badRequest("planId required");
        const result = await executeMigration(db, body.planId, auth.email);
        return NextResponse.json({ ok: result.ok, trashPath: result.trashPath, reason: result.reason });
      }
      case "list_conflicts": {
        const { data } = await db.from("workspace_lock_conflicts").select("*").order("attempted_at", { ascending: false }).limit(100);
        return NextResponse.json({ ok: true, conflicts: data ?? [] });
      }
      default:
        return badRequest("unhandled command");
    }
  } catch (e: any) {
    return NextResponse.json({
      ok: false,
      error: { code: e?.code ?? "WORKSPACE_OPERATION_FAILED", reason: e?.message ?? "unknown error", context: e?.context ?? {}, recovery_action: "check lock/dependency state and retry" },
    }, { status: 500 });
  }
}

function badRequest(reason: string, context: unknown = {}) {
  return NextResponse.json({ ok: false, error: { code: "WORKSPACE_BAD_REQUEST", reason, context, recovery_action: "supply required params" } }, { status: 400 });
}
