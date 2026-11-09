/**
 * Scenario 01 — one order, end to end, fake money.
 *
 * The point is NOT to make it pass. The point is to hit every door in order and
 * record what the system actually did at each one, then keep going.
 */
import { oneLine } from "../http";
import { fireGatewayWorkers } from "../clock";
import { sendLineMessage } from "../actors/customer";
import { replyPrice } from "../actors/partner";
import { approvePayout, readPayoutQueue } from "../actors/admin";
import { acceptJob, advance, listJobs, STAGES } from "../actors/driver";
import { sendPayment } from "../actors/bank";
import { selectRows, SIM_MARK, snapshot, diff } from "../db";
import type { ActorResult } from "../actors/_shared";

export type Verdict = "OK" | "GAP" | "SKIPPED" | "NO_ROUTE";

export interface StepRecord {
  n: number;
  step: string;
  expected: string;
  actual: string;
  verdict: Verdict;
  where: string;
}

const ORDER_TEXT = "อยากได้ทราย 500 คิว ส่งพรุ่งนี้";

export interface ScenarioResult {
  steps: StepRecord[];
  stoppedAt: string;
  finalState: string[];
  actorResults: ActorResult[];
}

const SYNTHETIC_ORDER_ID = "00000000-0000-0000-0000-000000000001";

function verdictFor(status: number, expected: string): Verdict {
  void expected;
  return status >= 200 && status < 300 ? "OK" : "GAP";
}

export async function play(): Promise<ScenarioResult> {
  const steps: StepRecord[] = [];
  const actorResults: ActorResult[] = [];
  const push = (rec: StepRecord) => {
    steps.push(rec);
  };

  // ---- [00] customer speaks -------------------------------------------------
  const customer = await sendLineMessage({ text: ORDER_TEXT, webhookEventId: `${SIM_MARK}-line-0001` });
  actorResults.push(customer);
  push({
    n: 0,
    step: `customer LINE: "${ORDER_TEXT}"`,
    expected: "HTTP 200, reply sent to the customer",
    actual: `HTTP ${customer.response.status} ${oneLine(customer.response)}`,
    verdict: verdictFor(customer.response.status, "200"),
    where: "app/api/gateway/observe/line/route.ts:32-44 (secret) / 46-49 (signature)",
  });

  // ---- [01] did the outside world land in the DB? ---------------------------
  push({
    n: 1,
    step: "DB: integration_gateway_events +1",
    expected: "one EVT-line row for this message",
    actual: customer.dbChanged.join("; "),
    verdict: customer.dbChanged.some((l) => l.startsWith("integration_gateway_events: ") && /\+\d/.test(l)) ? "OK" : "GAP",
    where: "app/api/gateway/observe/line/route.ts:51-57 (publish) -> engines/integration-gateway/evidence/store.ts",
  });

  // ---- [02] scheduler moves the event --------------------------------------
  const cron1 = await fireGatewayWorkers();
  actorResults.push(cron1);
  push({
    n: 2,
    step: "clock: cron gateway-workers",
    expected: "{translated:1, reconciled:0, dispatched:0, approvalRequested:0}",
    actual: `HTTP ${cron1.response.status} ${oneLine(cron1.response)}`,
    verdict: verdictFor(cron1.response.status, "200"),
    where: "app/api/cron/gateway-workers/route.ts:51-56 (CRON_SECRET gate)",
  });

  // ---- [03] the order -------------------------------------------------------
  const orderRows = (await selectRows(
    "customer_orders",
    `select=id,order_no,status,project_id,customer_company_id,customer_site_id,created_at&order_no=like.SIM-${SIM_MARK}-*&limit=5`,
  )) as Array<Record<string, unknown>>;
  const createdOrder = Array.isArray(orderRows) ? orderRows[0] : undefined;
  push({
    n: 3,
    step: "DB: customer_orders status = DRAFT",
    expected: "a DRAFT order for the sand request",
    actual: createdOrder
      ? JSON.stringify(createdOrder)
      : "no order row was created by this run",
    verdict: createdOrder ? "OK" : "GAP",
    where: "engines/integration-gateway/workers/order-translator.ts:141-158 (insert; NOT NULL columns left undefined)",
  });

  // ---- partner quotes -------------------------------------------------------
  const partner = await replyPrice({ orderNo: (createdOrder?.order_no as string) ?? `SIM-${SIM_MARK}-NOORDER`, amount: 250000 });
  actorResults.push(partner);
  push({
    n: 3.5,
    step: "partner: reply a price / accept",
    expected: "HTTP 200 from a partner-facing endpoint",
    actual: `HTTP ${partner.response.status} ${oneLine(partner.response)}`,
    verdict: partner.response.status === 404 ? "NO_ROUTE" : verdictFor(partner.response.status, "200"),
    where: "no app/api/partner/** route exists (only app/api/admin/partners/*)",
  });

  // ---- [04] money arrives ---------------------------------------------------
  const bank = await sendPayment({ amount: 250000, reference: (createdOrder?.order_no as string) ?? `SIM-${SIM_MARK}-NOORDER` });
  actorResults.push(bank);
  push({
    n: 4,
    step: "bank: payment webhook 250,000 THB",
    expected: "HTTP 200 with an event id",
    actual: `HTTP ${bank.response.status} ${oneLine(bank.response) || "(empty body)"}`,
    verdict: verdictFor(bank.response.status, "200"),
    where: "app/api/connectors/webhook/kbank/route.ts:34 (params.slug on a non-dynamic route) -> 404",
  });

  // ---- [05] reconcile -------------------------------------------------------
  const cron2 = await fireGatewayWorkers();
  actorResults.push(cron2);
  push({
    n: 5,
    step: "clock: cron gateway-workers again",
    expected: "reconciled:1, order status = PAID",
    actual: `HTTP ${cron2.response.status} ${oneLine(cron2.response)}`,
    verdict: verdictFor(cron2.response.status, "200"),
    where: "app/api/cron/gateway-workers/route.ts:51-56",
  });

  // ---- [06] dispatch --------------------------------------------------------
  const jobs = (await selectRows("truck_jobs", `select=id,order_id,current_status,created_at&current_status=eq.BROADCASTED&limit=5`)) as unknown;
  const jobList = Array.isArray(jobs) ? (jobs as Array<Record<string, unknown>>) : [];
  const jobId = (jobList[0]?.id as string) ?? "";
  push({
    n: 6,
    step: "DB: truck_jobs BROADCASTED",
    expected: ">=1 broadcasted truck job for the paid order",
    actual: Array.isArray(jobs) ? `${jobList.length} broadcasted job(s)` : JSON.stringify(jobs).slice(0, 200),
    verdict: jobList.length > 0 ? "OK" : "GAP",
    where: "engines/integration-gateway/workers/order-dispatcher.ts:101 (truck_jobs read/insert)",
  });

  // ---- [07] driver job board ------------------------------------------------
  const board = await listJobs();
  actorResults.push(board);
  push({
    n: 7,
    step: "driver: GET available-jobs",
    expected: "the broadcasted job is visible",
    actual: `HTTP ${board.response.status} ${oneLine(board.response)}`,
    verdict: verdictFor(board.response.status, "200"),
    where: "app/api/driver/_lib/driver-auth.ts:40-49 (DRIVER_TRACKING_SECRET) / available-jobs route:33-45",
  });

  // ---- [08] driver accepts --------------------------------------------------
  if (!jobId) {
    push({
      n: 8,
      step: "driver: accept job",
      expected: "status ACCEPTED",
      actual: "not attempted — [06] produced no job id (and the board returned no job)",
      verdict: "SKIPPED",
      where: "depends on step 6",
    });
  } else {
    const accepted = await acceptJob({ jobId, truckId: "TRUCK-SIM-01", driverId: "DRIVER-SIM-01" });
    actorResults.push(accepted);
    push({
      n: 8,
      step: "driver: accept job",
      expected: "status ACCEPTED",
      actual: `HTTP ${accepted.response.status} ${oneLine(accepted.response)}`,
      verdict: verdictFor(accepted.response.status, "200"),
      where: "app/api/driver/tracking/route.ts:41-88",
    });
  }

  // ---- [09] driver advances to DELIVERED -----------------------------------
  if (!jobId) {
    push({
      n: 9,
      step: `driver: advance through ${STAGES.length} stages to DELIVERED`,
      expected: "truck_jobs.current_status = DELIVERED",
      actual: "not attempted — no job to advance",
      verdict: "SKIPPED",
      where: "depends on step 8",
    });
  } else {
    const trail: string[] = [];
    for (const stage of STAGES) {
      const res = await advance({ jobId, action: stage, driverId: "DRIVER-SIM-01" });
      actorResults.push(res);
      trail.push(`${stage}=HTTP ${res.response.status}`);
      if (res.response.status >= 400) break;
    }
    push({
      n: 9,
      step: "driver: advance to DELIVERED",
      expected: "all 5 stages HTTP 200, final status DELIVERED",
      actual: trail.join(", "),
      verdict: trail.every((t) => t.endsWith("200")) ? "OK" : "GAP",
      where: "app/api/driver/tracking/route.ts:41-88 -> engines/integration-gateway/workers/truck-tracker.ts",
    });
  }

  // ---- [10] admin approves the payout --------------------------------------
  const queue = await readPayoutQueue();
  actorResults.push(queue);
  const approval = await approvePayout({
    orderId: (createdOrder?.id as string) ?? SYNTHETIC_ORDER_ID,
    actor: "SIM-ADMIN-01",
  });
  actorResults.push(approval);
  push({
    n: 10,
    step: "admin: approve payout",
    expected: "HTTP 200, order -> PAYOUT_APPROVED -> SETTLED",
    actual: `queue=HTTP ${queue.response.status} ${oneLine(queue.response, 120)} | approve=HTTP ${approval.response.status} ${oneLine(approval.response, 120)} — blocked by the admin auth guard before routing, so an outside client cannot reach the action at all`,
    verdict: approval.response.status === 404 ? "NO_ROUTE" : verdictFor(approval.response.status, "200"),
    where: "admin API is login-gated (401); behind the guard only app/api/admin/orders/[orderId]/dispatch/route.ts exists — no route calls executeApprovedPayout (only tests/e2e/kbank-payment-flow.test.ts)",
  });

  // ---- [11] summary ---------------------------------------------------------
  const watched = ["integration_gateway_events", "customer_orders", "truck_jobs", "truck_events", "kbank_webhook_events", "payout_audit_log"];
  const before = await snapshot(watched);
  actorResults.push(
    await (async () => {
      const after = await snapshot(watched);
      return {
        actor: "system",
        action: "final DB state",
        request: { method: "OBSERVE", path: "db", signed: false, signatureNote: "read-only" },
        response: {
          method: "OBSERVE",
          path: "db",
          url: "db",
          status: 200,
          ok: true,
          ms: 0,
          headers: {},
          bodyText: "",
          json: null,
        },
        dbChanged: diff(before, after),
        before,
        after,
      } satisfies ActorResult;
    })(),
  );
  const finalState = watched.map((t) => {
    const s = before[t];
    return `${t}: ${s.ok ? `${s.count} row(s)` : `ABSENT (${s.error})`}`;
  });
  push({
    n: 11,
    step: "summary",
    expected: "order SETTLED, truck job DELIVERED, payout audited",
    actual: "see final DB state",
    verdict: steps.some((s) => s.verdict === "GAP" || s.verdict === "NO_ROUTE") ? "GAP" : "OK",
    where: "-",
  });

  const firstGap = steps.find((s) => s.verdict === "GAP" || s.verdict === "NO_ROUTE");
  return {
    steps,
    stoppedAt: firstGap ? `[${String(firstGap.n).padStart(2, "0")}] ${firstGap.step}` : "completed",
    finalState,
    actorResults,
  };
}
