/**
 * Canonical material-stock write model (WORKSTREAM 1, owner directive 2026-10-15).
 *
 * THE one and only path that changes material stock numbers. เขียนผ่านทางเดียว:
 *   · ยอดสรุป  → pit_materials.{stock_quantity, reserved_quantity, stock_unit,
 *             stock_updated_at} (คอลัมน์ที่เพิ่มโดย 20261016000001)
 *   · ประวัติ  → resource_transactions แถว resource_type='stock_movement'
 *             (ตารางเดิม generic — idempotency source_event_id unique ของเดิม)
 *   · audit    → recordCanonicalAudit เดิม
 *
 * Fail-closed ตามสถาปัตยกรรม canonical เดิม:
 *   · แถววัสดุ/บ่อต้องมีจริง · quantity > 0 · direction ปิดชุด
 *   · หน่วยมีหลักฐานเท่านั้น: หน่วยเดียวกับ stock_unit เดิมเข้าได้ตรง ๆ ·
 *     การแปลงหน่วยทำได้เฉพาะรายที่ระบบมีหลักฐานจริง = density_ton_per_cbm
 *     (material_types เดิม — คิว↔ตัน) — หน่วยอื่นไม่มีหลักฐาน = STOCK_UNIT_NO_EVIDENCE
 *   · ผลลัพธ์ยอดห้ามติดลบทั้ง stock และ reserved · reserve ห้ามเกิน stock
 *   · ห้าม caller ส่งยอดสัมบูรณ์มาเขียนตรง — ต้องเป็น movement เสมอ
 */
import { supabaseAdmin } from "@/services/supabase/queries";
import { recordCanonicalAudit } from "@/engines/canonical/audit";

export type StockDirection = "in" | "out" | "reserve" | "release";

export interface StockMovementInput {
  pit_profile_id: string;
  material_type_id: string;
  direction: StockDirection;
  quantity: number;
  /** หน่วยของ movement (หลักฐานจากการเคลื่อนไหวจริง เช่น คิว/ตัน) */
  unit: string;
  /** idempotency key เดิมของ canonical architecture — source event เดียว = แถวเดียว */
  source_event_id: string;
  actor: string;
}

export interface StockWriteResult {
  ok: boolean;
  error?: string;
  duplicate?: boolean;
  stock?: {
    stock_quantity: number; reserved_quantity: number;
    available_quantity: number; stock_unit: string | null; stock_updated_at: string;
  };
}

type MovementRow = { id: string; created_at: string };

export async function writeStockMovement(input: StockMovementInput): Promise<StockWriteResult> {
  const qty = Number(input.quantity);
  if (!Number.isFinite(qty) || qty <= 0) return { ok: false, error: "STOCK_QUANTITY_INVALID" };
  const directions: StockDirection[] = ["in", "out", "reserve", "release"];
  if (!directions.includes(input.direction)) return { ok: false, error: `STOCK_DIRECTION_UNKNOWN:${input.direction}` };
  if (!input.source_event_id?.trim() || !input.actor?.trim()) return { ok: false, error: "STOCK_IDEMPOTENCY_OR_ACTOR_REQUIRED" };
  const unit = String(input.unit ?? "").trim();
  if (!unit) return { ok: false, error: "STOCK_UNIT_REQUIRED" };

  // Idempotency ระดับ DB ของเดิม: source_event_id unique — ซ้ำ = คืนแถวปัจจุบัน
  const existing = await supabaseAdmin()
    .from("resource_transactions")
    .select("id, created_at, meta")
    .eq("source_event_id", input.source_event_id)
    .limit(1);
  if (!existing.error && (existing.data?.length ?? 0) > 0) {
    const row = (existing.data![0] as unknown) as MovementRow & { meta: Record<string, unknown> };
    const meta = row.meta ?? {};
    const mat = await supabaseAdmin()
      .from("pit_materials")
      .select("stock_quantity, reserved_quantity, stock_unit, stock_updated_at")
      .eq("pit_profile_id", String(meta.pit_profile_id ?? ""))
      .eq("material_type_id", String(meta.material_type_id ?? ""))
      .limit(1);
    if (!mat.error && mat.data?.length) {
      const m = mat.data[0] as { stock_quantity: number; reserved_quantity: number; stock_unit: string | null; stock_updated_at: string };
      return { ok: true, duplicate: true, stock: { ...m, available_quantity: Number(m.stock_quantity) - Number(m.reserved_quantity) } };
    }
    return { ok: true, duplicate: true };
  }

  const matQ = await supabaseAdmin()
    .from("pit_materials")
    .select("id, stock_quantity, reserved_quantity, stock_unit, material_type_id")
    .eq("pit_profile_id", input.pit_profile_id)
    .eq("material_type_id", input.material_type_id)
    .is("deleted_at", null)
    .limit(1);
  if (matQ.error) return { ok: false, error: mel(matQ.error) };
  const mat = (matQ.data?.[0] ?? null) as { id: string; stock_quantity: number | null; reserved_quantity: number | null; stock_unit: string | null; material_type_id: string } | null;
  if (!mat) return { ok: false, error: "STOCK_LISTING_NOT_FOUND — ไม่มีรายการวัสดุนี้ในทะเบียน" };

  const stock = Number(mat.stock_quantity ?? 0);
  const reserved = Number(mat.reserved_quantity ?? 0);
  let newStock = stock;
  let newReserved = reserved;
  let appliedQty = qty; // qty ตามหน่วย stock_unit (หลังแปลง)
  let conversion: string | null = null;

  try {
    const eff = await resolveUnitByEvidence(unit, mat.stock_unit, qty, input.material_type_id);
    appliedQty = eff.effectiveQty;
    conversion = eff.conversion;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  if (mat.stock_unit && unit !== mat.stock_unit && !conversion) {
    return { ok: false, error: `STOCK_UNIT_MISMATCH — ยอดเดิมหน่วย ${mat.stock_unit} (ไม่มีหลักฐานแปลงหน่วย)` };
  }
  if (!mat.stock_unit && input.direction !== "in" && input.direction !== "reserve") {
    // ยอดเริ่มต้น 0 — การจ่ายออก/คืนจองจากยอดว่างไม่มีความหมาย
    return { ok: false, error: "STOCK_EMPTY — ไม่มียอดเริ่มต้นในหน่วยนี้" };
  }

  switch (input.direction) {
    case "in": newStock = stock + appliedQty; break;
    case "out":
      if (appliedQty > stock - reserved) return { ok: false, error: "STOCK_INSUFFICIENT_AVAILABLE" };
      newStock = stock - appliedQty; break;
    case "reserve":
      if (reserved + appliedQty > stock) return { ok: false, error: "STOCK_RESERVE_EXCEEDS_STOCK" };
      newReserved = reserved + appliedQty; break;
    case "release":
      if (appliedQty > reserved) return { ok: false, error: "STOCK_RESERVE_INSUFFICIENT" };
      newReserved = reserved - appliedQty; break;
  }

  const now = new Date().toISOString();
  const upd = await supabaseAdmin()
    .from("pit_materials")
    .update({ stock_quantity: newStock, reserved_quantity: newReserved, stock_unit: mat.stock_unit ?? unit, stock_updated_at: now })
    .eq("id", mat.id);
  if (upd.error) return { ok: false, error: mel(upd.error) };

  const ins = await supabaseAdmin()
    .from("resource_transactions")
    .insert({
      resource_type: "stock_movement",
      resource_label: `สต็อกวัสดุ (${input.direction})`,
      quantity: input.quantity,
      unit: input.unit,
      source_event_id: input.source_event_id,
      meta: {
        direction: input.direction,
        pit_profile_id: input.pit_profile_id,
        material_type_id: input.material_type_id,
        pit_material_id: mat.id,
        applied_quantity_in_stock_unit: appliedQty,
        converted_from_unit: conversion ?? null,
        stock_after: newStock,
        reserved_after: newReserved,
        actor: input.actor,
      },
    });
  if (ins.error) {
    // ประวัติล้ม = ย้อนยอดกลับ (ห้ามยอดไม่มีหลักฐานประวัติ — canonical เดียวพองเอง)
    await supabaseAdmin()
      .from("pit_materials")
      .update({ stock_quantity: stock, reserved_quantity: reserved, stock_updated_at: null })
      .eq("id", mat.id);
    return { ok: false, error: mel(ins.error) };
  }

  await recordCanonicalAudit({
    resource: "pit_materials",
    resource_id: mat.id,
    action: `stock:${input.direction}`,
    actor: input.actor,
    detail: { source_event_id: input.source_event_id, quantity: input.quantity, unit: input.unit, appliedQty, conversion, stock_after: newStock, reserved_after: newReserved },
  } as unknown as Parameters<typeof recordCanonicalAudit>[0]);

  return {
    ok: true,
    stock: { stock_quantity: newStock, reserved_quantity: newReserved, available_quantity: newStock - newReserved, stock_unit: mat.stock_unit ?? unit, stock_updated_at: now },
  };
}

/** การแปลงหน่วยเฉพาะที่มีหลักฐานจริง: density_ton_per_cbm ของ material_types เดิม
 *  (หลักฐานความหนาแน่นในระบบ) — คิว↔ตัน เท่านั้น · หน่วยอื่นไม่มีหลักฐาน = throw */
async function resolveUnitByEvidence(movementUnit: string, stockUnit: string | null, qty: number, materialTypeId: string): Promise<{ effectiveQty: number; conversion: string | null }> {
  if (!stockUnit || movementUnit === stockUnit) return { effectiveQty: qty, conversion: null };
  const densityQ = await supabaseAdmin()
    .from("material_types")
    .select("density_ton_per_cbm")
    .eq("id", materialTypeId)
    .limit(1);
  const density = ((densityQ.data?.[0] ?? null) as { density_ton_per_cbm: number | null } | null)?.density_ton_per_cbm ?? null;
  const isDensityPair = (density != null && Number(density) > 0) && ((movementUnit === "ตัน" && stockUnit === "คิว") || (movementUnit === "คิว" && stockUnit === "ตัน"));
  if (isDensityPair) {
    const d = Number(density);
    // ตัน→คิว: ตัน / ความหนาแน่น (ตัน/คิว) = คิว · คิว→ตัน: คิว × ความหนาแน่น = ตัน
    const effective = movementUnit === "ตัน" ? qty / d : qty * d;
    return { effectiveQty: effective, conversion: `density_ton_per_cbm=${d}` };
  }
  throw new Error(`STOCK_UNIT_NO_EVIDENCE — ไม่มีหลักฐานแปลงหน่วย ${movementUnit} → ${stockUnit}`);
}

function mel(e: { message: string }): string { return "query error: " + e.message; }
