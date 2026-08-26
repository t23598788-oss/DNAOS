/**
 * หน้าที่: the deterministic gate on the model's output for
 * `control/owner-command-semantics/` (Owner, 2026-08-26).
 *
 * The model is asked for text; this file is what makes sure text is all it can
 * deliver. It rejects any field the schema does not name, and — the part that
 * matters — it rejects any value SHAPED LIKE AN ID (`capability-<uuid>`,
 * `resource-<uuid>`, `task-<uuid>`, `cmd_...`). A model that tries to answer
 * "which resource is this" instead of "what did the Owner call it" fails here,
 * whatever the prompt said.
 *
 * Input: the raw text the sandboxed model printed.
 * Output: `AiValidation` — a typed `AiSemanticInterpretation` or the reasons it
 * was refused.
 * Dependency ที่อนุญาต: ./types.ts.
 * สิ่งที่ห้ามแตะ: ห้ามผ่อนกฎ id-shape เพื่อให้ผลลัพธ์ผ่าน — a model naming an id
 * is exactly the failure this layer exists to prevent.
 */

import type { AiSemanticInterpretation } from "./types";

/** Real id shapes used in this repo — see control/command-router/capability-registry.ts, software/registry-database/, control/agent-gateway/. */
const ID_SHAPED = /\b(capability|resource|task|identity|account|workspace)-[0-9a-f]{8}-|^cmd_[a-z0-9]+$/i;

const REQUIRED_STRING_FIELDS = ["raw_text", "intent", "action"] as const;
const NULLABLE_STRING_FIELDS = ["target_text", "resource_reference", "capability_reference", "continuation_reference", "previous_context_reference", "requested_result"] as const;
const STRING_ARRAY_FIELDS = ["entity_mentions", "constraints", "ambiguities"] as const;

const ALLOWED = new Set<string>([...REQUIRED_STRING_FIELDS, ...NULLABLE_STRING_FIELDS, ...STRING_ARRAY_FIELDS, "parameters"]);

export type AiValidation =
  | { ok: true; interpretation: AiSemanticInterpretation }
  | { ok: false; reasons: string[] };

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export function validateAiInterpretation(rawOutput: string, ownerText: string): AiValidation {
  const reasons: string[] = [];
  const trimmed = rawOutput.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    return { ok: false, reasons: [`model output is not valid JSON: ${error instanceof Error ? error.message : String(error)}`] };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { ok: false, reasons: ["model output is not a JSON object"] };
  const body = parsed as Record<string, unknown>;

  for (const key of Object.keys(body)) if (!ALLOWED.has(key)) reasons.push(`unexpected field: ${key}`);

  for (const field of REQUIRED_STRING_FIELDS) {
    if (typeof body[field] !== "string" || (body[field] as string).length === 0) reasons.push(`${field} must be a non-empty string`);
  }
  for (const field of NULLABLE_STRING_FIELDS) {
    if (body[field] !== null && typeof body[field] !== "string") reasons.push(`${field} must be a string or null`);
  }
  for (const field of STRING_ARRAY_FIELDS) {
    if (!isStringArray(body[field])) reasons.push(`${field} must be an array of strings`);
  }
  if (!body.parameters || typeof body.parameters !== "object" || Array.isArray(body.parameters)) {
    reasons.push("parameters must be an object");
  } else {
    for (const [key, value] of Object.entries(body.parameters as Record<string, unknown>)) {
      if (typeof value !== "string") reasons.push(`parameters.${key} must be a string`);
    }
  }

  // The Owner's own words are not the model's to edit.
  if (body.raw_text !== ownerText) reasons.push("raw_text must be the Owner's text, unchanged");

  // The id boundary.
  const idOffenders: string[] = [];
  const scan = (label: string, value: unknown): void => {
    if (typeof value === "string" && ID_SHAPED.test(value)) idOffenders.push(`${label}="${value}"`);
  };
  for (const field of NULLABLE_STRING_FIELDS) scan(field, body[field]);
  for (const field of STRING_ARRAY_FIELDS) if (isStringArray(body[field])) (body[field] as string[]).forEach((v, i) => scan(`${field}[${i}]`, v));
  if (body.parameters && typeof body.parameters === "object") {
    for (const [key, value] of Object.entries(body.parameters as Record<string, unknown>)) scan(`parameters.${key}`, value);
  }
  if (idOffenders.length > 0) {
    reasons.push(`the model must name what the Owner said, never an id — found: ${idOffenders.join(", ")}`);
  }

  if (reasons.length > 0) return { ok: false, reasons };

  return {
    ok: true,
    interpretation: {
      raw_text: body.raw_text as string,
      intent: body.intent as string,
      action: body.action as string,
      target_text: (body.target_text as string | null) ?? null,
      entity_mentions: body.entity_mentions as string[],
      resource_reference: (body.resource_reference as string | null) ?? null,
      capability_reference: (body.capability_reference as string | null) ?? null,
      parameters: body.parameters as Record<string, string>,
      constraints: body.constraints as string[],
      continuation_reference: (body.continuation_reference as string | null) ?? null,
      previous_context_reference: (body.previous_context_reference as string | null) ?? null,
      requested_result: (body.requested_result as string | null) ?? null,
      ambiguities: body.ambiguities as string[],
    },
  };
}
