/**
 * หน้าที่: ล็อกกฎที่ Owner สั่งไว้ — infrastructure-billing เป็นแหล่งความจริง
 * กลางของต้นทุน และหน้าจอห้ามคำนวณเงินซ้ำ
 *
 * เทสต์นี้บังคับสองอย่าง:
 *   1. read model ให้ทุก field ที่หน้าจอต้องใช้ "พร้อมแสดง" อยู่แล้ว
 *      (ถ้าขาด หน้าจอจะถูกบังคับให้คำนวณเอง = กฎพัง)
 *   2. ตัวเลขจาก read model ตรงกับ engine เป๊ะ ไม่มีการคำนวณสองชุด
 *
 * วิธีรัน:
 *   npx tsx control/infrastructure-billing/tests/read-model-proof.test.ts
 */

import { costOverview, collectVercel, summarize, buildBaseline, formatMinor } from "../contract";

let passed = 0;
let failed = 0;
function check(name: string, condition: boolean, detail?: unknown): void {
  if (condition) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.error(`FAIL  ${name}`); if (detail !== undefined) console.error("      " + JSON.stringify(detail).slice(0, 300)); }
}

const TEAM = "team_3uDXRYjLEx8E3AVWiuegeg2N";
const INVOICE_TOTAL_MINOR = 12633;

async function main(): Promise<void> {
  const collection = await collectVercel({ teamId: TEAM, invoiceTotalMinor: INVOICE_TOTAL_MINOR, invoiceId: "inv_test" });
  const baseline = buildBaseline({
    provider: "vercel", account_id: TEAM, currency: "usd",
    samples: [
      { period_start: "2026-05-19T00:00:00.000Z", period_end: "2026-06-18T00:00:00.000Z", total_minor: 2000, evidence_ref: "gmail:receipt#2981-6284" },
      { period_start: "2026-07-06T00:00:00.000Z", period_end: "2026-08-05T00:00:00.000Z", total_minor: 3000, evidence_ref: "gmail:receipt#2200-0878" },
    ],
  });

  const view = costOverview({
    provider: "vercel", account_id: TEAM,
    period_start: collection.period_start ?? "",
    records: collection.records,
    baseline,
    payment_status: collection.payment_status,
  });

  console.log(`\n  สิ่งที่หน้าจอได้รับ (แสดงได้ทันที ไม่ต้องคำนวณ):`);
  console.log(`    current_bill      ${view.current_bill}`);
  console.log(`    baseline          ${view.baseline}  (${view.baseline_sample_count} รอบ)`);
  console.log(`    delta             ${view.delta}  (${view.delta_percent > 0 ? "+" : ""}${view.delta_percent}%)`);
  console.log(`    daily_average     ${view.daily_average}`);
  console.log(`    forecast          ${view.forecast}`);
  console.log(`    top_cost_driver   ${view.top_cost_driver?.resource} ${view.top_cost_driver?.amount} (${view.top_cost_driver?.share_percent}%)`);
  console.log(`    payment_status    ${view.payment_status}`);
  console.log(`    anomalies         ${view.anomalies.length}`);
  console.log(`    unresolved        ${view.unresolved_count}`);
  console.log(`    evidence_ref      ${view.evidence_ref}`);

  // ---- field ที่ Owner ระบุต้องมีครบ ----
  const required = ["current_bill", "baseline", "forecast", "top_cost_driver", "anomalies", "evidence_ref"] as const;
  for (const field of required) {
    check(`F:${field} — มีให้หน้าจอใช้ได้เลย`, view[field] !== undefined && view[field] !== null, view[field]);
  }

  // ---- ทุกยอดต้องมีทั้งเลขดิบและข้อความ เพื่อไม่ให้หน้าจอต้องจัดรูปเอง ----
  check("D1. ทุกยอดมีทั้งเลขดิบและข้อความพร้อมแสดง",
    typeof view.current_bill_minor === "number" && typeof view.current_bill === "string"
    && typeof view.forecast_minor === "number" && typeof view.forecast === "string"
    && typeof view.baseline_minor === "number" && typeof view.baseline === "string");
  check("D2. breakdown จัดรูปมาให้แล้วทุกบรรทัด", view.breakdown.every((b) => typeof b.amount === "string" && typeof b.amount_minor === "number"));
  check("D3. anomaly จัดรูปมาให้แล้ว หน้าจอไม่ต้องคำนวณ %", view.anomalies.every((a) => typeof a.observed === "string" && typeof a.delta_percent === "number"));
  check("D4. by_classification จัดรูปมาให้แล้ว", Object.values(view.by_classification).every((v) => typeof v.amount === "string"));

  // ---- ตัวเลขต้องมาจาก engine ชุดเดียว ----
  const engine = summarize(collection.records);
  check("S1. current_bill ตรงกับ engine เป๊ะ", view.current_bill_minor === engine.current_period_minor, { view: view.current_bill_minor, engine: engine.current_period_minor });
  check("S2. forecast ตรงกับ engine เป๊ะ", view.forecast_minor === engine.estimated_end_of_period_minor);
  check("S3. daily_average ตรงกับ engine เป๊ะ", view.daily_average_minor === engine.daily_average_minor);
  check("S4. ยอดยังตรงกับ invoice จริง", view.current_bill_minor === INVOICE_TOTAL_MINOR, { got: view.current_bill_minor });
  check("S5. ข้อความจัดรูปตรงกับเลขดิบ", view.current_bill === formatMinor(view.current_bill_minor, view.currency));

  // ---- ยอดที่แยกไม่ได้ต้องยังมองเห็น ----
  const derived = view.breakdown.filter((b) => b.derived);
  check("U1. ยอดที่แยกไม่ได้ยังถูกแสดงเป็น UNKNOWN ไม่ถูกกลบ",
    derived.length === 1 && derived[0].classification === "UNKNOWN" && derived[0].amount === "$6.33",
    derived);
  check("U2. unresolved_count บอกหน้าจอว่ามีของที่ยังไม่รู้", view.unresolved_count >= 1, view.unresolved_count);

  // ---- top cost driver ต้องมีหลักฐาน ----
  check("T1. top_cost_driver คือ secure compute พร้อม evidence", /secure/i.test(view.top_cost_driver?.resource ?? "") && (view.top_cost_driver?.evidence_ref ?? "").includes("vercel:api"), view.top_cost_driver);
  check("T2. บอกสัดส่วนของยอดรวมให้ด้วย", (view.top_cost_driver?.share_percent ?? 0) > 50, view.top_cost_driver?.share_percent);

  // ---- ประกาศว่าใครคำนวณ ----
  check("O1. ประกาศแหล่งที่คำนวณไว้ในผลลัพธ์", view.computed_by.includes("infrastructure-billing"), view.computed_by);
  check("O2. payment_status ส่งมาให้แสดงด้วย", typeof view.payment_status === "string", view.payment_status);
}

main()
  .catch((error) => { failed++; console.error("FAIL  harness: " + (error instanceof Error ? error.stack ?? error.message : String(error))); })
  .finally(() => {
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed > 0 ? 1 : 0);
  });
