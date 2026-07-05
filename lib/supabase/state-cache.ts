import { supabase } from "./queries";

export interface DisplayState {
  activeView: string;
  data: Record<string, unknown>;
}

const DEFAULT_STATE: DisplayState = { activeView: "IDLE", data: {} };
const CACHE_KEY = "display_state";

export async function getDisplayState(sessionId = "default"): Promise<DisplayState> {
  const { data, error } = await supabase()
    .from("kv_cache")
    .select("value")
    .eq("key", `${CACHE_KEY}:${sessionId}`)
    .maybeSingle();

  if (error || !data) return DEFAULT_STATE;
  return data.value as DisplayState;
}

export async function setDisplayState(state: DisplayState, sessionId = "default"): Promise<void> {
  const key = `${CACHE_KEY}:${sessionId}`;
  await supabase()
    .from("kv_cache")
    .upsert({ key, value: state, updated_at: new Date().toISOString() }, { onConflict: "key" });
}
