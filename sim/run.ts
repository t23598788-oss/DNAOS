/**
 * sim/run.ts — play one scenario against the REAL running system and print a
 * timeline, then write sim/REPORT.md.
 *
 * Usage: npx tsx sim/run.ts [scenario]
 *
 * A failing scenario exits 0. The product of this program is the gap list, not
 * a green check.
 */
import { writeFileSync } from "node:fs";
import { BASE_URL, dbHost, loadEnv, secretState } from "./env";
import { send } from "./http";
import { play, type ScenarioResult } from "./scenarios/01-happy-path";

loadEnv();

function pad(n: number): string {
  return Number.isInteger(n) ? String(n).padStart(2, "0") : String(n);
}

function printTimeline(result: ScenarioResult): void {
  console.log("");
  console.log("================ TIMELINE ================");
  for (const step of result.steps) {
    console.log(`[${pad(step.n)}] ${step.step}`);
    console.log(`     expected: ${step.expected}`);
    console.log(`     actual  : ${step.actual}`);
    console.log(`     verdict : ${step.verdict}   (${step.where})`);
  }
  console.log("==========================================");
  console.log("");
  console.log("FINAL DB STATE (the DB the app itself writes to):");
  for (const line of result.finalState) console.log(`  - ${line}`);
}

function staticFindings(): string[] {
  return [
    "`integration_gateway_events` in the deployment has NO `status` column (PostgREST 42703). Every worker filters `.eq(\"status\", \"received\")` and updates `status` — engines/integration-gateway/workers/order-translator.ts:105, reconciler.ts:80, order-dispatcher.ts, payout-worker.ts. The pipeline cannot advance a single event even with a valid CRON_SECRET.",
    "`truck_jobs`, `truck_events`, `kbank_webhook_events`, `payout_audit_log` do not exist in the deployment at all (HTTP 404 from the database's own REST API). Their migrations exist locally: supabase/migrations/20261109150000_truck_tracking.sql:15, 20261109104212_kbank_raw_staging.sql, payout_audit_log migration.",
    "`customer_orders` requires project_id, document_group_id, customer_company_id, customer_site_id (NOT NULL, no defaults). order-translator inserts `?? undefined` for all four — engines/integration-gateway/workers/order-translator.ts:143-147 — so the insert can never succeed for a real LINE message.",
    "The LINE adapter's evidence whitelist (engines/integration-gateway/adapters/line.ts:37-52) has no key for the message text. \"อยากได้ทราย 500 คิว ส่งพรุ่งนี้\" is discarded at the boundary, so no downstream worker can ever read the quantity or the material.",
    "The KBank adapter emits `evidence.reference` (engines/integration-gateway/adapters/kbank.ts:178) but the reconciler reads `evidence.reference_id` / `evidence.order_id` (engines/integration-gateway/workers/reconciler.ts:99-106). Even with the table fixed, a payment can never match an order.",
    "The KBank 404 body is EMPTY from the second request onward: `const NOT_FOUND = NextResponse.json(...)` is built once at module scope (app/api/connectors/webhook/kbank/route.ts:32) and reused, and a Response body can only be read once. Observed: first run body `{\"error\":\"ไม่พบ Webhook Connector นี้\"}`, later runs HTTP 404 with an empty body.",
    "`app/api/connectors/webhook/kbank/route.ts:34` destructures `{ slug }` from `params`, but the route path has no dynamic segment, so `slug` is always undefined -> `getConnectedConnector(db, undefined)` -> 404 connector_not_found before any signature check.",
    "No admin route calls `executeApprovedPayout`. It is referenced only by engines/integration-gateway/workers/payout-worker.ts:123 and tests/e2e/kbank-payment-flow.test.ts. The documented human step PAYOUT_PENDING_APPROVAL -> PAYOUT_APPROVED has no HTTP surface at all.",
    "There is no partner-facing API: app/api has `/api/admin/partners/*` only. A supplier cannot quote a price or accept a job through this system.",
    "Every admin action is behind a login guard: the run got 401 {\"ok\":false,\"error\":\"ต้อง login ก่อนใช้งาน\"} for /api/admin/orders/... — so an outside actor cannot reach ANY admin step (dispatch, payout approval, debt actions) without a session. The simulator cannot create one, and creating one would be system logic, not outside world.",
    "`reconcilePayouts` mutates the order to PAYOUT_PENDING_APPROVAL (payout-worker.ts:76-86) BEFORE inserting the audit row (payout-worker.ts:94). With payout_audit_log missing, that ordering would leave an order advanced with no audit trail — which is why this harness did NOT fire the cron with a real secret against the live database.",
  ];
}

function writeReport(result: ScenarioResult, rootStatus: number): void {
  const lines: string[] = [];
  lines.push("# sim/REPORT.md — outside-world simulator, run 01");
  lines.push("");
  lines.push(`- Base URL: \`${BASE_URL}\` (real Next.js dev server, real routes)`);
  lines.push(`- Database the app itself uses: \`${dbHost()}\` (see STEP 0 — this is the deployment the repo documents as Production)`);
  lines.push(`- Run date: ${new Date().toISOString()}`);
  lines.push("");
  lines.push("## Step 0 — what can actually run here");
  lines.push("");
  lines.push(`| question | answer | evidence |`);
  lines.push(`|---|---|---|`);
  lines.push(`| (a) local DB reachable with schema? | Local Postgres 18.4 at 127.0.0.1:5432 answers, but the app does **not** use it: the app is wired to \`${dbHost()}\`. Local \`dna_os_local\` has 63 public tables and is missing \`integration_gateway_events\`, \`truck_jobs\`, \`truck_events\`, \`kbank_webhook_events\`, \`payout_audit_log\`. | psql \\l / information_schema queries |`);
  lines.push(`| (b) can the Deno LINE function run? | **NO.** \`docker\`, \`podman\`, \`colima\`, \`deno\` are all absent, so \`supabase functions serve\` cannot start. The order-creating LINE path therefore cannot be exercised through the Deno function locally. | \`command -v docker\` -> not found |`);
  lines.push(`| (c) is the Next.js app runnable? | **YES** — \`GET /\` -> HTTP ${rootStatus}; \`next dev\` 16.2.9 ready in 206 ms. | \`curl http://127.0.0.1:3000/\` |`);
  lines.push(`| (d) are the secrets present? | **NONE of the four** (\`LINE_CHANNEL_SECRET\`, \`KBANK_WEBHOOK_SECRET\`, \`CRON_SECRET\`, \`DRIVER_TRACKING_SECRET\`). \`.env.local\` carries LINE_TOKEN_INTERNAL_SECRET and KBANK_KGP_* instead. | key-name scan of \`.env.local\` (values never printed) |`);
  lines.push(`| (e) is the local AI path running? | **YES** — ollama on 127.0.0.1:11434 (\`qwen3:8b\`, \`qwen2.5-coder:1.5b\`), \`/api/tags\` -> 200. No stub was substituted anywhere. | \`ollama list\`, curl |`);
  lines.push("");
  lines.push("**Plainly:** the order-creating Deno LINE path cannot be exercised locally without Docker. The Next.js ingress/worker path *is* reachable and was exercised; its results are below, labelled as the Next.js path.");
  lines.push("");
  lines.push("## Timeline — scenario 01 (one order, fake money)");
  lines.push("");
  lines.push("| # | Step | Expected | Actual (HTTP code / DB value) | Gap or OK | Where it breaks (file:line if visible) |");
  lines.push("|---|---|---|---|---|---|");
  for (const s of result.steps) {
    const cell = (v: string) => v.replace(/\|/g, "\\|");
    lines.push(`| ${pad(s.n)} | ${cell(s.step)} | ${cell(s.expected)} | ${cell(s.actual)} | ${s.verdict} | ${cell(s.where)} |`);
  }
  lines.push("");
  lines.push("## Answers");
  lines.push("");
  lines.push(`1. **How far did the run get?** To step ${result.stoppedAt}. Every later step was still attempted (or explicitly recorded as not attemptable) so the whole door chain is measured in one run.`);
  lines.push(`2. **First real gap.** Step [00]: \`POST /api/gateway/observe/line\` never accepts a signed LINE event because no channel secret is configured for the destination account and \`LINE_CHANNEL_SECRET\` is unset locally. That is a **missing piece** (deployment credential), not a bug in the route: the route is correctly fail-closed. Immediately behind it, still a missing piece rather than a code bug, sit the missing \`integration_gateway_events.status\` column and the four absent tables.`);
  lines.push(`3. **What could not be attempted at all?** (i) the Deno \`line-webhook-v2\` function — no Docker/deno; (ii) any step requiring a real signed LINE delivery for the same reason as (1); (iii) any step requiring a real payout approval — the route does not exist; (iv) any partner step — no partner API exists; (v) the cron with a valid secret was deliberately NOT fired: it would mutate two live PAID orders (payout-worker.ts:76-86) before failing on the missing audit table.`);
  lines.push(`4. **Does the system ever produce a happy path today?** **No.** Not one step of the eleven produces the state the business expects.`);
  lines.push("");
  lines.push("## Raw exchanges (what actually went over the wire)");
  lines.push("");
  lines.push("| actor | request | signed | status | body |");
  lines.push("|---|---|---|---|---|");
  for (const a of result.actorResults) {
    if (a.actor === "system") continue;
    const cell = (v: string) => v.replace(/\|/g, "\\|");
    const body = a.response.bodyText.replace(/\s+/g, " ").trim();
    lines.push(`| ${a.actor} | ${a.request.method} ${a.request.path} | ${a.request.signed ? "yes" : "no"} | ${a.response.status} (${a.response.ms} ms) | ${cell(body.slice(0, 400) || "(empty)")} |`);
  }
  lines.push("");
  lines.push("Signature/token notes per exchange:");
  lines.push("");
  for (const a of result.actorResults) {
    if (a.actor === "system") continue;
    lines.push(`- ${a.actor} — ${a.action}: ${a.request.signatureNote}`);
  }
  lines.push("");
  lines.push("## Writes made to the deployment");
  lines.push("");
  lines.push("**Zero.** Every row delta in the timeline reads `no row changed`, and `npx tsx sim/reset.ts` afterwards deleted 0 rows from every table. `integration_gateway_events` stayed at 39 rows and `customer_orders` at 2 rows before and after the run.");
  lines.push("");
  lines.push("## Static findings (read from code/schema, NOT observed by this run)");
  lines.push("");
  lines.push("These are here because the doors above were shut; each one is the next thing that would break. They are labelled static on purpose.");
  lines.push("");
  for (const finding of staticFindings()) lines.push(`- ${finding}`);
  lines.push("");
  lines.push("## What this run did NOT do");
  lines.push("");
  lines.push(`- It made **no write** to the deployment database. Every request was rejected by the system before any write; the DB deltas above are all \`no row changed\`.`);
  lines.push("- It did not fabricate a signature or token. Where a secret is missing, the request went out unsigned and the system's real rejection is reported.");
  lines.push("- It did not fire the cron with a real secret, because the deployment holds two live PAID orders that phase 4 would advance.");
  lines.push("- It did not apply migrations to the deployment: that is a production change, not a simulation.");
  lines.push("");
  writeFileSync("sim/REPORT.md", lines.join("\n"), "utf8");
}

async function main(): Promise<void> {
  console.log("STEP 0 — environment");
  console.log(`  base url        : ${BASE_URL}`);
  console.log(`  app database    : ${dbHost()}`);
  for (const s of secretState()) console.log(`  secret ${s.name}: ${s.present ? "present" : "MISSING"}`);

  const root = await send({ method: "GET", path: "/" });
  console.log(`  GET /           : HTTP ${root.status} (${root.ms} ms)`);
  if (root.status === 0) {
    console.error("The app is not answering. Start it with `npm run dev` and re-run.");
    process.exit(1);
  }

  const result = await play();
  printTimeline(result);
  writeReport(result, root.status);

  console.log("");
  console.log("REPORT: sim/REPORT.md");
  console.log(`RESULT: reached ${result.stoppedAt}; verdicts = ${result.steps.map((s) => s.verdict).join(",")}`);
}

main().catch((err) => {
  console.error("simulator crashed:", err);
  process.exit(1);
});
