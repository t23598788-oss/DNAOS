/**
 * Clock actor — the scheduler firing the gateway worker pipeline.
 *
 * Route: GET /api/cron/gateway-workers
 * Auth : Authorization: Bearer <CRON_SECRET>, fail-closed 401.
 *
 * The secret is sent only when this machine really has it. It is NOT invented,
 * because a valid secret here would let the pipeline mutate live orders.
 */
import { secret, loadEnv } from "./env";
import { send } from "./http";
import { act, type ActorResult } from "./actors/_shared";

loadEnv();

const WATCHED = [
  "integration_gateway_events",
  "customer_orders",
  "truck_jobs",
  "truck_events",
  "payout_audit_log",
];

export async function fireGatewayWorkers(): Promise<ActorResult> {
  const cronSecret = secret("CRON_SECRET");
  const headers: Record<string, string> = {};
  if (cronSecret) headers.authorization = `Bearer ${cronSecret}`;
  return act(
    "clock",
    "cron: gateway-workers (translate -> reconcile -> dispatch -> payout request)",
    {
      method: "GET",
      path: "/api/cron/gateway-workers",
      signed: Boolean(cronSecret),
      signatureNote: cronSecret
        ? "Authorization: Bearer <CRON_SECRET>"
        : "CRON_SECRET not set locally — request sent with NO Authorization header",
    },
    WATCHED,
    () => send({ method: "GET", path: "/api/cron/gateway-workers", headers }),
  );
}

export type { ActorResult };
