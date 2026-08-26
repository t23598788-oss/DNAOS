/**
 * หน้าที่: prove the observation layer has no delete authority left, and that
 * the screenshot lifecycle names candidates without touching them.
 *
 * The defect this closes: `pruneClassifiedFiles()` in
 * ../../machine-observation/observation-store.ts unlinked files on a caller's
 * classification — a second mutation boundary inside a layer that is supposed
 * to observe. It is removed; this asserts it stays removed.
 *
 * Input: none. Output: printed report + exit code.
 * Dependency ที่อนุญาต: ../contract.ts, ../../machine-observation/contract.ts.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { offerHistoricalScreenshotsToLifecycle } from "../contract";
import * as observation from "../../machine-observation/contract";

const REPO = "/Users/tam/Desktop/DNA-OS-INFRASTRUCTURE";
const SHOTS = join(REPO, "control/ui-render-verification/data/screenshots");
const checks: { ok: boolean; label: string; detail: string }[] = [];
const check = (ok: boolean, label: string, detail = "") => { checks.push({ ok, label, detail }); };

// 1. The export is gone from the observation contract.
check(!("pruneClassifiedFiles" in observation),
  "machine-observation/contract.ts exports no prune/delete function",
  Object.keys(observation).filter((k) => /prune|delete|remove|evict|reclaim|gc/i.test(k)).join(", ") || "no deletion-shaped export");

// 2. The only unlinks left in the observation store are lock hygiene.
const store = readFileSync(join(REPO, "control/machine-observation/observation-store.ts"), "utf8");
const unlinkLines = store.split("\n")
  .map((l, i) => ({ l, n: i + 1 }))
  .filter(({ l }) => /fs\.unlinkSync\(/.test(l) && !l.trim().startsWith("*") && !l.trim().startsWith("//"));
check(unlinkLines.length === 2 && unlinkLines.every(({ l }) => l.includes("ROTATE_LOCK_FILE")),
  "every remaining unlink in the observation store operates on the rotation lock, not on data",
  unlinkLines.map(({ n, l }) => `${n}: ${l.trim().slice(0, 48)}`).join(" | "));

// 3. No deletion verb anywhere in the observation layer's own source.
const layerHits = execFileSync("/bin/sh", ["-c",
  `grep -rnE "unlinkSync|rmSync|rmdirSync|\\\\brm -rf" ${REPO}/control/machine-observation --include=*.ts | grep -v ROTATE_LOCK_FILE | grep -vE "^[^:]+:[0-9]+: *[*/]" || true`,
], { encoding: "utf8" }).trim();
check(layerHits === "", "no other filesystem-removal call exists in control/machine-observation", layerHits || "none");

// 4. A real candidate is NAMED and the file is still there afterwards.
//    keep_newest = 0 forces every historical screenshot into the candidate set,
//    which is exactly the input that previously caused deletion.
const before = existsSync(SHOTS) ? execFileSync("/bin/ls", ["-1", SHOTS], { encoding: "utf8" }).trim().split("\n").filter(Boolean) : [];
const offer = offerHistoricalScreenshotsToLifecycle(0);
const after = existsSync(SHOTS) ? execFileSync("/bin/ls", ["-1", SHOTS], { encoding: "utf8" }).trim().split("\n").filter(Boolean) : [];

console.log(`\n[OFFER] historical=${offer.classified_historical} candidates=${offer.lifecycle_candidates.length} retained=${offer.retained_newest.length} protected=${offer.protected_paths.length}`);
console.log(`  ${offer.candidate_reason}`);
console.log(`  decided_by: ${offer.decided_by}`);
offer.lifecycle_candidates.forEach((c) => console.log(`  CANDIDATE  ${c}`));

check(offer.lifecycle_candidates.length > 0,
  "with keep_newest=0 the historical screenshots really are named as candidates (the input that used to delete them)",
  `${offer.lifecycle_candidates.length} candidate(s)`);
check(before.length === after.length && before.every((f) => after.includes(f)),
  "every file that existed before the offer still exists after it",
  `${before.length} before, ${after.length} after`);
check(offer.lifecycle_candidates.every((c) => existsSync(c)),
  "every named candidate is still on disk — a candidate is a name, not an action");

// 5. The offer refuses to name protected evidence.
check(offer.protected_paths.every((p) => !offer.lifecycle_candidates.includes(p)),
  "no still-open execution's screenshot appears among the candidates");

// 6. The receiving end, stated as it really is rather than as a claim of completion.
let scope = "UNKNOWN";
try {
  scope = execFileSync("npx", ["tsx", "-e",
    `import {resolveScope,isAutoTrashable} from "./engines/storage/scope"; const d=resolveScope("${SHOTS}"); console.log(d.scope+"|"+isAutoTrashable(d.scope)+"|"+d.rule);`],
    { cwd: "/Users/tam/Desktop/dna-os-deadboard", encoding: "utf8", timeout: 300_000 }).trim();
} catch (e) { scope = `UNAVAILABLE (${String(e).slice(0, 60)})`; }
console.log(`\n[RECEIVING END] deadboard resolveScope(screenshots) = ${scope}`);
check(scope.startsWith("MUTABLE|false"),
  "the storage lifecycle resolves this directory to MUTABLE, not AUTO_TRASH — candidates reach an owner decision, never an automatic delete",
  scope);

console.log(`\n${"=".repeat(78)}\n[REGRESSION]`);
checks.forEach((c) => console.log(`  ${c.ok ? "✔" : "✘"} ${c.label}${c.detail ? ` — ${c.detail}` : ""}`));
const failed = checks.filter((c) => !c.ok).length;
console.log(`\nRESULT: ${checks.length - failed} passed, ${failed} failed`);
console.log("Read-only — nothing was moved, deleted or renamed.");
process.exit(failed === 0 ? 0 : 1);
