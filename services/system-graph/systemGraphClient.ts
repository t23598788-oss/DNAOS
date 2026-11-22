import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type SystemGraphClientResult =
  | { ok: true; client: SupabaseClient<any, any, "system", any, any>; projectRef: string }
  | { ok: false; code: "SYSTEM_DB_NOT_CONFIGURED" | "SYSTEM_DB_PROJECT_MISMATCH" };

/**
 * System metadata lives in the `system` schema of the one canonical Supabase
 * project. Pinning the project ref prevents legacy System DB settings from
 * redirecting code-graph and route-map traffic to a second project.
 */
export function getSystemGraphClient(): SystemGraphClientResult {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const expectedProjectUrl = process.env.DNAOS_CANONICAL_SUPABASE_URL || "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !serviceRoleKey || !expectedProjectUrl) return { ok: false, code: "SYSTEM_DB_NOT_CONFIGURED" };

  try {
    const parsed = new URL(url);
    const expected = new URL(expectedProjectUrl);
    const hostRef = parsed.hostname.split(".")[0];
    if (parsed.protocol !== "https:" || expected.protocol !== "https:" || parsed.origin !== expected.origin) {
      return { ok: false, code: "SYSTEM_DB_PROJECT_MISMATCH" };
    }
  } catch {
    return { ok: false, code: "SYSTEM_DB_PROJECT_MISMATCH" };
  }

  return {
    ok: true,
    projectRef: new URL(url).hostname.split(".")[0],
    client: createClient(url, serviceRoleKey, {
      db: { schema: "system" },
      auth: { persistSession: false, autoRefreshToken: false },
    }),
  };
}
