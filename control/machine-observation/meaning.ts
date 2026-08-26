/**
 * หน้าที่: turns raw observations into MEANING RECORDS, one deterministic step
 * at a time, each carrying the proof it came from (Owner, 2026-08-26).
 *
 * Every record names `derived_by` — the code that produced it. None of them can
 * name a model, because no model is on this path. A meaning with no proof is
 * recorded as `UNKNOWN` with the reason; it is neither dropped (which would
 * hide the gap) nor asserted (which would invent one).
 *
 * IT ENRICHES, IT DOES NOT RE-IDENTIFY. When a path already resolves to a
 * resource identity, that identity is reused verbatim. This file never mints a
 * resource_id and never rewrites one — new evidence attaches to the identity
 * that already exists.
 *
 * Input: a `ChangeEvent`, a `RegistryStore`, and the correlation verdict.
 * Output: `MeaningRecord[]`.
 * Dependency ที่อนุญาต: ./types.ts, ../realtime-change/contract.ts,
 * ../system-read-paths/contract.ts, ../../software/registry-database/contract.ts.
 * สิ่งที่ห้ามแตะ: ห้ามสร้าง resource_id ใหม่, ห้ามสร้าง meaning ที่ไม่มี proof.
 */

import type { CorrelationCandidate, MeaningRecord } from "./types";
import type { ChangeEvent } from "../realtime-change/contract";
import { resolvePath } from "../realtime-change/contract";
import { compareSourceToBlueprint } from "../system-read-paths/contract";
import type { RegistryStore } from "../../software/registry-database/contract";

const DERIVED_BY = "control/machine-observation/meaning.ts#deriveMeaning (deterministic; no model on this path)";

export function deriveMeaning(event: ChangeEvent, store: RegistryStore | undefined, correlation: CorrelationCandidate): readonly MeaningRecord[] {
  const at = new Date().toISOString();
  const records: MeaningRecord[] = [];
  const resolution = resolvePath(event.path, store);

  if (resolution.resource) {
    records.push({
      meaning_type: "RESOURCE_IDENTITY", resource_id: resolution.resource.resource_id,
      source: "software/registry-database (existing identity, reused verbatim)",
      proof: resolution.resource.evidence, observed_at: at, derived_by: DERIVED_BY,
    });
  } else {
    records.push({ meaning_type: "UNKNOWN", resource_id: null, source: "software/registry-database", proof: resolution.unresolved, observed_at: at, derived_by: DERIVED_BY });
  }

  if (resolution.capability) {
    records.push({
      meaning_type: "CAPABILITY_RELATION", resource_id: resolution.resource?.resource_id ?? null,
      source: "control/command-router/capability-registry.ts",
      proof: resolution.capability.evidence, observed_at: at, derived_by: DERIVED_BY,
    });
  }

  // The software relation is recorded at exactly the strength the OS proved.
  records.push({
    meaning_type: correlation.verdict === "PROVEN" ? "SOFTWARE_RELATION" : "UNKNOWN",
    resource_id: resolution.resource?.resource_id ?? null,
    source: correlation.pid !== null ? `process:${correlation.pid}` : "no process observed",
    proof: correlation.verdict === "PROVEN" ? correlation.evidence : [`verdict=${correlation.verdict}`, correlation.reason, ...correlation.evidence],
    observed_at: at, derived_by: DERIVED_BY,
  });

  const blueprint = compareSourceToBlueprint(resolution.repo_relative_path, null);
  for (const finding of blueprint) {
    records.push({
      meaning_type: finding.blueprint_document ? "DOCUMENT_RELATION" : "UNKNOWN",
      resource_id: resolution.resource?.resource_id ?? null,
      source: finding.blueprint_document ? `DNA-OS-BLUEPRINT ${finding.blueprint_document}` : "DNA-OS-BLUEPRINT",
      proof: [`status=${finding.status}`, finding.difference, ...(finding.blueprint_revision ? [`revision=${finding.blueprint_revision}`] : [])],
      observed_at: at, derived_by: DERIVED_BY,
    });
  }

  records.push({
    meaning_type: "STATE", resource_id: resolution.resource?.resource_id ?? null,
    source: "control/realtime-change/observer.ts filesystem_evidence",
    proof: [`exists=${event.filesystem_evidence.exists}`, `size_bytes=${event.filesystem_evidence.size_bytes}`, `mtime=${event.filesystem_evidence.mtime}`, `inode=${event.filesystem_evidence.inode}`],
    observed_at: at, derived_by: DERIVED_BY,
  });

  return records;
}
