/**
 * หน้าที่: เก็บหลักฐานค่าใช้จ่ายลง store เดิม ไม่สร้างที่เก็บใหม่
 *
 * ใช้ `../agent-gateway/#saveEvidence` ตัวเดียวกับที่ resolution, SystemEvent,
 * remediation และ action-ledger ใช้อยู่ — ค่าใช้จ่ายจึงตรวจสอบย้อนหลังได้
 * ด้วยเครื่องมือเดียวกับทุกอย่างในระบบ และรอดจากการรีสตาร์ท
 *
 * Output: `persistBillingRecords`, `loadBillingRecords`, `persistAnomaly`,
 * `loadBaselineSamples`, `persistBaselineSample`
 * Dependency ที่อนุญาต: ../agent-gateway/contract.ts, ./types.ts
 * สิ่งที่ห้ามแตะ: ห้ามเก็บ credential หรือเลขบัตรลง evidence
 */

import { saveEvidence, loadEvidenceForTask } from "../agent-gateway/contract";
import type { BillingAnomaly, BillingRecord, CostLineage } from "./types";

const SOURCE_MARKER = "control/infrastructure-billing/persistence.ts";

const taskForPeriod = (provider: string, account: string, periodStart: string): string =>
  `billing:${provider}:${account}:${periodStart.slice(0, 10)}`;

export function persistBillingRecords(records: readonly BillingRecord[]): { persisted: number; task_ids: readonly string[] } {
  const tasks = new Set<string>();
  for (const record of records) {
    const taskId = taskForPeriod(record.provider, record.account_id, record.period_start);
    tasks.add(taskId);
    saveEvidence({
      evidence_id: record.billing_record_id,
      task_id: taskId,
      kind: "execution_output",
      source: SOURCE_MARKER,
      recorded_at: record.observed_at,
      payload: record,
    });
  }
  return { persisted: records.length, task_ids: [...tasks] };
}

export function loadBillingRecords(provider: string, account: string, periodStart: string): readonly BillingRecord[] {
  return loadEvidenceForTask(taskForPeriod(provider, account, periodStart))
    .filter((row) => row.source === SOURCE_MARKER)
    .map((row) => row.payload as BillingRecord)
    .filter((row) => row && typeof row.amount_minor === "number");
}

export function persistAnomaly(anomaly: BillingAnomaly): void {
  saveEvidence({
    evidence_id: anomaly.anomaly_id,
    task_id: `billing-anomaly:${anomaly.provider}:${anomaly.account_id}`,
    kind: "execution_output",
    source: SOURCE_MARKER,
    recorded_at: anomaly.first_seen_at,
    payload: anomaly,
  });
}

export function loadAnomalies(provider: string, account: string): readonly BillingAnomaly[] {
  return loadEvidenceForTask(`billing-anomaly:${provider}:${account}`)
    .filter((row) => row.source === SOURCE_MARKER)
    .map((row) => row.payload as BillingAnomaly)
    .filter((row) => row && typeof row.anomaly_id === "string");
}

/** sample ของ baseline = รอบที่ "จ่ายสำเร็จจริง" เท่านั้น */
export function persistBaselineSample(input: {
  provider: string; account_id: string; period_start: string; period_end: string;
  total_minor: number; currency: string; evidence_ref: string;
}): void {
  saveEvidence({
    evidence_id: `baseline-${input.provider}-${input.period_start.slice(0, 10)}`,
    task_id: `billing-baseline:${input.provider}:${input.account_id}`,
    kind: "execution_output",
    source: SOURCE_MARKER,
    recorded_at: input.period_start,
    payload: input,
  });
}

export function loadBaselineSamples(provider: string, account: string): readonly { period_start: string; period_end: string; total_minor: number; evidence_ref: string }[] {
  return loadEvidenceForTask(`billing-baseline:${provider}:${account}`)
    .filter((row) => row.source === SOURCE_MARKER)
    .map((row) => row.payload as { period_start: string; period_end: string; total_minor: number; evidence_ref: string })
    .filter((row) => row && typeof row.total_minor === "number");
}

/** สายเลือดของต้นทุน — ผูกกับ workload ได้ก็ต่อเมื่อพิสูจน์ได้ */
export function lineageFor(record: BillingRecord, link?: { work_id?: string | null; trace_id?: string | null; capability_id?: string | null }): CostLineage {
  return {
    billing_record_id: record.billing_record_id,
    provider: record.provider,
    project_id: record.project_id,
    service: record.service,
    resource: record.resource,
    usage: record.usage_quantity === null ? "UNKNOWN" : `${record.usage_quantity} ${record.usage_unit ?? ""}`.trim(),
    price: record.unit_price_minor === null ? "UNKNOWN" : String(record.unit_price_minor),
    cost: String(record.amount_minor),
    invoice_id: record.invoice_id,
    // ยังไม่มีหลักฐานผูก workload กับค่าใช้จ่าย จึงเป็น null ไม่ใช่การเดา
    work_id: link?.work_id ?? null,
    trace_id: link?.trace_id ?? null,
    capability_id: link?.capability_id ?? null,
    evidence_ref: record.evidence_ref,
  };
}
