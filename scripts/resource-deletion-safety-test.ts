/** Resource deletion safety contract: static proof, with no database mutation. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const migration = read("supabase/migrations/20261014000001_atomic_pit_resource_deactivation.sql").replace(/^[ \t]*--.*$/gm, "").replace(/\s+/g, " ").toLowerCase();
const route = read("app/api/admin/pits/[pitId]/route.ts").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

assert.match(migration, /create table if not exists public\.pit_resource_operations \( operation_id uuid primary key/, "operation_id must be database-unique");
assert.doesNotMatch(migration, /pit_profile_id uuid not null references public\.pit_profiles/, "operation claim must not take an FK lock before the target FOR UPDATE lock");
assert.match(migration, /insert into public\.pit_resource_operations[\s\S]*?on conflict \(operation_id\) do nothing/, "operation claim must be atomic");
assert.match(migration, /for update/, "transaction must lock rows");
assert.match(migration, /lock table public\.jobs in share row exclusive mode/, "un-FK jobs references must be locked during deactivation");
assert.match(migration, /update public\.pit_materials[\s\S]*?update public\.pit_profiles/, "materials archive must precede pit deactivation in one SQL function");
assert.match(migration, /deactivation_preflight_authorized[\s\S]*?deactivated/, "preflight and final audit must be inside the transaction");
assert.match(migration, /security definer[\s\S]*?set search_path = public/, "RPC must have definer/search-path hardening");
assert.match(migration, /revoke all on function public\.deactivate_pit_resource[\s\S]*?grant execute on function public\.deactivate_pit_resource/, "RPC execution must be service-role scoped");
assert.match(route, /db\.rpc\("deactivate_pit_resource"/, "canonical route must use the atomic RPC");
assert.doesNotMatch(route, /alreadyCompleted\(/, "audit_logs must not be replay protection");
assert.doesNotMatch(route, /\.from\("pit_materials"\)\.update\(/, "route must not directly archive material links");
assert.doesNotMatch(route, /\.from\("pit_profiles"\)\.delete\(/, "route must not directly permanently delete pits");
assert.match(route, /permanent_delete_allowed: false/, "permanent delete must fail closed without jobs FK protection");

console.log("resource-deletion-safety-test: PASS (structural contract; no database mutation)");
console.log("LOCAL_DB_MUTATION: NOT_EXECUTED (no explicitly verified isolated database was supplied)");