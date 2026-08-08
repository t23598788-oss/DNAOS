/**
 * GET /api/admin/ide/global-factory — real, live-computed Global Factory
 * Report + Runtime Dependency Graph + Factory Runtime Report (owner,
 * 2026-08-08, Software Factory Step 11). Reuses globalFactoryRuntime.ts
 * only — no new Runtime/Queue/Artifact/Evidence Store (Rule 103).
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { computeGlobalFactoryReport, computeRuntimeDependencyGraph, computeFactoryRuntimeReport } from "../_lib/globalFactoryRuntime";

export async function GET() {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;

  const global = computeGlobalFactoryReport();
  const runtimeDependency = computeRuntimeDependencyGraph();
  const factoryRuntime = computeFactoryRuntimeReport();
  return NextResponse.json({ ok: true, global, runtimeDependency, factoryRuntime });
}
