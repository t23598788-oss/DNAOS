/**
 * Driver actor — the truck driver's phone.
 *
 * Real contract from app/api/driver/_lib/driver-auth.ts:
 *   header  x-driver-token
 *   secret  process.env.DRIVER_TRACKING_SECRET (unset -> 503, wrong -> 401)
 *
 * The token is sent only when the local environment really has the secret. We
 * never guess one: a fabricated token would prove nothing about the system.
 */
import { secret, loadEnv } from "../env";
import { send } from "../http";
import { act, type ActorResult } from "./_shared";

loadEnv();

const WATCHED = ["truck_jobs", "truck_events", "customer_orders"];

function authHeaders(): { headers: Record<string, string>; signed: boolean; note: string } {
  const token = secret("DRIVER_TRACKING_SECRET");
  if (!token) {
    return {
      headers: {},
      signed: false,
      note: "DRIVER_TRACKING_SECRET not set locally — x-driver-token omitted",
    };
  }
  return { headers: { "x-driver-token": token }, signed: true, note: "x-driver-token = local shared secret" };
}

export async function listJobs(): Promise<ActorResult> {
  const auth = authHeaders();
  return act(
    "driver",
    "open the job board (available jobs)",
    { method: "GET", path: "/api/driver/available-jobs", signed: auth.signed, signatureNote: auth.note },
    WATCHED,
    () => send({ method: "GET", path: "/api/driver/available-jobs", headers: auth.headers }),
  );
}

export async function acceptJob(input: {
  jobId: string;
  truckId: string;
  driverId: string;
}): Promise<ActorResult> {
  const auth = authHeaders();
  const body = JSON.stringify({
    jobId: input.jobId,
    action: "accept",
    truckId: input.truckId,
    driverId: input.driverId,
  });
  return act(
    "driver",
    "accept the broadcast job",
    {
      method: "POST",
      path: "/api/driver/tracking",
      signed: auth.signed,
      signatureNote: auth.note,
      bodyPreview: body,
    },
    WATCHED,
    () =>
      send({
        method: "POST",
        path: "/api/driver/tracking",
        body,
        headers: { ...auth.headers, "content-type": "application/json" },
      }),
  );
}

export const STAGES = [
  "en_route_pickup",
  "picked_up",
  "en_route_customer",
  "at_site",
  "delivered",
] as const;

export async function advance(input: {
  jobId: string;
  action: (typeof STAGES)[number];
  driverId: string;
}): Promise<ActorResult> {
  const auth = authHeaders();
  const body = JSON.stringify({
    jobId: input.jobId,
    action: input.action,
    driverId: input.driverId,
    metadata: { lat: 13.7563, lng: 100.5018, note: "sim" },
  });
  return act(
    "driver",
    `advance job -> ${input.action}`,
    {
      method: "POST",
      path: "/api/driver/tracking",
      signed: auth.signed,
      signatureNote: auth.note,
      bodyPreview: body,
    },
    WATCHED,
    () =>
      send({
        method: "POST",
        path: "/api/driver/tracking",
        body,
        headers: { ...auth.headers, "content-type": "application/json" },
      }),
  );
}

export type { ActorResult };
