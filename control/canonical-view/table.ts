/**
 * GENERIC_TABLE_V1 renderer. Column order and types come from the registered schema only.
 */

import { getTableSchema } from "./schemas";
import type { GenericTableSchema } from "./types";

export interface TableQuery {
  readonly sort_field?: string;
  readonly sort_direction?: "asc" | "desc";
  readonly filter_field?: string;
  readonly filter_contains?: string;
  readonly group_field?: string;
}

export interface RenderedTableV1 {
  readonly schema_id: string;
  readonly columns: GenericTableSchema["columns"];
  readonly rows: readonly Record<string, unknown>[];
  readonly row_count: number;
  readonly totals: Readonly<Record<string, number>>;
  readonly groups: readonly { readonly key: string; readonly count: number }[] | null;
  readonly validation_state: "VALID" | "REJECTED_UNDECLARED_FIELDS";
  readonly source_schema: "REGISTERED";
}

function projectRow(schema: GenericTableSchema, row: Record<string, unknown>): Record<string, unknown> | { error: "UNDECLARED_FIELDS" } {
  const allowed = new Set(schema.columns.map((col) => col.key));
  const extra = Object.keys(row).filter((key) => !allowed.has(key));
  if (extra.length > 0 && !schema.allow_dynamic_fields) return { error: "UNDECLARED_FIELDS" };
  const out: Record<string, unknown> = {};
  const ordered = [...schema.columns].sort((a, b) => a.order - b.order);
  for (const col of ordered) {
    if (Object.prototype.hasOwnProperty.call(row, col.key)) out[col.key] = row[col.key];
  }
  return out;
}

export function renderGenericTable(
  schema_id: string,
  rows: readonly Record<string, unknown>[],
  query: TableQuery = {},
): RenderedTableV1 | { ok: false; reason_code: string } {
  const schema = getTableSchema(schema_id);
  if (!schema) return { ok: false, reason_code: "UNKNOWN_TABLE_SCHEMA" };
  const projected: Record<string, unknown>[] = [];
  for (const row of rows) {
    const next = projectRow(schema, row);
    if ("error" in next) return { ok: false, reason_code: "REJECTED_UNDECLARED_FIELDS" };
    projected.push(next);
  }
  let working = projected;
  if (query.filter_field && query.filter_contains !== undefined) {
    if (!schema.filterable_fields.includes(query.filter_field)) return { ok: false, reason_code: "FILTER_FIELD_NOT_IN_SCHEMA" };
    working = working.filter((row) => String(row[query.filter_field!] ?? "").includes(query.filter_contains!));
  }
  if (query.sort_field) {
    if (!schema.sortable_fields.includes(query.sort_field)) return { ok: false, reason_code: "SORT_FIELD_NOT_IN_SCHEMA" };
    const dir = query.sort_direction === "desc" ? -1 : 1;
    working = [...working].sort((a, b) => String(a[query.sort_field!] ?? "").localeCompare(String(b[query.sort_field!] ?? "")) * dir);
  }
  const totals: Record<string, number> = {};
  for (const field of schema.total_fields) {
    totals[field] = working.reduce((sum, row) => sum + (typeof row[field] === "number" ? row[field] as number : 0), 0);
  }
  let groups: { key: string; count: number }[] | null = null;
  if (query.group_field) {
    if (!schema.groupable_fields.includes(query.group_field)) return { ok: false, reason_code: "GROUP_FIELD_NOT_IN_SCHEMA" };
    const counts = new Map<string, number>();
    for (const row of working) {
      const key = String(row[query.group_field] ?? "");
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    groups = [...counts.entries()].map(([key, count]) => ({ key, count }));
  }
  return {
    schema_id: schema.schema_id,
    columns: [...schema.columns].sort((a, b) => a.order - b.order),
    rows: working,
    row_count: working.length,
    totals,
    groups,
    validation_state: "VALID",
    source_schema: "REGISTERED",
  };
}
