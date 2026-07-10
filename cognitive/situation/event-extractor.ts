/**
 * Event Extractor — ดึงเหตุการณ์จากข้อมูล DB
 *
 * Pure Function
 * สร้าง events จากสถานะของ entities
 */

import type { Entity, SituationEvent, EventType } from "../state/types";

export function extractEvents(entities: Entity[]): SituationEvent[] {
  const events: SituationEvent[] = [];
  const now = new Date();

  for (const entity of entities) {
    if (entity.type === "debt") {
      const outstanding = entity.attributes.outstanding as number ?? entity.attributes.principal as number ?? 0;
      const status = entity.attributes.status as string;

      if (outstanding > 0) {
        const isOverdue = status === "OPEN" || status === "OVERDUE";
        events.push({
          id: `evt-debt-${entity.id}`,
          type: isOverdue ? "payment_overdue" : "payment_due",
          description: `${entity.name} ค้างชำระ ${outstanding.toLocaleString("th-TH")} บาท`,
          entities: [entity.id],
          timestamp: entity.attributes.interest_start as string ?? null,
          status: isOverdue ? "overdue" : "current",
        });
      }

      if (status === "PAID") {
        events.push({
          id: `evt-paid-${entity.id}`,
          type: "payment_received",
          description: `${entity.name} ชำระแล้ว`,
          entities: [entity.id],
          timestamp: null,
          status: "past",
        });
      }
    }

    if (entity.type === "job") {
      const status = entity.attributes.status as string;
      const delivered = entity.attributes.delivered as number ?? 0;
      const required = entity.attributes.required as number ?? 0;

      if (status === "IN_PROGRESS") {
        events.push({
          id: `evt-job-${entity.id}`,
          type: "delivery_scheduled",
          description: `${entity.name} กำลังส่ง (${delivered}/${required} คิว)`,
          entities: [entity.id],
          timestamp: null,
          status: "current",
        });
      }

      if (status === "COMPLETED") {
        events.push({
          id: `evt-job-done-${entity.id}`,
          type: "delivery_completed",
          description: `${entity.name} ส่งครบแล้ว`,
          entities: [entity.id],
          timestamp: null,
          status: "past",
        });
      }
    }

    if (entity.type === "document") {
      events.push({
        id: `evt-doc-${entity.id}`,
        type: "document_created",
        description: `${entity.attributes.doc_type} ${entity.name}`,
        entities: [entity.id],
        timestamp: entity.attributes.issue_date as string ?? null,
        status: "past",
      });
    }
  }

  return events.sort((a, b) => {
    const order = { overdue: 0, current: 1, planned: 2, past: 3 };
    return order[a.status] - order[b.status];
  });
}
