import { readFileSync } from "node:fs";
import { strict as assert } from "node:assert";

const adapter = readFileSync(new URL("../adapters/postgres-store.ts", import.meta.url), "utf8");
const migration = readFileSync(new URL("../migrations/0001_create_software_registry_schema.sql", import.meta.url), "utf8");

const executableSql = (adapter.match(/`[\s\S]*?`/g) ?? []).join("\n");
for (const oldColumn of ["related_resource_id", "related_capability_id", " hash,", " hash)"]) {
  assert(!executableSql.includes(oldColumn), `legacy executable column remains: ${oldColumn}`);
}
for (const required of ["exact_fingerprint", "content_hash", "capability_id", "resource_id", "request_id", "software_registry.resources", "software_registry.capabilities", "software_registry.evidence"]) {
  assert(adapter.includes(required), `adapter missing canonical reference: ${required}`);
  assert(migration.includes(required), `migration missing canonical reference: ${required}`);
}
assert(!adapter.includes("on conflict (semantic_fingerprint)"), "semantic fingerprint must not be a unique upsert key");
assert(adapter.includes("begin") || adapter.includes('BEGIN'), "transaction path missing");
console.log("PASS: Postgres adapter SQL references canonical software_registry contract");
