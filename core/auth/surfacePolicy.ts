import permissions from "@/registry/permissions.json";

/**
 * SURFACE / CAPABILITY-ACTION POLICY — the API + runtime half of the
 * Business ⇄ Developer control-surface split (owner directive 2026-10-12).
 *
 *  - A pure resolver that reads ONE existing authority:
 *    registry/permissions.json#capability_actions (the same single-registry
 *    pattern route_access / api_access / capability_access already use).
 *  - It decides only ONE thing: may this HTTP request perform a
 *    developer-plane ACTION from the caller's current SURFACE?
 *
 * NOT: a second identity/session system (who is logged in is still decided
 * only by core/auth/session.ts + requireAuth/requireAuthPage) · NOT a second
 * permission registry (every list lives in registry/permissions.json only) ·
 * NOT an AI-provider check (separation is by capability + action, never by
 * provider name).
 *
 * AUTHORITY MODEL (already in the system, not invented here):
 *  - dna-os-step2/control/owner-surface-separation/surface.ts —
 *    STRICT_OPERATIONAL_DEVELOPMENT_SURFACE_SEPARATION_V1: "Authority domains
 *    are routing/exposure, not chat policy"; operational surface cannot modify
 *    source (operationalModifySource → false) and source READ ≠ source WRITE
 *    (sourceReadIsNotWrite). This module wires that model into the API edge.
 *  - Surfaces are ROUTING only. Actually changing source still goes through
 *    the pre-existing chain unchanged: requireAuth(ADMIN_TIER) →
 *    app/api/admin/ide/_lib/fsSecurity.ts → review/build/deploy gates →
 *    scripts/deploy-gate.ts. Nothing here grants, replaces or widens it.
 *
 * SURFACE RESOLUTION (fail-closed):
 *  - cookie `dna_os_surface=development` → DEVELOPMENT surface
 *  - anything else (absent, unknown, tampered) → OPERATIONAL = Business
 *    Workspace = DENY on every developer-plane write action.
 *  - The cookie is written ONLY by middleware.ts and only as a side effect of
 *    opening a workspace entry URL (page navigation, never an API call), so
 *    an API caller cannot mint its own surface.
 */

export type SurfaceId = "operational" | "development";

/** Single cookie name — written by middleware.ts, read here and there only. */
export const SURFACE_COOKIE = "dna_os_surface";

interface CapabilityActionRegistry {
  default_surface?: string;
  write_methods?: string[];
  surfaces?: Record<string, { entry_urls?: string[]; cookie_value?: string; th?: string }>;
  deny?: Record<string, { prefixes: string[]; th?: string; authority?: string }>;
  allow?: Record<string, { prefixes: string[]; th?: string; authority?: string }>;
}

const REGISTRY = permissions as typeof permissions & {
  capability_actions?: CapabilityActionRegistry;
};

function capabilityActions(): CapabilityActionRegistry {
  const policy = REGISTRY.capability_actions;
  if (!policy || !policy.deny || !policy.write_methods) {
    // Fail closed: a missing/unreadable policy never opens a developer write.
    return { write_methods: ["POST", "PUT", "PATCH", "DELETE"], deny: {}, allow: {} };
  }
  return policy;
}

/** Fail-closed surface resolution — anything that is not explicitly the
 *  DEVELOPMENT surface is the OPERATIONAL (Business) surface. */
export function resolveSurface(cookieValue: string | undefined | null): SurfaceId {
  const policy = capabilityActions();
  const development = policy.surfaces?.development?.cookie_value ?? "development";
  return cookieValue === development ? "development" : "operational";
}

/** Workspace entry URLs that switch the caller's surface (page navigation
 *  only). Returns the target surface for a page path, or null when the path
 *  is not a workspace entry — API calls and ordinary pages never switch. */
export function surfaceForPagePath(pathname: string): SurfaceId | null {
  const policy = capabilityActions();
  for (const [id, def] of Object.entries(policy.surfaces ?? {})) {
    if ((def.entry_urls ?? []).some((url) => pathname === url || pathname.startsWith(url + "/"))) {
      return id === "development" ? "development" : "operational";
    }
  }
  return null;
}

export interface SurfaceDecision {
  allowed: boolean;
  /** capability action that produced the decision ("" when none matched) */
  action: string;
  surface: SurfaceId;
  reason: string;
  code?: string;
}

function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(prefix.endsWith("/") ? prefix : prefix + "/");
}

/**
 * The one decision function: does `method` on `pathname` require the
 * DEVELOPMENT surface (developer-plane action), and does the caller have it?
 *
 * Reads (GET/HEAD) are never blocked here — operational source READ is
 * explicitly allowed by the existing authority (sourceReadIsNotWrite) and the
 * Business Workspace keeps every shared capability it uses today.
 */
export function decideSurfaceAction(input: {
  pathname: string;
  method: string;
  surface: SurfaceId;
}): SurfaceDecision {
  const { pathname, method, surface } = input;
  const policy = capabilityActions();
  const writeMethods = (policy.write_methods ?? []).map((m) => m.toUpperCase());
  const upperMethod = method.toUpperCase();

  // Read path: allowed on both surfaces (business keeps CLI/shared reads).
  if (!writeMethods.includes(upperMethod)) {
    return { allowed: true, action: "", surface, reason: "read-only method — both surfaces allowed" };
  }

  for (const [action, rule] of Object.entries(policy.deny ?? {})) {
    if (rule.prefixes.some((prefix) => matchesPrefix(pathname, prefix))) {
      if (surface === "development") {
        return {
          allowed: true,
          action,
          surface,
          reason: "DEVELOPMENT surface — เดินเข้า existing source authority chain เดิม (requireAuth + fsSecurity + review/build/deploy gate)",
        };
      }
      return {
        allowed: false,
        action,
        surface,
        code: "SURFACE_ACTION_DENIED",
        reason: `${action} สงวนไว้สำหรับ Developer Workspace — Business surface ไม่มีสิทธิ์นี้ (เปิด /developer เพื่อสลับ surface)`,
      };
    }
  }

  return { allowed: true, action: "", surface, reason: "ไม่ได้อยู่ในชุด developer-plane action" };
}
