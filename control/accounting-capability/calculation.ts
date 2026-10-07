/**
 * หน้าที่: ชั้นคำนวณเอกสารจุดเดียว — subtotal / discount / tax_base / VAT / total / WHT
 *
 * Owner, 2026-09-05 Phase 4: "อย่าเอา subtotal / discount / VAT calculation
 * เข้าไปปนกับ ledger" และ "ห้าม kernel คำนวณ VAT ใหม่ kernel รับค่าที่
 * calculation layer ยืนยันแล้ว"
 *
 * สูตรยกมาจาก engines/tax.ts (deadboard) ซึ่งเป็น candidate canonical ที่พิสูจน์แล้วว่า
 * เป็นตัวเดียวที่อ่านอัตราจาก config ไม่ฝังเลข:
 *   inclusive: base = amount / (1 + rate/100) ; vat = amount - base
 *   exclusive: vat  = base * (rate/100)       ; gross = base + vat
 *   wht = base * (whtPercent/100) ; net = gross - wht
 * เพิ่มเฉพาะ discount ซึ่ง engines/tax.ts ไม่มี และ Phase 4 บังคับให้มี
 * เมื่อ discount = 0 ผลลัพธ์ต้องเท่ากับ engines/tax.ts ทุกตัว (พิสูจน์ใน tests)
 *
 * ห้ามฝังอัตรา VAT เป็นเลขในไฟล์นี้ ต้องรับเข้ามาเสมอ — จุดนี้คือสิ่งที่
 * engines/pricing.ts:45 (* 0.07) ทำผิดและเป็นเหตุให้มีสูตรซ้ำ
 *
 * Dependency ที่อนุญาต: ./types.ts
 * สิ่งที่ห้ามแตะ:
 * - ห้ามให้ไฟล์นี้รู้จัก kernel หรือฐานข้อมูลใด ๆ
 * - ห้ามเปลี่ยนลำดับ ส่วนลดหักก่อนคิดฐานภาษีเสมอ
 */

import type { DocumentAmounts } from "./types";

const round2 = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100;

export interface CalculationRequest {
  readonly subtotal: number;
  readonly discount?: number;
  readonly vat_rate: number;
  readonly vat_enabled?: boolean;
  /** inclusive = subtotal รวม VAT แล้ว (ค่าเริ่มต้นเดียวกับ engines/tax.ts) */
  readonly vat_mode?: "inclusive" | "exclusive";
  readonly withholding_rate?: number;
}

export type CalculationOutcome =
  | { readonly ok: true; readonly amounts: DocumentAmounts }
  | { readonly ok: false; readonly reason_code: string; readonly reason: string };

export function calculateDocument(req: CalculationRequest): CalculationOutcome {
  const discount = req.discount ?? 0;
  if (!Number.isFinite(req.subtotal) || req.subtotal < 0) {
    return { ok: false, reason_code: "INVALID_SUBTOTAL", reason: "ยอดก่อนหักต้องเป็นตัวเลขที่ไม่ติดลบ" };
  }
  if (discount < 0 || discount > req.subtotal) {
    return { ok: false, reason_code: "INVALID_DISCOUNT", reason: "ส่วนลดต้องอยู่ระหว่างศูนย์ถึงยอดก่อนหัก" };
  }
  if (!Number.isFinite(req.vat_rate) || req.vat_rate < 0) {
    return { ok: false, reason_code: "INVALID_VAT_RATE", reason: "อัตราภาษีต้องเป็นตัวเลขที่ไม่ติดลบ" };
  }

  const vatEnabled = req.vat_enabled ?? true;
  const mode = req.vat_mode ?? "inclusive";
  const whtRate = req.withholding_rate ?? 0;
  const afterDiscount = round2(req.subtotal - discount);

  let taxBase: number;
  let vat: number;
  let gross: number;

  if (!vatEnabled || req.vat_rate === 0) {
    taxBase = afterDiscount; vat = 0; gross = afterDiscount;
  } else if (mode === "inclusive") {
    gross = afterDiscount;
    taxBase = afterDiscount / (1 + req.vat_rate / 100);
    vat = gross - taxBase;
  } else {
    taxBase = afterDiscount;
    vat = taxBase * (req.vat_rate / 100);
    gross = taxBase + vat;
  }

  const wht = taxBase * (whtRate / 100);

  return {
    ok: true,
    amounts: {
      subtotal: round2(req.subtotal),
      discount: round2(discount),
      tax_base: round2(taxBase),
      vat_rate: req.vat_rate,
      vat_amount: round2(vat),
      total_amount: round2(gross),
      withholding_rate: whtRate,
      withholding_amount: round2(wht),
    },
  };
}

/**
 * ประตูที่ kernel ใช้ก่อนรับยอด — ยอดที่ประกอบกันเองไม่ได้ ห้ามเข้าบัญชี
 * ตรงนี้คือเหตุผลที่ kernel ไม่ต้องคำนวณ VAT เอง
 */
export function amountsAreConsistent(a: DocumentAmounts): boolean {
  // ฐานภาษี + ภาษี = ยอดรวม เป็นจริงทั้งสองโหมดเสมอ
  if (Math.abs(a.tax_base + a.vat_amount - a.total_amount) >= 0.01) return false;
  // ยอดหลังหักส่วนลดต้องไปลงที่ยอดรวม (inclusive) หรือฐานภาษี (exclusive) อย่างใดอย่างหนึ่ง
  const afterDiscount = a.subtotal - a.discount;
  return Math.abs(afterDiscount - a.total_amount) < 0.01
    || Math.abs(afterDiscount - a.tax_base) < 0.01;
}
