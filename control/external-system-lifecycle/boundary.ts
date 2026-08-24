/**
 * หน้าที่: the BOUNDARY/REPO DECISION stage — checks a candidate's
 * `source_location` falls under one of this repo's real, existing
 * top-level capability-group folders (root `README.md`'s "1 หน้างาน = 1
 * โฟลเดอร์" rule), per
 * `governance/architecture-rules/CAPABILITY_FOLDER_LAW.md` ข้อ 4's
 * pre-creation duplicate/boundary check. This repo has exactly one repo
 * (no multi-repo routing exists), so "repo decision" here means "which
 * top-level group folder does this candidate honestly belong to" —
 * never invented, always checked against the real folder list.
 *
 * Input: `source_location` (string).
 * Output: `decideBoundary`.
 * Dependency ที่อนุญาต: none.
 * สิ่งที่ห้ามแตะ: never widen ALLOWED_TOP_LEVEL_GROUPS without also
 * updating this comment — it must always match `ls` at repo root.
 */

/** The real top-level capability-group folders at repo root (verified via `ls`, 2026-08-21) — deliberately excludes node_modules, reports/, tests/ (docs/sandbox, not capability groups). */
const ALLOWED_TOP_LEVEL_GROUPS: ReadonlySet<string> = new Set([
  "ai",
  "audit",
  "config",
  "connections",
  "contracts",
  "control",
  "credentials",
  "dna-os-circuit",
  "execution",
  "governance",
  "local-runtime",
  "permissions",
  "providers",
  "software",
  "transport",
]);

export interface BoundaryDecision {
  allowed: boolean;
  top_level_group: string | null;
  reason: string;
}

export function decideBoundary(sourceLocation: string): BoundaryDecision {
  const topLevel = sourceLocation.split("/")[0];
  if (!topLevel || !ALLOWED_TOP_LEVEL_GROUPS.has(topLevel)) {
    return { allowed: false, top_level_group: topLevel || null, reason: `"${topLevel}" is not a real, existing top-level capability-group folder in this repo` };
  }
  return { allowed: true, top_level_group: topLevel, reason: `source_location falls under the real, existing "${topLevel}/" capability-group folder` };
}
