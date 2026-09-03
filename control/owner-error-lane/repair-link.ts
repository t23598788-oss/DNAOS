/**
 * หน้าที่: ต่อความล้มเหลวจริงที่ถูกรับเข้าคอนโซล เข้ากับวงจรซ่อมที่มีอยู่แล้ว
 *
 * ── ไม่มีวงจรซ่อมตัวที่สอง ──
 * ไฟล์นี้ไม่ตัดสินสาเหตุ ไม่สร้างงานซ่อม และไม่ตรวจว่าซ่อมได้ไหม ทั้งสามอย่างนั้น
 * เป็นของ `control/repair-loop` อยู่แล้ว (`analyzeRootCause`,
 * `buildRepairWorkItem`, `preDispatchStop`) หน้าที่เดียวของไฟล์นี้คือ **แปลง
 * ความล้มเหลวหนึ่งเรื่องให้เป็น GapRecord ที่พก work_id เดิม** แล้วส่งต่อ
 *
 * ── การปฏิเสธที่ถูกต้อง ไม่ใช่ของเสีย ──
 * ประตูที่ทำงานถูกแล้วปฏิเสธอินพุตที่ผิดสัญญา **ต้องไม่กลายเป็นเป้าหมายการซ่อม**
 * — ส่ง agent ไป "แก้" ประตูที่ทำงานถูก คือการพังของที่ยังดีอยู่ ชนิดของความ
 * ล้มเหลวที่อยู่ใน `OWNER_ATTENTION_REQUIRED` และการปฏิเสธเชิงนโยบายจึงถูกกัน
 * ไว้ที่นี่ **ก่อน** ถึง root-cause และ repair-loop เองก็ยังกันซ้ำอีกชั้นด้วย
 * `EXPECTED_POLICY_BLOCK`
 *
 * ── หยุดก่อนถึง Agent เสมอ ──
 * ปลายทางของไฟล์นี้คือ `preDispatchStop` ไม่ใช่การส่งงาน การส่งอัตโนมัติยังปิด
 * อยู่ (M6) และไฟล์นี้ไม่มีเส้นทางใดที่เรียก dispatch ได้เลย
 *
 * Input: `OwnerConsoleItem` ที่ผ่าน `admitSystemError` มาแล้ว
 * Output: `linkAdmittedErrorToRepairLoop`, `LinkOutcome`
 * Dependency ที่อนุญาต: ../repair-loop/contract.ts, ./types.ts, node:crypto
 * สิ่งที่ห้ามแตะ: ห้าม import ตัวส่งงานของ agent-gateway เข้ามาในไฟล์นี้
 * และห้ามให้ชนิดที่ต้องให้ Owner ตัดสิน กลายเป็นงานซ่อมอัตโนมัติ
 */

import { createHash } from "node:crypto";
import { analyzeRootCause, buildRepairWorkItem, preDispatchStop } from "../repair-loop/contract";
import type { GapRecord, RepairWorkItem, RootCauseFinding, StopCondition } from "../repair-loop/contract";
import { OWNER_ATTENTION_REQUIRED } from "./types";
import type { OwnerConsoleItem, SystemErrorKind } from "./types";

/**
 * ชนิดความล้มเหลวที่เป็น "การทำงานที่ถูกต้องของประตู" ไม่ใช่ของเสีย
 *
 * ต่างจาก `OWNER_ATTENTION_REQUIRED` ตรงที่ชุดนั้นคือเรื่องที่อันตรายเกินกว่าจะ
 * ซ่อมเอง ส่วนชุดนี้คือเรื่องที่ **ไม่มีอะไรให้ซ่อมเลย** ระบบทำถูกแล้ว
 */
export type NonDefectReason =
  | "EXPECTED_POLICY_BLOCK"
  | "VALID_REJECTION"
  | "OWNER_DECISION_REQUIRED"
  | "CREDENTIAL_REQUIRED"
  | "DESTRUCTIVE_CHANGE_REQUIRED";

/** ร่องรอยของการปฏิเสธที่ถูกต้อง — ตรวจจากรหัสเหตุผลจริง ไม่ใช่จากข้อความอิสระ */
const VALID_REJECTION_MARKERS = [
  "OUT_OF_SANDBOX_SCOPE", "WORKSPACE_SCOPE_MISMATCH", "PATH_TRAVERSAL",
  "FORBIDDEN_PRODUCTION_FILE", "MODE_NOT_SANDBOX", "CONTENT_INVALID",
  "NO_REQUIRED_TESTS", "NO_EVIDENCE", "MISSING_CHANGE_DESCRIPTION",
  "WORK_ORDER_REJECTED", "DENIED", "EXTERNAL_RESOURCE_POLICY_NOT_DEFINED",
];

export function classifyNonDefect(item: OwnerConsoleItem): NonDefectReason | null {
  if (OWNER_ATTENTION_REQUIRED.includes(item.error_kind as SystemErrorKind)) {
    if (item.error_kind === "CREDENTIAL_CHANGE") return "CREDENTIAL_REQUIRED";
    if (item.error_kind === "PRODUCTION_DELETION" || item.error_kind === "AMBIGUOUS_DESTRUCTIVE_ACTION") {
      return "DESTRUCTIVE_CHANGE_REQUIRED";
    }
    return "OWNER_DECISION_REQUIRED";
  }
  const surface = `${item.raw_command_text} ${JSON.stringify(item.evidence ?? {})}`;
  if (VALID_REJECTION_MARKERS.some((m) => surface.includes(m))) return "VALID_REJECTION";
  return null;
}

/**
 * ตัวตนของช่องว่างมาจากเนื้อหาของความล้มเหลว ไม่ใช่จากเวลา
 *
 * ความล้มเหลวเดิมที่ถูกสังเกตซ้ำจึงได้ `gap_id` เดิม ทำให้ `occurrences` เพิ่ม
 * ได้โดยไม่เกิดงานซ่อมใบใหม่
 */
export function gapIdForError(item: OwnerConsoleItem): string {
  const digest = createHash("sha256").update(JSON.stringify([
    item.error_kind,
    item.evidence?.source_capability ?? null,
    item.evidence?.test_or_build_name ?? null,
    item.evidence?.file_path ?? null,
    item.origin_event_id,
  ])).digest("hex");
  return `gap-${digest.slice(0, 16)}`;
}

/** GapRecord ที่พก work_id เดิม — ไม่สร้าง work_id ใหม่เด็ดขาด */
export function gapFromConsoleItem(item: OwnerConsoleItem, occurrences = 1): GapRecord {
  return {
    gap_id: gapIdForError(item),
    work_id: item.work_id,                 // ← สายเลือดเดิม ไม่ใช่ของใหม่
    source_event_id: item.origin_event_id ?? undefined,
    capability_id: item.evidence?.source_capability ?? "unresolved",
    source_path: item.evidence?.file_path ?? null,
    state: "ERROR",
    reason: item.raw_command_text,
    evidence_refs: [...(item.evidence?.evidence_refs ?? []),
      ...(item.origin_event_id ? [`owner-error-lane:${item.origin_event_id}`] : []),
      `owner-console:${item.command_id}`],
    registry_refs: [],
    upstream: item.parent_work_id ? [item.parent_work_id] : [],
    downstream: [],
    depth: item.parent_work_id ? 1 : 0,
    occurrences,
    first_seen: item.recorded_at,
    last_seen: item.recorded_at,
    repair_type: null,
    actionable: true,
    not_actionable_reason: null,
  };
}

export type LinkOutcome =
  | { readonly linked: false; readonly reason: NonDefectReason; readonly detail: string; readonly gap: GapRecord }
  | { readonly linked: true; readonly gap: GapRecord; readonly finding: RootCauseFinding;
      readonly repair: RepairWorkItem | null; readonly stop: StopCondition | null; readonly dispatched: false };

/**
 * ต่อความล้มเหลวที่รับเข้าแล้ว เข้าวงจรซ่อม แล้วหยุดที่ preDispatchStop
 *
 * `dispatched` เป็น `false` ตามชนิดข้อมูล — ไม่มีค่าอื่นเป็นไปได้ในไฟล์นี้
 */
export function linkAdmittedErrorToRepairLoop(
  item: OwnerConsoleItem, options: { occurrences?: number; trace_id?: string; attempt?: number } = {},
): LinkOutcome {
  const gap = gapFromConsoleItem(item, options.occurrences ?? 1);

  const nonDefect = classifyNonDefect(item);
  if (nonDefect !== null) {
    return { linked: false, reason: nonDefect, gap,
      detail: `${item.error_kind} ไม่ใช่ของเสีย — ประตูทำงานถูกแล้ว จึงไม่สร้างงานซ่อม` };
  }

  const finding = analyzeRootCause(gap);
  // ชั้นกันซ้ำของ repair-loop เอง: การบล็อกเชิงนโยบายไม่ต้องซ่อม
  if (!finding.repair_required || finding.root_cause_class === "EXPECTED_POLICY_BLOCK") {
    return { linked: false, reason: "EXPECTED_POLICY_BLOCK", gap,
      detail: `analyzeRootCause: ${finding.root_cause_class} — repair_required=${String(finding.repair_required)}` };
  }

  const repair = buildRepairWorkItem(gap, finding, {
    trace_id: options.trace_id ?? item.work_id,
    attempt: options.attempt ?? 1,
    existing_tests: [],
  });
  return {
    linked: true, gap, finding, repair,
    stop: repair === null ? "NO_VERIFIABLE_EVIDENCE" : preDispatchStop(repair),
    dispatched: false,
  };
}
