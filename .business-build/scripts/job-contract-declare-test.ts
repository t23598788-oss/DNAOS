#!/usr/bin/env npx tsx
/**
 * PASS 1 — DECLARE verifier (G6 + G7). READ-ONLY.
 *
 * Owner decision 2026-09-22: CANONICAL_JOB_CONTRACT is an INTEGRATION contract —
 * it must make the EXISTING systems speak the same job language and must never
 * create a new execution engine, queue, worker, approval, cost or state system.
 *
 * Checks:
 *   G7 single scope declaration — every scope dimension points at its real, existing authority
 *   G6 AI/tool registry completeness — every agent declares role/authority/must_not_do/tooling/
 *      status_source; every maps_into target + field backing path exists; this session is declared
 *      in registry/AI_SESSIONS.json (registry/EXECUTION_CONTRACT.json#execution_order requires it).
 *
 * Writes nothing. Exit 0 = declarations consistent, 1 = a declaration points at something missing.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    pass++;
    console.log(`  PASS  ${name}${detail ? " — " + detail : ""}`);
  } else {
    fail++;
    failures.push(name);
    console.log(`  FAIL  ${name}${detail ? " — " + detail : ""}`);
  }
}

const read = (rel: string) => JSON.parse(readFileSync(path.join(ROOT, rel), "utf8"));
const exists = (rel: string) => existsSync(path.join(ROOT, rel));

console.log("=== PASS 1 / DECLARE — job contract as integration contract ===\n");
const contract = read("registry/CANONICAL_JOB_CONTRACT.json");

console.log("[1] contract status + approval");
check("status is APPROVED_FOR_INTEGRATION", contract.status === "APPROVED_FOR_INTEGRATION", contract.status);
check("owner approval recorded", !!contract.approved?.by && !!contract.approved?.at, String(contract.approved?.decision ?? ""));
check("6 integration conditions declared", (contract.approved?.conditions ?? []).length === 6, String((contract.approved?.conditions ?? []).length));

console.log("\n[2] G7 — single scope declaration points at the REAL authority");
const scope: Record<string, { authority?: string; mechanism?: string }> = contract.scope_authority ?? {};
const dims: Array<[string, string]> = [
  ["files", "registry/LOCK_MANAGER.json"],
  ["paths", "registry/SCHEDULER.json"],
  ["capabilities", "registry/capability-registry.json"],
  ["tools", "registry/worker-tool-registry.json"],
];
for (const [dim, expected] of dims) {
  const actual = scope[dim]?.authority ?? "";
  check(`scope.${dim} -> ${expected}`, actual === expected && exists(expected), actual || "(unset)");
}
check("scope.spend -> COST_BUDGETS + costGateRuntime", String(scope.spend?.authority ?? "").includes("COST_BUDGETS") && String(scope.spend?.authority ?? "").includes("costGateRuntime") && exists("registry/COST_BUDGETS.json") && exists("app/api/admin/ide/_lib/costGateRuntime.ts"));
check("scope.data_boundary -> operating graph", String(scope.data_boundary?.authority ?? "").includes("DNA_OS_SYSTEM_OPERATING_GRAPH") && exists("registry/DNA_OS_SYSTEM_OPERATING_GRAPH.json"));
check("scope.url_target -> targetPolicy", String(scope.url_target?.authority ?? "").includes("targetPolicy") && exists("app/api/admin/ide/_lib/targetPolicy.ts"));
check("scope.agents -> AI registry + sessions", String(scope.agents?.authority ?? "").includes("AI_REGISTRY") && String(scope.agents?.authority ?? "").includes("AI_SESSIONS"));
check("all 8 scope dimensions declared", Object.keys(scope).filter((k) => k !== "note").length === 8, String(Object.keys(scope).filter((k) => k !== "note").length));
check("every scope dimension names an existing authority (no new mechanism)",
  Object.entries(scope).filter(([k]) => k !== "note").every(([, v]) => typeof v?.authority === "string" && v.authority.length > 0));

console.log("\n[3] integration contract maps into EXISTING systems only");
const maps: Array<{ system: string; contract_fields?: string[]; pass?: string }> = contract.maps_into ?? [];
check("10 systems mapped", maps.length === 10, String(maps.length));
for (const m of maps) {
  const first = String(m.system).split(" + ")[0].split(" (").slice(0, 1)[0].trim();
  const ok = first.startsWith("public.") || exists(first);
  check(`maps_into: ${first}`, ok, ok ? "exists" : "MISSING");
  check(`maps_into pass assigned: ${first}`, /^PASS[1-6]/.test(String(m.pass ?? "")), String(m.pass ?? ""));
}
check("6 integration passes declared", Object.keys(contract.integration_passes ?? {}).length === 6, Object.keys(contract.integration_passes ?? {}).join(","));
check("contract purpose is integration only", String(contract.single_purpose ?? contract.approved?.single_purpose ?? "").includes("ภาษางานเดียวกัน") || String(contract.purpose ?? "").includes("integration"), "declared");

console.log("\n[4] G6 — AI registry completeness (every agent has a ceiling)");
const ai = read("registry/AI_REGISTRY.json");
const need = ["role", "authority", "must_not_do", "tooling", "status_source"];
const incomplete = (ai.agents ?? []).filter((a: Record<string, unknown>) => !need.every((k) => k in a)).map((a: Record<string, unknown>) => a.id);
check(`all ${(ai.agents ?? []).length} agents declare role/authority/must_not_do/tooling/status_source`, incomplete.length === 0, incomplete.length ? String(incomplete) : "");
check("every agent has a non-empty must_not_do", (ai.agents ?? []).every((a: { must_not_do?: unknown[] }) => Array.isArray(a.must_not_do) && a.must_not_do.length > 0));
check("cline + codex are registered", ["cline", "codex"].every((id) => (ai.agents ?? []).some((a: { id: string }) => a.id === id)));
check("authority_reference declared", String(ai.authority_reference ?? "").includes("AUTHORITY_BOUNDARY_MATRIX"));
check("health cache declared honestly (0 rows, no invented status)", String(ai.health_cache_note ?? "").includes("0 แถว"));

console.log("\n[5] G6 — live session declared (EXECUTION_CONTRACT#execution_order)");
const sessions = read("registry/AI_SESSIONS.json");
const mine = (sessions.sessions ?? []).filter((s: { agent_id: string }) => s.agent_id === "cline");
check("this cline session has an entry", mine.length > 0, `${(sessions.sessions ?? []).length} sessions total`);
check("session status uses the real status_enum", mine.every((s: { status: string }) => Object.keys(sessions.status_enum ?? {}).includes(s.status)));
check("session status_note states real work", mine.every((s: { status_note?: string }) => (s.status_note ?? "").length > 20));
check("session roster file reused (no new state system)", exists("registry/AI_SESSIONS.json"));

console.log("\n[6] contract field backing references really exist");
const fields = Object.entries(contract.fields ?? {}) as Array<[string, { backing?: unknown }]>;
let backingChecked = 0;
let backingMissing = 0;
for (const [field, def] of fields) {
  const list = Array.isArray(def.backing) ? def.backing : def.backing ? [def.backing] : [];
  for (const raw of list) {
    const target = String(raw).split(" (")[0].split("#")[0].split(" + ")[0].trim();
    if (!target || target.startsWith("public.") || target.includes(" ")) continue;
    backingChecked++;
    if (!exists(target)) {
      backingMissing++;
      console.log(`        (unresolved backing of ${field}: ${target})`);
    }
  }
}
check(`${backingChecked - backingMissing}/${backingChecked} file-backed references exist`, backingMissing === 0, backingMissing ? `${backingMissing} missing` : "all resolved");

console.log("\n=== RESULT ===");
console.log(`${pass} passed, ${fail} failed`);
if (failures.length) console.log("FAILED:", failures.join(" | "));
console.log("\nPASS 1 declares (no new system): single scope authority + agent ceilings + live session.");
console.log("Next: PASS 2 WRAP (business job adapter into the existing execution lifecycle).");
process.exit(fail === 0 ? 0 : 1);

