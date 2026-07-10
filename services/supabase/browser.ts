import { createBrowserClient } from "@supabase/ssr";

// 400 days = Chrome's hard cap on any cookie's Max-Age (longer values get
// silently clamped by the browser anyway) — this is what makes "log in once,
// stay logged in on this device" work without a custom remember-me flag.
export const SESSION_COOKIE_MAX_AGE = 60 * 60 * 24 * 400;

// Browser-side Supabase client for the one real login form (app/login/page.tsx)
// and LogoutButton. Persists the session as cookies (not localStorage) so the
// server (middleware, Server Components, API routes) reads the exact same
// session — this is what makes it Single Sign-On instead of two separate
// client/server auth states.
export function createBrowserSupabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookieOptions: { maxAge: SESSION_COOKIE_MAX_AGE } }
  );
}