import { readFileSync } from "node:fs";
import { join } from "./host-runtime";
import { repoRoot } from "./host-runtime";
import { INVENTORY_TABLE_SCHEMA } from "./schemas";
import { renderGenericTable, type TableQuery } from "./table";

export function loadInventoryFixtureRows(): readonly Record<string, unknown>[] {
  const path = join(repoRoot(), "control/canonical-view/fixtures/inventory-table.json");
  const parsed = JSON.parse(readFileSync(path, "utf8")) as { rows: Record<string, unknown>[] };
  return parsed.rows;
}

export function renderInventoryTable(query: TableQuery = {}) {
  return renderGenericTable(INVENTORY_TABLE_SCHEMA.schema_id, loadInventoryFixtureRows(), query);
}
