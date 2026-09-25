/**
 * DEBT PATCH FREEZE — negative control (Owner decision ⑤a-B, 2026-09-24).
 *
 * พิสูจน์: LEGACY_DEBT_PATCH_DIRECT_MONEY_OVERWRITE = 0
 *  1) legacy PATCH (/api/admin/debt-trackings/[id]) REJECT 422 fail-closed เมื่อ body
 *     มี monetary key (principalAmount / principal_amount / total_outstanding / overdue_amount)
 *  2) updateDebtTracking (writer) ไม่มีสาขาเขียน money columns อีกต่อไป
 *  3) DebtTrackingManager ไม่แนบ monetary key ตอน PATCH + ปฏิเสธการแก้เงินต้นแบบเห็นชัด
 *  4) ไม่มี authority/semantics ใหม่: debt-write contract คงเดิม (appendDebtEvent +
 *     refreshDebtSnapshotFromLedger · event vocabulary 9 ตัวเดิม) · B-05 ห้ามแตะ
 *  5) CREATE/DELETE ไม่ถูก redesign = DEFERRED_DEBT_MODEL_DECISION (คงรูปเดิมเป๊ะ)
 * Source-truth · PASS/FAIL · exit 1 ถ้า FAIL · ไม่แตะ DB / ไม่มี LIVE write
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    pass += 1;
    console.log(`  PASS  ${name}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const route = read("app/api/admin/debt-trackings/[id]/route.ts");
const queries = read("services/supabase/queries.ts");
const ui = read("components/documents/DebtTrackingManager.tsx");
const debtWrite = read("engines/canonical/debt-write.ts");
const gateway = read("gateway/actions.ts");

function bodyOf(src: string, fnSignature: string): string {
  const start = src.indexOf(fnSignature);
  if (start === -1) return "";
  const next = src.indexOf("export async function", start + fnSignature.length);
  return next === -1 ? src.slice(start) : src.slice(start, next);
}
const updBody = bodyOf(queries, "export async function updateDebtTracking");
const createBody = bodyOf(queries, "export async function createDebtTracking");

console.log("[1] legacy PATCH = fail-closed REJECT on monetary key");
check("R1 contract: DEBT_PATCH_MONETARY_FROZEN + HTTP 422 (REJECT ไม่ใช่ ignore)",
  route.includes("DEBT_PATCH_MONETARY_FROZEN") && route.includes("status: 422"));
check("R2 frozen key list = principalAmount + principal_amount + total_outstanding + overdue_amount",
  ["principalAmount", "principal_amount", "total_outstanding", "overdue_amount"]
    .every((k) => route.includes(`"${k}"`)));
check("R3 route no longer maps principal into the writer",
  !route.includes("principal_amount: body.principalAmount") && !route.includes("principal_amount:"));
check("R4 config fields ยังผ่าน (partner re-point + interest start)",
  route.includes("partner_id: body.partnerId") && route.includes("interest_start_at: body.interestStartAt"));

console.log("\n[2] writer authority: no direct money column write");
check("W1 updateDebtTracking body ไม่มี money columns เลย", updBody.length > 0 && !/total_outstanding|overdue_amount/.test(updBody));
check("W2 updateDebtTracking signature ไม่มี principal_amount", updBody.length > 0 && !updBody.includes("principal_amount"));
check("W3 ยังเขียน config ได้ (last_refreshed_at + debt_start_at + company re-point)",
  updBody.includes("last_refreshed_at") && updBody.includes("debt_start_at") && updBody.includes("customer_company_id"));

console.log("\n[3] UI = ไม่ส่ง monetary key ตอน PATCH + ปฏิเสธแบบเห็นชัด (ไม่ silent)");
check("U1 payload ตอนแก้ไข = config เท่านั้น (principalAmount เฉพาะตอนสร้าง)",
  ui.includes("...(editingId ? {} : { principalAmount"));
check("U2 client ปฏิเสธแบบเห็นชัดเมื่อผู้ใช้แก้ค่าเงินต้นในฟอร์มแก้ไข",
  ui.includes("FREEZE: แก้ยอดหนี้"));
check("U3 CREATE (POST) ยังส่ง principalAmount ตามเดิม — ไม่โดน freeze",
  ui.includes("principalAmount: Number(form.principalAmount)"));

console.log("\n[4] ไม่มี authority/semantics ใหม่");
const eventList = debtWrite.match(/DEBT_EVENT_TYPES = \[([\s\S]*?)\] as const/)?.[1] ?? "";
const eventCount = (eventList.match(/"/g) ?? []).length / 2;
check("A1 debt-write contract คงเดิม = appendDebtEvent + refreshDebtSnapshotFromLedger เท่านั้น",
  (debtWrite.match(/export async function/g) ?? []).length === 2 &&
    debtWrite.includes("export async function appendDebtEvent") &&
    debtWrite.includes("export async function refreshDebtSnapshotFromLedger"));
check("A2 event vocabulary = 9 ตัวเดิม ไม่มี semantics ใหม่", eventCount === 9, `count=${eventCount}`);
check("A3 B-05: gateway ยังเป็นเจ้าของ debt_trackings (executeDebtCreate ห้ามแตะ)",
  gateway.includes('.from("debt_trackings")'));

console.log("\n[5] DEFERRED — CREATE/DELETE ไม่ถูก redesign ในรอบนี้");
check("D1 createDebtTracking คงรูปเดิมเป๊ะ (insert start row ด้วย principal)",
  /total_outstanding: payload\.principal_amount/.test(createBody));
check("D2 DELETE route คงเดิม (deleteDebtTracking(id))", route.includes("deleteDebtTracking(id)"));
check("D3 DEFERRED_DEBT_MODEL_DECISION บันทึกไว้ที่ route + writer",
  route.includes("DEFERRED_DEBT_MODEL_DECISION") && queries.includes("DEFERRED_DEBT_MODEL_DECISION"));

const overwrite =
  (route.includes("principal_amount: body.principalAmount") ? 1 : 0) +
  (/total_outstanding|overdue_amount/.test(updBody) ? 1 : 0) +
  (!ui.includes("...(editingId ? {} : { principalAmount") ? 1 : 0);
console.log(`\nLEGACY_DEBT_PATCH_DIRECT_MONEY_OVERWRITE = ${overwrite}`);
check("LEGACY_DEBT_PATCH_DIRECT_MONEY_OVERWRITE = 0", overwrite === 0);

console.log(`\ndebt-patch-freeze: ${pass} PASS / ${fail} FAIL`);
if (fail > 0) process.exit(1);