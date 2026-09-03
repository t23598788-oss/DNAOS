/**
 * หน้าที่: คำนวณ Capability Catalog Projection สดจากทะเบียนและ source จริง
 *
 * READ ONLY · DETERMINISTIC · RECOMPUTABLE · NON-PERSISTENT
 * ไม่มีฟังก์ชันใดในไฟล์นี้เขียนอะไรลงที่ใดเลย ไม่มี cache ไม่มีไฟล์ผลลัพธ์
 *
 * สิ่งที่ไฟล์นี้ **ไม่** ทำ:
 *   - ไม่แตะ capabilities / resources / relationships / evidence / versions
 *   - ไม่แตะ legacy routing table และไม่แตะ runtimeInventory()
 *   - ไม่แตะ worker state
 *   - ไม่เรียกผลที่คำนวณได้ว่าเป็น canonical contract
 *
 * การตรวจ provenance เกิดขึ้นทุกครั้งที่คำนวณ: ถ้า symbol หายไปจาก source
 * หรือชื่อ type ที่บันทึกไว้ไม่ปรากฏใน signature อีกต่อไป แถวนั้นจะถูก
 * **downgrade** ไม่ใช่ปล่อยผ่าน — ไม่มี SUCCESS ที่ค้างจากอดีต
 *
 * Dependency ที่อนุญาต: ./types.ts, ./recorded-provenance.ts,
 * ../registry-database/adapters/persistent-file-store.ts, node:fs, node:path.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createPersistentFileStore } from "../registry-database/adapters/persistent-file-store";
import { RECORDED_CONTRACT_CANDIDATES, RECORDED_PARTIAL } from "./recorded-provenance";
import type { RecordedContractCandidate } from "./recorded-provenance";
import type { CapabilityCatalogRow, CapabilityCatalogSummary, ProvenanceCheck } from "./types";

const REPO_ROOT = join(__dirname, "..", "..");
const WORKER_REGISTRATIONS = join(REPO_ROOT, "connections", "agent-registry", "data", "worker-registrations.jsonl");

interface WorkerRegistrationRow {
  readonly worker_id?: string; readonly status?: string;
  readonly safe_to_assign?: boolean; readonly last_probe_evidence_id?: string | null;
}

function readWorkerRegistrations(): readonly WorkerRegistrationRow[] {
  if (!existsSync(WORKER_REGISTRATIONS)) return [];
  const rows: WorkerRegistrationRow[] = [];
  for (const line of readFileSync(WORKER_REGISTRATIONS, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try { rows.push(JSON.parse(line) as WorkerRegistrationRow); } catch { /* บรรทัดเสียหนึ่งบรรทัดต้องไม่ล้มทั้งไฟล์ */ }
  }
  return rows;
}

/**
 * ตรวจว่า provenance ที่บันทึกไว้ยังตรงกับ source ปัจจุบันหรือไม่
 * เป็นการเทียบสตริงล้วน — ไม่มี heuristic ไม่มีโมเดล
 */
export function checkProvenance(candidate: RecordedContractCandidate): ProvenanceCheck {
  const reasons: string[] = [];
  const abs = join(REPO_ROOT, candidate.entry_source);
  if (!existsSync(abs)) {
    return { ok: false, reasons: [`SOURCE_MISSING: ${candidate.entry_source}`] };
  }
  const text = readFileSync(abs, "utf8");
  if (!text.includes(candidate.entry_symbol)) reasons.push(`SYMBOL_MISSING: ${candidate.entry_symbol}`);
  for (const t of [...candidate.input_types, ...candidate.output_types]) {
    if (!text.includes(t)) reasons.push(`TYPE_NOT_FOUND_IN_SOURCE: ${t}`);
  }
  for (const p of candidate.provenance) {
    if (p.test && !existsSync(join(REPO_ROOT, p.test))) reasons.push(`TEST_MISSING: ${p.test}`);
    if (p.validator) {
      const file = p.validator.split("#")[0];
      if (!existsSync(join(REPO_ROOT, file))) reasons.push(`VALIDATOR_MISSING: ${file}`);
    }
  }
  return { ok: reasons.length === 0, reasons };
}

export function buildCapabilityCatalog(nowIso: string = new Date().toISOString()): {
  readonly rows: readonly CapabilityCatalogRow[];
  readonly summary: CapabilityCatalogSummary;
} {
  const store = createPersistentFileStore();
  const capabilities = store.listCapabilities();
  const workers = readWorkerRegistrations();
  const workerById = new Map(workers.map((w) => [w.worker_id ?? "", w]));
  // capability หนึ่งตัวมีได้หลาย recorded surface — เก็บเป็น list ไม่ใช่ค่าเดียว
  const recordedById = new Map<string, RecordedContractCandidate[]>();
  for (const c of RECORDED_CONTRACT_CANDIDATES) {
    const list = recordedById.get(c.capability_id) ?? [];
    list.push(c);
    recordedById.set(c.capability_id, list);
  }
  const partialById = new Map(RECORDED_PARTIAL.map((p) => [p.capability_id, p]));

  const rows: CapabilityCatalogRow[] = capabilities.map((cap) => {
    const bindings = (cap.relationships ?? []).filter(
      (e) => e.relationship_kind === "CAPABILITY_TO_API" || e.relationship_kind === "CAPABILITY_TO_WORKER");
    const surfaces = bindings.filter((e) => e.relationship_kind === "CAPABILITY_TO_API").map((e) => e.to_id);
    const hasBinding = bindings.length > 0;

    const sourceLocation = (cap.source_location ?? [])[0] ?? "";
    const firstPath = String(sourceLocation).split(" ")[0];
    const resolvable = cap.status === "REGISTERED" && firstPath.length > 0 && existsSync(join(REPO_ROOT, firstPath));

    const canonicalIn = cap.input_contract ?? [];
    const canonicalOut = cap.output_contract ?? [];
    const canonicalDeclared = canonicalIn.length > 0 && canonicalOut.length > 0;
    const canonicalExecutable = cap.status === "REGISTERED" && resolvable && hasBinding && canonicalDeclared;

    const recorded = recordedById.get(cap.capability_id) ?? [];
    const partial = partialById.get(cap.capability_id);

    // ตรวจทุก surface ที่บันทึกไว้ — พังหนึ่ง surface = ทั้ง capability ไม่ COMPLETE
    const perSurface = recorded.map((c) => checkProvenance(c));
    const surfaceReasons = perSurface.flatMap((c, i) =>
      c.ok ? [] : c.reasons.map((r) => `${recorded[i].surface ?? "default"}: ${r}`));

    // ★ COVERAGE: ถ้า capability มีหลาย invocation surface ทุกเส้นต้องมี contract ที่บันทึกไว้
    // ไม่ใช่แค่เส้นเดียว — surface ที่ไม่มี contract คือเส้นที่เรียกได้แต่ไม่รู้ว่ารับ/คืนอะไร
    const coveredSurfaces = new Set(recorded.map((c) => c.surface).filter((v): v is string => Boolean(v)));
    const uncovered = recorded.some((c) => c.surface)
      ? surfaces.filter((sfc) => !coveredSurfaces.has(sfc))
      : [];
    if (uncovered.length > 0) surfaceReasons.push(`SURFACE_WITHOUT_CONTRACT: ${uncovered.join(", ")}`);

    const check: ProvenanceCheck = recorded.length === 0
      ? { ok: false, reasons: ["NO_RECORDED_PROVENANCE"] }
      : { ok: surfaceReasons.length === 0, reasons: surfaceReasons };

    const sourceProvenStatus = partial ? "PARTIAL" : recorded.length > 0 ? (check.ok ? "COMPLETE" : "PARTIAL") : "NONE";
    const projectedExecutable = recorded.length > 0 && !partial && check.ok
      && cap.status === "REGISTERED" && resolvable && hasBinding;

    const worker = bindings
      .filter((e) => e.relationship_kind === "CAPABILITY_TO_WORKER")
      .map((e) => workerById.get(e.to_id))
      .find((w) => w?.safe_to_assign === true && w?.status === "IDLE" && Boolean(w?.last_probe_evidence_id));
    const runtimeAvailable = projectedExecutable && Boolean(worker);

    const executableReason = !hasBinding ? "NO_BINDING"
      : partial ? `RECORDED_PARTIAL: ${partial.missing}`
      : recorded.length === 0 ? "NO_SOURCE_PROVEN_CONTRACT"
      : !check.ok ? `PROVENANCE_FAILED: ${check.reasons.join("; ")}`
      : !resolvable ? "SOURCE_NOT_RESOLVABLE" : "OK";
    const availabilityReason = !projectedExecutable ? "NOT_PROJECTED_EXECUTABLE"
      : worker ? "OK" : "NO_ELIGIBLE_WORKER";

    return {
      capability_id: cap.capability_id, canonical_name: cap.canonical_name,
      registered: cap.status === "REGISTERED", resolvable,
      canonical_contract_status: canonicalDeclared ? "DECLARED" : "EMPTY",
      canonical_input_contract: canonicalIn, canonical_output_contract: canonicalOut,
      source_proven_contract_status: sourceProvenStatus,
      source_proven_input: recorded.length > 0 && check.ok ? recorded[0].input_level : "UNKNOWN",
      source_proven_output: recorded.length > 0 && check.ok ? recorded[0].output_level : "UNKNOWN",
      source_provenance: recorded.flatMap((c) => c.provenance),
      provenance_check: check,
      canonical_executable: canonicalExecutable,
      projected_executable: projectedExecutable,
      runtime_available: runtimeAvailable,
      execution_binding_refs: bindings.map((e) => `${e.relationship_kind}:${e.to_id}`),
      invocation_surfaces: surfaces,
      executable_reason: executableReason, availability_reason: availabilityReason,
    };
  });

  const n = (f: (r: CapabilityCatalogRow) => boolean) => rows.filter(f).length;
  return {
    rows,
    summary: {
      registered: n((r) => r.registered),
      resolvable: n((r) => r.resolvable),
      canonical_executable: n((r) => r.canonical_executable),
      projected_executable: n((r) => r.projected_executable),
      // แยกไว้ต่างหาก ไม่ยุบรวม: capability ที่ประกาศ contract ไว้ใน canonical
      // ตั้งแต่แรก (เช่น owner-display-projection) ไม่มี source-proven record
      // เพราะไม่จำเป็นต้องมี — มันประกาศมาถูกทางแล้ว
      executable_union: n((r) => r.projected_executable || r.canonical_executable),
      runtime_available: n((r) => r.runtime_available),
      projected_complete: n((r) => r.source_proven_contract_status === "COMPLETE"),
      projected_partial: n((r) => r.source_proven_contract_status === "PARTIAL"),
      provenance_failures: RECORDED_CONTRACT_CANDIDATES.filter((c) => !checkProvenance(c).ok).length,
      surfaces_without_contract: rows.reduce((a, r) =>
        a + (r.provenance_check.reasons.some((x) => x.startsWith("SURFACE_WITHOUT_CONTRACT")) ? 1 : 0), 0),
      computed_at: nowIso,
    },
  };
}
