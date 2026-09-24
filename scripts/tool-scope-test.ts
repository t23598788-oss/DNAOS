/**
 * tool-scope-test.ts — owner steps2/4/6/7/8 (2026-09-26).
 *  - evaluateScope RUNTIME cases (deny-by-default: no subject/unknown
 *    action/unknown role/no grant/expired/revoked/job-mismatch + allow paths).
 *  - Source checks: migration CAS+found-fix, command lifecycle guards, route
 *    auth layers, grant write-path (owner-session only), runner policy sets.
 *  - LIVE runner spawns (real bypass probes): allowlist, env scrub, path
 *    escape, workspace validation, network denial — evidence, not claims.
 * Full probe suite incl. CPU-kill + KNOWN file-scope gap: tmp/mtr_probe.sh.
 * PASS/FAIL; exit1 on failure.
 */
import { readFileSync, existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evaluateScope, isGrantorRole, SCOPE_ACTIONS, type GrantRow } from "../core/policy/scope";

const ROOT = process.cwd();
let pass = 0;
let fail = 0;
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
function check(name: string, ok: boolean, detail = ""): void {
  if (ok) { pass += 1; console.log(`  PASS  ${name}`); }
  else { fail += 1; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
}

// ── step2: evaluateScope runtime (deny-by-default) ─────────────────────────
const G = (over: Partial<GrantRow> = {}): GrantRow => ({
  subject_type: "device", subject_id: "dev1", action: "run", resource: "managed.node",
  job_id: null, expires_at: null, revoked_at: null, ...over,
});
const SUB = { deviceId: "dev1" };
const now = new Date("2026-09-26T12:00:00Z");

check("scope: no subject → NO_SUBJECT deny", evaluateScope({ subject: {}, action: "run", resource: "x" }, [], now).allow === false);
check("scope: unknown action → ACTION_UNKNOWN", (() => {
  const d = evaluateScope({ subject: SUB, action: "launch" as never, resource: "x" }, [G()], now);
  return !d.allow && !d.allow && d.code === "ACTION_UNKNOWN";
})());
check("scope: account role not in registry any_authenticated → deny", (() => {
  const d = evaluateScope({ subject: { account: { id: "u1", role: "ghost_role" } }, action: "read", resource: "/f" }, [], now);
  return !d.allow && d.code === "ROLE_UNKNOWN";
})());
check("scope: zero grants → NO_GRANT (deny default)", (() => {
  const d = evaluateScope({ subject: SUB, action: "run", resource: "managed.node" }, [], now);
  return !d.allow && d.code === "NO_GRANT";
})());
check("scope: matching live grant → allow", evaluateScope({ subject: SUB, action: "run", resource: "managed.node" }, [G()], now).allow === true);
check("scope: expired grant → GRANT_EXPIRED deny", (() => {
  const d = evaluateScope({ subject: SUB, action: "run", resource: "managed.node" }, [G({ expires_at: "2026-09-26T11:00:00Z" })], now);
  return !d.allow && d.code === "GRANT_EXPIRED";
})());
check("scope: revoked grant → GRANT_REVOKED deny", (() => {
  const d = evaluateScope({ subject: SUB, action: "run", resource: "managed.node" }, [G({ revoked_at: "2026-09-26T10:00:00Z" })], now);
  return !d.allow && d.code === "GRANT_REVOKED";
})());
check("scope: job-bound grant without jobId → JOB_MISMATCH deny", (() => {
  const d = evaluateScope({ subject: SUB, action: "run", resource: "managed.node" }, [G({ job_id: "job-9" })], now);
  return !d.allow && d.code === "JOB_MISMATCH";
})());
check("scope: job-bound grant WITH matching jobId → allow", (() => {
  const d = evaluateScope({ subject: SUB, action: "run", resource: "managed.node", jobId: "job-9" }, [G({ job_id: "job-9" })], now);
  return d.allow === true;
})());
check("scope: prefix resource grant 'tool:*' covers 'tool:x'", (() => {
  const d = evaluateScope({ subject: SUB, action: "run", resource: "tool:x" }, [G({ resource: "tool:*" })], now);
  return d.allow === true;
})());
check("scope: subject mismatch (device grant, account subject) → deny", (() => {
  const d = evaluateScope({ subject: { account: { id: "u1", role: "admin" } }, action: "run", resource: "managed.node" }, [G()], now);
  return !d.allow && d.code === "NO_GRANT";
})());
check("scope: action classes fixed (read/write/delete/run/install/send/secret)", SCOPE_ACTIONS.length === 7);
check("scope: grantors = admin_tier registry (admin/super/employee) — ai_service/partner/customer NEVER",
  isGrantorRole("admin") && isGrantorRole("super_admin") && isGrantorRole("employee") &&
  !isGrantorRole("ai_service") && !isGrantorRole("customer") && !isGrantorRole("partner"));

// ── sources: migration / command lifecycle / routes / runner ───────────────
const migration = read("supabase/migrations/20260926000001_tool_scope_and_commands.sql");
const cmds = read("app/api/admin/devices/_lib/deviceCommands.ts");
const reg = read("app/api/admin/devices/_lib/deviceRegistry.ts");
const adminCmd = read("app/api/admin/devices/commands/route.ts");
const adminCmdId = read("app/api/admin/devices/commands/[cmdId]/route.ts");
const grantsRoute = read("app/api/admin/devices/grants/route.ts");
const devPull = read("app/api/internal/device/commands/route.ts");
const devOp = read("app/api/internal/device/commands/[cmdId]/route.ts");
const runner = read("local-runtime/managed/managed-tool-runner.mjs");

check("migration: scoped_grants + device_commands + closed kind + idempotency UNIQUE",
  migration.includes("scoped_grants") && migration.includes("device_commands") &&
  migration.includes("command_kind IN ('managed.run')") && migration.includes("idempotency_key text NOT NULL UNIQUE"));
check("migration: atomic pair fn IF NOT FOUND fix + CAS WHERE",
  migration.includes("IF NOT FOUND THEN") && !migration.includes("v_code.id IS NULL") &&
  migration.includes("consumed_at IS NULL") && migration.includes("expires_at > now()"));
check("migration: RLS deny-all both + pair fn revoked to public",
  (migration.match(/service_role_only/g) ?? []).length >= 2 && migration.includes("REVOKE ALL ON FUNCTION public.device_pair_code"));
check("commands lib: scope gate at create + policy re-check at ack + result-once",
  cmds.includes('action: "run", resource: toolId') && cmds.includes("jobId: commandId") &&
  cmds.includes('.eq("status", "running")') && cmds.includes("duplicate: true"));
check("commands lib: pull expires stale FIRST + requeue failed-only under max",
  cmds.includes('"expired before ack"') && cmds.includes('row.status !== "failed"') && cmds.includes("attempts >= row.max_attempts"));
check("registry: pair via atomic RPC + revoke cancels in-flight commands",
  reg.includes('rpc("device_pair_code"') && reg.includes('.in("status", ["dispatched", "running"])'));
check("admin routes ADMIN_TIER + SCOPE_DENIED mapping + grantor double-check",
  [adminCmd, adminCmdId, grantsRoute].every((s) => s.includes("requireAuth(ADMIN_TIER)")) &&
  adminCmd.includes("SCOPE_DENIED") && grantsRoute.includes("isGrantorRole(auth.role)"));
check("internal routes: device-token header only; success only via result op",
  [devPull, devOp].every((s) => s.includes('headers.get("x-dnaos-device-token")')) &&
  devOp.includes('body.op === "result"') && !devPull.includes("searchParams"));
check("grants write: granted_by session + revoke op + audit_logs (ไม่มีเส้น AI/เอกสาร)",
  grantsRoute.includes("granted_by: auth.id") && grantsRoute.includes('op === "revoke"') && grantsRoute.includes("audit_logs"));
check("runner: closed allowlist + env list + fixed wrapper + deny network*",
  runner.includes('ALLOWED_EXECUTABLES = ["node"]') && runner.includes("ENV_ALLOW = [") &&
  runner.includes('exec "$@"') && runner.includes("(deny network*)") && !runner.includes("eval("));
check("runner: honest gaps declared (file_scope false, whole_machine NOT_ENABLED)",
  runner.includes("file_scope_confined: false") && runner.includes('whole_machine_control: "NOT_ENABLED"'));
check("live-evidence scripts exist (mtr_probe / pair_proof / sb_conf_test)",
  ["tmp/mtr_probe.sh", "tmp/device_pair_proof.py", "tmp/sb_conf_test.py"].every((p) => existsSync(join(ROOT, p))));

// ── LIVE runner bypass probes (spawn real runner) ──────────────────────────
const RUNNER = join(ROOT, "local-runtime/managed/managed-tool-runner.mjs");
const ws = mkdtempSync(join(tmpdir(), "mts-ws-"));
writeFileSync(join(ws, "ok.js"), 'console.log("ws-file-ok")\n');

const envOut = spawnSync("node", [RUNNER, "run", "--workspace", ws, "--", "node",
  "-e", 'console.log("SECRET:"+(Object.keys(process.env).some(k=>/SECRET|PASSWORD|SUPABASE|ADMIN_/.test(k))?"YES":"NO"))'],
  { encoding: "utf8", env: { ...process.env, SUPABASE_SERVICE_ROLE_KEY: "fake-x", ADMIN_PASSWORD: "y" }, timeout: 15_000 });
check("LIVE env scrub: parent secrets never reach tool (SECRET:NO)",
  envOut.status === 0 && envOut.stdout.includes("SECRET:NO"), (envOut.stdout || envOut.stderr).slice(0, 200));

const exeOut = spawnSync("node", [RUNNER, "run", "--workspace", ws, "--", "/bin/echo", "hi"], { encoding: "utf8", timeout: 10_000 });
check("LIVE allowlist: /bin/echo refused exit4", exeOut.status === 4, `status=${exeOut.status}`);

const pathOut = spawnSync("node", [RUNNER, "run", "--workspace", ws, "--", "node", "/etc/hosts"], { encoding: "utf8", timeout: 10_000 });
check("LIVE path escape: absolute arg outside workspace refused exit3", pathOut.status === 3, `status=${pathOut.status}`);

const wsOut = spawnSync("node", [RUNNER, "run", "--workspace", "/nonexistent-mts", "--", "node", "-e", "1"], { encoding: "utf8", timeout: 10_000 });
check("LIVE bad workspace refused exit3", wsOut.status === 3, `status=${wsOut.status}`);

const okOut = spawnSync("node", [RUNNER, "run", "--workspace", ws, "--", "node", join(ws, "ok.js")], { encoding: "utf8", timeout: 15_000 });
check("LIVE in-workspace run works (ws-file-ok)", okOut.status === 0 && okOut.stdout.includes("ws-file-ok"), (okOut.stdout || okOut.stderr).slice(0, 150));

const netOut = spawnSync("node", [RUNNER, "run", "--workspace", ws, "--", "node", "-e",
  'fetch("https://example.com").then(r=>console.log("NET-OK-"+r.status)).catch(()=>console.log("NET-DENIED"));setTimeout(()=>{},2500)'],
  { encoding: "utf8", timeout: 20_000 });
check("LIVE network egress denied by OS sandbox (NET-DENIED never NET-OK)",
  netOut.stdout.includes("NET-DENIED") && !netOut.stdout.includes("NET-OK"), (netOut.stdout || "").slice(0, 120));

const st = spawnSync("node", [RUNNER, "selftest"], { encoding: "utf8", timeout: 10_000 });
let stJson: Record<string, unknown> | null = null;
try { stJson = JSON.parse(st.stdout); } catch { /* raw */ }
check("LIVE selftest: MANAGED-TOOL + whole-machine NOT_ENABLED + file gap declared",
  st.status === 0 && stJson?.mode === "MANAGED-TOOL" && stJson?.whole_machine_control === "NOT_ENABLED" && stJson?.file_scope_confined === false);

console.log(`\ntool-scope: ${pass} PASS / ${fail} FAIL`);
if (fail > 0) process.exit(1);


