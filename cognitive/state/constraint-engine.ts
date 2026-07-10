/**
 * Constraint Engine — ตรวจข้อจำกัดของสถานการณ์
 *
 * Pure Function
 */

import type { Entity, SituationEvent, Constraint } from "./types";

export function checkConstraints(entities: Entity[], events: SituationEvent[]): Constraint[] {
  const constraints: Constraint[] = [];

  // ── Overdue payments ──
  const overdueEvents = events.filter(e => e.status === "overdue");
  for (const evt of overdueEvents) {
    constraints.push({
      type: "overdue_payment",
      description: evt.description,
      entity_id: evt.entities[0] ?? null,
      severity: "warning",
      resolution: "ออกเอกสารทวงหนี้ หรือ ติดต่อลูกค้า",
    });
  }

  // ── Missing data ──
  const unresolvedEntities = entities.filter(e => e.confidence < 1.0);
  for (const entity of unresolvedEntities) {
    constraints.push({
      type: "missing_data",
      description: `${entity.name} ยังไม่ได้ระบุตัวตน (confidence: ${entity.confidence})`,
      entity_id: entity.id,
      severity: entity.confidence < 0.5 ? "blocking" : "warning",
      resolution: "ต้อง resolve identity ก่อน",
    });
  }

  // ── Over credit limit (placeholder — ต้อง config จาก DB) ──
  for (const entity of entities) {
    if (entity.type === "debt") {
      const outstanding = entity.attributes.outstanding as number ?? entity.attributes.principal as number ?? 0;
      if (outstanding > 100000) {
        constraints.push({
          type: "over_credit_limit",
          description: `${entity.name} ค้างชำระ ${outstanding.toLocaleString("th-TH")} บาท — เกินเกณฑ์`,
          entity_id: entity.id,
          severity: "warning",
          resolution: "พิจารณาหยุดส่งของจนกว่าจะชำระ",
        });
      }
    }
  }

  // ── Job capacity ──
  for (const entity of entities) {
    if (entity.type === "job") {
      const required = entity.attributes.required as number ?? 0;
      const delivered = entity.attributes.delivered as number ?? 0;
      if (required > 0 && delivered >= required) {
        constraints.push({
          type: "capacity_exceeded",
          description: `${entity.name} ส่งครบแล้ว (${delivered}/${required} คิว)`,
          entity_id: entity.id,
          severity: "info",
          resolution: null,
        });
      }
    }
  }

  return constraints.sort((a, b) => {
    const order = { blocking: 0, warning: 1, info: 2 };
    return order[a.severity] - order[b.severity];
  });
}
