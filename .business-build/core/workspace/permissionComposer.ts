import type { AppRole } from "@/core/auth/session";
import type { ApplicationDefinition } from "./application";

// Permission Composer (Phase 5, Step 30) — a visibility layer only. It
// creates no session, checks no password, issues no token — it only reads
// AppRole (already resolved elsewhere, by core/auth/session.ts's
// getAuthedUser, the one real source of truth for "who is this") against
// an ApplicationDefinition's own requiredRoles list. There is no separate
// per-board or per-widget role data anywhere in this codebase yet, so
// board/widget visibility fall back to application-level visibility rather
// than inventing finer-grained permission data that doesn't exist.
export function isApplicationVisible(app: ApplicationDefinition, role: AppRole): boolean {
  return app.requiredRoles.includes(role);
}

export function isBoardVisible(app: ApplicationDefinition, role: AppRole): boolean {
  return isApplicationVisible(app, role);
}

export function isWidgetVisible(app: ApplicationDefinition, role: AppRole): boolean {
  return isApplicationVisible(app, role);
}