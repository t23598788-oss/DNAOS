import { createServerSupabase } from "@/services/supabase/server";

// TASK-033 (registry/CHANGELOG.json DNA-000056 FAIL 1, fixed DNA-000067): thin
// Gateway wrapper so core/auth/session.ts (80 real callers) can resolve the
// live Supabase Auth session without importing services/ directly, which
// dependency-graph.json does not allow for the core layer. gateway is already
// allowed to import services (registry/dependency-graph.json allowed_imports.gateway)
// and is the architecturally sanctioned "one door" per CLAUDE.md — core -> gateway
// is the intended pattern, core -> services bypassing it is not. Read-only,
// no writes — this wrapper does not participate in the confirmed-write flow
// (gateway/actions.ts's preview -> token -> execute), it exists purely to keep
// the layer boundary honest for a read core already needed.
export async function getServerSupabaseClient() {
  return createServerSupabase();
}
