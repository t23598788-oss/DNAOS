/**
 * Hypothesis Engine — สร้างสถานการณ์สมมติให้ Reasoning ประเมิน
 *
 * Pure Function
 * ไม่เรียก DB ไม่เรียก Tool
 * รับ WorldState → สร้างหลาย Hypothesis → ส่งให้ Reasoning เลือก
 *
 * ตัวอย่าง:
 *   WorldState: ลูกค้าเท่ห์ ค้างจ่าย 48,866 บาท
 *   Hypothesis 1: ทวงหนี้ → ออกเอกสาร + ส่ง LINE → ได้เงินคืน
 *   Hypothesis 2: ให้เครดิตต่อ → ส่งของต่อ → หนี้เพิ่ม
 *   Hypothesis 3: หยุดส่ง → ลูกค้าจ่าย → ค่อยส่งต่อ
 */

import type { WorldState, Constraint, Entity } from "../state/types";

export interface Hypothesis {
  id: string;
  description: string;
  action: string;
  expected_outcome: string;
  risk_level: "low" | "medium" | "high";
  constraints_resolved: string[];
  constraints_created: string[];
  priority: number;
}

export function generateHypotheses(worldState: WorldState): Hypothesis[] {
  const hypotheses: Hypothesis[] = [];
  const focus = worldState.suggested_focus;
  const constraints = worldState.constraints;
  const entities = worldState.entities;

  // ── Debt collection scenarios ──
  if (focus === "debt_collection" || hasOverdueDebt(constraints)) {
    const debtEntities = entities.filter(e => e.type === "debt");
    const totalDebt = debtEntities.reduce((sum, e) => sum + (Number(e.attributes.outstanding ?? e.attributes.principal ?? 0)), 0);

    hypotheses.push({
      id: "h-collect-now",
      description: "ทวงหนี้ทันที — ออกเอกสารทวงหนี้ + ส่ง LINE",
      action: "collect_debt",
      expected_outcome: `ลดหนี้ค้าง ${totalDebt.toLocaleString("th-TH")} บาท`,
      risk_level: "low",
      constraints_resolved: constraints.filter(c => c.type === "overdue_payment").map(c => c.description),
      constraints_created: [],
      priority: 1,
    });

    hypotheses.push({
      id: "h-partial-payment",
      description: "เจรจาชำระบางส่วน — ลูกค้าจ่ายก่อนครึ่งหนึ่ง",
      action: "negotiate_payment",
      expected_outcome: `ได้เงินคืนบางส่วน รักษาความสัมพันธ์ลูกค้า`,
      risk_level: "medium",
      constraints_resolved: [],
      constraints_created: ["ต้องติดตามยอดที่เหลือ"],
      priority: 2,
    });

    if (totalDebt > 50000) {
      hypotheses.push({
        id: "h-stop-delivery",
        description: "หยุดส่งของจนกว่าจะชำระ",
        action: "suspend_delivery",
        expected_outcome: "ลดความเสี่ยงหนี้เพิ่ม แต่อาจเสียลูกค้า",
        risk_level: "high",
        constraints_resolved: ["ป้องกันหนี้เพิ่ม"],
        constraints_created: ["ลูกค้าอาจไม่พอใจ", "ต้องหาลูกค้าใหม่ทดแทน"],
        priority: 3,
      });
    }
  }

  // ── Review/Profile scenarios ──
  if (focus === "review") {
    const hasDebt = entities.some(e => e.type === "debt");
    const hasJobs = entities.some(e => e.type === "job");

    if (hasDebt) {
      hypotheses.push({
        id: "h-review-debt",
        description: "ดูสถานะหนี้ + ประวัติชำระ",
        action: "review_debt",
        expected_outcome: "เห็นภาพรวมหนี้ครบ",
        risk_level: "low",
        constraints_resolved: [],
        constraints_created: [],
        priority: 1,
      });
    }

    if (hasJobs) {
      hypotheses.push({
        id: "h-review-jobs",
        description: "ดูสถานะงาน + การส่งของ",
        action: "review_job",
        expected_outcome: "เห็นความคืบหน้างานจัดส่ง",
        risk_level: "low",
        constraints_resolved: [],
        constraints_created: [],
        priority: hasDebt ? 2 : 1,
      });
    }

    hypotheses.push({
      id: "h-create-invoice",
      description: "ออกใบแจ้งหนี้",
      action: "create_invoice",
      expected_outcome: "เริ่มกระบวนการเก็บเงิน",
      risk_level: "low",
      constraints_resolved: [],
      constraints_created: [],
      priority: 3,
    });
  }

  // ── Creation scenarios ──
  if (focus === "creation") {
    hypotheses.push({
      id: "h-create-with-db",
      description: "สร้างเอกสารจากข้อมูลใน DB",
      action: "create_from_db",
      expected_outcome: "เอกสารสมบูรณ์ไม่ต้องกรอกเอง",
      risk_level: "low",
      constraints_resolved: [],
      constraints_created: [],
      priority: 1,
    });

    if (worldState.has_blocking_constraints) {
      hypotheses.push({
        id: "h-resolve-first",
        description: "แก้ข้อจำกัดก่อนสร้างเอกสาร",
        action: "resolve_constraints",
        expected_outcome: "ข้อมูลครบถ้วนก่อนสร้าง",
        risk_level: "low",
        constraints_resolved: constraints.filter(c => c.severity === "blocking").map(c => c.description),
        constraints_created: [],
        priority: 0,
      });
    }
  }

  // ── Workflow scenarios ──
  if (focus === "workflow") {
    hypotheses.push({
      id: "h-workflow-full",
      description: "รัน workflow ครบทุก step",
      action: "execute_workflow",
      expected_outcome: "workflow สำเร็จ",
      risk_level: "low",
      constraints_resolved: [],
      constraints_created: [],
      priority: 1,
    });
  }

  // ── Transport scenarios ──
  if (focus === "transport") {
    hypotheses.push({
      id: "h-send-now",
      description: "ส่งทันที",
      action: "transport_execute",
      expected_outcome: "ส่งสำเร็จ",
      risk_level: "low",
      constraints_resolved: [],
      constraints_created: [],
      priority: 1,
    });
  }

  // ── ถ้าไม่มี hypothesis → general ──
  if (hypotheses.length === 0) {
    hypotheses.push({
      id: "h-general",
      description: "แสดงข้อมูลที่มี",
      action: "show_data",
      expected_outcome: "ผู้ใช้เห็นข้อมูล",
      risk_level: "low",
      constraints_resolved: [],
      constraints_created: [],
      priority: 1,
    });
  }

  return hypotheses.sort((a, b) => a.priority - b.priority);
}

function hasOverdueDebt(constraints: Constraint[]): boolean {
  return constraints.some(c => c.type === "overdue_payment");
}
