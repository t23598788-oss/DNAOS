/**
 * DNA OS Business Engine
 *
 * เชื่อม Runtime Engine + Registry + v3-engines + v2-rules
 * Register commands เข้า Runtime ให้เรียกผ่าน executeCommand ได้
 *
 * Complete Criteria:
 * 1. โหลด Business Rules ได้
 * 2. คำนวณ Business Logic ได้
 * 3. อ่าน/เขียน DB ได้ตามที่ออกแบบ
 * 4. คืนผลลัพธ์ถูกต้อง
 * 5. Build + Type Check ผ่าน
 * 6. Integration ผ่าน
 * 7. ไม่มี Regression
 */

import { registerCommand, dispatchEvent } from "@/lib/runtime/engine";
import { loadConfigs, getNum, type RulesConfig } from "./config-loader";

// ── 1. โหลด Business Rules ──

export async function loadBusinessRules(): Promise<{ ok: boolean; rules: RulesConfig; count: number }> {
  const rules = await loadConfigs();
  return { ok: true, rules, count: Object.keys(rules).length };
}

// ── 2. คำนวณ Business Logic ──

export async function calculatePrice(args: {
  distance_km: number;
  quantity: number;
  material_price: number;
}): Promise<Record<string, unknown>> {
  const rules = await loadConfigs();
  const fuelPrice = getNum(rules, "fuel-price", 43);
  const driverWage = getNum(rules, "driver-wage-per-trip", 450);
  const markup = getNum(rules, "pricing-markup-percent", 25);
  const capacity = getNum(rules, "vehicle-default-capacity", 10);

  const trips = Math.ceil(args.quantity / capacity);
  const fuelCost = args.distance_km * fuelPrice * trips;
  const materialCost = args.quantity * args.material_price;
  const driverCost = driverWage * trips;
  const totalCost = materialCost + fuelCost + driverCost;
  const markupAmount = totalCost * (markup / 100);
  const sellingPrice = totalCost + markupAmount;

  return {
    trips, capacity, fuelCost: round(fuelCost), materialCost: round(materialCost),
    driverCost: round(driverCost), totalCost: round(totalCost),
    markup: round(markupAmount), sellingPrice: round(sellingPrice),
  };
}

export async function calculateDebt(args: {
  principal: number;
  fee_rate: number;
  interest_rate: number;
  due_date: string;
  paid_amount?: number;
}): Promise<Record<string, unknown>> {
  const rules = await loadConfigs();
  const gracePeriod = getNum(rules, "debt-grace-period-hours", 24);
  const rate = args.interest_rate / 100;
  const dailyRate = rate / 365;

  const due = new Date(args.due_date);
  const now = new Date();
  const daysOverdue = Math.max(0, Math.floor((now.getTime() - due.getTime()) / 86_400_000));
  const isOverdue = daysOverdue > 0;

  const fee = round(args.principal * (args.fee_rate / 100));
  const base = args.principal + fee;
  const paid = args.paid_amount ?? 0;
  const remaining = Math.max(0, args.principal - paid);

  let interest = 0;
  if (isOverdue && remaining > 0) {
    const current = (remaining + fee) * Math.pow(1 + dailyRate, daysOverdue);
    interest = round(current - (remaining + fee));
  }

  const total = round(remaining + fee + interest);

  return {
    principal: args.principal, fee, base: round(base),
    daysOverdue, isOverdue, gracePeriod,
    interest: round(interest), dailyRate,
    paid, remaining: round(remaining),
    total,
  };
}

export async function calculateTax(args: {
  amount: number;
  vat_rate?: number;
  withholding_rate?: number;
}): Promise<Record<string, unknown>> {
  const vatRate = args.vat_rate ?? 0.07;
  const vat = round(args.amount * vatRate);
  const withholding = args.withholding_rate ? round(args.amount * args.withholding_rate) : 0;
  const net = round(args.amount + vat - withholding);

  return { amount: args.amount, vatRate, vat, withholding, net };
}

// ── 3. Register commands เข้า Runtime ──

export function registerBusinessCommands(): void {
  registerCommand("business.load_rules", async () => loadBusinessRules());

  registerCommand("business.calculate_price", async (args) =>
    calculatePrice({
      distance_km: Number(args.distance_km ?? 0),
      quantity: Number(args.quantity ?? 0),
      material_price: Number(args.material_price ?? 0),
    })
  );

  registerCommand("business.calculate_debt", async (args) =>
    calculateDebt({
      principal: Number(args.principal ?? 0),
      fee_rate: Number(args.fee_rate ?? 5),
      interest_rate: Number(args.interest_rate ?? 25),
      due_date: String(args.due_date ?? ""),
      paid_amount: args.paid_amount ? Number(args.paid_amount) : undefined,
    })
  );

  registerCommand("business.calculate_tax", async (args) =>
    calculateTax({
      amount: Number(args.amount ?? 0),
      vat_rate: args.vat_rate ? Number(args.vat_rate) : undefined,
      withholding_rate: args.withholding_rate ? Number(args.withholding_rate) : undefined,
    })
  );
}

function round(n: number): number { return Math.round(n * 100) / 100; }
