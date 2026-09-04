/**
 * R2 · การอนุมานขอบเขตจากหลักฐานใน Registry เท่านั้น
 *
 * กฎ: ทุกฟิลด์ต้องชี้กลับไปที่หลักฐานได้ ถ้าชี้ไม่ได้ = UNRESOLVED
 * ไม่มีที่ใดในไฟล์นี้ที่เดาค่าจากชื่อ จากรูปแบบ หรือจากความน่าจะเป็น
 */
import { readFileSync } from "node:fs";
import { UNRESOLVED } from "./schema";
import { resolveSources, runtimeEnv, fsAccess, netAccess, osAccess, authSignals,
         requiredFieldsOf, errorContract, verificationPath, cite } from "./source-evidence";
import { allowedScope, forbiddenScope, prohibitedData, lockedConstraint } from "./policy-source";
import { verificationOutcome, passFailCondition } from "./verification-outcome";
import { policyFor } from "./approved-policy";
import { runtimeStaticFor } from "./runtime-static";
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
  const entry = location ?? "";
  const allow = allowedScope(entry);
  const lock = lockedConstraint(entry);
  const forbidBase = forbiddenScope(entry);
  const forbid = forbidBase !== null && lock !== null
    ? cite([...forbidBase.value, ...lock.value], `${forbidBase.evidence} · ${lock.evidence}`)
    : forbidBase;
  const prohibited = prohibitedData(entry);
  const outcome = ver !== null ? verificationOutcome(ver.value.evidence) : null;
  const passFail = ver !== null ? passFailCondition(ver.value.method) : null;
  const pol = policyFor(cap.capability_id);
  const rt = runtimeStaticFor(cap.capability_id);
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
      allowed_scope: C("execution.allowed_scope", allow),
      forbidden_scope: C("execution.forbidden_scope", forbid),
      side_effect_boundary: R("execution.side_effect_boundary", sideEffects, "capabilities.side_effects"),
    },
    input: {
      accepted_input: R("input.accepted_input", inputs, "capabilities.input_contract"),
      required_fields: C("input.required_fields", reqIn),
      validation_requirements: C("input.validation_requirements", pol?.validation_requirements ?? null),
      caller_requirements: C("input.caller_requirements", authA),
    },
    output: {
      output_schema: R("output.output_schema", outputs, "capabilities.output_contract"),
      result_return_path: C("output.result_return_path", rt.result_return_path),
      evidence_return_path: C("output.evidence_return_path", rt.evidence_return_path),
      error_contract: C("output.error_contract", errC),
    },
    data: {
      readable: C("data.readable", rt.readable),
      writable: R("data.writable", fsWritesFrom(sideEffects), "capabilities.side_effects (รายการที่ระบุการเขียนไฟล์)"),
      prohibited: C("data.prohibited", prohibited),
      persistence: C("data.persistence", pol?.persistence ?? null),
    },
    authority: {
      may_request: C("authority.may_request", pol?.may_request ?? null),
      may_execute: C("authority.may_execute", authA),
      required_permission: C("authority.required_permission", authA),
      credential_reference: C("authority.credential_reference", rt.credential_reference),
      approval_requirement: C("authority.approval_requirement", pol?.approval_requirement ?? null),
      external_commit_authority: C("authority.external_commit_authority", pol?.external_commit_authority ?? null),
    },
    resources: {
      dependencies: R("resources.dependencies", resources.length > 0 ? resources.map((r) => r.resource_id) : null, "resource_capabilities"),
      availability_requirement: C("resources.availability_requirement", pol?.availability_requirement ?? null),
      service_requirement: C("resources.service_requirement", pol?.service_requirement ?? null),
      concurrency_policy: C("resources.concurrency_policy", pol?.concurrency_policy ?? null),
      cost_policy: C("resources.cost_policy", pol?.cost_policy ?? null),
    },
    external_access: {
      network: C("external_access.network", netA),
      filesystem: C("external_access.filesystem", fsA),
      os_or_browser: C("external_access.os_or_browser", osA),
      external_service: C("external_access.external_service", rt.external_service),
      explicitly_prohibited: C("external_access.explicitly_prohibited", prohibited),
    },
    verification: {
      method: C("verification.method", ver !== null ? { value: ver.value.method, evidence: ver.evidence } : null),
      required_evidence: C("verification.required_evidence", ver !== null ? { value: ver.value.evidence, evidence: ver.evidence } : null),
      last_verified_reference: C("verification.last_verified_reference", outcome),
      pass_fail_condition: C("verification.pass_fail_condition", passFail),
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
