// Integration Gateway — Real-time Truck Tracking Worker (2026-11-09).
//
// One order, one job, one unbroken event stream:
//
//   BROADCASTED -> ACCEPTED -> EN_ROUTE_TO_PICKUP -> PICKED_UP
//              -> EN_ROUTE_TO_CUSTOMER -> AT_SITE -> DELIVERED
//
// Every state change writes one `truck_events` row (who, when, what metadata
// such as GPS/photo/notes). The transition table below is strict: no status
// may be skipped, and the stream starts at BROADCASTED — there is no way for
// a later stage to appear before its predecessor.

import type { SupabaseClient } from "@supabase/supabase-js";

/** The seven tracking statuses, in the only order they may occur. */
export const TRUCK_JOB_STATUSES = [
  "BROADCASTED",
  "ACCEPTED",
  "EN_ROUTE_TO_PICKUP",
  "PICKED_UP",
  "EN_ROUTE_TO_CUSTOMER",
  "AT_SITE",
  "DELIVERED",
] as const;

export type TruckJobStatus = (typeof TRUCK_JOB_STATUSES)[number];

/** Event type written for each status (the first two are job-level events). */
export const TRUCK_EVENT_TYPES = [
  "JOB_BROADCASTED",
  "JOB_ACCEPTED",
  "EN_ROUTE_TO_PICKUP",
  "PICKED_UP",
  "EN_ROUTE_TO_CUSTOMER",
  "AT_SITE",
  "DELIVERED",
] as const;

export type TruckEventType = (typeof TRUCK_EVENT_TYPES)[number];

/** status -> the single status allowed to follow it (null = terminal). */
const NEXT_STATUS: Record<TruckJobStatus, TruckJobStatus | null> = {
  BROADCASTED: "ACCEPTED",
  ACCEPTED: "EN_ROUTE_TO_PICKUP",
  EN_ROUTE_TO_PICKUP: "PICKED_UP",
  PICKED_UP: "EN_ROUTE_TO_CUSTOMER",
  EN_ROUTE_TO_CUSTOMER: "AT_SITE",
  AT_SITE: "DELIVERED",
  DELIVERED: null,
};

/** status -> event_type recorded when the job enters that status. */
export const EVENT_TYPE_BY_STATUS: Record<TruckJobStatus, TruckEventType> = {
  BROADCASTED: "JOB_BROADCASTED",
  ACCEPTED: "JOB_ACCEPTED",
  EN_ROUTE_TO_PICKUP: "EN_ROUTE_TO_PICKUP",
  PICKED_UP: "PICKED_UP",
  EN_ROUTE_TO_CUSTOMER: "EN_ROUTE_TO_CUSTOMER",
  AT_SITE: "AT_SITE",
  DELIVERED: "DELIVERED",
};

/** Options carried through the tracker (db injected for testability). */
export interface TruckTrackerOptions {
  /** Supabase service_role client. */
  db?: SupabaseClient;
}

/** One row of `public.truck_jobs`. */
export interface TruckJobRow {
  id: string;
  order_id: string;
  assigned_truck_id: string | null;
  assigned_driver_id: string | null;
  current_status: TruckJobStatus;
  created_at: string;
  updated_at: string;
}

/** Metadata accepted alongside every transition (GPS, photos, notes, ...). */
export type TruckEventMetadata = Record<string, unknown>;

function requireDb(options: TruckTrackerOptions): SupabaseClient {
  if (!options.db) {
    throw new Error("truck-tracker: a Supabase client is required");
  }
  return options.db;
}

function nowIso(): string {
  return new Date().toISOString();
}

/** Append one event to the stream. Callers must have moved the job already. */
async function logEvent(
  db: SupabaseClient,
  jobId: string,
  eventType: TruckEventType,
  actorId: string,
  metadata: TruckEventMetadata,
): Promise<void> {
  const { error } = await db.from("truck_events").insert({
    job_id: jobId,
    event_type: eventType,
    actor_id: actorId,
    metadata,
    created_at: nowIso(),
  });

  if (error) {
    throw new Error(
      `truck-tracker: failed to log ${eventType} for job ${jobId}: ${error.message}`,
    );
  }
}

/** Read one job or fail loudly. */
async function getJob(db: SupabaseClient, jobId: string): Promise<TruckJobRow> {
  const { data: job, error } = await db
    .from("truck_jobs")
    .select("id, order_id, assigned_truck_id, assigned_driver_id, current_status, created_at, updated_at")
    .eq("id", jobId)
    .single();

  if (error || !job) {
    throw new Error(
      `truck-tracker: job ${jobId} not found: ${error?.message ?? "unknown"}`,
    );
  }

  return job as TruckJobRow;
}

/**
 * Broadcast an order to the truck pool.
 *
 * Creates the job at BROADCASTED and opens the event stream with
 * JOB_BROADCASTED (actor "system").
 */
export async function broadcastJob(
  orderId: string,
  options: TruckTrackerOptions = {},
): Promise<TruckJobRow> {
  const db = requireDb(options);
  if (!orderId) {
    throw new Error("broadcastJob: orderId is required");
  }

  const timestamp = nowIso();
  const { data: job, error } = await db
    .from("truck_jobs")
    .insert({
      order_id: orderId,
      assigned_truck_id: null,
      assigned_driver_id: null,
      current_status: "BROADCASTED" satisfies TruckJobStatus,
      created_at: timestamp,
      updated_at: timestamp,
    })
    .select()
    .single();

  if (error || !job) {
    throw new Error(
      `broadcastJob: failed to create job for order ${orderId}: ${error?.message ?? "unknown"}`,
    );
  }

  const row = job as TruckJobRow;
  await logEvent(db, row.id, "JOB_BROADCASTED", "system", { order_id: orderId });

  return row;
}

/**
 * A truck accepts a broadcast job.
 *
 * @throws when the job is already accepted (or no longer broadcastable)
 */
export async function acceptJob(
  jobId: string,
  truckId: string,
  driverId: string,
  options: TruckTrackerOptions = {},
): Promise<TruckJobRow> {
  const db = requireDb(options);
  if (!truckId) throw new Error("acceptJob: truckId is required");
  if (!driverId) throw new Error("acceptJob: driverId is required");

  const job = await getJob(db, jobId);

  if (job.current_status === "ACCEPTED" || job.assigned_truck_id) {
    throw new Error(
      `acceptJob: job ${jobId} is already accepted by truck ${job.assigned_truck_id ?? "unknown"}`,
    );
  }

  if (job.current_status !== "BROADCASTED") {
    throw new Error(
      `acceptJob: invalid transition ${job.current_status} -> ACCEPTED`,
    );
  }

  const { data: updated, error } = await db
    .from("truck_jobs")
    .update({
      assigned_truck_id: truckId,
      assigned_driver_id: driverId,
      current_status: "ACCEPTED" satisfies TruckJobStatus,
      updated_at: nowIso(),
    })
    .eq("id", jobId)
    .select()
    .single();

  if (error) {
    throw new Error(
      `acceptJob: failed to accept job ${jobId}: ${error.message}`,
    );
  }

  await logEvent(db, jobId, "JOB_ACCEPTED", driverId, {
    truck_id: truckId,
    driver_id: driverId,
  });

  return (updated ?? { ...job, assigned_truck_id: truckId, assigned_driver_id: driverId, current_status: "ACCEPTED" }) as TruckJobRow;
}

/**
 * Move a job to the next status in the strict state machine.
 *
 * @throws when `newStatus` is not the immediate successor of the current one
 */
export async function updateJobStatus(
  jobId: string,
  newStatus: TruckJobStatus,
  metadata: TruckEventMetadata = {},
  actorId = "system",
  options: TruckTrackerOptions = {},
): Promise<TruckJobRow> {
  const db = requireDb(options);

  if (!TRUCK_JOB_STATUSES.includes(newStatus)) {
    throw new Error(`updateJobStatus: unknown status ${String(newStatus)}`);
  }

  const job = await getJob(db, jobId);
  const expected = NEXT_STATUS[job.current_status];

  if (newStatus !== expected) {
    throw new Error(
      `updateJobStatus: invalid transition ${job.current_status} -> ${newStatus}` +
        (expected ? ` (next allowed is ${expected})` : " (job is already DELIVERED)"),
    );
  }

  const { data: updated, error } = await db
    .from("truck_jobs")
    .update({ current_status: newStatus, updated_at: nowIso() })
    .eq("id", jobId)
    .select()
    .single();

  if (error) {
    throw new Error(
      `updateJobStatus: failed to move job ${jobId} to ${newStatus}: ${error.message}`,
    );
  }

  await logEvent(db, jobId, EVENT_TYPE_BY_STATUS[newStatus], actorId, metadata);

  return (updated ?? { ...job, current_status: newStatus }) as TruckJobRow;
}
