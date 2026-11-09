/**
 * Simulator environment loader.
 *
 * Reads .env.local EXACTLY as the app does (Next.js loads it automatically).
 * We never override a variable that is already set, and we never print values.
 *
 * Nothing here provisions a secret. If a secret is missing, the actors send
 * their request WITHOUT a signature and report that fact — the system then
 * answers with whatever it really answers (503 / 401). That response is the
 * finding; it is not a failure of the harness.
 */
import { readFileSync, existsSync } from "node:fs";

let loaded = false;

export function loadEnv(file = ".env.local"): void {
  if (loaded) return;
  loaded = true;
  if (!existsSync(file)) return;
  const text = readFileSync(file, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1];
    let value = m[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

/** The real endpoints under test (next dev). */
export const BASE_URL = process.env.SIM_BASE_URL ?? "http://127.0.0.1:3000";

/** The secrets the outside world must possess to be believed by the system. */
export const SECRET_NAMES = [
  "LINE_CHANNEL_SECRET",
  "KBANK_WEBHOOK_SECRET",
  "CRON_SECRET",
  "DRIVER_TRACKING_SECRET",
] as const;

export function secret(name: string): string | undefined {
  const value = process.env[name];
  return value && value.length > 0 ? value : undefined;
}

export function secretState(): Array<{ name: string; present: boolean }> {
  return SECRET_NAMES.map((name) => ({ name, present: Boolean(secret(name)) }));
}

/** Host of the database the app itself is wired to (no keys, no values). */
export function dbHost(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  return url.replace(/^https?:\/\//, "");
}
