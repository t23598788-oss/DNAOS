// Deterministic economic computation over the Phase 16 registries.
// This file contains NO judgment calls — every output is either a pure
// function of registry data (with FORMULA/INPUTS/SOURCE/STATUS attached)
// or explicitly UNCOMPUTABLE when a required input is UNKNOWN. Run with:
//   node reports/phase16-world-evidence/compute.mjs
import fs from "node:fs";
import path from "node:path";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const evidence = JSON.parse(fs.readFileSync(path.join(DIR, "evidence_registry.json"), "utf-8"));
const problems = JSON.parse(fs.readFileSync(path.join(DIR, "problem_registry.json"), "utf-8"));
const dbc = JSON.parse(fs.readFileSync(path.join(DIR, "demand_buyer_channel_registry.json"), "utf-8"));
const prr = JSON.parse(fs.readFileSync(path.join(DIR, "price_resource_rules_registry.json"), "utf-8"));

const CAPITAL_AVAILABLE_THB = 10001;
const CASH_TARGET_THB = 40000;

function evidenceById(id) {
  return evidence.find((e) => e.evidence_id === id);
}

function field(name, formula, inputs, sourceIds, computeFn) {
  const missing = inputs.filter((v) => v === null || v === undefined || v === "UNKNOWN");
  if (missing.length > 0) {
    return { name, formula, inputs, source: sourceIds, status: "UNCOMPUTABLE", value: null, reason: `missing/UNKNOWN input(s): ${JSON.stringify(missing)}` };
  }
  try {
    const value = computeFn(...inputs);
    return { name, formula, inputs, source: sourceIds, status: "COMPUTED", value };
  } catch (err) {
    return { name, formula, inputs, source: sourceIds, status: "UNCOMPUTABLE", value: null, reason: err.message };
  }
}

function computeCandidate(problemId, priceRow, resourceRow, buyerRow, demandRow) {
  const out = { problem_id: problemId, computed_at: new Date().toISOString() };

  out.target_group_size = field(
    "target_group_size",
    "count of identified buyer entities",
    [buyerRow.buyer_identified ? "known" : "UNKNOWN"],
    buyerRow ? [] : [],
    () => { throw new Error("no buyer identification method exists"); },
  );

  out.reachable_target_group = field(
    "reachable_target_group",
    "target_group_size * channel_reach_rate",
    ["UNKNOWN"],
    [],
    () => 0,
  );

  out.observed_market_price = field(
    "observed_market_price",
    "th_specific_price if present, else UNKNOWN (international price is NOT substituted silently)",
    [priceRow.th_specific_price],
    priceRow.evidence_ids,
    (p) => p,
  );

  out.required_capital = field(
    "required_capital",
    "capped by Owner policy",
    [CAPITAL_AVAILABLE_THB],
    ["owner-directive-phase15"],
    (c) => Math.min(c, CAPITAL_AVAILABLE_THB),
  );

  out.CAC = field(
    "CAC (customer acquisition cost)",
    "capital_spent_on_acquisition / customers_acquired",
    ["UNKNOWN", "UNKNOWN"],
    [],
    () => { throw new Error("no acquisition spend or conversion data exists yet"); },
  );

  out.delivery_cost = field(
    "delivery_cost",
    "hours_to_deliver * cost_per_hour (or 0 if fully automated by existing capability)",
    [resourceRow.existing_capability_status === "READY" ? 0 : "UNKNOWN"],
    [],
    (v) => v,
  );

  out.platform_fees = field(
    "platform_fees",
    "observed_market_price * platform_fee_rate",
    [out.observed_market_price.value, "UNKNOWN"],
    ["market-fiverr-fee", "market-upwork-fee"],
    () => { throw new Error("observed_market_price is UNKNOWN and platform choice not yet made"); },
  );

  out.tax = field(
    "tax",
    "revenue * applicable_tax_rate",
    ["UNKNOWN"],
    ["tax-th-wht-status"],
    () => { throw new Error("Thai tax rule applicability not researched this round"); },
  );

  out.gross_margin = field("gross_margin", "observed_market_price - delivery_cost", [out.observed_market_price.value, out.delivery_cost.value], [], (p, d) => p - d);
  out.net_margin = field("net_margin", "gross_margin - platform_fees - tax", [out.gross_margin.value], [], () => { throw new Error("platform_fees/tax UNCOMPUTABLE"); });

  out.break_even_customers = field(
    "break_even_customers",
    "required_capital / net_margin_per_customer",
    [out.required_capital.value, "UNKNOWN"],
    [],
    () => { throw new Error("net_margin_per_customer UNCOMPUTABLE"); },
  );

  out.customers_required_for_40k_cash = field(
    "customers_required_for_40k_cash",
    `${CASH_TARGET_THB} / net_margin_per_customer`,
    ["UNKNOWN"],
    [],
    () => { throw new Error("net_margin_per_customer UNCOMPUTABLE"); },
  );

  out.required_conversion_rate = field(
    "required_conversion_rate",
    "customers_required / reachable_target_group",
    ["UNKNOWN", out.reachable_target_group.value],
    [],
    () => { throw new Error("customers_required UNCOMPUTABLE and reachable_target_group = 0"); },
  );

  out.days_to_first_possible_cash = field(
    "days_to_first_possible_cash",
    "date(buyer_reachable) + date(delivery) + date(payment_settlement) - date(day_0)",
    [buyerRow.buyer_reachability === "UNKNOWN" ? "UNKNOWN" : buyerRow.buyer_reachability],
    [],
    () => { throw new Error("no buyer_reachability date evidence exists"); },
  );

  out.cash_possible_by_day_30 = { name: "cash_possible_by_day_30", status: "UNCOMPUTABLE", value: null, reason: "depends on days_to_first_possible_cash, which is UNCOMPUTABLE" };

  out.maximum_loss = field(
    "maximum_loss",
    "required_capital (capital not returned if zero sales)",
    [out.required_capital.value],
    [],
    (c) => c,
  );

  out.capital_remaining = field("capital_remaining", "CAPITAL_AVAILABLE - required_capital (before any spend)", [CAPITAL_AVAILABLE_THB, out.required_capital.value], [], (a, r) => a - r);

  out.ROI = { name: "ROI", status: "UNCOMPUTABLE", value: null, reason: "net_margin and customer count both UNCOMPUTABLE" };

  return out;
}

const p3price = prr.price_cost_registry.find((r) => r.problem_id === "P3");
const p3resource = prr.resource_registry.find((r) => r.problem_id === "P3");
const p3buyer = dbc.buyer_registry.find((r) => r.problem_id === "P3");
const p3demand = dbc.demand_registry.find((r) => r.problem_id === "P3");

const p4price = prr.price_cost_registry.find((r) => r.problem_id === "P4");
const p4resource = prr.resource_registry.find((r) => r.problem_id === "P4");
const p4buyer = dbc.buyer_registry.find((r) => r.problem_id === "P4");
const p4demand = dbc.demand_registry.find((r) => r.problem_id === "P4");

const results = {
  capital_state: {
    CAPITAL_AVAILABLE: CAPITAL_AVAILABLE_THB,
    CAPITAL_BLOCKED: CAPITAL_AVAILABLE_THB,
    CAPITAL_PROPOSED: 0,
    CAPITAL_RELEASED: 0,
  },
  candidates: [
    computeCandidate("P3", p3price, p3resource, p3buyer, p3demand),
    computeCandidate("P4", p4price, p4resource, p4buyer, p4demand),
  ],
};

// Capital gate — deterministic, not AI-narrated.
function capitalGate(candidate) {
  const requiredFields = ["observed_market_price", "CAC", "days_to_first_possible_cash", "net_margin", "customers_required_for_40k_cash"];
  const uncomputable = requiredFields.filter((f) => candidate[f].status === "UNCOMPUTABLE");
  if (uncomputable.length > 0) {
    return { gate_result: "WAITING_EVIDENCE", blocking_fields: uncomputable };
  }
  if (candidate.maximum_loss.value > CAPITAL_AVAILABLE_THB) {
    return { gate_result: "NO_GO", blocking_fields: ["maximum_loss exceeds capital"] };
  }
  return { gate_result: "PROPOSE_GO", blocking_fields: [] };
}

for (const c of results.candidates) {
  c.capital_gate = capitalGate(c);
}

fs.writeFileSync(path.join(DIR, "computed_state.json"), JSON.stringify(results, null, 2), "utf-8");
console.log(JSON.stringify(results, null, 2));
