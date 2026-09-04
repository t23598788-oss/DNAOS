/**
 * R2 · การอนุมานขอบเขตจากหลักฐานใน Registry เท่านั้น
 *
 * กฎ: ทุกฟิลด์ต้องชี้กลับไปที่หลักฐานได้ ถ้าชี้ไม่ได้ = UNRESOLVED
 * ไม่มีที่ใดในไฟล์นี้ที่เดาค่าจากชื่อ จากรูปแบบ หรือจากความน่าจะเป็น
 */
import { readFileSync } from "node:fs";
import { UNRESOLVED } from "./schema";
import { resolveSources, runtimeEnv, fsAccess, netAccess, osAccess, authSignals,
         requiredFieldsOf, errorContract, verificationPath } from "./source-evidence";
import type { BoundaryRecord, BoundaryVerdict, Resolved } from "./schema";

const DIR = "software/registry-database/data/canonical";

export interface RegistryCapability {
  capability_id: string; canonical_name: string; capability_type: string;
  purpose?: string; input_contract?: unknown[]; output_contract?: unknown[];
  side_effects?: unknown[]; status?: string; verified_at?: string | null;
}
export interface RegistryResource {
  resource_id: string; resource_type: string; owner_id?: string;
  repository_id?: string; source_location?: string; module?: string;
  version?: string; content_hash?: string; status?: string;
}

function readJsonl<T>(name: string): T[] {
  const out: T[] = [];
  for (const line of readFileSync(`${DIR}/${name}`, "utf8").split("\n")) {
    const s = line.trim();
    if (!s) continue;
    try { out.push(JSON.parse(s) as T); } catch { /* บรรทัดเสียหนึ่งบรรทัดไม่ล้มทั้งไฟล์ */ }
  }
  return out;
}

export interface RegistrySnapshot {
  readonly capabilities: readonly RegistryCapability[];
  readonly resources: readonly RegistryResource[];
  readonly links: readonly { resource_id: string; capability_id: string }[];
}

export function loadRegistry(): RegistrySnapshot {
  return {
    capabilities: readJsonl<RegistryCapability>("capabilities.jsonl"),
    resources: readJsonl<RegistryResource>("resources.jsonl"),
    links: readJsonl<{ resource_id: string; capability_id: string }>("resource_capabilities.jsonl"),
  };
}

const strs = (v: unknown): string[] | null => {
  if (!Array.isArray(v) || v.length === 0) return null;
  const out = v.map((x) => (typeof x === "string" ? x : JSON.stringify(x)));
  return out.length > 0 ? out : null;
};
const nonEmpty = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

/** side_effect ที่พูดถึงไฟล์ = หลักฐานของขอบเขตข้อมูลและระบบไฟล์ */
function fsWritesFrom(sideEffects: string[] | null): string[] | null {
  if (sideEffects === null) return null;
  const hits = sideEffects.filter((s) => /\.jsonl|\.json\b|\.db\b|append|write|เขียน/i.test(s));
  return hits.length > 0 ? hits : null;
}

export function deriveBoundary(
  cap: RegistryCapability,
  snap: RegistrySnapshot,
): { record: BoundaryRecord; verdict: BoundaryVerdict } {
  const from: string[] = [];
  const missing: string[] = [];
  const R = <T>(field: string, value: T | null, evidence: string): Resolved<T> => {
    if (value === null) { missing.push(field); return UNRESOLVED; }
    from.push(`${field} <- ${evidence}`);
    return value;
  };

  const linked = snap.links.filter((l) => l.capability_id === cap.capability_id);
  const resources = linked
    .map((l) => snap.resources.find((r) => r.resource_id === l.resource_id))
    .filter((r): r is RegistryResource => r !== undefined);

  const owner = resources.map((r) => r.owner_id).find(nonEmpty) ?? null;
  const location = resources.map((r) => r.source_location).find(nonEmpty) ?? null;
  const sideEffects = strs(cap.side_effects);
  const inputs = strs(cap.input_contract);
  const outputs = strs(cap.output_contract);

  // ── หลักฐานจากซอร์สจริง ใช้เมื่อ Registry ไม่พอ (พิสูจน์แล้วว่าไม่พอ)
  const src = location !== null ? resolveSources(location) : { files: [], note: "ไม่มี source_location" };
  const F = src.files;
  const env = runtimeEnv(F);
  const fsA = fsAccess(F);
  const netA = netAccess(F);
  const osA = osAccess(F);
  const authA = authSignals(F);
  const reqIn = inputs !== null ? requiredFieldsOf(inputs, F) : null;
  const errC = errorContract(F);
  const ver = location !== null ? verificationPath(location) : null;
  const C = <T>(field: string, c: { value: T; evidence: string } | null): Resolved<T> => {
    if (c === null) { missing.push(field); return UNRESOLVED; }
    from.push(`${field} <- ${c.evidence}`);
    return c.value;
  };

  const record: BoundaryRecord = {
    identity: {
      canonical_id: cap.capability_id,
      canonical_name: cap.canonical_name,
      type: cap.capability_type,
      owner: R("identity.owner", owner, "resources.owner_id ผ่าน resource_capabilities"),
    },
    execution: {
      execution_owner: R("execution.execution_owner", owner, "resources.owner_id"),
      execution_environment: C("execution.execution_environment", env),
      entrypoint: R("execution.entrypoint", location, "resources.source_location"),
      allowed_scope: R("execution.allowed_scope", null, ""),
      forbidden_scope: R("execution.forbidden_scope", null, ""),
      side_effect_boundary: R("execution.side_effect_boundary", sideEffects, "capabilities.side_effects"),
    },
    input: {
      accepted_input: R("input.accepted_input", inputs, "capabilities.input_contract"),
      required_fields: C("input.required_fields", reqIn),
      validation_requirements: R("input.validation_requirements", null, ""),
      caller_requirements: C("input.caller_requirements", authA),
    },
    output: {
      output_schema: R("output.output_schema", outputs, "capabilities.output_contract"),
      result_return_path: R("output.result_return_path", null, ""),
      evidence_return_path: R("output.evidence_return_path", null, ""),
      error_contract: C("output.error_contract", errC),
    },
    data: {
      readable: R("data.readable", null, ""),
      writable: R("data.writable", fsWritesFrom(sideEffects), "capabilities.side_effects (รายการที่ระบุการเขียนไฟล์)"),
      prohibited: R("data.prohibited", null, ""),
      persistence: R("data.persistence", null, ""),
    },
    authority: {
      may_request: R("authority.may_request", null, ""),
      may_execute: C("authority.may_execute", authA),
      required_permission: C("authority.required_permission", authA),
      credential_reference: R("authority.credential_reference", null, ""),
      approval_requirement: R("authority.approval_requirement", null, ""),
      external_commit_authority: R("authority.external_commit_authority", null, ""),
    },
    resources: {
      dependencies: R("resources.dependencies", resources.length > 0 ? resources.map((r) => r.resource_id) : null, "resource_capabilities"),
      availability_requirement: R("resources.availability_requirement", null, ""),
      service_requirement: R("resources.service_requirement", null, ""),
      concurrency_policy: R("resources.concurrency_policy", null, ""),
      cost_policy: R("resources.cost_policy", null, ""),
    },
    external_access: {
      network: C("external_access.network", netA),
      filesystem: C("external_access.filesystem", fsA),
      os_or_browser: C("external_access.os_or_browser", osA),
      external_service: R("external_access.external_service", null, ""),
      explicitly_prohibited: R("external_access.explicitly_prohibited", null, ""),
    },
    verification: {
      method: C("verification.method", ver !== null ? { value: ver.value.method, evidence: ver.evidence } : null),
      required_evidence: C("verification.required_evidence", ver !== null ? { value: ver.value.evidence, evidence: ver.evidence } : null),
      last_verified_reference: R("verification.last_verified_reference", nonEmpty(cap.verified_at ?? null), "capabilities.verified_at"),
      pass_fail_condition: R("verification.pass_fail_condition", null, ""),
    },
    derived_from: from,
    unresolved_fields: missing,
  };

  const total = from.length + missing.length;
  const verdict: BoundaryVerdict =
    missing.length === 0 ? "COMPLETE" : from.length === 0 ? "UNRESOLVED" : "PARTIAL";
  void total;
  return { record, verdict };
}
