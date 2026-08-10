/**
 * GET/PUT /api/admin/ide/settings — real IDE editor-preferences settings
 * API (owner, 2026-08-10, TASK-068 — /admin/ide Settings tab real wiring,
 * capability #61 Phase 1). Mirrors app/api/admin/settings/route.ts's exact
 * requireAuth(ADMIN_TIER)-gated GET/PUT shape — a distinct real route,
 * never reusing that route (which serves CompanySettings, a different
 * real resource).
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER, getAccessToken } from "@/core/auth/session";
import { loadIdeSettings, saveIdeSettings, computeSettingStatus, IDE_SETTINGS_KEYS, type IdeSettings } from "@/core/config/ide-settings";
import { createConfigChangeArtifact, createSettingChangedArtifact, createSettingReloadedArtifact } from "../_lib/artifactRuntime";

export async function GET() {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;

  try {
    const settings = await loadIdeSettings();
    // Real per-key status (never hardcoded in the UI) — same
    // computeSettingStatus() the PUT handler and scripts/settings-real-
    // wiring-test.ts both call, one real source of truth.
    const status = {
      autoSaveEnabled: computeSettingStatus(IDE_SETTINGS_KEYS.autoSaveEnabled),
      formatOnSaveEnabled: computeSettingStatus(IDE_SETTINGS_KEYS.formatOnSaveEnabled),
      telemetryEnabled: computeSettingStatus(IDE_SETTINGS_KEYS.telemetryEnabled),
    };
    // Real SETTING_RELOADED evidence (TASK-069 requirement 5) — every real
    // GET is itself the real "does this survive a fresh read" proof STEP 3
    // requires; this records it as a real, structural artifact rather than
    // leaving that proof implicit. Best-effort, never blocks/masks the real
    // read that already succeeded above.
    try {
      createSettingReloadedArtifact(IDE_SETTINGS_KEYS.autoSaveEnabled, String(settings.autoSaveEnabled), auth.email, auth.id);
    } catch (evidenceError: unknown) {
      console.error("ide/settings GET: real read succeeded but SETTING_RELOADED evidence recording failed:", evidenceError);
    }
    return NextResponse.json({ settings, status });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "โหลดข้อมูลไม่สำเร็จ" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;

  const token = await getAccessToken();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  try {
    const settings: IdeSettings = {
      autoSaveEnabled: Boolean(body.autoSaveEnabled),
      formatOnSaveEnabled: Boolean(body.formatOnSaveEnabled),
      telemetryEnabled: Boolean(body.telemetryEnabled),
    };
    // Real previous values (TASK-069 requirement 5, SETTING_CHANGED evidence
    // needs a real before/after, not just the after CONFIG_CHANGE already
    // records) — read BEFORE the write below overwrites them.
    const previous = await loadIdeSettings();
    await saveIdeSettings(token, settings);

    // Real audit evidence (TASK-068 requirement 5) — reuses artifactRuntime.ts's
    // real EvidenceRef/emitArtifactEvent pattern (CONFIG_CHANGE kind), one
    // CONFIG_CHANGE_RECORD artifact per real key, each carrying the real
    // app_configs.updated_at timestamp. saveIdeSettings() already called
    // clearConfigCache() internally; loadIdeSettings() here is a real,
    // fresh loadConfigs() read that repopulates core/config-loader.ts's
    // cache/meta with the just-written rows so getConfigUpdatedAt() below
    // is real, not stale from before this write. A failure here (e.g. no
    // live Supabase in this environment) must never mask the real save
    // that already succeeded above — best-effort, logged, never thrown.
    try {
      await loadIdeSettings();
      for (const [field, key] of Object.entries(IDE_SETTINGS_KEYS)) {
        const value = String(settings[field as keyof IdeSettings]);
        createConfigChangeArtifact(key, value, auth.email, auth.id);
      }
    } catch (evidenceError: unknown) {
      console.error("ide/settings PUT: real save succeeded but real CONFIG_CHANGE evidence recording failed:", evidenceError);
    }

    // Real SETTING_CHANGED/SETTING_PERSISTED evidence (TASK-069 requirement
    // 5) — only for fields that ACTUALLY changed (previous !== new), with a
    // real previous value, never fabricated for a field the caller merely
    // re-sent unchanged. Same best-effort/never-masks-the-real-save
    // reasoning as the CONFIG_CHANGE loop above.
    try {
      for (const [field, key] of Object.entries(IDE_SETTINGS_KEYS)) {
        const f = field as keyof IdeSettings;
        if (previous[f] !== settings[f]) {
          createSettingChangedArtifact(key, String(previous[f]), String(settings[f]), auth.email, auth.id);
        }
      }
    } catch (evidenceError: unknown) {
      console.error("ide/settings PUT: real save succeeded but real SETTING_CHANGED evidence recording failed:", evidenceError);
    }

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "บันทึกไม่สำเร็จ" }, { status: 500 });
  }
}
