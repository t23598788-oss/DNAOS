/**
 * Thai human projection — read-only view of machine facts.
 * MUST NOT become architecture authority.
 */

import type { SemanticResolveResult } from "./resolve";
import type { SemanticLifecycleState } from "./types";

const KIND_TH: Record<string, string> = {
  repository: "ที่เก็บโค้ด",
  capability: "ความสามารถ",
  contract: "สัญญา",
  policy: "นโยบาย",
  adapter: "อะแดปเตอร์",
  connection: "การเชื่อมต่อ",
  credential: "ข้อมูลรับรอง",
  endpoint: "ปลายทาง",
  executor: "ตัวรัน",
  test: "ชุดทดสอบ",
  evidence: "หลักฐาน",
};

const STATE_TH: Record<SemanticLifecycleState | "UNRESOLVED", string> = {
  DISCOVERED: "ค้นพบแล้ว",
  IDENTIFIED: "ระบุตัวตนแล้ว",
  CLASSIFIED: "จัดหมวดแล้ว",
  LINKED: "เชื่อมความสัมพันธ์แล้ว",
  RESOLVED: "คลี่คลายความสัมพันธ์แล้ว",
  OBSERVED: "สังเกตที่ runtime แล้ว",
  VERIFIED: "ตรวจสอบแล้ว",
  PROVEN: "มีหลักฐานแล้ว",
  CANONICAL: "เป็นมาตรฐานแล้ว",
  UNRESOLVED: "ยังไม่พบตัวตน",
  AWAITING_RELATION: "รอความสัมพันธ์",
  AWAITING_RUNTIME_OBSERVATION: "รอการสังเกต runtime",
  AWAITING_EVIDENCE: "รอหลักฐาน",
};

export function kindToThai(kind: string | null): string {
  if (!kind) return "ไม่ทราบประเภท";
  return KIND_TH[kind] ?? kind;
}

export function stateToThai(state: SemanticLifecycleState | "UNRESOLVED"): string {
  return STATE_TH[state] ?? state;
}

/** Concise Thai projection from resolve facts only. */
export function projectResolveThai(result: SemanticResolveResult): string {
  if (result.status !== "IDENTITY_MATCHED" || !result.id) {
    return [
      "รหัส: (ไม่พบ)",
      "สถานะ: ยังไม่พบตัวตน — ไม่มีการเดาจาก AI",
    ].join("\n");
  }

  const lines: string[] = [];
  lines.push(`รหัส: ${result.id}`);
  lines.push(`ประเภท: ${kindToThai(result.kind)}`);
  if (result.title) lines.push(`ชื่อ: ${result.title}`);
  lines.push(
    `เจ้าของ: ${result.owner_title ?? result.owner ?? "(ไม่ระบุ)"}`,
  );
  if (result.current_implementation) {
    const sym = result.current_implementation.symbol
      ? ` + ${result.current_implementation.symbol}`
      : "";
    lines.push(
      `ตำแหน่งปัจจุบัน: ${result.current_implementation.path}${sym}`,
    );
  }
  if (result.relations.length) {
    lines.push("สัมพันธ์กับ:");
    for (const e of result.relations.slice(0, 12)) {
      if (e.from === result.id) {
        lines.push(`  - ${e.relation} → ${e.to}`);
      } else {
        lines.push(`  - ← ${e.relation} ${e.from}`);
      }
    }
  }
  if (result.tests.length) {
    lines.push(`Tests: ${result.tests.length}`);
  }
  if (result.evidence.length) {
    lines.push(`Evidence: ${result.evidence.length}`);
  }
  lines.push("สถานะ:");
  lines.push(`  ✓ ${stateToThai(result.current_state)}`);
  // Do not claim verification/proof succeeded while relation targets are unresolved.
  const proofOk =
    result.current_state === "VERIFIED" ||
    result.current_state === "PROVEN" ||
    result.current_state === "CANONICAL";
  if (result.tests.length && proofOk && result.current_state !== "AWAITING_RELATION") {
    lines.push("  ✓ ผลทดสอบยืนยันแล้ว (VERIFIED_BY)");
  }
  if (result.evidence.length && (result.current_state === "PROVEN" || result.current_state === "CANONICAL")) {
    lines.push("  ✓ มีหลักฐาน (PROVEN_BY)");
  }
  if (result.current_state === "CANONICAL") {
    lines.push("  ✓ เป็นมาตรฐาน (CANONICAL แยกจาก PROVEN)");
  }
  if (result.source_revision) {
    lines.push(`Revision: ${result.source_revision}`);
  }
  return lines.join("\n");
}
