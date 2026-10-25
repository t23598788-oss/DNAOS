/**
 * DNA OS — Unified Business Schema (2026-10-20).
 *
 * Every AI result that feeds a business API is checked here BEFORE the caller
 * uses it. The AI never decides business truth: a value that fails schema or
 * policy is BLOCKED with an explicit error, and the caller must not proceed.
 *
 * Mirror: supabase/functions/_shared/ai/businessSchema.ts (Deno). Both runtimes
 * are checked against the same fixtures by scripts/unified-ai-contract-test.ts,
 * so the rules cannot drift silently.
 */

export const AI_SCHEMA_INVALID = "AI_SCHEMA_INVALID";
export const AI_POLICY_BLOCKED = "AI_POLICY_BLOCKED";

export type BusinessValidation<T> =
  | { ok: true; value: T }
  | { ok: false; code: typeof AI_SCHEMA_INVALID | typeof AI_POLICY_BLOCKED; errors: string[] };

export const EVENT_TYPES = [
  "ขอราคา", "สั่งซื้อ", "แจ้งชำระเงิน", "ส่งพิกัด", "ส่งรูป", "ส่งเอกสาร",
  "เปลี่ยนปลายทาง", "ยกเลิกงาน", "สอบถามทั่วไป", "อื่นๆ",
] as const;
export const EVENT_STATUSES = ["quotation_pending", "new"] as const;
export const VEHICLE_TYPES = ["trailer", "10_wheeler", "6_wheeler"] as const;

/** Thailand service-area box used by the geocode policy gate (approximate). */
export const SERVICE_AREA = { latMin: 5.5, latMax: 20.5, lngMin: 97.3, lngMax: 105.7 } as const;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isNullableString = (v: unknown, max = 300): boolean => v === null || (typeof v === "string" && v.length <= max);
const isNullableNumber = (v: unknown): boolean => v === null || (typeof v === "number" && Number.isFinite(v));
const PHONE = /^0\d{8,9}$/;

/** Event extraction used by engines/events/event-builder.ts (text.entity_extract). */
export interface ValidatedEventExtract {
  event_type: string | null;
  material_text: string | null;
  quantity: number | null;
  quantity_unit: string | null;
  destination: string | null;
  schedule_text: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  status: string;
  confidence: number;
}

export function validateEventExtract(input: unknown): BusinessValidation<ValidatedEventExtract> {
  const errors: string[] = [];
  if (!isObj(input)) return { ok: false, code: AI_SCHEMA_INVALID, errors: ["output is not a JSON object"] };
  const s = input;
  if (s.event_type !== null && !(EVENT_TYPES as readonly string[]).includes(s.event_type as string)) errors.push("event_type not in allowed set");
  for (const k of ["material_text", "quantity_unit", "destination", "schedule_text", "contact_name"]) {
    if (!isNullableString(s[k])) errors.push(`${k} must be string or null (<=300 chars)`);
  }
  if (!isNullableNumber(s.quantity)) errors.push("quantity must be finite number or null");
  if (typeof s.quantity === "number" && s.quantity < 0) errors.push("quantity must not be negative");
  if (s.contact_phone !== null && !(typeof s.contact_phone === "string" && PHONE.test(s.contact_phone.replace(/[\s-]/g, "")))) {
    errors.push("contact_phone must be a Thai 9-10 digit number starting with 0, or null");
  }
  if (!(EVENT_STATUSES as readonly string[]).includes(s.status as string)) errors.push("status not in allowed set");
  if (typeof s.confidence !== "number" || !Number.isFinite(s.confidence) || s.confidence < 0 || s.confidence > 1) errors.push("confidence must be a number in [0,1]");
  if (errors.length) return { ok: false, code: AI_SCHEMA_INVALID, errors };
  return {
    ok: true,
    value: {
      event_type: (s.event_type as string | null) ?? null,
      material_text: (s.material_text as string | null) ?? null,
      quantity: (s.quantity as number | null) ?? null,
      quantity_unit: (s.quantity_unit as string | null) ?? null,
      destination: (s.destination as string | null) ?? null,
      schedule_text: (s.schedule_text as string | null) ?? null,
      contact_name: (s.contact_name as string | null) ?? null,
      contact_phone: s.contact_phone === null ? null : (s.contact_phone as string).replace(/[\s-]/g, ""),
      status: s.status as string,
      confidence: s.confidence as number,
    },
  };
}

/** Entity extraction used by line-webhook-v2/helpers.ts (text.entity_extract, Deno). */
export interface ValidatedEntities {
  material: string | null;
  quantity: number | null;
  contact_name: string | null;
  contact_phone: string | null;
  project_name: string | null;
  destination_text: string | null;
  vehicle_type: string | null;
  concrete_type: string | null;
}

export function validateEntities(input: unknown): BusinessValidation<ValidatedEntities> {
  const errors: string[] = [];
  if (!isObj(input)) return { ok: false, code: AI_SCHEMA_INVALID, errors: ["output is not a JSON object"] };
  const s = input;
  for (const k of ["material", "contact_name", "project_name", "destination_text", "concrete_type"]) {
    if (!isNullableString(s[k])) errors.push(`${k} must be string or null`);
  }
  if (!isNullableNumber(s.quantity)) errors.push("quantity must be finite number or null");
  if (typeof s.quantity === "number" && s.quantity < 0) errors.push("quantity must not be negative");
  if (s.contact_phone !== null && s.contact_phone !== undefined && !(typeof s.contact_phone === "string" && PHONE.test(String(s.contact_phone).replace(/[\s-]/g, "")))) {
    errors.push("contact_phone must be a Thai 9-10 digit number starting with 0, or null");
  }
  if (s.vehicle_type !== null && s.vehicle_type !== undefined && !(VEHICLE_TYPES as readonly string[]).includes(s.vehicle_type as string)) {
    errors.push("vehicle_type not in allowed set");
  }
  if (errors.length) return { ok: false, code: AI_SCHEMA_INVALID, errors };
  return {
    ok: true,
    value: {
      material: (s.material as string | null) ?? null,
      quantity: (s.quantity as number | null) ?? null,
      contact_name: (s.contact_name as string | null) ?? null,
      contact_phone: s.contact_phone ? String(s.contact_phone).replace(/[\s-]/g, "") : null,
      project_name: (s.project_name as string | null) ?? null,
      destination_text: (s.destination_text as string | null) ?? null,
      vehicle_type: (s.vehicle_type as string | null) ?? null,
      concrete_type: (s.concrete_type as string | null) ?? null,
    },
  };
}

/** Geocode used by line-webhook-v2/helpers.ts (location.geocode). */
export interface ValidatedCoordinates { lat: number; lng: number }

export function validateGeocode(input: unknown): BusinessValidation<ValidatedCoordinates | null> {
  if (input === null) return { ok: true, value: null };
  if (!isObj(input)) return { ok: false, code: AI_SCHEMA_INVALID, errors: ["output is not a JSON object"] };
  const { lat, lng } = input;
  if (typeof lat !== "number" || typeof lng !== "number" || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { ok: false, code: AI_SCHEMA_INVALID, errors: ["lat and lng must be finite numbers"] };
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return { ok: false, code: AI_SCHEMA_INVALID, errors: ["coordinates out of range"] };
  }
  // Policy gate: a coordinate outside the service area is a wrong answer for a
  // delivery business, never a valid location to act on.
  if (lat < SERVICE_AREA.latMin || lat > SERVICE_AREA.latMax || lng < SERVICE_AREA.lngMin || lng > SERVICE_AREA.lngMax) {
    return { ok: false, code: AI_POLICY_BLOCKED, errors: ["coordinates outside service area"] };
  }
  return { ok: true, value: { lat, lng } };
}
