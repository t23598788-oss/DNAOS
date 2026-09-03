/**
 * หน้าที่: ยุบอาการหลายอย่างที่มาจากต้นเหตุเดียว ให้เหลืองานซ่อมใบเดียว
 *
 * ── กฎที่ห้ามละเมิด ──
 * อาการ 20 อย่างที่เกิดจากต้นเหตุเดียวที่พิสูจน์แล้ว ต้องได้งานซ่อม **หนึ่งใบ**
 * ไม่ใช่ยี่สิบใบ และอาการปลายทางกลายเป็น "เป้าหมายการตรวจสอบ" ไม่ใช่เป้าหมาย
 * การซ่อม — การไล่ซ่อมอาการขณะที่ต้นเหตุยังอยู่ คือการแก้สิ่งที่จะพังซ้ำทันที
 *
 * ── COMMON_UPSTREAM ไม่ใช่หลักฐานของเหตุ ──
 * การมีต้นน้ำร่วมกันบอกได้แค่ว่า "อาจเกี่ยวกัน" `PROVEN_ROOT_CAUSE` ตั้งได้ก็
 * ต่อเมื่อมี `causal_evidence` จริงเท่านั้น ไม่มีหลักฐาน = ยุบไม่ได้ และอาการ
 * แต่ละอย่างยังคงเป็นเรื่องของตัวเอง
 *
 * Input: `PreparedRepairRecord[]`
 * Output: `collapseSymptoms`, `RootIncident`
 * Dependency ที่อนุญาต: ./preparation.ts (type-only)
 * สิ่งที่ห้ามแตะ: ห้ามยุบกลุ่มโดยไม่มี proven cause และห้ามให้ผลการยุบกลาย
 * เป็นใบอนุญาตลงมือ
 */

import type { PreparedRepairRecord } from "./preparation";

export interface RootIncident {
  readonly root_incident_id: string;
  readonly symptom_work_ids: readonly string[];
  readonly common_upstream: readonly string[];
  readonly first_divergence_point: string | null;
  readonly root_cause_candidates: readonly string[];
  readonly proven_root_cause: string | null;
  readonly causal_evidence: readonly string[];
  /** ซ่อมได้ก็ต่อเมื่อพิสูจน์ต้นเหตุแล้ว และไม่มี stop condition */
  readonly root_repair_ready: boolean;
  /** อาการที่ถูกกดไว้ ไม่ให้ซ่อมแยกขณะต้นเหตุยังไม่ถูกแก้ */
  readonly suppressed_downstream: readonly string[];
}

export interface CollapseResult {
  readonly root_incidents: readonly RootIncident[];
  readonly independent: readonly PreparedRepairRecord[];
  readonly symptom_count: number;
  readonly collapsed_symptom_count: number;
  readonly proven_root_cause_count: number;
  readonly ready_root_repair_count: number;
  readonly downstream_repair_suppressed_count: number;
}

/**
 * จัดกลุ่มด้วยต้นน้ำร่วม แล้วยุบเฉพาะกลุ่มที่มีหลักฐานเชิงเหตุ
 *
 * กลุ่มที่มีต้นน้ำร่วมแต่ยังไม่มีหลักฐาน จะถูกรายงานเป็น root incident ที่
 * `proven_root_cause = null` และ **ไม่กด** อาการใด — เพราะยังพิสูจน์ไม่ได้ว่า
 * มันเป็นอาการของกันและกันจริง
 */
export function collapseSymptoms(records: readonly PreparedRepairRecord[]): CollapseResult {
  const byUpstream = new Map<string, PreparedRepairRecord[]>();
  const independent: PreparedRepairRecord[] = [];

  for (const r of records) {
    const key = r.upstream.length > 0 ? [...r.upstream].sort().join("|") : null;
    if (key === null) { independent.push(r); continue; }
    const list = byUpstream.get(key) ?? [];
    list.push(r);
    byUpstream.set(key, list);
  }

  const incidents: RootIncident[] = [];
  let collapsed = 0, proven = 0, ready = 0, suppressed = 0;

  for (const [key, group] of byUpstream) {
    const upstream = key.split("|");
    // หลักฐานเชิงเหตุมีก็ต่อเมื่อมีสมาชิกที่ระบุ proven_cause ไว้แล้ว
    const withProof = group.filter((g) => g.proven_cause !== null);
    const provenCause = withProof.length > 0 ? withProof[0].proven_cause : null;
    const evidence = withProof.flatMap((g) => g.evidence_refs.filter((e) => e.startsWith("binding:") || e.includes("causal")));

    const canRepair = provenCause !== null
      && group.some((g) => g.stop_condition === null && g.root_cause !== null && g.root_cause !== "UNDETERMINED");
    const downstream = provenCause !== null ? group.map((g) => g.work_id) : [];

    if (provenCause !== null) { proven += 1; collapsed += group.length; suppressed += downstream.length; }
    if (canRepair) ready += 1;

    incidents.push({
      root_incident_id: `root-${key.slice(0, 24)}`,
      symptom_work_ids: group.map((g) => g.work_id),
      common_upstream: upstream,
      first_divergence_point: group.map((g) => g.observed_at).find((o) => o !== null) ?? null,
      root_cause_candidates: [...new Set(group.map((g) => g.bound_capability).filter((c): c is string => c !== null))],
      proven_root_cause: provenCause,
      causal_evidence: evidence,
      root_repair_ready: canRepair,
      suppressed_downstream: downstream,
    });
  }

  return {
    root_incidents: incidents, independent,
    symptom_count: records.length,
    collapsed_symptom_count: collapsed,
    proven_root_cause_count: proven,
    ready_root_repair_count: ready,
    downstream_repair_suppressed_count: suppressed,
  };
}
