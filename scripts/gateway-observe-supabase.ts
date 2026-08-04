#!/usr/bin/env npx tsx
/**
 * Integration Gateway — Supabase Observe poll (owner, 2026-08-05).
 * Supabase has no single webhook this project already receives, so this
 * script is the Supabase side of the Observe Channel: runs
 * observeSupabaseHealth + observeMigrationState (engines/integration-gateway/adapters/supabase.ts)
 * and publishes both through the same event bus GitHub/Vercel's webhook
 * routes use. Run manually (npm run gateway:observe:supabase) or on a
 * schedule — no schedule is wired up yet, per "Observe first, prove it
 * works" instruction.
 */
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { createClient } from "@supabase/supabase-js";
import { observeSupabaseHealth, observeMigrationState } from "../engines/integration-gateway/adapters/supabase";
import { publish } from "../engines/integration-gateway/event-bus/bus";

const ROOT = join(__dirname, "..");

try {
  const envFile = readFileSync(join(ROOT, ".env.local"), "utf8");
  for (const line of envFile.split("\n")) {
    if (!line.includes("=") || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    const key = line.slice(0, i);
    if (!process.env[key]) process.env[key] = line.slice(i + 1);
  }
} catch {
  // no .env.local — falls through to the missing-env-var check below
}

async function main() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error("[gateway-observe-supabase] missing Supabase env vars");
    process.exit(1);
  }
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  const healthEvent = await observeSupabaseHealth(db);
  const healthResult = await publish(db, healthEvent);
  console.log(`[gateway-observe-supabase] health: ${healthEvent.evidence.ok ? "OK" : "UNHEALTHY"} (${healthResult.ok ? "published" : healthResult.reason})`);

  const migrationsDir = join(ROOT, "supabase/migrations");
  if (existsSync(migrationsDir)) {
    const migrationEvent = observeMigrationState(migrationsDir);
    const migrationResult = await publish(db, migrationEvent);
    console.log(`[gateway-observe-supabase] migrations: ${migrationEvent.evidence.count} files, latest ${migrationEvent.evidence.latest} (${migrationResult.ok ? "published" : migrationResult.reason})`);
  }
}

main().catch((e) => {
  console.error("[gateway-observe-supabase] fatal:", e);
  process.exit(1);
});
