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
    {
      cookieOptions: { maxAge: SESSION_COOKIE_MAX_AGE },
      // Login-flow debug instrumentation (2026-07-14) — explicit getAll/setAll
      // that log cookie NAMES only (never values), otherwise identical to
      // @supabase/ssr's own default document.cookie-based implementation
      // (createStorageFromOptions's documentCookieGetAll/documentCookieSetAll
      // in node_modules/@supabase/ssr/dist/module/cookies.js). Remove once the
      // login-bounce investigation is closed.
      cookies: {
        getAll() {
          if (typeof document === "undefined") return [];
          const parsed = document.cookie.split(";").map((c) => c.trim()).filter(Boolean);
          const all = parsed.map((c) => {
            const idx = c.indexOf("=");
            return { name: c.slice(0, idx), value: c.slice(idx + 1) };
          });
          console.log("[TRACE-LOGIN] browser client: getAll cookies", { cookieNames: all.map((c) => c.name) });
          return all;
        },
        setAll(cookiesToSet) {
          console.log("[TRACE-LOGIN] browser client: setAll cookies", { cookieNames: cookiesToSet.map((c) => c.name) });
          cookiesToSet.forEach(({ name, value, options }) => {
            const opts = options ?? {};
            let str = `${name}=${value}`;
            if (opts.maxAge != null) str += `; Max-Age=${opts.maxAge}`;
            if (opts.path) str += `; Path=${opts.path}`;
            if (opts.domain) str += `; Domain=${opts.domain}`;
            if (opts.sameSite) str += `; SameSite=${opts.sameSite}`;
            if (opts.secure) str += `; Secure`;
            document.cookie = str;
          });
        },
      },
    }
  );
}