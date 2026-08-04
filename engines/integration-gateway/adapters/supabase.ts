/**
 * Integration Gateway — Supabase Adapter (owner, 2026-08-05). Observe
 * Channel only. Unlike GitHub/Vercel, Supabase has no single webhook this
 * project already receives, so this adapter is poll-based: called by
 * scripts/gateway-observe-supabase.ts (run manually or on a schedule),
 * never guesses state — a failed health check produces a real "unhealthy"
 * evidence.ok:false event, not a skipped one.
 */
import { readdirSync } from "fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { GatewayEvent } from "../contracts/event";

export async function observeSupabaseHealth(db: SupabaseClient): Promise<GatewayEvent> {
  const startedAt = Date.now();
  const { error } = await db.from("dev_loop_sessions").select("id").limit(1);
  const latencyMs = Date.now() - startedAt;

  return {
    event_id: `EVT-supabase-health-${startedAt}`,
    provider: "supabase",
    capability: "database.health.observed",
    channel: "observe",
    action: "observe",
    session_id: null,
    change_id: null,
    evidence: { ok: !error, latency_ms: latencyMs, error: error?.message ?? null },
    requested_effect: "none",
    requires_owner_approval: false,
    occurred_at: new Date().toISOString(),
  };
}

/** Real migration file listing from disk — the same source of truth the
 * Supabase CLI itself reads, never queried from a remote "applied migrations"
 * table here (that would require a DB round trip this adapter doesn't need
 * to make just to report what's on disk). */
export function observeMigrationState(migrationsDir: string): GatewayEvent {
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  return {
    event_id: `EVT-supabase-migrations-${Date.now()}`,
    provider: "supabase",
    capability: "database.migration.observed",
    channel: "observe",
    action: "observe",
    session_id: null,
    change_id: files.length > 0 ? files[files.length - 1] : null,
    evidence: { count: files.length, latest: files[files.length - 1] ?? null, files },
    requested_effect: "none",
    requires_owner_approval: false,
    occurred_at: new Date().toISOString(),
  };
}
