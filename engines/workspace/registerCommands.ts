/**
 * Registers storage.* and workspace.* (registry/command-registry.json) as
 * real Runtime-callable commands via core/runtime/engine.ts's
 * registerCommand() — the same real mechanism engines/business.ts already
 * uses (registerCommand("business.calculate_price", ...) etc). Before this
 * file, these 14 commands existed only as JSON documentation +
 * app/api/admin/storage-intelligence and .../workspace HTTP routes — never
 * actually invocable through core/runtime/engine.ts's executeCommand().
 *
 * Import this module once (engines/index.ts does, below) so the
 * registerCommand() calls run as a load-time side effect — identical
 * bootstrapping pattern to engines/business.ts.
 */
import { registerCommand } from "@/core/runtime/engine";
import { supabaseAdmin } from "@/services/supabase/queries";
import {
  scanStorage, classifyScan, report as storageReport, moveSafeToTrash,
  inspectDocker, verifySupabase, checkThreshold,
} from "@/engines/storage/engine";
import { acquireLockWithRetry, releaseLock } from "@/engines/workspace/lockManager";
import { getDependents, analyzeImpact } from "@/engines/workspace/dependencyRegistry";
import { createMigrationPlan, approveMigrationPlan, executeMigration } from "@/engines/workspace/migrationEngine";
import { verifyWorkspaceRoot } from "@/engines/workspace/workspaceRootVerifier";

function actorFrom(args: Record<string, unknown>): string {
  return String(args.actor ?? "runtime");
}

registerCommand("storage.scan", async (args) => scanStorage(supabaseAdmin(), actorFrom(args)));
registerCommand("storage.classify", async (args) => classifyScan(supabaseAdmin(), String(args.scanRunId ?? ""), actorFrom(args)));
registerCommand("storage.report", async (args) => storageReport(supabaseAdmin(), String(args.scanRunId ?? "")));
registerCommand("storage.move_safe_to_trash", async (args) =>
  moveSafeToTrash(supabaseAdmin(), String(args.scanRunId ?? ""), actorFrom(args), { dryRun: args.dryRun !== false }));
registerCommand("storage.inspect_docker", async () => inspectDocker());
registerCommand("storage.verify_supabase", async (args) =>
  verifySupabase(supabaseAdmin(), String(args.bucket ?? ""), String(args.objectPath ?? ""), args.expectedSha256 as string | undefined));
registerCommand("storage.check_threshold", async (args) => checkThreshold(supabaseAdmin(), actorFrom(args), (args.reclaimableBytes as number) ?? null));

registerCommand("workspace.acquire_lock", async (args) =>
  acquireLockWithRetry(supabaseAdmin(), args.resourceType as any, String(args.resourcePath ?? ""), actorFrom(args), String(args.sessionId ?? "")));
registerCommand("workspace.release_lock", async (args) => releaseLock(supabaseAdmin(), String(args.lockId ?? "")));
registerCommand("workspace.get_dependents", async (args) => getDependents(String(args.resourcePath ?? "")));
registerCommand("workspace.analyze_impact", async (args) => analyzeImpact(String(args.resourcePath ?? "")));
registerCommand("workspace.create_migration_plan", async (args) =>
  createMigrationPlan(supabaseAdmin(), String(args.resourcePath ?? ""), String(args.resourceType ?? "file"), actorFrom(args)));
registerCommand("workspace.approve_migration_plan", async (args) =>
  approveMigrationPlan(supabaseAdmin(), String(args.planId ?? ""), actorFrom(args)));
registerCommand("workspace.execute_migration", async (args) =>
  executeMigration(supabaseAdmin(), String(args.planId ?? ""), actorFrom(args)));
registerCommand("workspace.verify_root", async (args) => verifyWorkspaceRoot({
  workspacePath: args.workspacePath as string | undefined,
  expectedRepositoryRoot: args.expectedRepositoryRoot as string | undefined,
}));

export const STORAGE_WORKSPACE_COMMANDS_REGISTERED = true;
