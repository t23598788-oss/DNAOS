/**
 * หน้าที่: decides — deterministically — whether a set of changed source paths
 * can affect what a user sees (Owner, 2026-08-26).
 *
 * RULES OVER PATHS AND ROUTES, NEVER A MODEL. Every decision below is a path
 * rule plus the real route table, and each returned decision names the rule
 * that produced it. There is no scoring, no similarity, and no judgement call.
 *
 * UNRESOLVED IS A REAL ANSWER. A file that serves routes but is not itself a UI
 * asset — a server that both routes pages and does other work — cannot be
 * decided from its path alone. Rather than guessing either way, it returns
 * UNRESOLVED, and the completion gate refuses to complete on it.
 *
 * Input: changed repo-relative paths.
 * Output: `UiImpactAssessment` with per-path reasoning and the affected routes.
 * Dependency ที่อนุญาต: ./types.ts, node built-ins.
 * สิ่งที่ห้ามแตะ: ห้ามให้ AI ตัดสิน, ห้ามเดาแทน UNRESOLVED.
 */

declare const require: any;

import type { UiImpact, UiImpactAssessment } from "./types";

const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = "/Users/tam/Desktop/DNA-OS-INFRASTRUCTURE";

/** Assets a browser renders directly. */
const UI_ASSET_EXTENSIONS = new Set([".html", ".css", ".js", ".jsx", ".tsx", ".svg"]);

/**
 * The real route table, derived from the server sources that actually serve
 * static UI directories — not a maintained list. A `serveStaticFile(root,
 * "ui/<dir>/index.html")` call IS the ownership fact.
 */
export function routeOwnership(): ReadonlyMap<string, string> {
  const ownership = new Map<string, string>();
  const serverFiles = [
    "dna-os-circuit/runtime/server.ts",
    "observability/joint-monitor/server.ts",
    "transport/owner-command-http/server.ts",
  ];
  for (const relative of serverFiles) {
    let source: string;
    try { source = String(fs.readFileSync(path.join(REPO_ROOT, relative), "utf8")); } catch { continue; }
    // url === "/x" ... serveStaticFile(root, "ui/y/index.html")
    const pattern = /url\s*===\s*"([^"]+)"[\s\S]{0,400}?serveStaticFile\(\s*root\s*,\s*"([^"]+)"/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source)) !== null) {
      const uiDir = path.dirname(match[2]);
      const owner = path.join(path.dirname(path.dirname(relative)), uiDir);
      ownership.set(owner, match[1]);
    }
  }
  return ownership;
}

function decideOne(changedPath: string, ownership: ReadonlyMap<string, string>): { path: string; rule: string; impact: UiImpact; route: string | null } {
  const extension = path.extname(changedPath);

  for (const [owner, route] of ownership) {
    if (changedPath === owner || changedPath.startsWith(`${owner}/`)) {
      return { path: changedPath, rule: `path is inside "${owner}", which a server serves at "${route}"`, impact: "YES", route };
    }
  }
  if (UI_ASSET_EXTENSIONS.has(extension)) {
    return { path: changedPath, rule: `"${extension}" is an asset a browser renders, but no served route owns this path`, impact: "UNRESOLVED", route: null };
  }
  // A file that decides what a UI route returns is not itself a UI asset, and
  // its effect on the screen cannot be read off its path.
  if (/server\.ts$/.test(changedPath) && /serveStaticFile|sendJson/.test(safeRead(changedPath))) {
    return { path: changedPath, rule: "serves routes but is not a UI asset — path alone cannot decide whether the screen changes", impact: "UNRESOLVED", route: null };
  }
  return { path: changedPath, rule: "not a UI asset and not inside any served UI directory", impact: "NO", route: null };
}

function safeRead(relative: string): string {
  try { return String(fs.readFileSync(path.join(REPO_ROOT, relative), "utf8")); } catch { return ""; }
}

export function assessUiImpact(changedPaths: readonly string[]): UiImpactAssessment {
  const ownership = routeOwnership();
  const decided = changedPaths.map((changedPath) => decideOne(changedPath, ownership));
  const routes = [...new Set(decided.map((entry) => entry.route).filter((route): route is string => route !== null))];

  // Strongest answer wins, and UNRESOLVED outranks NO: an undecidable file in
  // the change set means the change set is undecidable.
  const impact: UiImpact = decided.some((entry) => entry.impact === "YES")
    ? "YES"
    : decided.some((entry) => entry.impact === "UNRESOLVED")
      ? "UNRESOLVED"
      : "NO";

  return {
    impact,
    decided_by: decided.map(({ path: p, rule, impact: i }) => ({ path: p, rule, impact: i })),
    routes,
    reason: impact === "YES"
      ? `${decided.filter((entry) => entry.impact === "YES").length} changed path(s) are owned by a served UI route`
      : impact === "UNRESOLVED"
        ? "at least one changed path could not be decided from its path and the route table"
        : "no changed path is a UI asset or lives under a served UI directory",
  };
}
