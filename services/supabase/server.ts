import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { SESSION_COOKIE_MAX_AGE } from "@/services/supabase/browser";

// Server-side Supabase client bound to the real request's cookies — this is
// the ONE session every Portal and every API route reads (TASK-001 SSO).
// Session refresh happens automatically: middleware.ts calls supabase.auth.getUser()
// on every request, which rotates the access/refresh token cookies via setAll below.
export async function createServerSupabase() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: { maxAge: SESSION_COOKIE_MAX_AGE },
      cookies: {
        getAll() {
          const all = cookieStore.getAll();
          console.log("[TRACE-LOGIN] server client: getAll cookies", { cookieNames: all.map((c) => c.name) });
          return all;
        },
        setAll(cookiesToSet) {
          console.log("[TRACE-LOGIN] server client: setAll cookies", { cookieNames: cookiesToSet.map((c) => c.name) });
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch (err) {
            // called from a Server Component render — middleware.ts already
            // refreshes the session on every request, so this is safe to ignore
            console.log("[TRACE-LOGIN] server client: setAll threw (expected in Server Component render)", err);
          }
        },
      },
    }
  );
}