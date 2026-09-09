/**
 * Registered view and table schemas. AI cannot add columns or invent view types.
 */

import type { CanonicalViewType, GenericTableSchema } from "./types";

export const REGISTERED_VIEW_TYPES: readonly CanonicalViewType[] = [
  "GENERIC_TABLE_V1", "DOCUMENT_VIEW_V1", "PDF_VIEW_V1", "IMAGE_VIEW_V1", "FILE_LIST_V1",
  "EMAIL_VIEW_V1", "MESSAGE_VIEW_V1", "CALENDAR_VIEW_V1", "CONTACT_VIEW_V1",
  "ACTIVITY_VIEW_V1", "TRANSFER_VIEW_V1", "APP_RESOURCE_VIEW_V1", "SAFE_GENERIC_VIEW",
];

export const INVENTORY_TABLE_SCHEMA: GenericTableSchema = {
  schema_id: "fixture.inventory_table.v1",
  schema: "GENERIC_TABLE_V1",
  allow_dynamic_fields: false,
  row_id_field: "row_id",
  sortable_fields: ["sku", "name", "qty", "unit_price"],
  filterable_fields: ["sku", "name", "category"],
  groupable_fields: ["category"],
  total_fields: ["qty", "line_total"],
  export_mapping: { sku: "SKU", name: "Name", qty: "Quantity", unit_price: "UnitPrice", line_total: "LineTotal" },
  columns: [
    { key: "row_id", label: "ID", type: "id", order: 0 },
    { key: "sku", label: "SKU", type: "text", order: 1 },
    { key: "name", label: "Name", type: "text", order: 2 },
    { key: "category", label: "Category", type: "text", order: 3 },
    { key: "qty", label: "Qty", type: "number", order: 4, aggregatable: true },
    { key: "unit_price", label: "Unit price", type: "number", order: 5 },
    { key: "line_total", label: "Line total", type: "number", order: 6, aggregatable: true },
  ],
};

export const TABLE_SCHEMAS: Readonly<Record<string, GenericTableSchema>> = {
  [INVENTORY_TABLE_SCHEMA.schema_id]: INVENTORY_TABLE_SCHEMA,
};

export const VIEW_ACTIONS: Readonly<Record<CanonicalViewType, readonly string[]>> = {
  GENERIC_TABLE_V1: ["READ", "SEARCH", "EXPORT"],
  DOCUMENT_VIEW_V1: ["READ", "SUMMARIZE", "EXTRACT"],
  PDF_VIEW_V1: ["READ", "EXTRACT"],
  IMAGE_VIEW_V1: ["READ"],
  FILE_LIST_V1: ["SEARCH", "READ", "CREATE", "WRITE", "COPY", "MOVE", "RENAME", "DELETE", "ARCHIVE", "EXTRACT", "COMPARE", "SUMMARIZE"],
  EMAIL_VIEW_V1: ["READ", "REPLY", "FORWARD", "DOWNLOAD_ATTACHMENT", "SEND"],
  MESSAGE_VIEW_V1: ["READ"],
  CALENDAR_VIEW_V1: ["READ", "SEARCH"],
  CONTACT_VIEW_V1: ["READ", "SEARCH"],
  ACTIVITY_VIEW_V1: ["READ"],
  TRANSFER_VIEW_V1: ["READ"],
  APP_RESOURCE_VIEW_V1: ["READ", "SEARCH", "COMMIT", "PUSH"],
  SAFE_GENERIC_VIEW: ["READ"],
};

export function getTableSchema(schema_id: string): GenericTableSchema | null {
  return TABLE_SCHEMAS[schema_id] ?? null;
}
