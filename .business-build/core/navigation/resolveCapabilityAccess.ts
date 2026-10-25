/**
 * Central Authority — Business Capability Access resolver (SLICE-1 of the
 * locked Full System Upgrade Line, owner decision D1=A, 2026-09-23).
 *
 * The one place that decides which BUSINESS TOOLS a role may see in the
 * Application Workspace (/workspace). It reads
 * registry/permissions.json#capability_access — the same single-registry
 * pattern core/navigation/resolveNavItems.ts already uses for workspace
 * navigation (permissions.route_access). No component may hardcode a role
 * list, and no second permission file exists anywhere.
 *
 * DEFAULT IS DENY: a tool key with no capability_access entry is never
 * returned, so a new tool cannot leak to everyone by being forgotten.
 *
 * Boundary (important): this is a PRESENTATION filter only. It never replaces
 * the credential/authority check inside an API route — every server route
 * still calls core/auth/requireAuth.ts (which reads role_tiers from this same
 * registry) on every request, and pages still resolve the real session through
 * core/auth/session.ts#getAuthedUser. Losing this filter must never be what
 * stands between a role and real data.
 */
import permissions from "@/registry/permissions.json";
import type { AppRole } from "@/core/auth/session";

/** tool key → roles allowed to see it (registry/permissions.json#capability_access) */
const CAPABILITY_ACCESS = permissions.capability_access as Record<string, AppRole[]>;

/** True only when the registry explicitly grants this tool key to this role. */
export function isCapabilityAllowed(toolKey: string, role: AppRole): boolean {
  const roles = CAPABILITY_ACCESS[toolKey];
  return Array.isArray(roles) && roles.includes(role);
}

/**
 * Every business-tool key this role is granted, in registry order. Callers
 * keep their own display order by filtering their own list with this result
 * (`TOOLS.filter((t) => allowed.includes(t.key))`) instead of rendering in
 * registry order.
 */
export function resolveAllowedCapabilities(role: AppRole): string[] {
  return Object.keys(CAPABILITY_ACCESS).filter((toolKey) => isCapabilityAllowed(toolKey, role));
}
