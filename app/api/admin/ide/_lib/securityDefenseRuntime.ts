/**
 * Security Defense Runtime (owner, 2026-08-08, Software Factory Step
 * 13.25, Section 7/13). Read-only aggregation over the real, already-
 * existing Monitoring/Incident/Recovery/Alert Runtimes (Step 12/12.5) —
 * never a second detection engine, never a mutation path. This file
 * exports NO counter-attack, retaliation, or autonomous-response
 * function of any kind, on purpose (Section 13) — Defense may Detect,
 * Analyze, Correlate, and Notify Owner only.
 */
import { listSignals, computeMonitoringSummary } from "./monitoringRuntime";
import { listIncidents } from "./incidentRuntime";
import { listRecoveryPlans } from "./recoveryRuntime";
import { listAlerts } from "./alertRuntime";
import { listThreatPatterns, type ThreatPatternDefinition } from "./threatPatternRegistry";

export interface DefenseSummary {
  monitoring: ReturnType<typeof computeMonitoringSummary>;
  openIncidents: number;
  recoveryPlans: number;
  alerts: number;
  threatPatternCategories: ThreatPatternDefinition[];
  computedAt: string;
}

/** Real, read-only aggregation — reuses the exact real accessor
 * functions every prior Step's Operations tab already calls; never a
 * second, parallel computation. */
export function computeDefenseSummary(ownerId: string): DefenseSummary {
  return {
    monitoring: computeMonitoringSummary(ownerId),
    openIncidents: listIncidents(ownerId).filter((i) => !["RESOLVED", "FALSE_POSITIVE"].includes(i.status)).length,
    recoveryPlans: listRecoveryPlans(ownerId).length,
    alerts: listAlerts(ownerId).length,
    threatPatternCategories: listThreatPatterns(),
    computedAt: new Date().toISOString(),
  };
}

export function listRealSignals(ownerId: string) { return listSignals(ownerId); }
