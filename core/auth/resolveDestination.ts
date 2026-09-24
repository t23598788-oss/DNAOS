import permissions from "@/registry/permissions.json";
import type { AppRole } from "./session";

const WORKSPACE_LANDING = permissions.workspace_landing as unknown as Record<string, string>;

// nextPath comes from a URL query param (?next=) a visitor controls directly —
// middleware.ts only ever sets it to req.nextUrl.pathname (always a same-origin
// path), but anyone can also link straight to /login?next=<anything>. Only trust
// it if it's a real same-origin path: starts with exactly one "/", never "//"
// (protocol-relative, e.g. //evil.com) and never contains "://" (an absolute
// URL) — a standard open-redirect guard. AUTH-P3 defect fix (2026-07-14); this
// gap pre-dates EWA, the original ROLE_HOME/landingPathFor had the same
// unvalidated pattern.
// Exported (2026-09-24): every other ?next= consumer (login auto-login branch,
// /auth/confirm) now guards through THIS function instead of re-implementing
// `startsWith("/")`, which //evil.com passes. Also rejects a leading
// backslash: WHATWG URL parsing treats "\" like "/" for special schemes, so
// `/\evil.com` also becomes protocol-relative (external).
export function isSafeInternalPath(path: string): boolean {
  return (
    path.startsWith("/") &&
    !path.startsWith("//") &&
    !path.startsWith("/\\") &&
    !path.includes("://")
  );
}

// The one place "where does this role land after login" is decided (Enterprise
// Workspace Architecture, Phase 1). Authentication (supabase.auth.signInWithPassword)
// only ever returns a session — it must never carry an opinion about UI destination.
// nextPath (the page a user was bounced from, e.g. by middleware.ts) always wins over
// the role default, same precedence the old inline ROLE_HOME/landingPathFor used.
export function resolveDestination(role: AppRole, nextPath?: string | null): string {
  if (nextPath && isSafeInternalPath(nextPath)) return nextPath;
  return WORKSPACE_LANDING[role] || "/";
}
