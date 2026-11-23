import { createClient } from "@supabase/supabase-js";

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !key) throw new Error("Development history database access is not configured");

  const recordKey = process.env.DNAOS_RECORD_KEY?.trim() || "dnaos-platform";
  const limit = Number(process.env.DNAOS_HISTORY_LIMIT ?? 50);
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    throw new Error("DNAOS_HISTORY_LIMIT must be an integer between 1 and 200");
  }

  const supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: events, error: eventsError } = await supabase.rpc("read_development_history", {
    p_record_key: recordKey,
    p_limit: limit,
  });
  if (eventsError) throw new Error("Development history could not be read");

  console.log(JSON.stringify({ record_key: recordKey, events: events ?? [] }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Development history read failed");
  process.exitCode = 1;
});
