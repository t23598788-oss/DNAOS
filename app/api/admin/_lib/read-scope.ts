/**
 * Admin-route read scope (STEP 1b, owner 2026-10-25).
 *
 * The AI/business boundary already runs under a verified DataScope. This module
 * applies the SAME scope to /api/admin/* routes that read companies, debts and
 * documents, so the control-room UI cannot become a second, unscoped door.
 *
 * Semantics:
 *   platform      → companyIds = null  (no restriction; super_admin operator)
 *   organization   → companyIds = the companies whose organization_id is in the
 *                    caller's membership (may be empty ⇒ sees nothing)
 *   none           → companyIds = empty Set and `deny()` returns 403
 *
 * Rows without a company id (e.g. unattributed business events) are visible
 * only in platform scope.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER, type AuthedUser } from "@/core/auth/session";
import type { DataScope } from "@/core/authority/data-scope";
import { resolveSessionDataScope } from "@/engines/authority/session-scope";
import { getVisibleCompanyIds } from "@/services/supabase/queries";

export interface AdminReadScope {
  scope: DataScope;
  /** null = platform (no restriction); a Set = exactly the visible companies */
  companyIds: Set<string> | null;
}

export async function resolveAdminReadScope(auth: AuthedUser): Promise<AdminReadScope> {
  const scope = await resolveSessionDataScope(auth);
  if (scope.mode === "platform") return { scope, companyIds: null };
  if (scope.mode !== "organization") return { scope, companyIds: new Set() };
  const companyIds = await getVisibleCompanyIds(scope);
  return { scope, companyIds: companyIds ?? new Set() };
}

/** Auth + scope in one call for routes that do not need the raw AuthedUser. */
export async function requireAdminReadScope(): Promise<AdminReadScope | NextResponse> {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  return resolveAdminReadScope(auth);
}

export function denyUnscoped(ctx: AdminReadScope): NextResponse | null {
  if (ctx.scope.mode === "none") {
    return NextResponse.json(
      { error: "ไม่มี scope ขององค์กรสำหรับอ่านข้อมูลนี้", reason: ctx.scope.reason },
      { status: 403 },
    );
  }
  return null;
}

export function isCompanyVisible(ctx: AdminReadScope, companyId: string | null | undefined): boolean {
  if (ctx.companyIds === null) return true;
  return Boolean(companyId) && ctx.companyIds.has(String(companyId));
}

export function filterRowsByCompany<T>(
  ctx: AdminReadScope,
  rows: readonly T[],
  companyIdOf: (row: T) => string | null | undefined,
): T[] {
  if (ctx.companyIds === null) return [...rows];
  return rows.filter((row) => isCompanyVisible(ctx, companyIdOf(row)));
}

/** A detail route must behave as "not found" outside the caller's scope. */
export function notFound(): NextResponse {
  return NextResponse.json({ error: "ไม่พบข้อมูล" }, { status: 404 });
}
