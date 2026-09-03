/**
 * หน้าที่: a READ-ONLY probe answering two questions about
 * `control/external-system-lifecycle/` without changing a single line of
 * implementation:
 *
 *   1. Does an owning capability already exist? (registry-first discovery)
 *   2. Would permissions/write-gate resolve that owner, if it were given the
 *      registry that holds it?
 *
 * NOTHING HERE IS WIRED INTO PRODUCTION. The "after" case builds a
 * CapabilityMetadata projection of the PERSISTENT software registry in local
 * memory and hands it to the real `evaluateWriteIntent` as its context. That
 * is exactly what the gate's own contract invites — `WriteGateContext` takes
 * an already-resolved index and the gate never scans anything itself — so
 * this measures the real rule against a different, real index. It changes no
 * default, no wiring, and no file.
 *
 * WHY THAT DISTINCTION MATTERS: the gate is not broken. `ruleRegistryLookup`
 * correctly requires exactly one registered capability at the target path.
 * What it is handed today is `software/capability-registrar/index.ts`, a
 * projection of `control/command-router/`'s 12 routable entries — while the
 * owner of this folder lives among the persistent registry's 101. The denial
 * was a true statement about the index it was given, not about ownership.
 *
 * Usage: npx tsx control/repair-loop/tests/ownership-probe.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { evaluateWriteIntent } from "../../../permissions/write-gate/contract";
import { getCapabilityIndex } from "../../../software/capability-registrar/index";
import { findCapability } from "../../../software/registry-database/contract";
import { createPersistentFileStore } from "../../../software/registry-database/adapters/persistent-file-store";
import { loadAllEvidence } from "../../agent-gateway/contract";
import { listCapabilities } from "../../command-router/contract";

const REPO = process.cwd();
const CANONICAL = join(REPO, "software/registry-database/data/canonical");
const TARGET_PATH = "control/external-system-lifecycle/pipeline.ts";
const TARGET_FOLDER = "control/external-system-lifecycle/";

function readJsonl(name: string): Record<string, unknown>[] {
  return readFileSync(join(CANONICAL, name), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

function intent(operation: "MODIFY", capabilityClaim: string) {
  return {
    intent_id: `ownership-probe-${operation}`,
    operation,
    capability: capabilityClaim,
    target_type: "FILE" as const,
    target_path: TARGET_PATH,
    requested_change: "read-only ownership probe; nothing is written",
    requesting_agent: { identity_id: "ownership-probe", kind: "ai_agent" as const, display_name: "ownership probe" },
    evidence: [{ source: "control/repair-loop/tests/ownership-probe.ts", note: "registry-first discovery" }],
    correlation_id: "ownership-probe",
    submitted_at: new Date().toISOString(),
  };
}

console.log("=".repeat(98));
console.log("OWNERSHIP PROBE — control/external-system-lifecycle/");
console.log("=".repeat(98));

// --- 1. REGISTRY-FIRST DISCOVERY ----------------------------------------
console.log("\n[1] REGISTRY-FIRST DISCOVERY");

const store = createPersistentFileStore();
const persistentHit = findCapability({ canonical_name: "external-system-lifecycle" }, store);
console.log(`  persistent software registry : ${persistentHit ? `FOUND ${persistentHit.capability_id} (status ${persistentHit.status})` : "not found"}`);

const routable = listCapabilities().find((c) => c.capability_id === "external-system-lifecycle");
console.log(`  command-router registry      : ${routable ? "FOUND" : "not found"}`);

const registrarHit = getCapabilityIndex().find(
  (c) => TARGET_PATH.startsWith((c as unknown as { OWNER_FOLDER: string }).OWNER_FOLDER));
console.log(`  capability-registrar index   : ${registrarHit ? "FOUND" : "not found"}`);

const resources = readJsonl("resources.jsonl");
const links = readJsonl("resource_capabilities.jsonl");
const owningResource = resources.find((r) => r.source_location === TARGET_FOLDER);
const link = owningResource ? links.find((l) => l.resource_id === owningResource.resource_id) : null;
console.log(`  resource row for the folder  : ${owningResource ? owningResource.resource_id : "none"}`);
console.log(`  resource -> capability link  : ${link ? link.capability_id : "none"}`);

// --- 2. WRITE GATE, BEFORE and AFTER -------------------------------------
console.log("\n[2] WRITE GATE");

const before = evaluateWriteIntent(intent("MODIFY", "external-system-lifecycle") as never, { registryIndex: getCapabilityIndex() });
console.log(`  BEFORE (index = capability-registrar projection of command-router, ${getCapabilityIndex().length} entries)`);
console.log(`    decision   : ${before.decision} (${before.reason_codes.join(",")})`);

// A CapabilityMetadata-shaped projection of the PERSISTENT registry. Built
// here, in memory, for measurement only — production wiring is untouched.
const capabilityRows = readJsonl("capabilities.jsonl");
const capabilityById = new Map(capabilityRows.map((c) => [c.capability_id as string, c]));
const persistentIndex = resources
  .filter((r) => typeof r.source_location === "string" && (r.source_location as string).endsWith("/"))
  .map((r) => {
    const l = links.find((x) => x.resource_id === r.resource_id);
    const cap = l ? capabilityById.get(l.capability_id as string) : undefined;
    return {
      SOFTWARE_ID: (cap?.canonical_name as string) ?? (r.resource_id as string),
      CAPABILITY_ID: (cap?.canonical_name as string) ?? (r.resource_id as string),
      OWNER_FOLDER: r.source_location as string,
      PARENT_CAPABILITY: null,
      STATUS: (cap?.status as string) ?? "REGISTERED",
      EVIDENCE_SOURCE: `software/registry-database/data/canonical/resources.jsonl#${r.resource_id}`,
    };
  })
  .filter((entry) => entry.OWNER_FOLDER && entry.OWNER_FOLDER !== "/");

const after = evaluateWriteIntent(intent("MODIFY", "external-system-lifecycle") as never, { registryIndex: persistentIndex as never });
console.log(`  AFTER  (index = persistent software registry projection, ${persistentIndex.length} folder-owning entries)`);
console.log(`    decision   : ${after.decision} (${after.reason_codes.join(",")})`);
const overlapping = persistentIndex.filter((e) => TARGET_PATH.startsWith(e.OWNER_FOLDER));
console.log(`    overlaps   : ${overlapping.length} -> ${overlapping.map((o) => `${o.CAPABILITY_ID}@${o.OWNER_FOLDER}`).join(", ") || "none"}`);

// --- 3. VERIFICATION LINKAGE --------------------------------------------
// Why 11 capabilities carry no verification record: check whether ANY stored
// evidence row names a capability_id at all. If none does, the gap is a
// missing FIELD, not a missing verification.
console.log("\n[3] VERIFICATION LINKAGE");
const evidence = loadAllEvidence() as unknown as { kind: string; source: string; payload: unknown }[];
const verificationRows = evidence.filter((e) => e.kind === "verification");
const namingACapability = verificationRows.filter((e) => {
  const p = e.payload as Record<string, unknown> | null;
  return Boolean(p && (p.capability_id || p.MATCHED_CAPABILITY_ID));
});
console.log(`  verification evidence rows            : ${verificationRows.length}`);
console.log(`  rows naming a capability_id           : ${namingACapability.length}`);
const registryCapabilities = listCapabilities().map((c) => c.capability_id);
const linkable = registryCapabilities.filter((id) =>
  namingACapability.some((e) => JSON.stringify((e as { payload: unknown }).payload).includes(id)));
console.log(`  command-router capabilities           : ${registryCapabilities.length}`);
console.log(`  linkable from existing evidence       : ${linkable.length}${linkable.length ? ` (${linkable.join(", ")})` : ""}`);
console.log(`  EVIDENCE_LINK_MISSING                 : ${registryCapabilities.filter((id) => !linkable.includes(id)).join(", ")}`);
