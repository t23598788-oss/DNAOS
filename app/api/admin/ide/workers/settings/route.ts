/**
 * GET/POST /api/admin/ide/workers/settings — real, Owner-only Worker
 * Settings (owner, 2026-08-08, Software Factory Step 13.6, Section 15).
 * Never a Public Settings surface — never returns/accepts a secret
 * value; only real CONFIGURED/NOT_CONFIGURED/ACTIVE/PARTIAL/UNKNOWN
 * status per provider.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { getWorkerSettings, updateWorkerSettings, computeProviderStatuses } from "../../_lib/workerSettingsRuntime";

export async function GET() {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  const [settings, providerStatuses] = await Promise.all([
    getWorkerSettings(auth.id),
    computeProviderStatuses(auth.id),
  ]);
  return NextResponse.json({ ok: true, settings, providerStatuses });
}

export async function POST(req: Request) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { body = {}; }
  // Real, explicit allow-list — never accepts an arbitrary field (no
  // secret-shaped key can ever be persisted through this route).
  const allowedKeys = ["providerEnabled", "localCloudPreference", "allowedWorkerTypes", "budgetDefaults", "privacyPolicy", "fallbackPolicy", "modelPreference", "toolAccess", "maxContextBytes", "approvalMode"];
  const patch: Record<string, unknown> = {};
  for (const k of allowedKeys) if (k in body) patch[k] = body[k];
  const updated = await updateWorkerSettings(auth.id, patch);
  return NextResponse.json({ ok: true, settings: updated });
}
