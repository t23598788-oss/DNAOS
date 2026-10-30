/**
 * M019 — Capability Unit Verification (26 business capabilities)
 *
 * Executes the REAL exported functions from the REAL owner modules and
 * reports PASS/FAIL per capability with the individual cases. No mocks of the
 * functions under test, no assertion weakening, no engine changes.
 *
 * Run: npx tsx scripts/m019-unit-verify.ts
 * Output: human lines + one machine-readable JSON line prefixed M019_UNIT_JSON
 */
import { selectVehicle, effectiveCapacity } from "@/engines/vehicle-selector";
import {
  splitMaterialText,
  resolveMaterial,
  resolveMaterialText,
} from "@/engines/material-resolver";
import { calcCompoundInterest, calcDaysOverdue } from "@/engines/debt/interest";
import { calcDebtSummary } from "@/engines/debt/calculator";
import { checkOverdue } from "@/engines/debt/overdue";
import {
  canAccrueInterest,
  canChargeCollectionFee,
  isTerminal,
  nextStatus,
} from "@/engines/debt/status";
import { calcCollectionFee } from "@/engines/debt/collection";
import { applyTransition, buildTransitionChain } from "@/engines/debt/transition";
import {
  getAvailableActions,
  resolveTransition,
} from "@/engines/transactions/state-machine";
import {
  getWorkflow,
  getStepIndex,
  getNextStep,
  isFinalEvent,
  isPendingEvent,
} from "@/engines/transactions/workflows";
import {
  calculateDocumentTotals,
  createEmptyDocumentDraft,
  formatMoney,
  roundMoney,
} from "@/engines/documents/document-editor";

type Case = { name: string; fn: () => void };
type CapResult = { id: string; cases: number; failures: string[]; status: "PASS" | "FAIL" };

class AssertionError extends Error {}

function eq(actual: unknown, expected: unknown, label = "") {
  if (actual !== expected) {
    throw new AssertionError(`${label} expected ${String(expected)} got ${String(actual)}`);
  }
}
function near(actual: number, expected: number, tol = 0.005, label = "") {
  if (Math.abs(actual - expected) > tol) {
    throw new AssertionError(`${label} expected ~${expected} got ${actual}`);
  }
}
function truthy(v: unknown, label = "") {
  if (!v) throw new AssertionError(`${label} expected truthy got ${String(v)}`);
}
function falsy(v: unknown, label = "") {
  if (v) throw new AssertionError(`${label} expected falsy got ${String(v)}`);
}

const results: CapResult[] = [];

function capability(id: string, cases: Case[]) {
  const failures: string[] = [];
  for (const c of cases) {
    try {
      c.fn();
      console.log(`  ok   ${id} :: ${c.name}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      failures.push(`${c.name}: ${msg}`);
      console.log(`  FAIL ${id} :: ${c.name} — ${msg}`);
    }
  }
  const status: "PASS" | "FAIL" = failures.length === 0 ? "PASS" : "FAIL";
  results.push({ id, cases: cases.length, failures, status });
}

const MATERIALS = [
  { id: "m1", name: "ทรายละเอียด" },
  { id: "m2", name: "ทรายหยาบ" },
  { id: "m3", name: "หินคลุก" },
  { id: "m4", name: "ลูกรัง" },
];

// ── vehicle-selector ────────────────────────────────────────────────────────
capability("business.vehicle-selector.selectVehicle", [
  { name: "positive: 20km -> รถหกล้อ", fn: () => eq(selectVehicle({ distance_km: 20 }).recommended_type, "รถหกล้อ") },
  { name: "boundary: 30km -> รถหกล้อ", fn: () => eq(selectVehicle({ distance_km: 30 }).recommended_type, "รถหกล้อ") },
  { name: "boundary: 30.1km -> รถสิบล้อ", fn: () => eq(selectVehicle({ distance_km: 30.1 }).recommended_type, "รถสิบล้อ") },
  { name: "boundary: 100km -> รถสิบล้อ", fn: () => eq(selectVehicle({ distance_km: 100 }).recommended_type, "รถสิบล้อ") },
  { name: "boundary: 100.1km -> รถพ่วง", fn: () => eq(selectVehicle({ distance_km: 100.1 }).recommended_type, "รถพ่วง") },
  { name: "negative: -5km stays deterministic (รถหกล้อ)", fn: () => eq(selectVehicle({ distance_km: -5 }).recommended_type, "รถหกล้อ") },
  { name: "contract: spec/audit returned", fn: () => truthy(selectVehicle({ distance_km: 50 }).spec.label && selectVehicle({ distance_km: 50 }).audit) },
]);

capability("business.vehicle-selector.effectiveCapacity", [
  { name: "positive: 5m3/6t @1.5 -> 4", fn: () => eq(effectiveCapacity({ label: "x", max_volume_m3: 5, max_weight_ton: 6, consumption_km_per_l: 6 }, 1.5), 4) },
  { name: "boundary: weight-limited exactly -> floor", fn: () => eq(effectiveCapacity({ label: "x", max_volume_m3: 10, max_weight_ton: 15, consumption_km_per_l: 4.5 }, 3), 5) },
  { name: "boundary: density 1 -> volume cap", fn: () => eq(effectiveCapacity({ label: "x", max_volume_m3: 22, max_weight_ton: 30, consumption_km_per_l: 3.5 }, 1), 22) },
  { name: "negative: huge density -> 0 trips capacity", fn: () => eq(effectiveCapacity({ label: "x", max_volume_m3: 5, max_weight_ton: 6, consumption_km_per_l: 6 }, 100), 0) },
]);

// ── material-resolver ───────────────────────────────────────────────────────
capability("business.material-resolver.resolveMaterial", [
  { name: "positive: exact name", fn: () => eq(resolveMaterial("หินคลุก", MATERIALS).matched?.id, "m3") },
  { name: "positive: unique substring", fn: () => eq(resolveMaterial("ลูกรัง", MATERIALS).matched?.id, "m4") },
  { name: "negative: ambiguous ทราย -> no guess", fn: () => { const r = resolveMaterial("ทราย", MATERIALS); eq(r.matched, null); eq(r.candidates.length, 2); } },
  { name: "negative: unknown -> no match", fn: () => { const r = resolveMaterial("ปูนซีเมนต์", MATERIALS); eq(r.matched, null); eq(r.candidates.length, 0); } },
  { name: "boundary: empty input -> no match", fn: () => { const r = resolveMaterial("", MATERIALS); eq(r.matched, null); } },
]);

capability("business.material-resolver.resolveMaterialText", [
  { name: "positive: two materials", fn: () => eq(resolveMaterialText("หินคลุก, ลูกรัง", MATERIALS).filter((m) => m.matched).length, 2) },
  { name: "negative: ambiguous kept unresolved", fn: () => eq(resolveMaterialText("ทราย", MATERIALS)[0].matched, null) },
  { name: "boundary: empty -> 0", fn: () => eq(resolveMaterialText("", MATERIALS).length, 0) },
  {
    name: "regression M020: 'ทราย และ หินคลุก' resolves to 2 entries (Thai connector)",
    fn: () => {
      const r = resolveMaterialText("ทราย และ หินคลุก", MATERIALS);
      eq(r.length, 2, "entry count");
      eq(r[0].matched, null, "ทราย ambiguous -> no guess");
      eq(r[1].matched?.id, "m3", "หินคลุก matched");
    },
  },
]);

capability("business.material-resolver.splitMaterialText", [
  { name: "positive: comma", fn: () => eq(splitMaterialText("ก,ข").length, 2) },
  { name: "positive: และ/กับ separators", fn: () => eq(splitMaterialText("ก และ ข กับ ค").length, 3) },
  { name: "negative: whitespace only -> 0", fn: () => eq(splitMaterialText("   ").length, 0) },
  { name: "negative: no separator stays one material", fn: () => eq(splitMaterialText("หินคลุก").length, 1) },
  { name: "boundary: trailing separator", fn: () => eq(splitMaterialText("ก,").length, 1) },
  {
    name: "regression M019->M020: 'ทราย และ หิน' splits into 2 (Thai connector)",
    fn: () => eq(JSON.stringify(splitMaterialText("ทราย และ หิน")), JSON.stringify(["ทราย", "หิน"])),
  },
  {
    name: "regression M019->M020: 'ทราย กับ หิน' splits into 2 (Thai connector)",
    fn: () => eq(JSON.stringify(splitMaterialText("ทราย กับ หิน")), JSON.stringify(["ทราย", "หิน"])),
  },
  { name: "positive: no-space 'ทรายและหิน' -> 2", fn: () => eq(splitMaterialText("ทรายและหิน").length, 2) },
  {
    name: "positive: mixed separators , 、 และ กับ -> 4",
    fn: () => eq(splitMaterialText("ทราย, หิน และ ลูกรัง กับ ดินถม").length, 4),
  },
  { name: "boundary: leading/trailing connectors -> 1 real token", fn: () => eq(splitMaterialText("และ ทราย และ").length, 1) },
]);

// ── debt: interest / calculator / overdue ───────────────────────────────────
capability("business.interest.calcCompoundInterest", [
  { name: "positive: 1000+100 @0.0005 10d", fn: () => { const r = calcCompoundInterest({ principal: 1000, fee: 100, dailyRate: 0.0005, daysOverdue: 10 }); eq(r.base, 1100); near(r.currentValue, 1105.51, 0.01); } },
  { name: "boundary: 0 days -> interest 0", fn: () => eq(calcCompoundInterest({ principal: 1000, fee: 0, dailyRate: 0.001, daysOverdue: 0 }).interestAccrued, 0) },
  { name: "negative: negative days -> finite result", fn: () => truthy(Number.isFinite(calcCompoundInterest({ principal: 1000, fee: 0, dailyRate: 0.001, daysOverdue: -1 }).currentValue)) },
  { name: "contract: formula present", fn: () => truthy(calcCompoundInterest({ principal: 1, fee: 0, dailyRate: 0, daysOverdue: 1 }).formula) },
]);

capability("business.interest.calcDaysOverdue", [
  { name: "positive: 10 days past", fn: () => eq(calcDaysOverdue(new Date("2026-10-01"), new Date("2026-10-11")), 10) },
  { name: "negative: future due -> 0", fn: () => eq(calcDaysOverdue(new Date("2026-11-01"), new Date("2026-10-01")), 0) },
  { name: "boundary: same instant -> 0", fn: () => eq(calcDaysOverdue(new Date("2026-10-01T00:00:00Z"), new Date("2026-10-01T00:00:00Z")), 0) },
  { name: "boundary: 23h59m -> 0 days", fn: () => eq(calcDaysOverdue(new Date("2026-10-01T00:00:00Z"), new Date("2026-10-01T23:59:00Z")), 0) },
]);

capability("business.calculator.calcDebtSummary", [
  { name: "positive: DEBT accrues interest", fn: () => { const r = calcDebtSummary({ principal: 1000, feeRate: 10, interestRate: 7.3, collectionFeeRate: 0, collectionFeeLimit: 0, dueDate: "2026-09-01", status: "DEBT", paidAmount: 0, asOfDate: "2026-10-01" }); truthy(r.interestAccrued > 0); eq(r.base, 1100); } },
  { name: "negative: CLOSED no interest/fee", fn: () => { const r = calcDebtSummary({ principal: 1000, feeRate: 10, interestRate: 7.3, collectionFeeRate: 5, collectionFeeLimit: 500, dueDate: "2026-01-01", status: "CLOSED", paidAmount: 0, asOfDate: "2026-10-01" }); eq(r.interestAccrued, 0); eq(r.collectionFee, 0); } },
  { name: "boundary: fully paid -> netRemaining 0", fn: () => eq(calcDebtSummary({ principal: 1000, feeRate: 0, interestRate: 0, collectionFeeRate: 0, collectionFeeLimit: 0, dueDate: "2026-10-01", status: "WAIT_PAYMENT", paidAmount: 5000, asOfDate: "2026-10-01" }).netRemaining, 0) },
  { name: "boundary: not yet due -> days 0", fn: () => eq(calcDebtSummary({ principal: 1000, feeRate: 0, interestRate: 7, collectionFeeRate: 0, collectionFeeLimit: 0, dueDate: "2026-12-01", status: "DEBT", paidAmount: 0, asOfDate: "2026-10-01" }).daysOverdue, 0) },
]);

capability("business.overdue.checkOverdue", [
  { name: "positive: 1h past grace -> overdue", fn: () => { const r = checkOverdue(new Date("2026-10-01T00:00:00Z"), 24, new Date("2026-10-02T01:00:00Z")); truthy(r.isOverdue); eq(r.hoursOverdue, 1); } },
  { name: "boundary: exactly at grace expiry -> not overdue", fn: () => falsy(checkOverdue(new Date("2026-10-01T00:00:00Z"), 24, new Date("2026-10-02T00:00:00Z")).isOverdue) },
  { name: "negative: before due -> not overdue", fn: () => falsy(checkOverdue(new Date("2026-10-10T00:00:00Z"), 24, new Date("2026-10-01T00:00:00Z")).isOverdue) },
]);

// ── debt: status / collection / transition ──────────────────────────────────
capability("business.status.canAccrueInterest", [
  { name: "positive: DEBT", fn: () => truthy(canAccrueInterest("DEBT")) },
  { name: "positive: COLLECTION/PARTIAL_PAYMENT", fn: () => truthy(canAccrueInterest("COLLECTION") && canAccrueInterest("PARTIAL_PAYMENT")) },
  { name: "negative: ACTIVE_CREDIT/WAIT_PAYMENT/OVERDUE/CLOSED", fn: () => falsy(canAccrueInterest("ACTIVE_CREDIT") || canAccrueInterest("WAIT_PAYMENT") || canAccrueInterest("OVERDUE") || canAccrueInterest("CLOSED")) },
]);

capability("business.status.canChargeCollectionFee", [
  { name: "positive: COLLECTION only", fn: () => truthy(canChargeCollectionFee("COLLECTION")) },
  { name: "negative: all other statuses", fn: () => falsy(canChargeCollectionFee("DEBT") || canChargeCollectionFee("OVERDUE") || canChargeCollectionFee("CLOSED")) },
]);

capability("business.status.isTerminal", [
  { name: "positive: CLOSED", fn: () => truthy(isTerminal("CLOSED")) },
  { name: "negative: active statuses", fn: () => falsy(isTerminal("DEBT") || isTerminal("COLLECTION")) },
]);

capability("business.status.nextStatus", [
  { name: "positive: full_payment -> CLOSED", fn: () => eq(nextStatus("full_payment"), "CLOSED") },
  { name: "positive: grace_period_expired -> OVERDUE", fn: () => eq(nextStatus("grace_period_expired"), "OVERDUE") },
  { name: "negative: unknown event -> null", fn: () => eq(nextStatus("teleport"), null) },
  { name: "boundary: empty event -> null", fn: () => eq(nextStatus(""), null) },
]);

capability("business.collection.calcCollectionFee", [
  { name: "positive: under legal limit", fn: () => { const r = calcCollectionFee({ outstanding: 1000, feeRate: 5, legalLimit: 500 }); eq(r.appliedFee, 50); falsy(r.cappedByLaw); } },
  { name: "boundary: equal to limit -> not capped", fn: () => { const r = calcCollectionFee({ outstanding: 1000, feeRate: 5, legalLimit: 50 }); eq(r.appliedFee, 50); falsy(r.cappedByLaw); } },
  { name: "negative: over limit -> capped", fn: () => { const r = calcCollectionFee({ outstanding: 1000, feeRate: 50, legalLimit: 100 }); eq(r.appliedFee, 100); truthy(r.cappedByLaw); } },
]);

capability("business.transition.applyTransition", [
  { name: "positive: DEBT + full_payment -> CLOSED", fn: () => { const r = applyTransition("DEBT", { debtId: "d", event: "full_payment", actor: "human", timestamp: 1 }); truthy(r.ok); eq(r.to, "CLOSED"); } },
  { name: "negative: CLOSED is terminal -> refused", fn: () => { const r = applyTransition("CLOSED", { debtId: "d", event: "partial_payment", actor: "human", timestamp: 1 }); falsy(r.ok); truthy(r.error); } },
  { name: "negative: unknown event -> refused", fn: () => falsy(applyTransition("DEBT", { debtId: "d", event: "nope", actor: "system", timestamp: 1 }).ok) },
]);

capability("business.transition.buildTransitionChain", [
  { name: "positive: chain advances status", fn: () => { const r = buildTransitionChain([{ debtId: "d", event: "customer_received", actor: "system", timestamp: 1 }, { debtId: "d", event: "due_date_reached", actor: "system", timestamp: 2 }, { debtId: "d", event: "grace_period_expired", actor: "system", timestamp: 3 }]); eq(r.finalStatus, "OVERDUE"); eq(r.transitions.length, 3); } },
  { name: "negative: invalid event does not advance", fn: () => { const r = buildTransitionChain([{ debtId: "d", event: "invalid", actor: "system", timestamp: 1 }]); eq(r.finalStatus, "ACTIVE_CREDIT"); falsy(r.transitions[0].ok); } },
  { name: "boundary: empty chain stays ACTIVE_CREDIT", fn: () => { const r = buildTransitionChain([]); eq(r.finalStatus, "ACTIVE_CREDIT"); eq(r.transitions.length, 0); } },
]);

// ── transactions: state machine / workflows ─────────────────────────────────
capability("business.state-machine.getAvailableActions", [
  { name: "positive: sale DRAFT -> 1 action", fn: () => { const a = getAvailableActions("sale", "DRAFT"); eq(a.length, 1); eq(a[0].action, "submit"); } },
  { name: "boundary: sale PAID (final) -> 0 actions", fn: () => eq(getAvailableActions("sale", "PAID").length, 0) },
  { name: "negative: unknown event -> 0 actions", fn: () => eq(getAvailableActions("sale", "NOPE").length, 0) },
]);

capability("business.state-machine.resolveTransition", [
  { name: "positive: correct action resolves", fn: () => { const r = resolveTransition("sale", "DRAFT", "submit"); eq(r?.to, "SUBMITTED"); } },
  { name: "negative: wrong action refused", fn: () => eq(resolveTransition("sale", "DRAFT", "deliver"), undefined) },
  { name: "boundary: final state -> undefined", fn: () => eq(resolveTransition("sale", "PAID", "pay"), undefined) },
]);

capability("business.workflows.getWorkflow", [
  { name: "positive: sale has 11 steps", fn: () => eq(getWorkflow("sale").steps.length, 11) },
  { name: "positive: purchase resolves by type", fn: () => eq(getWorkflow("purchase").type, "purchase") },
  { name: "boundary: unknown type falls back to sale", fn: () => eq(getWorkflow("unknown").type, "sale") },
]);

capability("business.workflows.getStepIndex", [
  { name: "positive: CONFIRMED index 4", fn: () => eq(getStepIndex(getWorkflow("sale"), "CONFIRMED"), 4) },
  { name: "negative: unknown -> -1", fn: () => eq(getStepIndex(getWorkflow("sale"), "NOPE"), -1) },
  { name: "boundary: first step index 0", fn: () => eq(getStepIndex(getWorkflow("sale"), "DRAFT"), 0) },
]);

capability("business.workflows.getNextStep", [
  { name: "positive: DRAFT -> SUBMITTED", fn: () => eq(getNextStep(getWorkflow("sale"), "DRAFT")?.event, "SUBMITTED") },
  { name: "boundary: last step -> undefined", fn: () => eq(getNextStep(getWorkflow("sale"), "PAID"), undefined) },
  { name: "negative: unknown event -> undefined", fn: () => eq(getNextStep(getWorkflow("sale"), "NOPE"), undefined) },
]);

capability("business.workflows.isFinalEvent", [
  { name: "positive: PAID final for sale", fn: () => truthy(isFinalEvent(getWorkflow("sale"), "PAID")) },
  { name: "negative: DRAFT not final", fn: () => falsy(isFinalEvent(getWorkflow("sale"), "DRAFT")) },
  { name: "boundary: unknown event not final", fn: () => falsy(isFinalEvent(getWorkflow("sale"), "NOPE")) },
]);

capability("business.workflows.isPendingEvent", [
  { name: "positive: DRAFT pending", fn: () => truthy(isPendingEvent(getWorkflow("sale"), "DRAFT")) },
  { name: "negative: PAID not pending", fn: () => falsy(isPendingEvent(getWorkflow("sale"), "PAID")) },
  { name: "boundary: unknown event counted pending (contract)", fn: () => truthy(isPendingEvent(getWorkflow("sale"), "NOPE")) },
]);

// ── documents: money math ───────────────────────────────────────────────────
function draftWith(rows: { qty: number; unitPrice: number }[], over: Partial<ReturnType<typeof createEmptyDocumentDraft>> = {}) {
  const d = createEmptyDocumentDraft("invoice");
  return { ...d, rows: rows.map((r, i) => ({ description: `row${i}`, qty: r.qty, unit: "Unit", unitPrice: r.unitPrice })), ...over };
}

capability("business.document-editor.calculateDocumentTotals", [
  { name: "positive: 2x100 -> 214 gross", fn: () => { const t = calculateDocumentTotals(draftWith([{ qty: 2, unitPrice: 100 }])); eq(t.subtotal, 200); near(t.vatAmount, 14); eq(t.grossAmount, 214); } },
  { name: "positive: discount applied before VAT", fn: () => { const t = calculateDocumentTotals(draftWith([{ qty: 2, unitPrice: 100 }], { discountAmount: 20 })); eq(t.baseAmount, 180); near(t.vatAmount, 12.6); } },
  { name: "negative: vat disabled -> 0 VAT", fn: () => eq(calculateDocumentTotals(draftWith([{ qty: 1, unitPrice: 100 }], { vatEnabled: false })).vatAmount, 0) },
  { name: "positive: WHT deducted from net", fn: () => { const t = calculateDocumentTotals(draftWith([{ qty: 1, unitPrice: 1000 }], { withholdingTaxPercent: 3 })); near(t.withholdingAmount, 30); near(t.netAmount, 1040); } },
  { name: "boundary: zero rows -> all zero", fn: () => { const t = calculateDocumentTotals(draftWith([])); eq(t.subtotal, 0); eq(t.grossAmount, 0); } },
]);

capability("business.document-editor.formatMoney", [
  { name: "positive: 1234.5 -> 2dp grouped", fn: () => truthy(formatMoney(1234.5).includes("1,234.50"), "formatMoney(1234.5)") },
  { name: "boundary: 0 -> 0.00", fn: () => eq(formatMoney(0), "0.00") },
  { name: "negative: non-finite does not throw", fn: () => truthy(typeof formatMoney(Number.NaN) === "string") },
]);

capability("business.document-editor.roundMoney", [
  { name: "positive: 0.1+0.2 -> 0.3", fn: () => eq(roundMoney(0.1 + 0.2), 0.3) },
  { name: "boundary: 1.005 documented float behaviour", fn: () => eq(roundMoney(1.005), 1) },
  { name: "negative: -1.234 -> -1.23", fn: () => eq(roundMoney(-1.234), -1.23) },
]);

// ── summary ─────────────────────────────────────────────────────────────────
const passed = results.filter((r) => r.status === "PASS").length;
const failed = results.filter((r) => r.status === "FAIL").length;
console.log(`\nM019 UNIT SUMMARY: caps=${results.length} pass=${passed} fail=${failed} cases=${results.reduce((a, r) => a + r.cases, 0)}`);
console.log("M019_UNIT_JSON " + JSON.stringify({ total: results.length, passed, failed, results }));
process.exit(failed === 0 ? 0 : 1);
