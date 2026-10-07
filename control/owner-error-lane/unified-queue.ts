/**
 * หน้าที่: มุมมองรวมของ "งานซ่อมหนึ่งเรื่อง" จากสามแหล่งที่มีอยู่แล้ว
 *
 * ── ไม่มีคิวใหม่ ไม่มีสโตร์ใหม่ ──
 * ไฟล์นี้ **อ่านอย่างเดียว** ไม่มี append ไม่มี write ไม่มีไฟล์ของตัวเอง
 * ข้อมูลทั้งหมดมาจากสามที่ที่มีอยู่แล้ว: ฟีดคอนโซล (สโตร์สายเลือดของ
 * owner-command), GapRecord (repair-loop), RemediationRecord (evidence store
 * ของ agent-gateway) การรวมเกิดตอนอ่าน ไม่ใช่ตอนเขียน
 *
 * ── หนึ่งของเสียจริง = หนึ่งรายการ ──
 * รวมด้วย `work_id` ซึ่งเป็นคีย์ร่วมที่ M5 ทำให้มีครบทั้งสามแหล่ง ไม่ใช่ด้วย
 * การเดาจากข้อความหรือเวลา ถ้าแถวใดไม่มี work_id จะถูกจัดกลุ่มด้วยตัวตนของ
 * ตัวเอง — ไม่ถูกยุบรวมกับใครมั่ว ๆ
 *
 * ── ช่องที่ยังไม่รู้คือ null ──
 * รายการที่ยังไม่เคยผ่าน root-cause จะมี `root_cause` เป็น null ไม่ใช่
 * "UNDETERMINED" ที่ดูเหมือนเคยวิเคราะห์แล้ว
 *
 * Input: none (อ่านจากสามแหล่งที่มีอยู่)
 * Output: `listUnifiedRepairItems`, `UnifiedRepairItem`
 * Dependency ที่อนุญาต: ./console-feed.ts, ./repair-link.ts,
 * ../repair-loop/contract.ts, ../incident-remediation/contract.ts
 * สิ่งที่ห้ามแตะ: ห้ามให้ไฟล์นี้เขียนอะไรลงที่ใด และห้ามยุบรวมสองรายการที่
 * ไม่มีหลักฐานว่าเป็นเรื่องเดียวกัน
 */

import { listOwnerConsoleItems } from "./console-feed";
import { loadRemediationByWorkId } from "../incident-remediation/contract";
import type { RemediationRecord } from "../incident-remediation/contract";
import type { GapRecord, RepairType, RootCauseClass, StopCondition } from "../repair-loop/contract";

export interface UnifiedRepairItem {
  readonly work_id: string | null;
  readonly source_identity: string | null;
  readonly gap_id: string | null;
  readonly remediation_id: string | null;
  readonly owner_console_id: string | null;

  readonly state: string;
  readonly severity: "OWNER_ATTENTION" | "DEFECT" | "OBSERVED";
  readonly depth: number;
  readonly upstream: readonly string[];
  readonly downstream: readonly string[];
  readonly occurrences: number;

  readonly root_cause: RootCauseClass | null;
  readonly repair_type: RepairType | null;
  readonly attempt_count: number;
  readonly execution_state: string | null;
  readonly verification_state: string | null;
  readonly terminal_state: string | null;

  readonly stop_condition: StopCondition | null;
  readonly owner_decision_required: boolean;

  readonly evidence_refs: readonly string[];
  readonly registry_refs: readonly string[];

  readonly FIRST_SEEN: string | null;
  readonly LAST_SEEN: string | null;
}

export interface UnifiedQueueInput {
  /** GapRecord ที่ผู้เรียกมีอยู่แล้ว — ไฟล์นี้ไม่เรียก scanGaps เอง เพื่อไม่ให้การอ่านมีต้นทุนแฝง */
  readonly gaps?: readonly GapRecord[];
  readonly limit?: number;
}

function severityOf(consoleDetail: string, gap: GapRecord | undefined): UnifiedRepairItem["severity"] {
  if (/OWNER_ATTENTION|OWNER_DECISION_REQUIRED/.test(consoleDetail)) return "OWNER_ATTENTION";
  return gap ? "DEFECT" : "OBSERVED";
}

/**
 * รวมสามแหล่งเป็นรายการเดียวต่อหนึ่งของเสีย
 *
 * ลำดับความสำคัญของค่า: GapRecord (สิ่งที่วิเคราะห์แล้ว) > RemediationRecord
 * (สิ่งที่ลงมือแล้ว) > ฟีดคอนโซล (สิ่งที่เพิ่งเห็น) — ค่าที่พิสูจน์ลึกกว่าชนะ
 */
export function listUnifiedRepairItems(input: UnifiedQueueInput = {}): readonly UnifiedRepairItem[] {
  const limit = input.limit ?? 50;
  const gapsByWork = new Map<string, GapRecord>();
  const gapsWithoutWork: GapRecord[] = [];
  for (const g of input.gaps ?? []) {
    if (g.work_id) gapsByWork.set(g.work_id, g); else gapsWithoutWork.push(g);
  }

  const byKey = new Map<string, UnifiedRepairItem>();

  for (const c of listOwnerConsoleItems(limit * 4)) {
    const workId = c.work_id;
    const key = workId ?? `console:${c.command_id}`;
    const gap = workId ? gapsByWork.get(workId) : undefined;
    let rem: RemediationRecord | null = null;
    if (workId) { try { rem = loadRemediationByWorkId(workId); } catch { rem = null; } }

    byKey.set(key, {
      work_id: workId,
      source_identity: c.origin_event_id,
      gap_id: gap?.gap_id ?? null,
      remediation_id: rem?.incident_id ?? null,
      owner_console_id: c.command_id,
      state: gap?.state ?? c.stage,
      severity: severityOf(c.detail, gap),
      depth: gap?.depth ?? 0,
      upstream: gap?.upstream ?? [],
      downstream: gap?.downstream ?? [],
      occurrences: gap?.occurrences ?? 1,
      root_cause: null,
      repair_type: gap?.repair_type ?? null,
      attempt_count: rem?.attempts.length ?? 0,
      execution_state: rem?.attempts.at(-1)?.outcome ?? null,
      verification_state: rem?.current_runtime_state ?? null,
      terminal_state: rem?.terminal_state ?? null,
      stop_condition: null,
      owner_decision_required: rem?.terminal_state === "OWNER_DECISION_REQUIRED"
        || /OWNER_ATTENTION|OWNER_DECISION_REQUIRED/.test(c.detail),
      evidence_refs: gap?.evidence_refs ?? [],
      registry_refs: gap?.registry_refs ?? [],
      FIRST_SEEN: gap?.first_seen ?? c.recorded_at,
      LAST_SEEN: gap?.last_seen ?? c.recorded_at,
    });
  }

  // ช่องว่างที่ scanGaps เจอเองโดยไม่มีงานต้นทาง — แสดงแยก ไม่ยุบรวมกับใคร
  for (const g of gapsWithoutWork) {
    if (byKey.has(`gap:${g.gap_id}`)) continue;
    byKey.set(`gap:${g.gap_id}`, {
      work_id: null, source_identity: g.source_event_id ?? null, gap_id: g.gap_id,
      remediation_id: null, owner_console_id: null,
      state: g.state, severity: "DEFECT", depth: g.depth,
      upstream: g.upstream, downstream: g.downstream, occurrences: g.occurrences,
      root_cause: null, repair_type: g.repair_type, attempt_count: 0,
      execution_state: null, verification_state: null, terminal_state: null,
      stop_condition: null, owner_decision_required: false,
      evidence_refs: g.evidence_refs, registry_refs: g.registry_refs,
      FIRST_SEEN: g.first_seen, LAST_SEEN: g.last_seen,
    });
  }

  return [...byKey.values()]
    .sort((a, b) => (String(a.LAST_SEEN) < String(b.LAST_SEEN) ? 1 : -1))
    .slice(0, limit);
}
