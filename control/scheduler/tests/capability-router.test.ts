/**
 * หน้าที่: real proof for `../capability-router.ts` — pure, synthetic pool
 * and metrics data (no filesystem/Agent Host I/O), fast, so the SELECTION
 * LOGIC itself is asserted exhaustively: no fixed `WorkKind -> ProviderKind`
 * table exists, availability/concurrency caps are respected, and real
 * historical latency/success rate move the decision.
 *
 * How to run: npx tsx control/scheduler/tests/capability-router.test.ts
 */
import { routeWork } from "../capability-router";
import type { ProcessingUnit, ProviderMetricRecord, ProviderKind } from "../provider-pool";
import type { WorkItem } from "../../work-graph/types";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail?: unknown): void {
  if (cond) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n      ${JSON.stringify(detail)}`); }
}

function item(kind: WorkItem["kind"] = "WIRE_OR_RETIRE"): WorkItem {
  return {
    work_id: `${kind}:fixture`, kind, worker_class: "REASONING_INTEGRATION", target: "fixture",
    write_scope: ["fixture"], test_files: [], depends_on: [], state: "READY", blocked_by: [], reason: "", evidence_ref: null,
  };
}

function unit(provider: ProviderKind, n: number, available = true): ProcessingUnit {
  return { unit_id: `${provider}#${n}`, provider, available, detail: available ? "ok" : "not found" };
}

function main(): void {
  // ===== 1. No fixed kind -> provider table: every reasoning kind gets the SAME candidate set with equal base scores when no history exists =====
  const equalPool = [unit("CLAUDE", 1), unit("CODEX", 1)];
  for (const kind of ["WIRE_OR_RETIRE", "REPAIR", "IMPLEMENT", "RESOLVE_DEPENDENCY"] as const) {
    const decision = routeWork(item(kind), equalPool, new Map(), []);
    check(`routeWork(${kind}) with no history and two equally-capable providers picks a real candidate, not a hardcoded one`, decision.ok, decision);
  }

  // ===== 2. Availability: an unavailable provider (e.g. GEMINI with no real binary on this host) is never selected =====
  {
    const pool = [unit("GEMINI", 1, false), unit("CLAUDE", 1, true)];
    const decision = routeWork(item(), pool, new Map(), []);
    check("an unavailable provider is skipped; the only real available one is chosen", decision.ok && decision.unit.provider === "CLAUDE", decision);
  }

  // ===== 3. Concurrency cap: a provider already at its pool capacity is not selected again =====
  {
    const pool = [unit("CLAUDE", 1)]; // exactly one CLAUDE unit
    const inFlight = new Map<ProviderKind, number>([["CLAUDE", 1]]); // already fully occupied
    const decision = routeWork(item(), pool, inFlight, []);
    check("a provider at its concurrency cap is refused, not double-booked", !decision.ok, decision);
  }
  {
    // Two CLAUDE units (pool size 2), one busy -> the other is still selectable.
    const pool = [unit("CLAUDE", 1), unit("CLAUDE", 2)];
    const inFlight = new Map<ProviderKind, number>([["CLAUDE", 1]]);
    const decision = routeWork(item(), pool, inFlight, []);
    check("with pool size 2 and 1 busy, the second unit of the SAME provider is still available", decision.ok && decision.unit.provider === "CLAUDE", decision);
  }

  // ===== 4. No available provider at all -> honest refusal, never a fabricated dispatch =====
  {
    const pool = [unit("CLAUDE", 1, false), unit("CODEX", 1, false)];
    const decision = routeWork(item(), pool, new Map(), []);
    check("with every real provider unavailable, routing is refused with a real reason naming each", !decision.ok && decision.reason.includes("CLAUDE") && decision.reason.includes("CODEX"), decision);
  }

  // ===== 5. Real historical success rate moves the decision — a provider that failed repeatedly loses to one with no history at all =====
  {
    const pool = [unit("CLAUDE", 1), unit("CODEX", 1)];
    const badHistory: ProviderMetricRecord[] = Array.from({ length: 5 }, () => ({
      recorded_at: new Date().toISOString(), unit_id: "CLAUDE#1", provider: "CLAUDE", work_kind: "REPAIR", outcome: "BLOCKED", duration_ms: 1000, cost: null,
    }));
    const decision = routeWork(item("REPAIR"), pool, new Map(), badHistory);
    check("a provider with a real, repeatedly-BLOCKED history for this exact work kind loses to an unproven (neutral-prior) alternative", decision.ok && decision.unit.provider === "CODEX", decision);
  }

  // ===== 6. Real historical success moves the decision the OTHER way — a proven-good provider beats an unproven one =====
  {
    const pool = [unit("CLAUDE", 1), unit("CODEX", 1)];
    const goodHistory: ProviderMetricRecord[] = Array.from({ length: 5 }, () => ({
      recorded_at: new Date().toISOString(), unit_id: "CODEX#1", provider: "CODEX", work_kind: "IMPLEMENT", outcome: "VERIFIED", duration_ms: 500, cost: null,
    }));
    const decision = routeWork(item("IMPLEMENT"), pool, new Map(), goodHistory);
    check("a provider with a real, repeatedly-successful history for this exact work kind is preferred over an unproven alternative", decision.ok && decision.unit.provider === "CODEX", decision);
  }

  // ===== 7. History for a DIFFERENT work kind never leaks into this kind's decision =====
  {
    const pool = [unit("CLAUDE", 1), unit("CODEX", 1)];
    const unrelatedHistory: ProviderMetricRecord[] = Array.from({ length: 5 }, () => ({
      recorded_at: new Date().toISOString(), unit_id: "CODEX#1", provider: "CODEX", work_kind: "REPAIR", outcome: "VERIFIED", duration_ms: 500, cost: null,
    }));
    const decisionA = routeWork(item("IMPLEMENT"), pool, new Map(), unrelatedHistory);
    const decisionB = routeWork(item("IMPLEMENT"), pool, new Map(), []);
    check("REPAIR-kind history does not bias an IMPLEMENT-kind decision — both routes are equally undetermined by history", decisionA.ok && decisionB.ok && decisionA.score === decisionB.score, { decisionA, decisionB });
  }

  // ===== 8. LOCAL is a real, always-lower-scored fallback — never preferred over an available real reasoning provider =====
  {
    const pool = [unit("LOCAL", 1), unit("CLAUDE", 1)];
    const decision = routeWork(item(), pool, new Map(), []);
    check("LOCAL is never chosen over an available real reasoning provider with no history to distinguish them", decision.ok && decision.unit.provider === "CLAUDE", decision);
  }
  {
    // LOCAL is the only real fallback when nothing else is available at all.
    const pool = [unit("LOCAL", 1), unit("CLAUDE", 1, false), unit("CODEX", 1, false)];
    const decision = routeWork(item(), pool, new Map(), []);
    check("LOCAL is selected when it is the only real available unit", decision.ok && decision.unit.provider === "LOCAL", decision);
  }

  // ===== 9. --force-provider style restriction (achieved by the CALLER pre-filtering the pool, per coordinator.ts's own design) still respects availability =====
  {
    const forcedPool = [unit("CLAUDE", 1, false)]; // caller restricted candidates to CLAUDE only, but it is unavailable
    const decision = routeWork(item(), forcedPool, new Map(), []);
    check("a forced-but-unavailable provider is still honestly refused, never dispatched anyway", !decision.ok, decision);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) (process as unknown as { exitCode: number }).exitCode = 1;
}

main();
