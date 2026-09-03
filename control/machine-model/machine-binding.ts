/**
 * หน้าที่: ผูก 945 โหนดของโมเดลเข้ากับตัวตนของเครื่อง โดยไม่แตะตัวตนเดิมสักตัว
 *
 * ── ผูก ไม่ใช่เขียนทับ ──
 * `resource_id`, `capability_id`, `repository_id` ทุกตัวคงเดิมทุกอักขระ การผูก
 * เป็นการทาบแผนที่ใบใหม่ลงบนของเดิม ไม่ใช่การเปลี่ยนของเดิมให้มีชื่อเครื่องต่อท้าย
 * ถ้าทำอย่างหลัง ตัวตนที่อ้างอิงกันอยู่ทั้งระบบจะพังพร้อมกันหมด
 *
 * ── เหตุผลของการผูก ต้องพูดออกมาได้ ──
 * โหนดเหล่านี้ถูกอ่านจากคลังบนเครื่องนี้ ผ่าน state root ของการติดตั้งนี้ นั่นคือ
 * `LOCAL_STORE_READ_ON_THIS_INSTALLATION` — เป็นการอนุมานจากที่มาของข้อมูล
 * ไม่ใช่หลักฐานว่าของสิ่งนั้นวางอยู่บนเครื่องนี้จริงทางกายภาพ และมันไม่แอบอ้างว่าเป็น
 *
 * ── ยังไม่มีชื่อเครื่อง = ผูกไม่ได้ ──
 * `whichMachine` คืน null เมื่อยังไม่ทำพิธีเริ่มติดตั้ง ไม่ใช่คืนชื่อชั่วคราว
 *
 * Input: `MachineModel`
 * Output: `whichMachine`, `resourcesOf`, `machineState`
 * Dependency ที่อนุญาต: ./model.ts, installation-initialization (อ่าน)
 * สิ่งที่ห้ามแตะ: ห้ามแก้ id เดิม ห้ามเขียนไฟล์ ห้ามแทนชื่อเครื่องด้วยค่าอื่น
 */

import { readInstallationInitialization } from "../../execution/installation-initialization/contract";
import { buildMachineModel, machineCensus } from "./model";
import type { MachineModel, MachineNode, LayerCoverage } from "./model";
import type { MachineFact, SoftwareEntity, DatabaseEntity } from "./census";
import type { DependencyIndex, DependencyEdge } from "./dependency-index";

export type BindingBasis = "LOCAL_STORE_READ_ON_THIS_INSTALLATION";

export interface MachineIdentity {
  readonly machine_id: string | null;
  readonly initialization_id: string | null;
  readonly created_at: string | null;
  readonly state: "INITIALIZED" | "UNINITIALIZED" | "CORRUPT";
  readonly persistence_path: string | null;
}

/** ตัวตนของเครื่องนี้ อ่านจากพิธีเริ่มติดตั้ง — ไม่มีทางอื่น */
export function currentMachineIdentity(): MachineIdentity {
  const r = readInstallationInitialization();
  if (r.state === "INITIALIZED") {
    return { machine_id: r.initialization.installation_id, initialization_id: r.initialization.initialization_id,
      created_at: r.initialization.created_at, state: "INITIALIZED", persistence_path: r.path ?? null };
  }
  return { machine_id: null, initialization_id: null, created_at: null,
    state: r.state === "CORRUPT" ? "CORRUPT" : "UNINITIALIZED", persistence_path: r.path ?? null };
}

export interface NodeBinding {
  readonly node_id: string;
  readonly machine_id: string | null;
  readonly binding_basis: BindingBasis | null;
  readonly reason: string;
}

/** โหนดนี้อยู่บนเครื่องไหน */
export function whichMachine(nodeId: string, model?: MachineModel): NodeBinding {
  const m = model ?? buildMachineModel();
  const identity = currentMachineIdentity();
  const known = m.nodes.some((n) => n.node_id === nodeId);
  if (!known) {
    return { node_id: nodeId, machine_id: null, binding_basis: null, reason: "โมเดลนี้ไม่รู้จักโหนดนี้" };
  }
  if (identity.machine_id === null) {
    return { node_id: nodeId, machine_id: null, binding_basis: null,
      reason: `เครื่องยังไม่มีตัวตน (${identity.state}) — ผูกไม่ได้ และไม่แทนด้วยค่าอื่น` };
  }
  return { node_id: nodeId, machine_id: identity.machine_id,
    binding_basis: "LOCAL_STORE_READ_ON_THIS_INSTALLATION",
    reason: "อ่านจากคลังบนเครื่องนี้ผ่าน state root ของการติดตั้งนี้" };
}

/** ทุกอย่างที่ผูกกับเครื่องนี้ — id เดิมไม่ถูกแตะ */
export function resourcesOf(machineId: string, model?: MachineModel): readonly MachineNode[] {
  const m = model ?? buildMachineModel();
  const identity = currentMachineIdentity();
  return identity.machine_id === machineId ? m.nodes : [];
}

export interface MachineStateSummary {
  readonly machine_id: string | null;
  readonly identity_state: MachineIdentity["state"];
  readonly persistence_path: string | null;
  readonly bound_node_count: number;
  readonly edge_count: number;
  readonly coverage: readonly LayerCoverage[];
  readonly represented_layers: number;
  readonly not_represented_layers: readonly string[];
  readonly built_from: readonly string[];
}

/** สถานะของเครื่องหนึ่งใบ — คำตอบเดียวกันทุกครั้งจากหลักฐานชุดเดิม */
export function machineState(machineId: string, model?: MachineModel): MachineStateSummary {
  const m = model ?? buildMachineModel();
  const identity = currentMachineIdentity();
  const bound = resourcesOf(machineId, m);
  return {
    machine_id: identity.machine_id === machineId ? machineId : null,
    identity_state: identity.state,
    persistence_path: identity.persistence_path,
    bound_node_count: bound.length,
    edge_count: identity.machine_id === machineId ? m.edges.length : 0,
    coverage: m.coverage,
    represented_layers: m.coverage.filter((c) => c.status === "REPRESENTED").length,
    not_represented_layers: m.coverage.filter((c) => c.status !== "REPRESENTED").map((c) => c.layer_id),
    built_from: m.built_from,
  };
}


// ───────────────────────── คำถามที่ต้องตอบได้จากร่างกายของเครื่อง ─────────────────────────

const OS_FACTS = new Set(["OS_FAMILY", "OS_VERSION", "OS_BUILD", "KERNEL_VERSION", "BOOT_TIME", "UPTIME_SECONDS"]);

/** เครื่องนี้เป็นฮาร์ดแวร์อะไร */
export function hardwareOf(machineId: string): readonly MachineFact[] {
  const id = currentMachineIdentity();
  if (id.machine_id !== machineId) return [];
  return machineCensus(machineId).facts.filter((f) => !OS_FACTS.has(f.fact_type));
}

/** เครื่องนี้รันระบบปฏิบัติการอะไร */
export function operatingSystemOf(machineId: string): readonly MachineFact[] {
  const id = currentMachineIdentity();
  if (id.machine_id !== machineId) return [];
  return machineCensus(machineId).facts.filter((f) => OS_FACTS.has(f.fact_type));
}

/** เครื่องนี้มีซอฟต์แวร์อะไรบ้าง */
export function softwareOf(machineId: string, kind?: SoftwareEntity["kind"]): readonly SoftwareEntity[] {
  const id = currentMachineIdentity();
  if (id.machine_id !== machineId) return [];
  const all = machineCensus(machineId).software;
  return kind === undefined ? all : all.filter((s) => s.kind === kind);
}

/** เครื่องนี้มีฐานข้อมูล/ที่เก็บข้อมูลอะไรบ้าง */
export function databasesOf(machineId: string, kind?: DatabaseEntity["kind"]): readonly DatabaseEntity[] {
  const id = currentMachineIdentity();
  if (id.machine_id !== machineId) return [];
  const all = machineCensus(machineId).databases;
  return kind === undefined ? all : all.filter((d) => d.kind === kind);
}

export interface ResourceLocation {
  readonly resource: string;
  readonly status: "FOUND" | "NOT_FOUND" | "AMBIGUOUS" | "NO_MACHINE_IDENTITY";
  readonly install_location: string | null;
  readonly machine_id: string | null;
  readonly evidence_ref: string | null;
  readonly candidates: readonly string[];
}

/**
 * หาซอฟต์แวร์จากตัวตนหรือจากชื่อ
 *
 * ชื่อเดียวกันอยู่ได้หลายชนิด — `node` เป็นทั้งแพ็กเกจ homebrew และ runtime
 * การหยิบตัวแรกมาตอบคือการเลือกแทนผู้ถามโดยไม่บอก จึงคืน `AMBIGUOUS` พร้อม
 * รายชื่อผู้เข้าข่าย ให้ผู้ถามระบุ `software_id` มาเอง
 */
type SoftwareLookup =
  | { readonly status: "FOUND"; readonly entity: SoftwareEntity }
  | { readonly status: "NOT_FOUND" }
  | { readonly status: "AMBIGUOUS"; readonly candidates: readonly string[] };

function findSoftware(resource: string, machineId: string): SoftwareLookup {
  const all = machineCensus(machineId).software;
  const exact = all.find((s) => s.software_id === resource);
  if (exact !== undefined) return { status: "FOUND", entity: exact };
  const byName = all.filter((s) => s.name === resource);
  if (byName.length === 1) return { status: "FOUND", entity: byName[0] };
  if (byName.length > 1) return { status: "AMBIGUOUS", candidates: byName.map((s) => s.software_id) };
  return { status: "NOT_FOUND" };
}

/** ของสิ่งนี้อยู่ที่ไหน */
export function whereIs(resource: string): ResourceLocation {
  const id = currentMachineIdentity();
  if (id.machine_id === null) {
    return { resource, status: "NO_MACHINE_IDENTITY", install_location: null, machine_id: null, evidence_ref: null, candidates: [] };
  }
  const hit = findSoftware(resource, id.machine_id);
  if (hit.status === "AMBIGUOUS") {
    return { resource, status: "AMBIGUOUS", install_location: null, machine_id: id.machine_id, evidence_ref: null, candidates: hit.candidates };
  }
  if (hit.status === "NOT_FOUND") {
    return { resource, status: "NOT_FOUND", install_location: null, machine_id: null, evidence_ref: null, candidates: [] };
  }
  return { resource, status: "FOUND", install_location: hit.entity.install_location,
    machine_id: hit.entity.machine_id, evidence_ref: hit.entity.evidence_ref, candidates: [] };
}

/**
 * ของสิ่งนี้ใช้ได้บนเครื่องนี้ไหม
 *
 * ตอบเรื่องการมีอยู่เท่านั้น — ไม่ได้แปลว่าได้รับอนุญาตให้ใช้ สิทธิ์เป็นคนละ
 * ข้อเท็จจริงและอยู่คนละชั้น
 */
export function availableOn(resource: string, machineId: string): { readonly available: boolean; readonly reason: string } {
  const id = currentMachineIdentity();
  if (id.machine_id !== machineId) return { available: false, reason: "ไม่ใช่เครื่องนี้ — ตอบแทนเครื่องอื่นไม่ได้" };
  const hit = findSoftware(resource, machineId);
  if (hit.status === "NOT_FOUND") return { available: false, reason: "การสำรวจไม่พบของสิ่งนี้บนเครื่องนี้" };
  if (hit.status === "AMBIGUOUS") {
    return { available: false, reason: `ชื่อนี้ตรงกับหลายรายการ (${hit.candidates.join(", ")}) — ระบุ software_id มา` };
  }
  const s = hit.entity;
  return s.availability === "AVAILABLE"
    ? { available: true, reason: `พบที่ ${s.install_location ?? s.invocation ?? "แหล่งที่ประกาศไว้"} — มีอยู่ ไม่ได้แปลว่าได้รับอนุญาต` }
    : { available: false, reason: "ประกาศไว้แต่ตำแหน่งติดตั้งหายไป" };
}

/** เรียกของสิ่งนี้ยังไง — `null` เมื่อไม่มีขอบเขตการเรียกที่วัดได้ */
export function invocationOf(resource: string): string | null {
  const id = currentMachineIdentity();
  if (id.machine_id === null) return null;
  const hit = findSoftware(resource, id.machine_id);
  return hit.status === "FOUND" ? hit.entity.invocation : null;
}

/** ของสิ่งนี้พึ่งอะไร — เฉพาะเส้นที่ประกาศความหมายไว้แล้ว */
export function dependenciesOfResource(resource: string, index: DependencyIndex, model: MachineModel): readonly DependencyEdge[] {
  const node = resolveNode(resource, model);
  return node === null ? [] : index.dependenciesOf(node);
}

/** อะไรพึ่งของสิ่งนี้ — เฉพาะเส้นที่ประกาศความหมายไว้แล้ว */
export function dependentsOfResource(resource: string, index: DependencyIndex, model: MachineModel): readonly DependencyEdge[] {
  const node = resolveNode(resource, model);
  return node === null ? [] : index.dependentsOf(node);
}

function resolveNode(resource: string, model: MachineModel): string | null {
  if (model.nodes.some((n) => n.node_id === resource)) return resource;
  const byLabel = model.nodes.filter((n) => n.label === resource);
  return byLabel.length === 1 ? byLabel[0].node_id : null;
}
