/**
 * Resource Migration Engine — Scan -> Dependency Analysis -> Impact Analysis
 * -> Migration Plan -> Approval -> Move To Trash -> Audit. The moment any
 * dependent is found, safe=false immediately — engines/storage/engine.ts's
 * moveSafeToTrash() calls createMigrationPlan() as a hard pre-check before
 * it will ever move a real file, so storage-intelligence's own SAFE
 * classification is no longer the only gate.
 */
import { randomUUID } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ResourceMigrationPlan } from "@/core/shared/types";
import { analyzeImpact } from "./dependencyRegistry";
import { moveToTrash } from "@/engines/storage/adapters/trashAdapter";

export async function createMigrationPlan(
  db: SupabaseClient,
  resourcePath: string,
  resourceType: string,
  requestedBy: string
): Promise<ResourceMigrationPlan> {
  const correlationId = randomUUID();
  const impact = analyzeImpact(resourcePath);

  const { data: row, error } = await db.from("resource_migration_plans").insert({
    resource_path: resourcePath,
    resource_type: resourceType,
    requested_by: requestedBy,
    dependency_count: impact.dependency_count,
    dependents: impact.dependents,
    safe: impact.safe_to_migrate,
    status: impact.safe_to_migrate ? "planned" : "blocked",
    correlation_id: correlationId,
  }).select().single();

  if (error || !row) throw Object.assign(new Error("migration plan insert failed"), { code: "MIGRATION_PLAN_INSERT_FAILED", context: { error } });

  if (!impact.safe_to_migrate) {
    for (const dep of impact.dependents) {
      await db.from("resource_migration_blocks").insert({
        plan_id: row.id,
        resource_path: resourcePath,
        blocking_dependent: dep.source,
        dependency_kind: dep.kind,
        reason: `${dep.source} (${dep.kind}) depends on this resource — real dependency found via ${dep.source_generated}`,
      });
    }
  }

  return {
    id: row.id, resource_path: resourcePath, resource_type: resourceType,
    dependency_count: impact.dependency_count, dependents: impact.dependents,
    safe: impact.safe_to_migrate, approved: false, status: row.status, correlation_id: correlationId,
  };
}

export async function approveMigrationPlan(db: SupabaseClient, planId: string, approvedBy: string): Promise<{ ok: boolean; reason?: string }> {
  const { data: plan } = await db.from("resource_migration_plans").select("*").eq("id", planId).single();
  if (!plan) return { ok: false, reason: "plan not found" };
  if (!plan.safe) return { ok: false, reason: "plan is not SAFE — real dependents exist, cannot approve" };

  await db.from("resource_migration_plans").update({ approved: true, approved_by: approvedBy, approved_at: new Date().toISOString(), status: "approved" }).eq("id", planId);
  return { ok: true };
}

export async function executeMigration(db: SupabaseClient, planId: string, actor: string): Promise<{ ok: boolean; trashPath?: string; reason?: string }> {
  const { data: plan } = await db.from("resource_migration_plans").select("*").eq("id", planId).single();
  if (!plan) return { ok: false, reason: "plan not found" };
  if (!plan.safe || !plan.approved) return { ok: false, reason: "plan must be SAFE and approved before execution" };

  try {
    const result = moveToTrash(plan.resource_path);
    await db.from("resource_migration_plans").update({ status: "moved" }).eq("id", planId);
    return { ok: true, trashPath: result.trash_path };
  } catch (e: any) {
    await db.from("resource_migration_plans").update({ status: "failed" }).eq("id", planId);
    return { ok: false, reason: e?.message ?? "unknown error" };
  }
}
