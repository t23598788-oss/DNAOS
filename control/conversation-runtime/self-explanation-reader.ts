/**
 * หน้าที่: PUBLISH_EXISTING_SELF_EXPLANATION_PROJECTIONS PHASE 3, refactored
 * for HARDEN_SUBJECT_AWARE_OWNER_QUERY_ROUTING (Owner UNLOCK 2026-09-06) —
 * subject resolution now belongs to `./subject-router.ts`, not to this
 * file. This file answers ONE question about ONE already-resolved subject;
 * it never re-derives which subject the Owner meant from raw text.
 *
 * Reads ONLY `../conversation-read-model/contract.ts#readSelfExplanationProjection`.
 * Never imports `control/machine-model/` or `control/resource-reconciliation/` —
 * see `./tests/dependency-gate.test.ts`.
 *
 * Input: an already-resolved `SelfExplanationNodeProjection` + a question
 * kind (`./subject-router.ts` supplies both — see its own header for why
 * subject resolution moved out of here).
 * Output: `classifySelfExplanationQuestionType`, `findAllMatchingSubjectNodes`,
 * `answerSelfExplanationQueryForSubject`.
 * Dependency ที่อนุญาต: ../conversation-read-model/contract.ts.
 * สิ่งที่ห้ามแตะ: ห้าม import control/machine-model/ หรือ
 * control/resource-reconciliation/ เข้าไฟล์นี้ไม่ว่าทางใด. ห้ามเดา subject
 * จากข้อความเอง — นั่นเป็นหน้าที่ของ ./subject-router.ts เท่านั้น.
 */

import { readSelfExplanationProjection, type SelfExplanationNodeProjection } from "../conversation-read-model/contract";

export type SelfExplanationQuestionKind = "IDENTITY" | "DEPENDENCIES" | "DEPENDENTS" | "IMPACT" | "LINEAGE" | "DUPLICATES";

const KIND_PATTERNS: readonly { kind: SelfExplanationQuestionKind; pattern: RegExp }[] = [
  { kind: "IMPACT", pattern: /ถ้า.{0,20}หาย.{0,20}(ได้รับผล|กระทบ)|impact.{0,10}(removal|remove)/i },
  { kind: "DEPENDENTS", pattern: /มีอะไร.{0,10}พึ่ง|what depends on/i },
  { kind: "DUPLICATES", pattern: /ซ้ำ.{0,10}(กับตัวนี้|กันไหม|กัน)|duplicate|ตัวแทน/i },
  { kind: "LINEAGE", pattern: /มาจากไหน|ทำไม.{0,10}มีอยู่|ใครยังใช้|where.{0,10}from/i },
  { kind: "DEPENDENCIES", pattern: /พึ่งอะไร|เชื่อมกับอะไร|depends? on what/i },
  { kind: "IDENTITY", pattern: /คืออะไร|what is\b/i },
];

/** QUESTION TYPE only — no subject involved. `./subject-router.ts` calls this AFTER it has already resolved a real subject, never before. */
export function classifySelfExplanationQuestionType(text: string): SelfExplanationQuestionKind | null {
  return KIND_PATTERNS.find(({ pattern }) => pattern.test(text))?.kind ?? null;
}

/**
 * EVERY real, published node whose label appears in the text — not just the
 * longest/best match. Returning the full set is what lets
 * `./subject-router.ts` detect genuine ambiguity (two distinct real
 * subjects both named) instead of silently picking a winner.
 */
export function findAllMatchingSubjectNodes(text: string, nodes: readonly SelfExplanationNodeProjection[]): readonly SelfExplanationNodeProjection[] {
  const seen = new Set<string>();
  const matches: SelfExplanationNodeProjection[] = [];
  for (const n of nodes) {
    if (n.label && text.includes(n.label) && !seen.has(n.label)) {
      seen.add(n.label);
      matches.push(n);
    }
  }
  return matches;
}

export function readPublishedSelfExplanationNodes(): readonly SelfExplanationNodeProjection[] | null {
  const read = readSelfExplanationProjection();
  return read.status === "OK" ? read.manifest.nodes : null;
}

export interface SelfExplanationAnswer {
  readonly answer: string;
  readonly status: "ANSWERED" | "UNRESOLVED" | "DENIED";
  readonly evidence_refs: readonly string[];
  readonly projection: unknown;
}

/** Answers ONE question about an ALREADY-RESOLVED subject node — never resolves the subject itself. */
export function answerSelfExplanationQueryForSubject(subject: SelfExplanationNodeProjection, kind: SelfExplanationQuestionKind): SelfExplanationAnswer {
  if (kind === "IDENTITY") {
    if (!subject.purpose) {
      return { answer: `"${subject.label}" (${subject.node_type}) — ไม่พบข้อมูล purpose ที่ยืนยันได้ในโปรเจกชันนี้ (UNKNOWN)`, status: "UNRESOLVED", evidence_refs: [subject.node_id], projection: { node_type: subject.node_type, purpose: null } };
    }
    return { answer: `"${subject.label}" เป็น ${subject.node_type} — ${subject.purpose}`, status: "ANSWERED", evidence_refs: [subject.node_id], projection: { node_type: subject.node_type, purpose: subject.purpose } };
  }

  if (kind === "DEPENDENCIES") {
    if (subject.dependencies.length === 0) {
      return { answer: `"${subject.label}" ไม่มี dependency ที่เผยแพร่ไว้ในโปรเจกชันนี้`, status: "UNRESOLVED", evidence_refs: subject.evidence_refs, projection: subject.dependencies };
    }
    const parts = subject.dependencies.map((d) => `${d.label ?? d.node_id} (${d.kind})`);
    return { answer: `"${subject.label}" พึ่ง: ${parts.join(", ")}`, status: "ANSWERED", evidence_refs: subject.dependencies.map((d) => d.evidence_ref), projection: subject.dependencies };
  }

  if (kind === "DEPENDENTS") {
    if (subject.dependents.length === 0) {
      return { answer: `ไม่พบสิ่งใดที่พึ่ง "${subject.label}" ในโปรเจกชันนี้`, status: "UNRESOLVED", evidence_refs: subject.evidence_refs, projection: subject.dependents };
    }
    const parts = subject.dependents.map((d) => `${d.label ?? d.node_id} (${d.kind})`);
    return { answer: `พบสิ่งที่พึ่ง "${subject.label}": ${parts.join(", ")}`, status: "ANSWERED", evidence_refs: subject.dependents.map((d) => d.evidence_ref), projection: subject.dependents };
  }

  if (kind === "IMPACT") {
    if (subject.impacted_by_removal.length === 0) {
      return { answer: `ถ้า "${subject.label}" หายไป ไม่พบสิ่งใดได้รับผลกระทบตามโปรเจกชันนี้`, status: "UNRESOLVED", evidence_refs: subject.evidence_refs, projection: subject.impacted_by_removal };
    }
    const parts = subject.impacted_by_removal.map((i) => `${i.label ?? i.node_id} (depth=${i.depth})`);
    return { answer: `ถ้า "${subject.label}" หายไป จะกระทบ: ${parts.join(", ")}`, status: "ANSWERED", evidence_refs: subject.dependents.map((d) => d.evidence_ref), projection: subject.impacted_by_removal };
  }

  if (kind === "LINEAGE") {
    if (!subject.lineage) {
      return { answer: `ยังไม่มีข้อมูล lineage ที่เผยแพร่ไว้สำหรับ "${subject.label}" ในรอบนี้ (ไม่ได้แปลว่าไม่มี — แค่ยังไม่ถูกคำนวณ)`, status: "UNRESOLVED", evidence_refs: subject.evidence_refs, projection: null };
    }
    const l = subject.lineage;
    const answer = `"${subject.label}": current_state=${l.current_state}, consumers=[${l.consumers.join(", ") || "none"}], dependencies=[${l.dependencies.join(", ") || "none"}]`
      + (l.superseded_by ? `, superseded_by=${l.superseded_by}` : "")
      + (l.unresolved.length > 0 ? `, unresolved=[${l.unresolved.join(", ")}]` : "");
    return { answer, status: "ANSWERED", evidence_refs: subject.evidence_refs, projection: l };
  }

  // DUPLICATES
  if (subject.duplicate_findings.length === 0) {
    return { answer: `ไม่พบหลักฐาน duplicate/supersession สำหรับ "${subject.label}" ในโปรเจกชันนี้`, status: "UNRESOLVED", evidence_refs: subject.evidence_refs, projection: [] };
  }
  const findings = subject.duplicate_findings.map((f) => `${f.old_path} → ${f.new_path} (${f.basis})`);
  return { answer: `พบความสัมพันธ์ duplicate/supersession: ${findings.join("; ")}`, status: "ANSWERED", evidence_refs: subject.duplicate_findings.flatMap((f) => f.evidence), projection: subject.duplicate_findings };
}
