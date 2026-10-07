/**
 * หน้าที่: prove that DNA OS can tell the difference between money it has
 * observed and money a piece of work actually cost — and that where the chain
 * between them breaks, it says so instead of producing a number (Owner,
 * 2026-09-02).
 *
 * THE EASIEST LIE IN ANY SYSTEM THAT HANDLES COST. There is a real invoice on
 * disk and there are real executions on disk, and it is trivially easy to divide
 * one by the other. Cases 7–10 feed exactly the four temptations — timestamp
 * proximity, name similarity, even allocation, model inference — and require
 * each to be refused as a basis. Case 9's arithmetic works perfectly; it is
 * still rejected, because "the numbers divide" was never the question.
 *
 * THREE FACTS THAT MUST NOT SUBSTITUTE. Cases 2 and 3 take real executions with
 * a known `duration_ms` and a known `bytes_written` and require that neither
 * produces a monetary amount. Knowing how long something took is not knowing
 * what it cost; the contract keeps those in separate fields precisely so a
 * later reader cannot mistake one for the other.
 *
 * ZERO IS THE FAILURE MODE, NOT THE FALLBACK. Case 4 requires every
 * unattributable amount to be `null`. A zero would be indistinguishable from a
 * free execution and would propagate silently into any sum.
 *
 * Input: none — reads the persisted execution, billing and attribution stores.
 * No execution, no OS action, no model.
 * Output: exit code 0 (all passed) or 1.
 * Dependency ที่อนุญาต: ../contract, ../derive, node built-ins.
 * สิ่งที่ห้ามแตะ: ห้ามยอมรับ basis ที่เป็นการเดา, ห้ามเติม 0, ห้ามแก้แถวต้นทาง.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REJECTED_BASES, answerThreeQuestions, attributeCost, isAdmissibleBasis, type ExecutionIdentity, type MonetaryEvent } from "../contract";
import { answerMethodCostQuestions, deriveAttributions, deriveMissingEdges, readAttributions, readExecutionIdentities, readMissingEdges, readMonetaryEvents, readRegisteredRelationships } from "../derive";

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

const ROOT = process.cwd();
const attributions = readAttributions();
const money = readMonetaryEvents();
const executions = readExecutionIdentities();
const byMethod = (id: string) => attributions.find((a) => a.method_id === id)!;
const exec = (id: string) => executions.find((e) => e.method_id === id)!;

(async () => {
  // ================= 1-4. the four substitutions =================
  const realBill = money.find((m) => m.amount_minor !== null && m.provider === "vercel")!;
  check("1. an observed bill is not an execution cost",
    realBill.amount_minor !== null && realBill.execution_id === null && realBill.work_id === null
    && attributions.every((a) => a.attribution_state !== "DIRECT"),
    `bill ${realBill.amount_minor} ${realBill.currency} carries no execution or work identity`);

  const proc = byMethod("method-local-process");
  check("2. a known duration does not imply a monetary cost",
    Object.keys(exec("method-local-process").measured_usage).includes("duration_ms")
    && proc.amount_minor === null && proc.currency === null,
    `duration_ms=${exec("method-local-process").measured_usage["duration_ms"]}, amount=null`);

  const file = byMethod("method-file-write");
  check("3. known bytes_written does not imply a monetary cost",
    Object.keys(exec("method-file-write").measured_usage).includes("bytes_written")
    && file.amount_minor === null && file.currency === null);

  check("4. UNKNOWN never becomes zero",
    attributions.every((a) => (a.attribution_state === "DIRECT" || a.attribution_state === "DERIVABLE") || a.amount_minor === null)
    && !attributions.some((a) => a.amount_minor === 0),
    "every unattributed amount is null, and no amount is 0");

  // ================= 5-6. what each state demands =================
  const directEvent: MonetaryEvent = { ...realBill, money_event_id: "m-direct", execution_id: "exec-1" };
  const e1: ExecutionIdentity = { execution_id: "exec-1", work_id: null, correlation_id: null, capability_id: null, method_id: "m", resource_id: null, account_id: null, provider: "vercel", provider_request_id: null, measured_usage: {}, evidence_ref: "e" };
  const directResult = attributeCost(e1, [directEvent], [], "a1");
  check("5. DIRECT requires the money event to carry the execution identity itself",
    directResult.attribution_state === "DIRECT" && directResult.attribution_basis === "SAME_EXECUTION_ID"
    && attributeCost({ ...e1, execution_id: "exec-2" }, [directEvent], [], "a2").attribution_state !== "DIRECT");

  const e2: ExecutionIdentity = { ...e1, execution_id: "exec-9", account_id: "account-x" };
  const withEdge = attributeCost(e2, [{ ...realBill, account_or_project_ref: "team-x" }], [{ from_identity: "account-x", to_identity: "team-x", relationship_kind: "DNA_OS_ACCOUNT_TO_PROVIDER_ACCOUNT" }], "a3");
  const withoutEdge = attributeCost(e2, [{ ...realBill, account_or_project_ref: "team-x" }], [], "a4");
  check("6. DERIVABLE requires a complete registered chain, and collapses without it",
    withEdge.attribution_state === "DERIVABLE" && withEdge.attribution_basis === "EXPLICIT_REGISTERED_RELATIONSHIP"
    && withoutEdge.attribution_state === "UNATTRIBUTABLE" && withoutEdge.amount_minor === null,
    "the same two facts, with and without the edge, give different answers");

  // ================= 7-10. the four temptations, each refused =================
  check("7. timestamp proximity is not an admissible basis", !isAdmissibleBasis("TIMESTAMP_PROXIMITY"));
  check("8. name similarity is not an admissible basis", !isAdmissibleBasis("NAME_SIMILARITY"));
  // The arithmetic works. It is still not an answer.
  const totalMinor = money.reduce((s, m) => s + (m.amount_minor ?? 0), 0);
  const evenSplit = Math.round(totalMinor / Math.max(attributions.length, 1));
  check("9. even allocation is refused even though the arithmetic succeeds",
    !isAdmissibleBasis("EVEN_SPLIT") && evenSplit > 0
    && attributions.every((a) => a.amount_minor !== evenSplit),
    `an even split would have produced ${evenSplit} minor units per method; none was recorded`);
  check("10. model inference is not an admissible basis",
    !isAdmissibleBasis("MODEL_GUESS") && REJECTED_BASES.every((b) => !isAdmissibleBasis(b)),
    REJECTED_BASES.join(", "));

  // ================= 11-14. real execution traces =================
  for (const [n, id] of [["11", "method-local-process"], ["12", "method-file-write"], ["13", "method-computer-use"], ["14", "method-webhook-outbound"]] as const) {
    const a = byMethod(id), e = exec(id);
    check(`${n}. real ${id.replace("method-", "")} trace stops at the truth`,
      a.evidence_refs.length > 0 && e.evidence_ref !== "NO_EXECUTION_ROWS"
      && (a.attribution_state === "UNATTRIBUTABLE" || a.attribution_state === "NOT_MEASURED")
      && a.amount_minor === null && a.unattributable_reasons.length > 0,
      `usage=${JSON.stringify(e.measured_usage)} -> ${a.attribution_state} [${a.unattributable_reasons.join(",")}]`);
  }

  // ================= 15-17. the real billing trace =================
  check("15. the real billing row is traced as far as it goes and no further",
    realBill.provider === "vercel" && realBill.account_or_project_ref !== null
    && realBill.execution_id === null && realBill.work_id === null,
    `last proven node: provider account ${realBill.account_or_project_ref}`);
  const edges = readMissingEdges();
  check("16. the missing edge is reported exactly, not approximately",
    edges.some((e) => e.missing_relationship === "DNA_OS_ACCOUNT_TO_PROVIDER_ACCOUNT")
    && edges.every((e) => e.required_producer.length > 0 && e.verification_method.length > 0),
    edges.map((e) => e.missing_relationship).join(", "));
  check("17. provider and project identity are preserved where they exist",
    money.filter((m) => m.provider !== "unknown").length > 0
    && money.some((m) => m.account_or_project_ref !== null),
    `${money.length} money events, providers: ${[...new Set(money.map((m) => m.provider))].join(", ")}`);
  check("18. currency is preserved, never normalised away",
    money.filter((m) => m.amount_minor !== null).every((m) => typeof m.currency === "string" && m.currency.length > 0),
    [...new Set(money.map((m) => m.currency))].join(", "));

  // ================= 19-21. immutability, determinism, no model =================
  const before = readFileSync(join(ROOT, "control/agent-gateway/data/evidence.jsonl"), "utf8").length;
  const rederived = deriveAttributions();
  const after = readFileSync(join(ROOT, "control/agent-gateway/data/evidence.jsonl"), "utf8").length;
  check("19. source evidence is read, never written",
    before === after
    && !/writeFileSync\([^)]*agent-gateway|appendFileSync\([^)]*execution-audit/.test(readFileSync(join(ROOT, "control/cost-attribution/derive.ts"), "utf8")));
  const strip = (rs: readonly { attribution_id: string; attribution_state: string; amount_minor: number | null; unattributable_reasons: readonly string[] }[]) =>
    JSON.stringify(rs.map((r) => ({ id: r.attribution_id, s: r.attribution_state, a: r.amount_minor, w: r.unattributable_reasons })));
  check("20. repeated derivation is identical",
    strip(rederived) === strip(attributions) && strip(deriveAttributions()) === strip(rederived));
  const code = (readFileSync(join(ROOT, "control/cost-attribution/contract.ts"), "utf8") + readFileSync(join(ROOT, "control/cost-attribution/derive.ts"), "utf8"))
    .replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !l.trimStart().startsWith("//")).join("\n");
  check("21. no model, network or randomness in the attribution path",
    !/\b(fetch|anthropic|openai|claude|spawn|child_process|https?:|Math\.random)/i.test(code),
    "AI_INVOLVED = NO");

  // ================= 22. Step 15 untouched, and joined by pointer =================
  const selfResources = readFileSync(join(ROOT, "control/self-resource/data/self-resources.jsonl"), "utf8")
    .split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as { method_id: string; measured_dimensions: readonly string[]; runtime_state: string });
  const answers = answerMethodCostQuestions(selfResources, attributions);
  check("22a. self-resource records are joined by pointer, not copied into",
    answers.every((a) => a.self_resource_ref.includes("self-resources.jsonl") && a.attribution_ref.includes("attributions.jsonl"))
    && !readFileSync(join(ROOT, "control/self-resource/data/self-resources.jsonl"), "utf8").includes("amount_minor"),
    "no billing data entered the self-resource store");
  check("22b. Step 15 runtime states are unchanged by this step",
    selfResources.length === 12 && selfResources.some((s) => s.runtime_state === "RUNTIME_PROVEN")
    && selfResources.some((s) => s.runtime_state === "CONFIGURATION_DRIFT"));
  check("22c. the four cost questions are answerable per method",
    answers.length === attributions.length
    && answers.every((a) => typeof a.can_i_attribute_usage_to_execution === "boolean" && typeof a.can_i_attribute_money_to_execution === "boolean")
    && answers.every((a) => a.can_i_attribute_money_to_execution === false),
    `${answers.filter((a) => a.can_i_attribute_usage_to_execution).length}/${answers.length} can attribute USAGE to an execution; 0 can attribute money`);

  // ================= the three questions stay three =================
  const three = answerThreeQuestions(exec("method-local-process"), proc);
  check("23. the three cost questions cannot substitute for one another",
    three.usage_state === "MEASURED" && three.resource_cost_state === "NO_PRICE_CONTRACT"
    && three.resource_cost_minor === null && three.work_cost_state === "UNATTRIBUTABLE" && three.work_cost_minor === null,
    "usage known; resource price unknown; work cost unattributable — three separate answers");

  console.log(`\n${failures === 0 ? "ALL PASSED" : `${failures} FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
})();
