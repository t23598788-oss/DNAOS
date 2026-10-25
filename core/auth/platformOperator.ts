/**
 * Platform management plane decision (owner directive 2026-10-20).
 *
 * Developer Plane = IDE, Dev Loop, Deploy, Release, Build, source fs,
 * Worker Execute. Only platform operators may use it:
 *   - super_admin: platform-level by role (registry role_tiers.platform_management)
 *   - admin: ONLY when explicitly granted in registry platform_operator_grants.admin_emails
 *   - employee and business admins without a grant: DENIED
 *   - ai_service / external agents: never a session user, so always DENIED
 *
 * Single authority: registry/permissions.json. Consumed by core/auth/requireAuth.ts
 * (API) and core/auth/requireAuthPage.ts (pages).
 */
import permissions from "@/registry/permissions.json";
import type { AppRole } from "./session";

export const PLATFORM_MANAGEMENT_TIER = permissions.role_tiers.platform_management as AppRole[];

const adminGrants = (permissions.platform_operator_grants.admin_emails as string[]).map((e) =>
  e.trim().toLowerCase(),
);

export interface PlatformSubject {
  role: AppRole | string | null;
  email: string | null;
}

export function isPlatformOperator(subject: PlatformSubject): boolean {
  if (!subject.role || !(PLATFORM_MANAGEMENT_TIER as string[]).includes(subject.role)) return false;
  if (subject.role === "super_admin") return true;
  if (subject.role === "admin") {
    const email = (subject.email ?? "").trim().toLowerCase();
    return email !== "" && adminGrants.includes(email);
  }
  return false;
}
