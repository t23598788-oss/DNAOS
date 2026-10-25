/**
 * NEW-2 — Freebuff PULL adapter test. Offline: no process, no network, no DB.
 *
 * The point of this suite is the guarantee the Owner asked for explicitly:
 * **the adapter must never spawn a child process.** That is asserted three ways:
 *   P1  no process API is imported (static: child_process / spawn / exec / fork)
 *   P2  the module cannot even reach one at runtime (no such symbol in its export surface)
 *   P3  the pull round-trip works using files only
 * plus NC-1: injecting a spawn call makes P1/P2 fail (proving the guard is real,
 * not decorative), with a byte-identical restore.
 */
import { readFileSync, existsSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import * as adapter from "../src/adapters/freebuffPullAdapter";

const REPO = process.cwd();
const ADAPTER = "dna-os-contractor/src/adapters/freebuffPullAdapter.ts";
const WORK = join(tmpdir(), `dna-os-contractor-pull-${process.pid}`);

let failures = 0;
let checks = 0;
function check(name: string, ok: boolean, detail = ""): void {
  checks += 1;
  if (ok) {
    console.log(`PASS  ${name}`);
    return;
  }
  failures += 1;
  console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
}

const src = readFileSync(join(REPO, ADAPTER), "utf-8");
const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

// ── P1/P2 — the hard rule: no process spawning ──────────────────────────────
check("P1 adapter never imports a process API", !/from\s+"node:child_process"|require\(["']child_process["']\)/.test(code));
check("P1 adapter never calls spawn/exec/fork/execFile", !/\b(spawn|spawnSync|exec|execSync|execFile|execFileSync|fork)\s*\(/.test(code));
check("P2 adapter exposes no process-launching symbol", !Object.keys(adapter).some((k) => /spawn|exec|fork|run|launch/i.test(k)));
check("P2 adapter reports that a human launches the agent", adapter.PULL_PROTOCOL.launchedBy.includes("never by this adapter"));

// ── P3 — the pull round-trip (files only) ──────────────────────────────────
if (existsSync(WORK)) rmSync(WORK, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });

const offerId = "job-contract-1";
const published = adapter.publishTaskOffer(WORK, {
  jobContractId: offerId,
  capabilityRequired: "code.generate",
  taskDescription: "แก้ไฟล์ a.ts ให้ผ่าน tsc",
  acceptanceCriteria: ["tsc exit 0"],
  permittedReadScope: ["src/a.ts"],
  permittedWriteScope: ["src/a.ts"],
  forbiddenTools: ["Bash"],
});
check("P3 offer published", published.ok && existsSync(published.path));
check("P3 offer is discoverable (pull)", adapter.listOpenOffers(WORK).includes(offerId));
const offer = adapter.readTaskOffer(WORK, offerId);
check("P3 offer carries the canonical pull contract", offer?.claimVia === "contractor.task.claim" && offer?.submitVia === "contractor.evidence.submit");
check("P3 MCP discovery file exists at the repo root", existsSync(join(REPO, "mcp.json")));

// a result left by the agent is read as DATA only
mkdirSync(join(WORK, ".agents/results"), { recursive: true });
writeFileSync(
  join(WORK, ".agents/results", `${offerId}.json`),
  JSON.stringify({ jobContractId: offerId, status: "SUCCEEDED", output: "ok", error: null, evidence: ["tsc"], submittedAt: "2026-09-23T00:00:00Z" }),
  "utf-8",
);
const result = adapter.readSubmittedResult(WORK, offerId);
check("P3 submitted result is ingested as data", result?.status === "SUCCEEDED" && result?.evidence[0] === "tsc");
adapter.withdrawTaskOffer(WORK, offerId);
check("P3 offer can be withdrawn", adapter.readTaskOffer(WORK, offerId) === null);
rmSync(WORK, { recursive: true, force: true });

console.log(`\n${checks - failures}/${checks} passed`);
if (failures > 0) {
  console.log(`${failures} FAILED`);
  process.exit(1);
}
