/**
 * หน้าที่: ผูก "อาการที่เห็น" เข้ากับ "ของจริงในระบบ" ด้วยหลักฐาน ไม่ใช่การเดา
 *
 * ── สามคำที่ห้ามใช้แทนกัน ──
 *   OBSERVED_AT  เห็นที่ไหน — ไม่ได้แปลว่าที่นั่นเป็นต้นเหตุ
 *   AFFECTS      กระทบอะไร — ทิศตรงข้ามของสาเหตุ
 *   CAUSED_BY    เป็นเหตุ — สร้างได้ก็ต่อเมื่อมีหลักฐานพิสูจน์เท่านั้น
 * ข้อผิดพลาดที่เห็นบนหน้าจอไม่ได้พิสูจน์ว่าหน้าจอทำให้เกิด และการที่ A พึ่งพา B
 * ไม่ได้พิสูจน์ว่า B ทำให้ A พัง ความสัมพันธ์เชิงพึ่งพาจึงอยู่ที่ `DEPENDS_ON`
 * และได้แค่ `POSSIBLE_CAUSE` จนกว่าจะมีหลักฐานยกระดับเป็น `PROVEN_CAUSE`
 *
 * ── ไม่มีทะเบียนใหม่ ไม่มีตัวแปลตัวที่สอง ──
 * ตัวตนทั้งหมดมาจากของเดิม: `realtime-change#resolveCapabilityForPath`
 * (อิงโฟลเดอร์ของ contract ที่ทะเบียนบันทึกไว้เอง), `command-router` capability
 * registry, `runtime-control#SERVICES` และสายเลือด work/task/command/event ที่
 * มีอยู่แล้ว ไฟล์นี้ไม่ประดิษฐ์ตัวตนที่หายไป
 *
 * ── ไม่รู้ ต้องบอกว่าไม่รู้เพราะอะไร ──
 * `UNRESOLVED` มาพร้อม `missing_evidence` เสมอ ระบบต้องรู้ว่าทำไมมันวินิจฉัยไม่ได้
 * ไม่ใช่เงียบแล้วปล่อยผ่าน
 *
 * Input: `OwnerConsoleItem`
 * Output: `bindFailureEvidence`, `EvidenceBinding`, `CausalGraph`
 * Dependency ที่อนุญาต: ../realtime-change/contract.ts,
 * ../command-router/contract.ts, ../runtime-control/contract.ts, ./types.ts
 * สิ่งที่ห้ามแตะ: ห้ามสร้าง CAUSED_BY จากความพึ่งพาเพียงอย่างเดียว และห้ามให้
 * AMBIGUOUS/UNRESOLVED กลายเป็นเป้าหมายการลงมืออัตโนมัติ
 */

import { resolveCapabilityForPath, toRepoRelative } from "../realtime-change/contract";
import { listCapabilities } from "../command-router/contract";
import { SERVICES } from "../runtime-control/contract";
import { createPersistentFileStore } from "../../software/registry-database/adapters/persistent-file-store";
import type { OwnerConsoleItem } from "./types";
import { normalizeSourceLocation as canonicalSourceIdentity, covers } from "./source-identity";

export type BindingStatus = "EXACT" | "DERIVED" | "AMBIGUOUS" | "UNRESOLVED";

export type MissingEvidenceKind =
  | "MISSING_COMPONENT_IDENTITY"
  | "MISSING_CAPABILITY_IDENTITY"
  | "MISSING_RUNTIME_TRACE"
  | "MISSING_REGISTRY_RELATION"
  | "MISSING_INPUT_EVIDENCE"
  | "MISSING_OUTPUT_EVIDENCE"
  | "MISSING_CAUSAL_EVIDENCE";

/** ความสัมพันธ์เชิงสาเหตุ — แยกจากความสัมพันธ์เชิงพึ่งพาโดยเด็ดขาด */
export interface CausalGraph {
  /** ที่ที่สังเกตเห็นอาการ — ไม่ใช่คำกล่าวหา */
  readonly OBSERVED_AT: string | null;
  readonly UPSTREAM: readonly string[];
  readonly DOWNSTREAM: readonly string[];
  readonly DEPENDS_ON: readonly string[];
  readonly AFFECTS: readonly string[];
  /** ผู้ต้องสงสัยจากความพึ่งพา — ยังไม่ใช่ข้อสรุป */
  readonly POSSIBLE_CAUSE: readonly string[];
  /** ต้องมีหลักฐานเท่านั้น ไม่มีหลักฐาน = null ตลอดไป */
  readonly PROVEN_CAUSE: string | null;
  readonly proven_cause_evidence: readonly string[];
}

export interface EvidenceBinding {
  readonly work_id: string;
  readonly observed_at_boundary: string | null;
  readonly bound_component: string | null;
  readonly bound_capability: string | null;
  readonly registry_refs: readonly string[];
  readonly runtime_owner: string | null;
  readonly binding_status: BindingStatus;
  readonly binding_evidence: readonly string[];
  readonly candidates: readonly string[];
  readonly missing_evidence: readonly MissingEvidenceKind[];
  readonly causal: CausalGraph;
  /** ชนิดข้อมูลกันไม่ให้การผูกกลายเป็นใบอนุญาตลงมือ */
  readonly ready_for_execution: false;
}

interface ResourceRow { resource_id: string; owner_id: string; source_location: string }

/**
 * ทำ `source_location` ให้เทียบได้ ตามรูปที่ทะเบียน **บันทึกจริง**
 *
 * ทะเบียนบันทึกไว้สามรูป และทั้งสามมีอยู่จริงในข้อมูล:
 *   โฟลเดอร์   `control/agent-gateway/`
 *   ไฟล์       `control/runtime-control/contract.ts`
 *   มีคำอธิบาย `control/runtime-control/ (boot-orchestrator.ts, host-runtime.ts …)`
 * เดิมตัวผูกเทียบเฉพาะรูปโฟลเดอร์ ทำให้ของที่ทะเบียน **ประกาศเจ้าของไว้แล้ว**
 * ถูกอ่านว่า "ไม่มีในทะเบียน" — ปัญหาอยู่ที่วิธีอ่าน ไม่ใช่ที่ทะเบียนขาดแถว
 */
function normalizeSourceLocation(raw: string): string {
  return String(raw ?? "").split(" (")[0].trim();
}

/**
 * path ของความล้มเหลว -> ตัวตน canonical
 *
 * ปัจจุบันตัวผูกรับ path จาก evidence ของ repo นี้ จึงตีความเป็น
 * `repo:dna-os-infrastructure` เว้นแต่ข้อความมีเบาะแสรีโปอื่นอยู่ในตัว
 * ไม่ใช่การสมมติ — `normalizeSourceLocation` ตัดสินจากรูปของ path เอง
 */
function targetIdentityFor(repoRelativePath: string): ReturnType<typeof canonicalSourceIdentity> {
  return canonicalSourceIdentity(repoRelativePath);
}

/**
 * เจ้าของตามทะเบียน canonical — ตรงตัว หรือเป็นโฟลเดอร์แม่ของ path นี้
 *
 * เลือก `source_location` ที่ยาวที่สุดที่ครอบ path จริง เพื่อให้ไฟล์ที่มีเจ้าของ
 * เฉพาะตัว (contract.ts) ไม่ถูกกลืนโดยเจ้าของระดับโฟลเดอร์
 * **ไม่มีการเดา**: ถ้าไม่มี source_location ใดครอบ path นี้ คืน null
 */
function canonicalOwnerFor(repoRelativePath: string): ResourceRow | null {
  const store = createPersistentFileStore() as unknown as {
    listResourceRows?: () => readonly ResourceRow[];
    findResourceBySourceLocation?: (s: string) => ResourceRow | null;
  };
  if (typeof store.listResourceRows !== "function") {
    // ตัวอ่านที่ไม่มีการแจกแจง ยังใช้ทางเดิมได้ (เทียบตรงตัวเท่านั้น)
    return store.findResourceBySourceLocation?.(repoRelativePath) ?? null;
  }
  // ── เทียบด้วยตัวตนที่รู้รีโป ไม่ใช่ด้วยสตริง path ──
  // `server/server.mjs` ในสองรีโปคือคนละของ การเทียบสตริงอย่างเดียวจะจับคู่ผิด
  const target = targetIdentityFor(repoRelativePath);
  if (target === null) return null;

  let best: ResourceRow | null = null;
  let bestLen = -1;
  for (const row of store.listResourceRows()) {
    const owner = canonicalSourceIdentity(row.source_location);
    if (owner === null) continue;                       // absolute path ที่แปลไม่ได้ = ไม่ใช้ตัดสิน
    if (!covers(owner, target)) continue;               // คนละรีโป = ไม่นับ ไม่ว่า path จะเหมือนแค่ไหน
    const len = owner.repo_relative_path.length;
    if (len > bestLen) { best = row; bestLen = len; }
  }
  return best;
}

/** capability ที่ผูกกับ resource นี้ตามตาราง resource_capabilities ของทะเบียน */
function capabilitiesForResource(resourceId: string): readonly string[] {
  const store = createPersistentFileStore() as unknown as {
    listResourceCapabilityLinks?: () => readonly { resource_id: string; capability_id: string }[];
  };
  if (typeof store.listResourceCapabilityLinks !== "function") return [];
  return store.listResourceCapabilityLinks()
    .filter((l) => l.resource_id === resourceId)
    .map((l) => l.capability_id);
}

/** ชื่อบริการที่ runtime-control ประกาศ — ตัวตนของขอบเขตรันไทม์ที่พิสูจน์ได้ */
function serviceBoundaryFor(text: string): { service_id: string; port: number } | null {
  for (const [id, def] of Object.entries(SERVICES)) {
    if (text.includes(id)) return { service_id: id, port: (def as { port: number }).port };
  }
  return null;
}

/** ผู้สมัคร capability จากชื่อที่ผู้รายงานให้มา — อาจได้หลายตัว */
function capabilityCandidatesByName(name: string): readonly string[] {
  const needle = name.toLowerCase();
  return listCapabilities()
    .filter((c) => {
      const cn = String((c as { canonical_name?: string }).canonical_name ?? "").toLowerCase();
      const contract = String((c as { contract?: string }).contract ?? "").toLowerCase();
      return (cn.length > 0 && (cn === needle || needle.includes(cn)))
        || (contract.length > 0 && needle.length > 0 && contract.startsWith(`${needle}/`));
    })
    .map((c) => c.capability_id);
}

/**
 * ผูกความล้มเหลวหนึ่งเรื่องเข้ากับของจริงในระบบ
 *
 * ลำดับความแข็งของหลักฐาน: path จริงที่ทะเบียนเป็นเจ้าของ (EXACT) >
 * ชื่อที่ชี้ไป capability เดียว (DERIVED) > ชี้ได้หลายตัว (AMBIGUOUS) >
 * ไม่มีอะไรให้ยึด (UNRESOLVED)
 */
export function bindFailureEvidence(item: OwnerConsoleItem): EvidenceBinding {
  const ev = item.evidence ?? {};
  const evidence: string[] = [];
  const missing: MissingEvidenceKind[] = [];
  let status: BindingStatus = "UNRESOLVED";
  let capability: string | null = null;
  let component: string | null = null;
  const registryRefs: string[] = [];
  let candidates: string[] = [];

  // 1) path จริง -> เจ้าของตามทะเบียน = หลักฐานตรงที่สุด
  //
  // ถามทะเบียน canonical ก่อน (`findResourceBySourceLocation` ของมันเอง ซึ่ง
  // เทียบ source_location แบบตรงตัว ไม่ใช่ใกล้เคียง) แล้วจึงตกลงมาที่ทะเบียนของ
  // command-router ทะเบียนแรกใหญ่กว่าและเป็นแหล่งของกราฟระบบ การถามตัวเล็ก
  // ก่อนจะทำให้ของที่มีอยู่จริงถูกอ่านว่า "ไม่มีในทะเบียน"
  if (typeof ev.file_path === "string" && ev.file_path.length > 0) {
    const rel = toRepoRelative(ev.file_path);
    component = rel;

    const canonical = canonicalOwnerFor(rel);
    if (canonical !== null) {
      const owners = capabilitiesForResource(canonical.resource_id);
      // capability ที่ผูกไว้จริงคือเจ้าของ ไม่ใช่ owner_id ซึ่งเป็นระดับ repo
      if (owners.length === 1) {
        capability = owners[0];
        status = "EXACT";
        evidence.push(`path->resource->capability: ${rel} -> ${canonical.resource_id} -> ${owners[0]}`);
      } else if (owners.length > 1) {
        status = "AMBIGUOUS";
        candidates = [...owners];
        missing.push("MISSING_CAPABILITY_IDENTITY");
        evidence.push(`resource ${canonical.resource_id} ผูกกับ ${owners.length} capability — ไม่เลือกให้`);
      } else {
        // มี resource แต่ไม่มี capability ผูก — เป็นของที่ทะเบียนรู้จักแต่ยังไม่มีเจ้าของหน้าที่
        status = "DERIVED";
        missing.push("MISSING_CAPABILITY_IDENTITY");
        evidence.push(`resource ${canonical.resource_id} ไม่มี capability ผูกไว้`);
      }
      registryRefs.push(`registry-database:resource=${canonical.resource_id}`, `source_location=${normalizeSourceLocation(canonical.source_location)}`);
    }

    const owned = capability === null ? resolveCapabilityForPath(rel) : null;
    if (owned) {
      capability = owned.capability_id;
      status = "EXACT";
      registryRefs.push(...owned.evidence);
      evidence.push(`path->capability: ${rel} -> ${owned.capability_id} (provenance=${owned.provenance})`);
    } else if (capability === null) {
      missing.push("MISSING_REGISTRY_RELATION");
      evidence.push(`path ${rel} ไม่มี resource/capability ใดในทะเบียนใดประกาศเป็นเจ้าของ`);
    }
  } else {
    missing.push("MISSING_COMPONENT_IDENTITY");
  }

  // 2) ชื่อที่ผู้รายงานให้มา -> capability (อ่อนกว่า path)
  if (capability === null && typeof ev.source_capability === "string" && ev.source_capability.length > 0) {
    candidates = [...capabilityCandidatesByName(ev.source_capability)];
    if (candidates.length === 1) {
      capability = candidates[0];
      component = component ?? ev.source_capability;
      status = "DERIVED";
      registryRefs.push(`command-router/capability-registry#${candidates[0]}`);
      evidence.push(`name->capability: "${ev.source_capability}" -> ${candidates[0]} (ผู้สมัครเดียว)`);
    } else if (candidates.length > 1) {
      status = "AMBIGUOUS";
      evidence.push(`name "${ev.source_capability}" ชี้ได้ ${candidates.length} capability — ไม่เลือกให้`);
      missing.push("MISSING_CAPABILITY_IDENTITY");
    } else {
      missing.push("MISSING_CAPABILITY_IDENTITY");
      evidence.push(`name "${ev.source_capability}" ไม่ตรง capability ใดในทะเบียน`);
    }
  } else if (capability === null) {
    missing.push("MISSING_CAPABILITY_IDENTITY");
  }

  // 3) ขอบเขตรันไทม์ที่สังเกตเห็น — เป็น OBSERVED_AT ไม่ใช่ CAUSED_BY
  const surface = `${item.raw_command_text} ${JSON.stringify(ev)}`;
  const boundary = serviceBoundaryFor(surface);
  if (boundary) evidence.push(`observed boundary: service=${boundary.service_id} port=${boundary.port}`);
  else missing.push("MISSING_RUNTIME_TRACE");

  if (typeof ev.stdout !== "string" && typeof ev.stderr !== "string") missing.push("MISSING_OUTPUT_EVIDENCE");
  if (item.origin_event_id === null) missing.push("MISSING_INPUT_EVIDENCE");

  // 4) กราฟเชิงสาเหตุ — ความพึ่งพาไม่เท่ากับสาเหตุ
  const upstream = item.parent_work_id ? [item.parent_work_id] : [];
  const dependsOn = capability !== null ? [capability] : [];
  const causal: CausalGraph = {
    OBSERVED_AT: boundary ? `service:${boundary.service_id}` : component,
    UPSTREAM: upstream,
    DOWNSTREAM: [],
    DEPENDS_ON: dependsOn,
    AFFECTS: [],
    // ผู้ต้องสงสัยมาจากงานแม่ที่มีหลักฐานความพึ่งพา ไม่ใช่จากทุกอย่างที่อยู่ใกล้
    POSSIBLE_CAUSE: [...upstream, ...dependsOn],
    PROVEN_CAUSE: null,
    proven_cause_evidence: [],
  };
  if (causal.PROVEN_CAUSE === null) missing.push("MISSING_CAUSAL_EVIDENCE");

  return {
    work_id: item.work_id,
    observed_at_boundary: causal.OBSERVED_AT,
    bound_component: component,
    bound_capability: capability,
    registry_refs: registryRefs,
    runtime_owner: boundary?.service_id ?? null,
    binding_status: status,
    binding_evidence: evidence,
    candidates,
    missing_evidence: [...new Set(missing)],
    causal,
    ready_for_execution: false,
  };
}

/**
 * ยกระดับเป็น PROVEN_CAUSE ได้ก็ต่อเมื่อมีหลักฐานที่พิสูจน์เหตุ
 *
 * ไม่มีเส้นทางอื่นในไฟล์นี้ที่ตั้งค่า `PROVEN_CAUSE` ได้ — การเดาจึงเป็นไปไม่ได้
 * เชิงโครงสร้าง ไม่ใช่แค่เชิงมารยาท
 */
export function withProvenCause(
  binding: EvidenceBinding, cause: string, causalEvidence: readonly string[],
): EvidenceBinding {
  if (causalEvidence.length === 0) return binding;
  return {
    ...binding,
    causal: { ...binding.causal, PROVEN_CAUSE: cause, proven_cause_evidence: causalEvidence },
    missing_evidence: binding.missing_evidence.filter((m) => m !== "MISSING_CAUSAL_EVIDENCE"),
  };
}

export interface PathOwnership {
  readonly repo_relative_path: string;
  readonly resource_id: string | null;
  readonly capability_id: string | null;
  readonly repository_id: string | null;
  readonly status: BindingStatus;
  readonly evidence_refs: readonly string[];
}

/**
 * เจ้าของของ path เดียว โดยไม่ต้องมีความล้มเหลวเป็นตัวตั้ง
 *
 * `bindFailureEvidence` ต้องการ `OwnerConsoleItem` เพราะมันเกิดจากเหตุล้มเหลว
 * แต่การผูกขั้นของ flow กับเจ้าของเกิดตอนที่ยังไม่มีอะไรพัง จึงต้องมีทางเข้า
 * ที่ไม่บังคับให้ประดิษฐ์ความล้มเหลวปลอมขึ้นมาเพื่อถามทะเบียน — ตรรกะการค้นหา
 * เป็นตัวเดียวกัน ไม่ใช่สำเนา
 */
export function resolveOwnershipForPath(rawPath: string): PathOwnership {
  const rel = toRepoRelative(rawPath);
  const canonical = canonicalOwnerFor(rel);
  const refs: string[] = [];
  let capability: string | null = null;
  let status: BindingStatus = "UNRESOLVED";

  if (canonical !== null) {
    refs.push(`registry-database:resource=${canonical.resource_id}`);
    const owners = capabilitiesForResource(canonical.resource_id);
    if (owners.length === 1) { capability = owners[0]; status = "EXACT"; }
    else if (owners.length > 1) { status = "AMBIGUOUS"; }
    else { status = "DERIVED"; }
  }
  if (capability === null) {
    const owned = resolveCapabilityForPath(rel);
    if (owned) { capability = owned.capability_id; status = "EXACT"; refs.push(...owned.evidence); }
  }
  const ident = canonicalSourceIdentity(rel);
  return {
    repo_relative_path: ident?.repo_relative_path ?? rel,
    resource_id: canonical?.resource_id ?? null,
    capability_id: capability,
    repository_id: ident?.repository_id ?? null,
    status, evidence_refs: refs,
  };
}
