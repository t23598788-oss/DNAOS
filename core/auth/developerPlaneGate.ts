/**
 * Developer Plane production deny gate (owner directive 2026-10-20).
 *
 * Developer Operations = source read/write, git, build/release/deploy, terminal
 * and process execution, developer worker execution, IDE management.
 * Business processing and Shared Engines are NOT covered by this gate.
 *
 * Rule: in production the developer plane is DENIED unless the operator sets
 * DNA_DEVELOPER_PLANE_ENABLED=true explicitly. Outside production it is open to
 * the platform-operator guard (core/auth/platformOperator.ts) as before.
 *
 * This module is edge-safe (no Node-only imports): middleware.ts uses it too.
 * Deny is enforced server-side in middleware (direct HTTP), in the API guard
 * (requirePlatformOperator) and in the page guard (requirePlatformOperatorPage).
 */
import { NextResponse } from "next/server";

export const DEVELOPER_PLANE_ENV = "DNA_DEVELOPER_PLANE_ENABLED";

/** Page prefixes that belong to the Developer Plane. */
export const DEVELOPER_PAGE_PREFIXES = ["/developer", "/admin/ide", "/admin/dev-loop", "/admin/deploy", "/admin/ui-gallery"];

/** API prefixes that belong to the Developer Plane (entry routes only). */
export const DEVELOPER_API_PREFIXES = ["/api/admin/ide", "/api/admin/dev-loop", "/api/v1/mcp/contractor"];

type EnvLike = Record<string, string | undefined>;

export function isDeveloperPlaneEnabled(env: EnvLike = process.env as EnvLike): boolean {
  if (env.NODE_ENV !== "production") return true;
  return (env[DEVELOPER_PLANE_ENV] ?? "").trim().toLowerCase() === "true";
}

export function isDeveloperOperationPath(pathname: string): boolean {
  return [...DEVELOPER_PAGE_PREFIXES, ...DEVELOPER_API_PREFIXES].some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/** Returns a 403 response when the path is a Developer Operation and the plane is disabled; otherwise null. */
export function developerPlaneDenyResponse(pathname: string, env: EnvLike = process.env as EnvLike): NextResponse | null {
  if (!isDeveloperOperationPath(pathname)) return null;
  if (isDeveloperPlaneEnabled(env)) return null;
  const isApi = pathname.startsWith("/api/");
  if (isApi) {
    return NextResponse.json(
      { ok: false, code: "DEVELOPER_PLANE_DISABLED", error: "Developer Plane ปิดใช้งานในสภาพแวดล้อม production" },
      { status: 403 },
    );
  }
  return new NextResponse("Developer Plane is disabled in production", { status: 403 });
}
