/**
 * หน้าที่: the impact analysis that must pass BEFORE the composed index is
 * wired into any Write Gate caller.
 *
 * It answers one question honestly: does swapping the index change any
 * decision that cannot be justified by a registry row? Every path that
 * becomes writable is required to produce its ownership chain — resource row,
 * ownership link, capability row — and a single path that becomes writable
 * without one BLOCKS promotion.
 *
 * The gate is called for real, with both indexes, over every path either
 * index claims plus the paths of the pending repair. Nothing is simulated.
 *
 * Usage: npx tsx software/capability-registrar/tests/write-ownership-impact.ts
 */

import { evaluateWriteIntent } from "../../../permissions/write-gate/contract";
import { getCapabilityIndex } from "../index";
import { inspectWriteOwnershipIndex } from "../write-ownership-index";
import type { CapabilityMetadata } from "../types";

const before = getCapabilityIndex();
const composed = inspectWriteOwnershipIndex();
const after = composed.registryIndex;

function decide(path: string, index: readonly CapabilityMetadata[]): { decision: string; codes: string } {
  const result = evaluateWriteIntent(
    {
      intent_id: `impact-${path}`,
      operation: "MODIFY",
      capability: "impact-analysis",
      target_type: "FILE",
      target_path: path,
      requested_change: "impact analysis probe; nothing is written",
      requesting_agent: { identity_id: "impact-analysis", kind: "ai_agent", display_name: "impact analysis" },
      evidence: [{ source: "software/capability-registrar/tests/write-ownership-impact.ts", note: "read-only probe" }],
      correlation_id: "impact-analysis",
      submitted_at: new Date().toISOString(),
    } as never,
    { registryIndex: index },
  );
  return { decision: result.decision, codes: result.reason_codes.join(",") };
}

// Every path either index claims, plus the pending repair's real target.
const probePaths = [
  ...new Set([
    ...before.map((c) => `${(c as unknown as { OWNER_FOLDER: string }).OWNER_FOLDER}probe.ts`),
    ...after.map((c) => `${(c as unknown as { OWNER_FOLDER: string }).OWNER_FOLDER}probe.ts`),
    "control/external-system-lifecycle/pipeline.ts",
    "some/path/nobody/owns/file.ts",
    "permissions/write-gate/policy.ts",
    "credentials/macos-keychain/provider.ts",
  ]),
].filter((p) => !p.startsWith("UNKNOWN"));

console.log("=".repeat(100));
console.log("WRITE OWNERSHIP INDEX — IMPACT ANALYSIS (pre-promotion, read-only)");
console.log("=".repeat(100));
console.log(`  TOTAL_INDEX_BEFORE : ${before.length}`);
console.log(`  TOTAL_INDEX_AFTER  : ${after.length}`);
console.log(`  excluded candidates: ${composed.excluded.length}`);
console.log(`  ambiguous paths    : ${composed.ambiguous_paths.length}`);

const newlyWritable: { path: string; owner: string; evidence: string }[] = [];
const newlyAmbiguous: string[] = [];
const stillUnowned: string[] = [];
const changedOtherwise: { path: string; from: string; to: string }[] = [];

for (const path of probePaths) {
  const b = decide(path, before);
  const a = decide(path, after);
  if (b.decision === a.decision) {
    if (a.decision === "DENY") stillUnowned.push(path);
    continue;
  }
  if (b.decision === "DENY" && a.decision === "ALLOW_MODIFY") {
    const owner = composed.entries.find((e) => path.startsWith(e.OWNED_PATH));
    newlyWritable.push({ path, owner: owner?.CANONICAL_NAME ?? "UNPROVEN", evidence: owner?.OWNERSHIP_EVIDENCE_REF ?? "NONE" });
  } else if (a.decision === "UNKNOWN" && a.codes.includes("AMBIGUOUS")) {
    newlyAmbiguous.push(path);
  } else {
    changedOtherwise.push({ path, from: `${b.decision}(${b.codes})`, to: `${a.decision}(${a.codes})` });
  }
}

console.log(`\n  NEWLY_WRITABLE_PATHS : ${newlyWritable.length}`);
console.log(`  NEWLY_AMBIGUOUS_PATHS: ${newlyAmbiguous.length}${newlyAmbiguous.length ? ` -> ${newlyAmbiguous.join(", ")}` : ""}`);
console.log(`  STILL_UNOWNED_PATHS  : ${stillUnowned.length}`);
console.log(`  OTHER_CHANGES        : ${changedOtherwise.length}${changedOtherwise.map((c) => `\n      ${c.path}: ${c.from} -> ${c.to}`).join("")}`);

// --- every newly writable path must produce its ownership chain ----------
console.log("\n  OWNERSHIP CHAIN FOR EVERY NEWLY WRITABLE PATH:");
const unproven: string[] = [];
for (const item of newlyWritable) {
  const proven = item.owner !== "UNPROVEN" && item.evidence !== "NONE" && item.evidence.includes("capabilities.jsonl");
  if (!proven) unproven.push(item.path);
  console.log(`    ${proven ? "PROVEN " : "UNPROVEN"} ${item.path.padEnd(58)} -> ${item.owner}`);
}
if (newlyWritable.length === 0) console.log("    (none)");

// --- the specific path this whole exercise is about ----------------------
console.log("\n  TARGET PATH CHECK");
const targetBefore = decide("control/external-system-lifecycle/pipeline.ts", before);
const targetAfter = decide("control/external-system-lifecycle/pipeline.ts", after);
const targetOwners = composed.entries.filter((e) => "control/external-system-lifecycle/pipeline.ts".startsWith(e.OWNED_PATH));
console.log(`    before : ${targetBefore.decision} (${targetBefore.codes})`);
console.log(`    after  : ${targetAfter.decision} (${targetAfter.codes})`);
console.log(`    owners : ${targetOwners.length} -> ${targetOwners.map((o) => o.CANONICAL_NAME).join(", ") || "none"}`);

// --- paths that must NEVER become writable -------------------------------
console.log("\n  PROTECTED PATHS (must stay DENY):");
let protectionBroken = false;
for (const path of ["permissions/write-gate/policy.ts", "credentials/macos-keychain/provider.ts", "some/path/nobody/owns/file.ts"]) {
  const a = decide(path, after);
  const ok = a.decision === "DENY";
  if (!ok) protectionBroken = true;
  console.log(`    ${ok ? "DENY  " : "LEAKED"} ${path.padEnd(50)} ${a.decision} (${a.codes})`);
}

const blocked = unproven.length > 0 || protectionBroken || targetOwners.length !== 1;
console.log(`\n  PROMOTION: ${blocked ? "BLOCKED" : "CLEARED"}`);
if (unproven.length) console.log(`    unproven newly-writable paths: ${unproven.join(", ")}`);
if (protectionBroken) console.log("    a protected path became writable");
if (targetOwners.length !== 1) console.log(`    target path resolves to ${targetOwners.length} owners, expected exactly 1`);
process.exit(blocked ? 1 : 0);
