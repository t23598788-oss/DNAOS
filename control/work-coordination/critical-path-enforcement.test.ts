/**
 * หน้าที่: §4 พิสูจน์การชนกันจริงระหว่าง OS process จริง — ไม่ใช่การจำลอง
 *
 *   process A จอง control/runtime-control  → process B เขียนทับ → ถูกปฏิเสธ
 *   A ปล่อย                                → B จองได้
 *   โฟลเดอร์พี่น้องที่ไม่ทับกัน               → ทำพร้อมกันได้
 *
 * และพิสูจน์ว่า **นโยบายนี้เลือกเฉพาะจุดจริง**: path ที่ไม่ critical คืน
 * NOT_REQUIRED โดยไม่แตะ lock directory เลย
 *
 * Input: none
 * Output: exit 0 เมื่อครบ, exit 1 เมื่อไม่ครบ
 * Dependency ที่อนุญาต: Node built-ins + ./contract.ts
 * สิ่งที่ห้ามแตะ:
 * - ห้าม "จำลอง" การชนกันในกระบวนการเดียว — A กับ B ต้องเป็นคนละ OS process
 * - ห้ามให้เคสที่ถูกปฏิเสธผ่านด้วยการอ่อนข้อ
 * - ห้ามทิ้ง lock ค้างไว้เมื่อจบ — การถือ claim ที่ไม่ได้ใช้คือสิ่งที่ไฟล์นี้กัน
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { classifyPath, criticalPathReport, releaseWriteClaim, requireWriteClaim, CRITICAL_SHARED_PATHS } from "./contract";

const REPO = process.cwd();
const scratch = mkdtempSync(join(tmpdir(), "critical-path-"));
const checks: { name: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail: string): void => { checks.push({ name, ok, detail }); };

/** Runs one claim attempt in a SEPARATE OS process and returns what it saw. */
function claimInChildProcess(workId: string, holder: string, paths: string[], leaseMs: number): { status: string; detail: string; lock_keys?: string[] } {
  const script = join(scratch, `claim-${workId}.ts`);
  writeFileSync(script, `
    const { requireWriteClaim } = require("${resolve(REPO, "control/work-coordination/contract.ts")}");
    const r = requireWriteClaim({ work_id: ${JSON.stringify(workId)}, holder_agent_id: ${JSON.stringify(holder)},
      repository_id: "dna-os-infrastructure", intended_write_paths: ${JSON.stringify(paths)}, lease_ms: ${leaseMs} });
    console.log("RESULT " + JSON.stringify(r));
  `);
  const out = execFileSync("npx", ["tsx", script], { cwd: REPO, encoding: "utf8" });
  const line = out.split("\n").find((l) => l.startsWith("RESULT ")) ?? "RESULT {}";
  return JSON.parse(line.slice("RESULT ".length));
}

let aborted = "";
let holderA: { holder_agent_id: string; lock_keys: readonly string[] } | null = null;
try {
  const before = criticalPathReport();
  check("no claim is held before the proof starts — a leftover lock would invalidate everything below",
    before.held === 0, `${before.declared} critical path(s) declared, ${before.held} held`);

  const ordinary = requireWriteClaim({ work_id: "wc-ordinary", holder_agent_id: "proof", repository_id: "dna-os-infrastructure", intended_write_paths: ["control/agent-gateway/gateway.ts"], lease_ms: 60_000 });
  check("an ordinary path needs NO claim — the policy is selective, not repo-wide",
    ordinary.status === "NOT_REQUIRED" && criticalPathReport().held === 0,
    `control/agent-gateway (32 production importers) -> ${ordinary.status}; lock directory untouched`);

  const unclassifiable = requireWriteClaim({ work_id: "wc-bad", holder_agent_id: "proof", repository_id: "dna-os-infrastructure", intended_write_paths: ["../outside/x.ts"], lease_ms: 60_000 });
  check("a path that cannot be normalized is REFUSED, never silently allowed",
    unclassifiable.status === "REFUSED", unclassifiable.detail);

  const a = requireWriteClaim({ work_id: "wc-A", holder_agent_id: "process-A", repository_id: "dna-os-infrastructure", intended_write_paths: ["control/runtime-control/resolver.ts"], lease_ms: 120_000 });
  check("A claims the critical path it intends to write",
    a.status === "CLAIMED", a.status === "CLAIMED" ? `scopes=${a.scopes.join(",")} lease until ${a.lease_expires_at}` : a.detail);
  if (a.status !== "CLAIMED") throw new Error("A could not claim; the rest of the proof would be meaningless");
  holderA = { holder_agent_id: "process-A", lock_keys: a.lock_keys };

  const b = claimInChildProcess("wc-B", "process-B", ["control/runtime-control/host-runtime.ts"], 120_000);
  check("a DIFFERENT OS process attempting an overlapping critical write is DENIED",
    b.status === "WRITE_BLOCKED_SCOPE_HELD",
    `child process -> ${b.status} :: ${String(b.detail).slice(0, 110)}`);

  const c = claimInChildProcess("wc-C", "process-C", ["credentials/registry/database-credential-registry.ts"], 120_000);
  check("a non-overlapping critical path can be claimed CONCURRENTLY by another process",
    c.status === "CLAIMED", `credentials/registry -> ${c.status} while control/runtime-control is held by A`);
  const d = claimInChildProcess("wc-D", "process-D", ["control/system-read-paths/registry.ts"], 120_000);
  check("an ordinary sibling folder is never blocked by a critical claim",
    d.status === "NOT_REQUIRED", `control/system-read-paths -> ${d.status}`);

  const e = claimInChildProcess("wc-E", "process-E", ["control/runtime-control-legacy/x.ts"], 60_000);
  check("`control/runtime-control-legacy` is NOT `control/runtime-control` — enforcement is segment-boundary aware",
    e.status === "NOT_REQUIRED", `control/runtime-control-legacy -> ${e.status}`);

  const released = releaseWriteClaim(holderA);
  holderA = null;
  check("A releases when its mutation is done — an unused claim blocks others without protecting anything",
    released.ok, released.ok ? "released" : `not released: ${released.not_released.join(", ")}`);
  const bAgain = claimInChildProcess("wc-B2", "process-B", ["control/runtime-control/host-runtime.ts"], 30_000);
  check("after the release, the previously denied process CAN claim",
    bAgain.status === "CLAIMED", `child process -> ${bAgain.status}`);
  if (bAgain.status === "CLAIMED" && bAgain.lock_keys) releaseWriteClaim({ holder_agent_id: "process-B", lock_keys: bAgain.lock_keys });
  if (c.status === "CLAIMED" && c.lock_keys) releaseWriteClaim({ holder_agent_id: "process-C", lock_keys: c.lock_keys });

  check("every critical declaration names the real line that makes it non-recoverable",
    CRITICAL_SHARED_PATHS.every((p) => p.evidence.length > 20 && p.recovery_cost.length > 20),
    `${CRITICAL_SHARED_PATHS.length} declarations, each with evidence + recovery_cost`);
  check("importer count is NOT the criterion — the busiest folder in the repo is deliberately ordinary",
    classifyPath("control/agent-gateway").kind === "ORDINARY",
    "control/agent-gateway has 32 production importers and is ORDINARY; control/runtime-control has 7 and is CRITICAL");

  const after = criticalPathReport();
  check("no claim is left held when the proof finishes",
    after.held === 0, `${after.held} held`);
} catch (error) {
  aborted = error instanceof Error ? (error.stack ?? error.message) : String(error);
} finally {
  if (holderA) releaseWriteClaim(holderA);
  rmSync(scratch, { recursive: true, force: true });
}

console.log("\n[CRITICAL PATH ENFORCEMENT PROOF]");
for (const c of checks) console.log(`  ${c.ok ? "✔" : "✘"} ${c.name}\n      ${c.detail}`);
if (aborted) console.log(`\n  ✘ proof aborted: ${aborted}`);
const failed = checks.filter((c) => !c.ok).length + (aborted ? 1 : 0);
console.log(`\nRESULT: ${checks.length - checks.filter((c) => !c.ok).length} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
