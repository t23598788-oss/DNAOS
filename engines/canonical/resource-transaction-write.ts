/**
 * Canonical resource-transaction write model (machinery/telematics hours —
 * BATCH 19/20/24).
 *
 * THE one and only path that writes `public.resource_transactions`.
 * Producers no longer insert anything: they forward raw source facts to the
 * internal route (app/api/internal/connect/resource-transaction), which calls
 * this writer — same shape as every other canonical writer
 * (recordCanonicalAudit on success, fail-closed validation before any write).
 *
 * Money authority (ไม่มี fallback — ห้าม hardcode):
 *   · fuel price  → app_configs["fuel-price"]   (written by fuel-price-sync cron)
 *   · machinery   → app_configs["machinery_rates"] = { base_rate_per_hour,
 *                   fuel_consumption_lph, markup_margin } (owner-set)
 * Missing/invalid config => CONFIG_AUTHORITY_MISSING, ZERO rows written.
 * unit_cost/unit_price/gross_cost are computed HERE from those authorities —
 * the caller supplies raw source facts only (duration/timestamps), never money.
 *
 * Idempotency: `source_event_id` is unique — a duplicate event returns the
 * existing row (`duplicate: true`) and never inserts twice.
 */
import { supabaseAdmin, jobExists } from "@/services/supabase/queries";
import { recordCanonicalAudit } from "@/engines/canonical/audit";

/** Raw source facts — money fields deliberately absent (computed by the writer). */
export interface ResourceTransactionInput {
  /** provider identity (e.g. "telematics:equipment") — a value, never a branch */
  source: string;
  /** deterministic idempotency key of the SOURCE event (never a caller guess) */
  source_event_id: string;
  /** equipment_assets.id — only when evidenced; null when the email names no registered asset */
  resource_id: string | null;
  /** e.g. "รถขุด 3 ตัน" — a fact parsed from the source payload (ยี่ห้อ/รุ่นไม่ผูก architecture) */
  resource_label: string;
  /** must resolve to a real public.jobs row — otherwise reject */
  job_id: string;
  /** ISO timestamp of Start Time from the source — must be <= received_at */
  started_at: string;
  /** hours, > 0, finite */
  duration_hours: number;
  /** sha256 of the raw source fields — re-verifiable evidence */
  evidence_ref: string;
  /** webhook receipt time (ISO) */
  received_at: string;
  /** who is writing (internal bridge actor) */
  actor: string;
}

export interface ResourceTransactionResult {
  resource_transaction_id: string;
  duplicate: boolean;
  unit_cost: number;
  unit_price: number;
  fuel_price_reference: number;
  gross_cost: number;
}

export interface MachineryRatesConfig {
  base_rate_per_hour: number;
  fuel_consumption_lph: number;
  markup_margin: number;
}

/** Minimal db surface this writer needs — tests inject an in-memory test double. */
export interface ResourceTransactionDeps {
  db: {
    from(table: string): {
      select(columns?: string): {
        eq(column: string, value: string): {
          maybeSingle(): Promise<{ data: Record<string, unknown> | null; error: { message: string } | null }>;
          limit(n: number): Promise<{ data: Record<string, unknown>[] | null; error: { message: string } | null }>;
        };
      };
      insert(row: Record<string, unknown>): {
        select(columns?: string): {
          single(): Promise<{ data: Record<string, unknown> | null; error: { message: string } | null }>;
        };
      };
    };
  };
  audit: typeof recordCanonicalAudit;
  nowIso: () => string;
}

export function defaultDeps(): ResourceTransactionDeps {
  return {
    db: supabaseAdmin() as unknown as ResourceTransactionDeps["db"],
    audit: recordCanonicalAudit,
    nowIso: () => new Date().toISOString(),
  };
}
const round2 = (v: number): number => Math.round(v * 100) / 100;

function parseIso(value: string, field: string): number {
  const t = Date.parse(value);
  if (Number.isNaN(t)) throw new Error(`RESOURCE_TRANSACTION_INVALID_${field}: ${value} ไม่ใช่ timestamp ที่แปลงได้`);
  return t;
}

/** Read both money authorities. Missing/invalid => throw (fail-closed, no defaults). */
export async function readConfigAuthorities(
  db: ResourceTransactionDeps["db"],
): Promise<{ fuelPrice: number; rates: MachineryRatesConfig }> {
  const { data: rows, error } = await db.from("app_configs").select("title, data").eq("title", "fuel-price").limit(1);
  if (error) throw new Error(`CONFIG_AUTHORITY_READ_FAILED: ${error.message}`);
  const fuelPrice = rows && rows[0] ? Number(rows[0].data) : Number.NaN;
  if (!Number.isFinite(fuelPrice) || fuelPrice <= 0) {
    throw new Error("CONFIG_AUTHORITY_MISSING: app_configs[fuel-price] ไม่มีค่าที่ใช้ได้ — ห้าม fallback ราคา hardcode");
  }

  const ratesResult = await db.from("app_configs").select("title, data").eq("title", "machinery_rates").limit(1);
  if (ratesResult.error) throw new Error(`CONFIG_AUTHORITY_READ_FAILED: ${ratesResult.error.message}`);
  let raw: unknown = ratesResult.data && ratesResult.data[0] ? ratesResult.data[0].data : null;
  if (typeof raw === "string") {
    try { raw = JSON.parse(raw); } catch { raw = null; }
  }
  const rates = (raw ?? {}) as Partial<MachineryRatesConfig>;
  const base = Number(rates.base_rate_per_hour);
  const consumption = Number(rates.fuel_consumption_lph);
  const markup = Number(rates.markup_margin);
  if (!Number.isFinite(base) || base <= 0 || !Number.isFinite(consumption) || consumption <= 0 || !Number.isFinite(markup) || markup < 0) {
    throw new Error("CONFIG_AUTHORITY_MISSING: app_configs[machinery_rates] ยังไม่มีค่าที่ตั้งโดย owner — ห้าม fallback 600/8.5/25%");
  }
  return { fuelPrice, rates: { base_rate_per_hour: base, fuel_consumption_lph: consumption, markup_margin: markup } };
}

export async function recordResourceTransaction(
  input: ResourceTransactionInput,
  deps: ResourceTransactionDeps = defaultDeps(),
): Promise<ResourceTransactionResult> {
  if (!input.source?.trim()) throw new Error("RESOURCE_TRANSACTION_SOURCE_REQUIRED");
  if (!input.source_event_id?.trim()) throw new Error("RESOURCE_TRANSACTION_SOURCE_EVENT_ID_REQUIRED");
  if (!input.resource_label?.trim()) throw new Error("RESOURCE_TRANSACTION_RESOURCE_LABEL_REQUIRED");
  if (!input.evidence_ref?.trim()) throw new Error("RESOURCE_TRANSACTION_EVIDENCE_REQUIRED");
  if (!input.actor?.trim()) throw new Error("RESOURCE_TRANSACTION_ACTOR_REQUIRED");
  if (!input.job_id?.trim()) throw new Error("RESOURCE_TRANSACTION_JOB_ID_REQUIRED");
  if (!Number.isFinite(input.duration_hours) || input.duration_hours <= 0) {
    throw new Error(`RESOURCE_TRANSACTION_INVALID_DURATION: duration_hours ต้องมากกว่า 0 (ได้ ${input.duration_hours})`);
  }
  const startedAt = parseIso(input.started_at, "STARTED_AT");
  const receivedAt = parseIso(input.received_at, "RECEIVED_AT");
  if (startedAt > receivedAt) {
    throw new Error(`RESOURCE_TRANSACTION_INVALID_TIME: started_at (${input.started_at}) ห้ามมากกว่า received_at (${input.received_at})`);
  }
  let jobFound = false;
  try {
    jobFound = await jobExists(deps.db, input.job_id);
  } catch (e) {
    throw new Error(`RESOURCE_TRANSACTION_JOB_LOOKUP_FAILED: ${(e as Error).message}`);
  }
  if (!jobFound) throw new Error(`RESOURCE_TRANSACTION_JOB_NOT_FOUND: ${input.job_id} ไม่มีจริงใน jobs — reject ไม่เดา`);

  // Idempotency — same source event never inserts twice.
  const existing = await deps.db.from("resource_transactions").select("id, unit_cost, unit_price, meta").eq("source_event_id", input.source_event_id).limit(1);
  if (existing.error) throw new Error(`RESOURCE_TRANSACTION_IDEMPOTENCY_CHECK_FAILED: ${existing.error.message}`);
  if (existing.data && existing.data.length > 0) {
    const row = existing.data[0];
    const meta = (row.meta ?? {}) as Record<string, unknown>;
    return {
      resource_transaction_id: String(row.id),
      duplicate: true,
      unit_cost: Number(row.unit_cost ?? 0),
      unit_price: Number(row.unit_price ?? 0),
      fuel_price_reference: Number(meta.fuel_price_reference ?? 0),
      gross_cost: Number(meta.gross_cost ?? 0),
    };
  }

  const { fuelPrice, rates } = await readConfigAuthorities(deps.db);

  // Money computed only from the authorities above (finance canonical: 2dp).
  const unitCost = round2(rates.base_rate_per_hour + rates.fuel_consumption_lph * fuelPrice);
  const markup = round2(unitCost * rates.markup_margin);
  const unitPrice = round2(unitCost + markup);
  const grossCost = round2(input.duration_hours * unitCost);
  const now = deps.nowIso();

  const meta = {
    source: input.source,
    source_event_id: input.source_event_id,
    evidence_ref: input.evidence_ref,
    started_at: input.started_at,
    received_at: input.received_at,
    fuel_price_reference: fuelPrice,
    machinery_rates: rates,
    actor: input.actor,
  };

  const { data: inserted, error: insertError } = await deps.db
    .from("resource_transactions")
    .insert({
      job_id: input.job_id,
      partner_id: null,
      resource_type: "machinery_hours",
      resource_label: input.resource_label,
      quantity: input.duration_hours,
      unit: "ชั่วโมง",
      unit_cost: unitCost,
      unit_price: unitPrice,
      markup_margin: markup,
      total_cost: grossCost,
      total_price: round2(input.duration_hours * unitPrice),
      note: "อีเมลอัตโนมัติจากระบบ (" + input.source + ") — source_event_id=" + input.source_event_id,
      meta,
      source_event_id: input.source_event_id,
      created_at: now,
      updated_at: now,
    })
    .select("id")
    .single();
  if (insertError) {
    if (/duplicate key|23505/i.test(insertError.message)) {
      const race = await deps.db.from("resource_transactions").select("id").eq("source_event_id", input.source_event_id).limit(1);
      if (race.data && race.data.length > 0) {
        return { resource_transaction_id: String(race.data[0].id), duplicate: true, unit_cost: unitCost, unit_price: unitPrice, fuel_price_reference: fuelPrice, gross_cost: grossCost };
      }
    }
    throw new Error("RESOURCE_TRANSACTION_INSERT_FAILED: " + insertError.message);
  }

  const id = String(inserted?.id ?? "");
  await deps.audit({
    action: "transaction.created",
    entity_type: "resource_transaction",
    entity_id: id,
    actor: input.actor,
    new_value: {
      source: input.source,
      source_event_id: input.source_event_id,
      resource_label: input.resource_label,
      job_id: input.job_id,
      duration_hours: input.duration_hours,
      unit_cost: unitCost,
      unit_price: unitPrice,
      gross_cost: grossCost,
    },
    evidence: { evidence_ref: input.evidence_ref, fuel_price_reference: fuelPrice, started_at: input.started_at, received_at: input.received_at },
  });

  return { resource_transaction_id: id, duplicate: false, unit_cost: unitCost, unit_price: unitPrice, fuel_price_reference: fuelPrice, gross_cost: grossCost };
}
