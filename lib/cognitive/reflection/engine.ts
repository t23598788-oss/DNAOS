/**
 * Reflection — ตรวจผลลัพธ์ + สร้างบทเรียนให้ Memory
 *
 * Pure Function
 * รับ: ExecutionResult + WorldState + Decision
 * ส่ง: Reflection (สิ่งที่เรียนรู้ + memory updates)
 */

import type { WorldState, Entity } from "../state/types";

export interface ExecutionResult {
  tool: string;
  success: boolean;
  data: any;
  error?: string;
}

export interface ReflectionOutput {
  success: boolean;
  summary: string;
  resolved_entities: Entity[];
  state_transitions: StateTransition[];
  lessons: string[];
  memory_updates: MemoryUpdate[];
}

export interface StateTransition {
  entity_id: string;
  field: string;
  from: string;
  to: string;
  timestamp: string;
}

export interface MemoryUpdate {
  action: "set" | "add" | "remove" | "clear";
  key: string;
  value: any;
}

export function reflect(
  results: ExecutionResult[],
  worldState: WorldState,
  decision: string,
): ReflectionOutput {

  const now = new Date().toISOString();
  const transitions: StateTransition[] = [];
  const lessons: string[] = [];
  const memoryUpdates: MemoryUpdate[] = [];
  const resolvedEntities: Entity[] = [];
  const allSuccess = results.every(r => r.success);

  for (const result of results) {
    if (!result.success) {
      lessons.push(`${result.tool} ล้มเหลว: ${result.error ?? "ไม่ทราบสาเหตุ"}`);
      continue;
    }

    // ── identity.resolve → จำ who_id ──
    if (result.tool === "identity.resolve" && result.data) {
      const resolved = Array.isArray(result.data) ? result.data : [result.data];
      if (resolved.length === 1) {
        const entity = resolved[0];
        memoryUpdates.push({ action: "set", key: "who_id", value: entity.id });
        memoryUpdates.push({ action: "set", key: "who", value: entity.name ?? entity.customer_name });
        resolvedEntities.push({
          id: entity.id,
          type: "customer",
          name: entity.name ?? entity.customer_name ?? "",
          attributes: entity,
          source: "database",
          confidence: 1.0,
        });
        lessons.push(`ระบุตัวตนสำเร็จ: ${entity.name ?? entity.customer_name}`);
      } else if (resolved.length > 1) {
        lessons.push(`พบหลายรายการ ${resolved.length} ราย — ต้องให้ผู้ใช้เลือก`);
      } else {
        lessons.push("ไม่พบข้อมูลในระบบ");
      }
    }

    // ── debt.query → บันทึกสถานะหนี้ ──
    if (result.tool === "debt.query" && result.data) {
      const debts = Array.isArray(result.data) ? result.data : [result.data];
      for (const d of debts) {
        if (d.outstanding_amount > 0 || d.principal_amount > 0) {
          transitions.push({
            entity_id: d.id ?? "",
            field: "debt_status",
            from: "unknown",
            to: d.invoice_status ?? "OPEN",
            timestamp: now,
          });
        }
      }
      memoryUpdates.push({ action: "set", key: "last_debt_data", value: debts });
    }

    // ── create operations → บันทึกว่าสร้างอะไร ──
    if (result.tool.includes(".create") && result.data) {
      transitions.push({
        entity_id: result.data.id ?? "",
        field: "document_status",
        from: "none",
        to: "created",
        timestamp: now,
      });
      memoryUpdates.push({
        action: "add",
        key: "pending_actions",
        value: `ส่ง LINE ${worldState.context.who ?? ""}`,
      });
      lessons.push(`สร้างสำเร็จ: ${result.tool}`);
    }

    // ── เก็บ result ล่าสุด ──
    memoryUpdates.push({
      action: "set",
      key: `last_${result.tool.replace(".", "_")}`,
      value: result.data,
    });
  }

  // ── บันทึก goal ที่เสร็จ ──
  memoryUpdates.push({ action: "add", key: "previous_goals", value: decision });
  memoryUpdates.push({ action: "set", key: "current_goal", value: decision });

  return {
    success: allSuccess,
    summary: allSuccess
      ? `${decision} — สำเร็จ (${results.length} steps)`
      : `${decision} — บางขั้นตอนล้มเหลว`,
    resolved_entities: resolvedEntities,
    state_transitions: transitions,
    lessons,
    memory_updates: memoryUpdates,
  };
}
