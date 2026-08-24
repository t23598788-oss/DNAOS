/**
 * หน้าที่: CHANGE-IMPACT ANALYSIS — transitive verification invalidation.
 * Closes a real correctness hole in the verification model, proven before this
 * file existed:
 *
 *   permissions/execution-policy was VERIFIED. control/command-router was
 *   VERIFIED *against that code* and declares it as a dependency. Perturbing
 *   execution-policy correctly moved IT to CHANGED_SINCE_VERIFICATION — while
 *   command-router kept reporting VERIFIED.
 *
 * That is exactly the failure the Owner directive forbids: "a code change
 * affecting a previously VERIFIED capability must NOT leave it appearing
 * VERIFIED indefinitely." `./derive.ts` compares each capability against its OWN
 * source digest, which cannot see a dependency moving underneath it. This file
 * supplies the missing half.
 *
 * THE RULE, and why it is drawn exactly here:
 *   A VERIFIED capability becomes REQUIRES_REVERIFICATION when any capability it
 *   transitively depends on is CHANGED_SINCE_VERIFICATION or itself
 *   REQUIRES_REVERIFICATION — i.e. that dependency's CODE HAS MOVED since it was
 *   proven.
 *   It does NOT trigger on a dependency that is merely UNVERIFIED. A dependent's
 *   own tests exercise its dependencies, so passing against never-formally-
 *   verified-but-UNCHANGED code is still real evidence about the code that is
 *   actually there. Invalidating on UNVERIFIED would cascade almost everything
 *   to REQUIRES_REVERIFICATION on day one and make the signal worthless.
 *
 * Input: the derived `CapabilityRecord[]`.
 * Output: `deriveImpact`, `applyImpact`, `impactOf`.
 * Dependency ที่อนุญาต: ./types.ts only — pure, so `./tests/impact.test.ts` can
 * prove the closure (including cycles) without a repository.
 * สิ่งที่ห้ามแตะ: never let this UPGRADE a status. It may only move VERIFIED ->
 * REQUIRES_REVERIFICATION. Nothing here may ever make something look more
 * proven than its own evidence says.
 */

import type { CapabilityRecord, CapabilityStatus } from "./types";

/** Statuses that mean "this capability's code has moved since it was proven". */
const MOVED_STATUSES: ReadonlySet<CapabilityStatus> = new Set<CapabilityStatus>([
  "CHANGED_SINCE_VERIFICATION",
  "REQUIRES_REVERIFICATION",
]);

export interface ImpactFinding {
  capability_path: string;
  /** The transitive dependencies whose code moved, in discovery order. */
  invalidated_by: readonly string[];
  /** The shortest dependency path from this capability to the first moved dependency. */
  via: readonly string[];
}

/**
 * Builds the reverse-dependency closure and returns every VERIFIED capability
 * that must be re-verified. Cycle-safe: a visited set bounds the walk, so a
 * dependency cycle terminates instead of recursing forever.
 */
export function deriveImpact(capabilities: readonly CapabilityRecord[]): ImpactFinding[] {
  const byPath = new Map(capabilities.map((c) => [c.path, c]));
  const findings: ImpactFinding[] = [];

  for (const cap of capabilities) {
    if (cap.current_status !== "VERIFIED") continue;

    const invalidatedBy: string[] = [];
    let shortestVia: string[] = [];
    const visited = new Set<string>([cap.path]);
    // BFS so `via` is genuinely the SHORTEST path to the first moved dependency,
    // not whatever a depth-first walk happened to reach first.
    const queue: { path: string; trail: string[] }[] = cap.dependencies
      .filter((d) => d !== cap.path && byPath.has(d))
      .map((d) => ({ path: d, trail: [cap.path, d] }));

    while (queue.length > 0) {
      const { path, trail } = queue.shift()!;
      if (visited.has(path)) continue;
      visited.add(path);
      const dep = byPath.get(path);
      if (!dep) continue;

      if (MOVED_STATUSES.has(dep.current_status)) {
        invalidatedBy.push(path);
        if (shortestVia.length === 0) shortestVia = trail;
        // Do not walk THROUGH a moved dependency: everything beyond it is
        // already accounted for by that dependency's own finding, and following
        // it would report the same root cause many times over.
        continue;
      }
      for (const next of dep.dependencies) {
        if (next !== path && !visited.has(next) && byPath.has(next)) {
          queue.push({ path: next, trail: [...trail, next] });
        }
      }
    }

    if (invalidatedBy.length > 0) {
      findings.push({ capability_path: cap.path, invalidated_by: invalidatedBy, via: shortestVia });
    }
  }
  return findings;
}

/**
 * Applies the findings, returning NEW records — the input is never mutated, so a
 * caller can always compare pre- and post-impact views. Only VERIFIED may be
 * downgraded; every other status is returned untouched.
 */
export function applyImpact(capabilities: readonly CapabilityRecord[]): CapabilityRecord[] {
  const findings = new Map(deriveImpact(capabilities).map((f) => [f.capability_path, f]));
  return capabilities.map((cap) => {
    const finding = findings.get(cap.path);
    if (!finding || cap.current_status !== "VERIFIED") return cap;
    const reason =
      `dependency code moved since this was verified: ${finding.invalidated_by.slice(0, 3).join(", ")}` +
      `${finding.invalidated_by.length > 3 ? ` (+${finding.invalidated_by.length - 3} more)` : ""}` +
      ` via ${finding.via.join(" -> ")}. Its own source is unchanged, so the evidence still describes THIS code — but not the code underneath it.`;
    return { ...cap, current_status: "REQUIRES_REVERIFICATION", verification_state: "REQUIRES_REVERIFICATION", status_reason: reason };
  });
}

/**
 * FORWARD change-impact: "if I change X, what must be re-verified?" — the
 * question an engineer actually asks before touching something. Returns the
 * transitive set of dependents, nearest first.
 */
export function impactOf(target: string, capabilities: readonly CapabilityRecord[]): { path: string; depth: number; status: CapabilityStatus }[] {
  const dependents = new Map<string, string[]>();
  for (const cap of capabilities) {
    for (const dep of cap.dependencies) {
      if (dep === cap.path) continue;
      dependents.set(dep, [...(dependents.get(dep) ?? []), cap.path]);
    }
  }
  const byPath = new Map(capabilities.map((c) => [c.path, c]));
  const out: { path: string; depth: number; status: CapabilityStatus }[] = [];
  const visited = new Set<string>([target]);
  let frontier = dependents.get(target) ?? [];
  let depth = 1;
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const path of frontier) {
      if (visited.has(path)) continue;
      visited.add(path);
      out.push({ path, depth, status: byPath.get(path)?.current_status ?? "UNKNOWN" });
      next.push(...(dependents.get(path) ?? []));
    }
    frontier = next;
    depth += 1;
  }
  return out;
}
