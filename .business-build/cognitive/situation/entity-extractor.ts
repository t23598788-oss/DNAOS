/**
 * Entity Extractor — ดึง Entity จากข้อมูล DB + session
 *
 * Pure Function
 * ไม่เรียก DB เอง — รับ db_results เป็น input
 * ไม่ใช้ keyword matching — อ่านจากข้อมูลจริง
 */

import type { Entity, EntityType, SituationInput } from "../state/types";

export function extractEntities(input: SituationInput): Entity[] {
  const entities: Entity[] = [];

  // ── Primary entity: who ──
  if (input.who) {
    entities.push({
      id: input.who_id ?? `unresolved-${input.who}`,
      type: "customer",
      name: input.who,
      attributes: { resolved: !!input.who_id },
      source: input.who_id ? "database" : "user_input",
      confidence: input.who_id ? 1.0 : 0.7,
    });
  }

  // ── Entities from DB results ──
  for (const [table, rows] of Object.entries(input.db_results)) {
    for (const row of rows as any[]) {
      const entity = mapRowToEntity(table, row);
      if (entity && !entities.some(e => e.id === entity.id)) {
        entities.push(entity);
      }
    }
  }

  return entities;
}

function mapRowToEntity(table: string, row: any): Entity | null {
  switch (table) {
    case "partners":
      return {
        id: row.id, type: "partner", name: row.name,
        attributes: { code: row.code, phone: row.phone, address: row.address, partner_type: row.partner_type_label },
        source: "database", confidence: 1.0,
      };

    case "debt_trackings":
      return {
        id: row.id, type: "debt", name: row.customer_name ?? "unknown",
        attributes: { principal: row.principal_amount, fee_rate: row.fee_rate, interest_start: row.interest_start_at },
        source: "database", confidence: 1.0,
      };

    case "invoice_debts":
      return {
        id: row.id, type: "debt", name: row.document_id,
        attributes: { principal: row.principal_amount, outstanding: row.outstanding_amount, status: row.invoice_status, paid: row.paid_amount },
        source: "database", confidence: 1.0,
      };

    case "documents":
      return {
        id: row.id, type: "document", name: row.document_number ?? row.id,
        attributes: { doc_type: row.document_type, party_name: row.party_name, amount: row.net_amount, status: row.status, issue_date: row.issue_date },
        source: "database", confidence: 1.0,
      };

    case "jobs":
      return {
        id: row.id, type: "job", name: row.project_name ?? row.id,
        attributes: { contact: row.contact_name, distance: row.distance_km, required: row.required_quantity, delivered: row.delivered_quantity, status: row.job_status },
        source: "database", confidence: 1.0,
      };

    case "material_types":
      return {
        id: row.id, type: "material", name: row.name,
        attributes: {},
        source: "database", confidence: 1.0,
      };

    default:
      return null;
  }
}
