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
  surfaces?: Record<string, { entry_urls?: string[]; cookie_value?: string; th?: string; roles?: string[] }>;
  deny?: Record<string, { prefixes: string[]; th?: string; authority?: string }>;
  /** owner directive 2026-10-15 — denied for EVERY method (incl. GET/HEAD):
   *  developer-plane reads (source code / git status / infrastructure). */
  deny_all?: Record<string, { prefixes: string[]; th?: string; authority?: string }>;
  /** owner directive 2026-10-15 — developer-plane PAGE prefixes denied at the
   *  server for the operational surface (direct URL or menu, not just hidden). */
  deny_pages?: Record<string, { prefixes: string[]; th?: string }>;
  allow?: Record<string, { prefixes: string[]; th?: string; authority?: string }>;
}

const REGISTRY = permissions as typeof permissions & {
  capability_actions?: CapabilityActionRegistry;
};

function capabilityActions(): CapabilityActionRegistry {
  const policy = REGISTRY.capability_actions;
  if (!policy || !policy.deny || !policy.write_methods) {
    // Fail closed: a missing/unreadable policy never opens a developer write.
    return { write_methods: ["POST", "PUT", "PATCH", "DELETE"], deny: {}, deny_all: {}, deny_pages: {}, allow: {} };
  }
  return policy;
}

/** Roles allowed to switch into a surface. `operational` is open to every
 *  authenticated user (it is the default/fail-closed surface); `development`
 *  is restricted to the roles declared in the SAME registry. */
export function canEnterSurface(role: string | null | undefined, surfaceId: SurfaceId): boolean {
  if (surfaceId === "operational") return true;
  const policy = capabilityActions();
  const roles = policy.surfaces?.development?.roles ?? [];
  return !!role && roles.includes(role);
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
 * Order of decision (owner directive 2026-10-12, extended 2026-10-15):
 *   1. developer-plane WRITE (source.modify / git.push / deployment.execute /
 *      developer.worker.execute / developer.workflow.execute) — specific action
 *   2. developer-plane READ (source code / git status / infrastructure) —
 *      denied for EVERY method, GET/HEAD included
 *   3. everything else: allowed (business READ/WRITE keep their existing
 *      requireAuth + route_access/api_access authority, untouched)
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
  const isWrite = writeMethods.includes(upperMethod);

  // ── 1. developer-plane WRITE (owner directive 2026-10-12) ─────────────────
  // ตรวจก่อนเพื่อให้ได้ action ที่เจาะจง (source.modify / git.push /
  // deployment.execute / developer.worker.execute / developer.workflow.execute)
  if (isWrite) {
    for (const [action, rule] of Object.entries(policy.deny ?? {})) {
      if (!Array.isArray(rule?.prefixes)) continue;
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
  }

  // ── 2. developer-plane READ (owner directive 2026-10-15) ──────────────────
  // Source Code / Git Status / Infrastructure are NOT shared capabilities of a
  // business user: denied for EVERY method (GET/HEAD included) unless the
  // caller is on the development surface.
  for (const [action, rule] of Object.entries(policy.deny_all ?? {})) {
    if (!Array.isArray(rule?.prefixes)) continue; // skip the map's own "note" key
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
        reason: `${action} สงวนไว้สำหรับ Developer Workspace — Business surface เรียกไม่ได้ทุก method (เปิด /developer เพื่อสลับ surface)`,
      };
    }
  }

  // Read path: allowed on both surfaces (business keeps CLI/shared reads).
  if (!isWrite) {
    return { allowed: true, action: "", surface, reason: "read-only method — both surfaces allowed" };
  }

  return { allowed: true, action: "", surface, reason: "ไม่ได้อยู่ในชุด developer-plane action" };
}

/**
 * PAGE half of the same decision (owner directive 2026-10-15) — developer /
 * infrastructure screens are closed at the SERVER for the operational surface,
 * whether the user opens the URL directly or reaches it from a menu. Same
 * single registry, same fail-closed surface resolution; nothing is only hidden.
 */
export function decideSurfacePage(input: {
  pathname: string;
  surface: SurfaceId;
}): { allowed: boolean; action: string; surface: SurfaceId; code?: string; reason: string } {
  const { pathname, surface } = input;
  const policy = capabilityActions();
  for (const [action, rule] of Object.entries(policy.deny_pages ?? {})) {
    if (!Array.isArray(rule?.prefixes)) continue; // skip the map's own "note" key
    if (rule.prefixes.some((prefix) => matchesPrefix(pathname, prefix))) {
      if (surface === "development") {
        return { allowed: true, action, surface, reason: "DEVELOPMENT surface — หน้าเครื่องมือพัฒนาอนุญาต" };
      }
      return {
        allowed: false,
        action,
        surface,
        code: "SURFACE_PAGE_DENIED",
        reason: `${action} เป็นหน้าของ Developer/Infrastructure — Business surface เข้าไม่ได้ (เปิด /developer เพื่อสลับ surface)`,
      };
    }
  }
  return { allowed: true, action: "", surface, reason: "ไม่ใช่หน้า developer-plane" };
}
