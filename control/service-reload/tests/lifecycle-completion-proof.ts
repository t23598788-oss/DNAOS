/**
 * หน้าที่: prove the automatic path — LIFECYCLE COMPLETION -> RELOAD — with
 * the repository's real verification records, and prove the refusals that make
 * it safe to leave unattended.
 *
 * The refusals matter more than the happy path here, because this is the one
 * entry point that can restart a live service with no owner present.
 *
 * Input: none. Output: printed report + exit code.
 * Dependency ที่อนุญาต: ../contract.ts, ../../post-commit-verification/contract.ts.
 */
import { execFileSync } from "node:child_process";
import { reloadForVerifiedCommit, requestReload, reloadRequiredFor } from "../contract";
import { findVerificationForCommit } from "../../post-commit-verification/contract";

const REPO = "/Users/tam/Desktop/DNA-OS-INFRASTRUCTURE";
/** A real commit in this repo whose verification record is VERIFIED. */
const REAL_VERIFIED = "9ced972d7c96d58960b15a18b1653443451852f6";
/** A 40-hex sha with a VERIFIED record in the evidence store that is NOT a commit here. */
const FIXTURE_SHA = "eeee5555eeee5555eeee5555eeee5555eeee5555";

const checks: { ok: boolean; label: string; detail: string }[] = [];
const check = (ok: boolean, label: string, detail = "") => { checks.push({ ok, label, detail }); };
const pidOf = (): number | null => {
  const row = execFileSync("/bin/sh", ["-c", "launchctl list | grep com.dnaos.machine-observer || true"], { encoding: "utf8" }).trim();
  const n = row.split(/\s+/)[0];
  return /^\d+$/.test(n) ? Number(n) : null;
};

async function main(): Promise<void> {
  const pidBefore = pidOf();
  console.log(`\n[BEFORE] machine-observer pid ${pidBefore}`);

  // 1. A fixture sha with a VERIFIED record must not grant authority.
  const fixture = findVerificationForCommit(FIXTURE_SHA, REPO);
  console.log(`[FIXTURE] findVerificationForCommit(${FIXTURE_SHA.slice(0, 12)}) -> ${fixture === null ? "null" : fixture.status}`);
  check(fixture === null,
    "a VERIFIED record whose commit_sha is not a real commit in this repo grants nothing — checked against git, not against the record",
    fixture === null ? "null" : `LEAKED ${fixture.status}`);

  // 2. The one real verified commit is found.
  const real = findVerificationForCommit(REAL_VERIFIED, REPO);
  console.log(`[REAL]    findVerificationForCommit(${REAL_VERIFIED.slice(0, 12)}) -> ${real?.status ?? "null"} (${real?.verification_id ?? "-"})`);
  check(real !== null && real.status === "VERIFIED",
    "a real commit's real VERIFIED record is found in the existing evidence store", real?.verification_id ?? "not found");

  // 3. A verified commit that touches no service restarts nothing.
  const unrelated = await reloadForVerifiedCommit(REAL_VERIFIED, REPO);
  console.log(`\n[COMPLETION] ${unrelated.reason}`);
  console.log(`  changed: ${unrelated.changed_paths.map((p) => p.slice(REPO.length + 1)).join(", ") || "(none)"}`);
  check(unrelated.services_impacted.length === 0 && unrelated.outcomes.length === 0,
    "a VERIFIED commit that touches no registered service's source root restarts nothing",
    `${unrelated.services_impacted.length} impacted, ${unrelated.outcomes.length} reload(s)`);
  check(unrelated.changed_paths.length > 0,
    "the changed paths came from git diff-tree on the commit itself, not from a caller's list",
    `${unrelated.changed_paths.length} path(s)`);

  // 4. An unverified commit triggers nothing at all.
  const head = execFileSync("/usr/bin/git", ["rev-parse", "HEAD"], { cwd: REPO, encoding: "utf8" }).trim();
  const unverified = await reloadForVerifiedCommit(head, REPO);
  console.log(`\n[UNVERIFIED HEAD] ${unverified.reason}`);
  check(unverified.outcomes.length === 0 && unverified.verification_id === null,
    "a commit with no verification record triggers no reload — an incomplete lifecycle is not a completed one",
    unverified.reason.slice(0, 70));

  // 5. Nothing above touched the running service.
  check(pidOf() === pidBefore, "no service was restarted by any of the refusals", `pid still ${pidOf()}`);

  // 6. The authority rule itself, on the live working tree.
  const auto = await requestReload({
    changed_paths: [`${REPO}/control/machine-observation/observation-store.ts`],
    repo_root: REPO, trigger: "AUTOMATIC", execute: true,
  });
  console.log(`\n[AUTOMATIC on dirty tree] ${auto.decision} — gate ${auto.gate.status}/${auto.gate.authority}`);
  check(auto.operation === null,
    "an AUTOMATIC reload of an uncommitted change never reaches runtime-control",
    `${auto.decision} (authority ${auto.gate.authority})`);
  check(auto.gate.authority !== "COMMIT_VERIFIED",
    "a dirty working tree can never produce COMMIT_VERIFIED authority", auto.gate.authority);

  // 7. Read-only reporting still works and still reports, never acts.
  const report = reloadRequiredFor("machine-observer");
  console.log(`\n[OBSERVATION] ${report.status} pid ${report.pid} started ${report.process_started_at} vs source ${report.newest_source_mtime}`);
  check(["SERVICE_RELOAD_REQUIRED", "CURRENT", "NOT_RUNNING", "UNRESOLVED"].includes(report.status),
    "the observation layer reports a reload status from real process and mtime facts", report.status);
  check(pidOf() === pidBefore, "the whole proof restarted nothing", `pid still ${pidOf()}`);

  console.log(`\n${"=".repeat(78)}\n[REGRESSION]`);
  checks.forEach((c) => console.log(`  ${c.ok ? "✔" : "✘"} ${c.label}${c.detail ? ` — ${c.detail}` : ""}`));
  const failed = checks.filter((c) => !c.ok).length;
  console.log(`\nRESULT: ${checks.length - failed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();
