/**
 * AI_OUTPUT_TO_CANONICAL_VIEW — accept structured data only.
 * Arbitrary HTML/scripts/UI code and undeclared fields are rejected.
 */

import { randomUUID } from "node:crypto";
import { renderGenericTable } from "./table";
import { REGISTERED_VIEW_TYPES, VIEW_ACTIONS, getTableSchema } from "./schemas";
import { nowIso } from "./host-runtime";
import type { CanonicalViewType, CanonicalViewV1 } from "./types";

const FORBIDDEN = /<\s*(script|iframe|object|embed|link|style)\b|javascript:|on\w+\s*=|<\/?[a-z][\s\S]*>/i;

export function normalizeAiOutputToCanonicalView(input: {
  readonly view_type?: unknown;
  readonly data_schema?: unknown;
  readonly rows?: unknown;
  readonly fields?: unknown;
  readonly html?: unknown;
  readonly layout?: unknown;
  readonly jsx?: unknown;
  readonly script?: unknown;
  readonly presentation?: unknown;
  readonly source_resource_ids?: unknown;
  readonly actions?: unknown;
  readonly sort_field?: unknown;
  readonly sort_direction?: unknown;
  readonly filter_field?: unknown;
  readonly filter_contains?: unknown;
  readonly group_field?: unknown;
}): { ok: true; view: CanonicalViewV1 } | { ok: false; reason_code: string } {
  if (input.html !== undefined || input.layout !== undefined || input.jsx !== undefined || input.script !== undefined || input.presentation !== undefined) {
    return { ok: false, reason_code: "ARBITRARY_AI_PRESENTATION" };
  }
  const blob = JSON.stringify(input);
  if (FORBIDDEN.test(blob)) return { ok: false, reason_code: "ARBITRARY_EXECUTABLE_MARKUP" };

  const view_type = String(input.view_type ?? "SAFE_GENERIC_VIEW") as CanonicalViewType;
  if (!REGISTERED_VIEW_TYPES.includes(view_type)) {
    return {
      ok: true,
      view: fallbackView(["unregistered-view-type"], { note: "SAFE_GENERIC_VIEW", requested: view_type }),
    };
  }
  if (view_type === "GENERIC_TABLE_V1") {
    const schema_id = String(input.data_schema ?? "");
    const schema = getTableSchema(schema_id);
    if (!schema) return { ok: false, reason_code: "UNKNOWN_TABLE_SCHEMA" };
    if (!Array.isArray(input.rows)) return { ok: false, reason_code: "ROWS_REQUIRED" };
    const rendered = renderGenericTable(schema_id, input.rows as Record<string, unknown>[], {
      sort_field: typeof input.sort_field === "string" ? input.sort_field : undefined,
      sort_direction: input.sort_direction === "desc" ? "desc" : "asc",
      filter_field: typeof input.filter_field === "string" ? input.filter_field : undefined,
      filter_contains: typeof input.filter_contains === "string" ? input.filter_contains : undefined,
      group_field: typeof input.group_field === "string" ? input.group_field : undefined,
    });
    if ("ok" in rendered && rendered.ok === false) return { ok: false, reason_code: rendered.reason_code };
    return {
      ok: true,
      view: {
        schema: "CANONICAL_VIEW_V1",
        view_id: `view-${randomUUID()}`,
        view_type,
        view_schema_version: "1",
        source_resource_ids: Array.isArray(input.source_resource_ids) ? input.source_resource_ids.map(String) : [],
        data_schema: schema_id,
        display_schema: "GENERIC_TABLE_V1",
        validation_rules: ["registered_columns_only", "no_dynamic_fields", "no_arbitrary_html"],
        actions_available: [...VIEW_ACTIONS.GENERIC_TABLE_V1],
        authority_state: "DENY",
        evidence_refs: [],
        render_status: "RENDERABLE",
        payload: rendered as Record<string, unknown>,
      },
    };
  }
  const fields = input.fields && typeof input.fields === "object" ? input.fields as Record<string, unknown> : {};
  const textBlob = JSON.stringify(fields);
  if (/\b(EXECUTE|DELETE|APPROVE|SEND|COMMIT)\s*[:=]/i.test(textBlob)) {
    return { ok: false, reason_code: "ACTION_INSTRUCTION_IN_DISPLAY_TEXT" };
  }
  return {
    ok: true,
    view: {
      schema: "CANONICAL_VIEW_V1",
      view_id: `view-${randomUUID()}`,
      view_type,
      view_schema_version: "1",
      source_resource_ids: Array.isArray(input.source_resource_ids) ? input.source_resource_ids.map(String) : [],
      data_schema: String(input.data_schema ?? view_type),
      display_schema: view_type,
      validation_rules: ["registered_view_type", "no_arbitrary_html"],
      actions_available: [...VIEW_ACTIONS[view_type]],
      authority_state: "DENY",
      evidence_refs: [],
      render_status: "RENDERABLE",
      payload: { fields, rendered_at: nowIso() },
    },
  };
}

function fallbackView(source_resource_ids: readonly string[], payload: Record<string, unknown>): CanonicalViewV1 {
  return {
    schema: "CANONICAL_VIEW_V1",
    view_id: `view-${randomUUID()}`,
    view_type: "SAFE_GENERIC_VIEW",
    view_schema_version: "1",
    source_resource_ids,
    data_schema: "SAFE_GENERIC_VIEW",
    display_schema: "SAFE_GENERIC_VIEW",
    validation_rules: ["unknown_types_use_safe_generic"],
    actions_available: ["READ"],
    authority_state: "DENY",
    evidence_refs: [],
    render_status: "SAFE_FALLBACK",
    payload,
  };
}

export function renderCanonicalView(input: {
  readonly view_type: CanonicalViewType;
  readonly data_schema?: string;
  readonly rows?: readonly Record<string, unknown>[];
  readonly fields?: Record<string, unknown>;
  readonly source_resource_ids?: readonly string[];
  readonly actions_available?: readonly string[];
  readonly authority_state?: CanonicalViewV1["authority_state"];
  readonly evidence_refs?: readonly string[];
  readonly sort_field?: string;
  readonly filter_field?: string;
  readonly filter_contains?: string;
}): CanonicalViewV1 {
  const normalized = normalizeAiOutputToCanonicalView({
    view_type: input.view_type,
    data_schema: input.data_schema,
    rows: input.rows,
    fields: input.fields,
    source_resource_ids: input.source_resource_ids,
    sort_field: input.sort_field,
    filter_field: input.filter_field,
    filter_contains: input.filter_contains,
  });
  if (!normalized.ok) {
    return fallbackView(input.source_resource_ids ?? [], { rejected: normalized.reason_code });
  }
  return {
    ...normalized.view,
    actions_available: input.actions_available ?? normalized.view.actions_available,
    authority_state: input.authority_state ?? "DENY",
    evidence_refs: input.evidence_refs ?? [],
  };
}
