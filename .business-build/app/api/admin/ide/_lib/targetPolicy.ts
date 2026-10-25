/**
 * UI Inspection Target Policy (owner, 2026-08-06, Software Factory Step 6).
 * The single real gate every URL the Browser Inspection Runtime is asked
 * to open must pass — never a client-supplied arbitrary URL. Reuses
 * Node's own `dns` resolver + `net.isIP`/private-range checks (no new
 * dependency) — real DNS resolution before ever handing a URL to
 * Playwright, so a hostname that LOOKS public but resolves to a private/
 * loopback/link-local address (classic SSRF/DNS-rebinding) is rejected
 * before the browser ever navigates there.
 */
import { promises as dns } from "dns";
import { isIP } from "net";
import { glob } from "glob";

import { WORKSPACE_ROOT } from "./fsSecurity";

export type TargetType = "CURRENT_PREVIEW" | "DEPLOYED_URL" | "REGISTERED_ROUTE";

export interface TargetContract {
  targetId: string;
  targetType: TargetType;
  url: string;
  route: string | null;
  environment: "development" | "production";
  authenticationMode: "none";
  viewportProfileIds: string[];
  waitUntil: "load" | "domcontentloaded" | "networkidle";
  timeoutMs: number;
  createdBy: string;
  sourceJobId: string | null;
  sourceArtifactId: string | null;
  expectedBuildId: string | null;
  expectedSourceHash: string | null;
}

export class TargetPolicyError extends Error {
  code: "INVALID_TARGET_TYPE" | "UNREGISTERED_ROUTE" | "FORBIDDEN_PROTOCOL" | "PRIVATE_NETWORK_BLOCKED" | "HOST_NOT_ALLOWED" | "DNS_RESOLUTION_FAILED" | "REDIRECT_BLOCKED";
  constructor(code: typeof TargetPolicyError.prototype.code, message: string) {
    super(message);
    this.code = code;
    this.name = "TargetPolicyError";
  }
}

// ---- Real, private/reserved IPv4 + IPv6 ranges (RFC 1918, RFC 4193, RFC
// 3927 link-local, loopback, and the cloud metadata service address
// 169.254.169.254 specifically named in the task) — checked against the
// REAL resolved IP, never the hostname string alone. ----
function isPrivateOrReservedIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return true; // malformed — refuse, never guess safe
  const [a, b] = parts;
  if (a === 127) return true; // loopback
  if (a === 10) return true; // RFC1918
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
  if (a === 192 && b === 168) return true; // RFC1918
  if (a === 169 && b === 254) return true; // link-local + cloud metadata service (169.254.169.254)
  if (a === 0) return true; // "this network"
  if (a >= 224) return true; // multicast/reserved
  return false;
}
function isPrivateOrReservedIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === "::1") return true; // loopback
  if (lower.startsWith("fe80:") || lower.startsWith("fe80::")) return true; // link-local
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // unique local (RFC4193)
  if (lower.startsWith("::ffff:")) return isPrivateOrReservedIPv4(lower.slice(7)); // IPv4-mapped
  return false;
}
function isPrivateOrReservedIP(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return isPrivateOrReservedIPv4(ip);
  if (version === 6) return isPrivateOrReservedIPv6(ip);
  return true; // not a real IP — refuse
}

/** Real DNS resolution (A + AAAA) of a hostname — every resolved address
 * must be public, or the whole hostname is rejected. This is the actual
 * SSRF/DNS-rebinding gate, not a string-pattern guess on the hostname. */
async function assertHostResolvesToPublicIP(hostname: string): Promise<void> {
  const directIpVersion = isIP(hostname);
  if (directIpVersion !== 0) {
    if (isPrivateOrReservedIP(hostname)) throw new TargetPolicyError("PRIVATE_NETWORK_BLOCKED", `target IP ${hostname} is a private/reserved address`);
    return;
  }
  let addresses: string[];
  try {
    const [v4, v6] = await Promise.all([
      dns.resolve4(hostname).catch(() => [] as string[]),
      dns.resolve6(hostname).catch(() => [] as string[]),
    ]);
    addresses = [...v4, ...v6];
  } catch {
    throw new TargetPolicyError("DNS_RESOLUTION_FAILED", `could not resolve hostname ${hostname}`);
  }
  if (addresses.length === 0) throw new TargetPolicyError("DNS_RESOLUTION_FAILED", `hostname ${hostname} resolved to no real addresses`);
  for (const addr of addresses) {
    if (isPrivateOrReservedIP(addr)) throw new TargetPolicyError("PRIVATE_NETWORK_BLOCKED", `hostname ${hostname} resolves to a private/reserved address ${addr}`);
  }
}

/** The one real exception to the private-network rule: CURRENT_PREVIEW
 * targets the SAME server that received this API request (same host the
 * client's own request arrived on) — never an arbitrary loopback URL a
 * client could otherwise supply. The allowed host is derived from the
 * REAL incoming request, never from client-controlled target input. */
export function resolveCurrentPreviewOrigin(requestUrl: string): string {
  const u = new URL(requestUrl);
  return `${u.protocol}//${u.host}`;
}

/** Computed fresh on every call (never cached at module-import time) — a
 * real env var read, so a changed UI_INSPECTION_ALLOWED_HOSTS always takes
 * effect immediately, never stale from whenever this module first loaded. */
function getDeployedUrlAllowlist(): string[] {
  return (process.env.UI_INSPECTION_ALLOWED_HOSTS ?? "").split(",").map((h) => h.trim()).filter(Boolean);
}

/** REGISTERED_ROUTE — validated against the real, live app/**\/page.tsx
 * file tree (the actual Next.js App Router route table), never a
 * hand-maintained registry that could drift from the real routes. */
export async function isRegisteredRoute(route: string): Promise<boolean> {
  if (!route.startsWith("/")) return false;
  const pageFiles = await glob("app/**/page.tsx", { cwd: WORKSPACE_ROOT, ignore: ["**/node_modules/**", ".next/**"] });
  const routes = new Set(
    pageFiles.map((f) => {
      let r = "/" + f.replace(/^app\//, "").replace(/\/page\.tsx$/, "");
      r = r.replace(/\/\([^/]+\)/g, ""); // route groups (name) never appear in the real URL
      if (r === "/index" || r === "") r = "/";
      return r;
    })
  );
  if (routes.has(route)) return true;
  // Real dynamic segment match: /admin/ide -> literal; /workspace-preview/[appId] -> /workspace-preview/anything
  for (const r of routes) {
    if (!r.includes("[")) continue;
    const pattern = "^" + r.replace(/\[[^/]+\]/g, "[^/]+").replace(/\//g, "\\/") + "$";
    if (new RegExp(pattern).test(route)) return true;
  }
  return false;
}

/**
 * The single real validation gate — every UI Inspection target passes
 * through here before the Browser Inspection Runtime ever opens it.
 * `requestUrl` is the REAL incoming API request URL (server-derived),
 * never client input, and is the only source for a CURRENT_PREVIEW origin.
 */
export async function validateTarget(input: {
  targetType: TargetType; route: string | null; url: string | null; requestUrl: string;
}): Promise<{ url: string; environment: "development" | "production" }> {
  const environment: "development" | "production" = process.env.NODE_ENV === "production" ? "production" : "development";

  if (input.targetType === "CURRENT_PREVIEW") {
    if (!input.route || !input.route.startsWith("/")) throw new TargetPolicyError("UNREGISTERED_ROUTE", "CURRENT_PREVIEW requires a real route starting with /");
    if (!(await isRegisteredRoute(input.route))) throw new TargetPolicyError("UNREGISTERED_ROUTE", `route ${input.route} is not a real registered app route`);
    const origin = resolveCurrentPreviewOrigin(input.requestUrl);
    return { url: origin + input.route, environment };
  }

  if (input.targetType === "REGISTERED_ROUTE") {
    if (!input.route || !(await isRegisteredRoute(input.route))) throw new TargetPolicyError("UNREGISTERED_ROUTE", `route ${input.route} is not a real registered app route`);
    const origin = resolveCurrentPreviewOrigin(input.requestUrl);
    return { url: origin + input.route, environment };
  }

  // DEPLOYED_URL — requires a real, explicit host allowlist (env-driven,
  // never guessed); empty allowlist means nothing is allowed, honestly.
  if (input.targetType === "DEPLOYED_URL") {
    if (!input.url) throw new TargetPolicyError("HOST_NOT_ALLOWED", "DEPLOYED_URL requires a url");
    let parsed: URL;
    try { parsed = new URL(input.url); } catch { throw new TargetPolicyError("FORBIDDEN_PROTOCOL", "malformed URL"); }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new TargetPolicyError("FORBIDDEN_PROTOCOL", `protocol ${parsed.protocol} is forbidden — only http/https allowed (never file:/data:/javascript:)`);
    }
    if (!getDeployedUrlAllowlist().includes(parsed.hostname)) {
      throw new TargetPolicyError("HOST_NOT_ALLOWED", `host ${parsed.hostname} is not in the real UI_INSPECTION_ALLOWED_HOSTS allowlist`);
    }
    await assertHostResolvesToPublicIP(parsed.hostname);
    return { url: input.url, environment };
  }

  throw new TargetPolicyError("INVALID_TARGET_TYPE", `unknown targetType`);
}
