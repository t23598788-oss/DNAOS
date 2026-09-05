/**
 * หน้าที่: ทางเข้าเดียวสำหรับอ่าน contract ทั้งหมด
 *
 * ทุกตัวประกอบ (planner, linker, validator, docs) ต้องอ่านผ่านที่นี่ เพื่อให้
 * "ความจริง" มีสำเนาเดียว และเปลี่ยนที่เก็บได้โดยไม่ต้องแก้ผู้ใช้ทุกตัว
 *
 * Dependency ที่อนุญาต: ./types.ts + data/*.json
 * สิ่งที่ห้ามแตะ:
 * - ห้ามอ่านซอร์สของระบบปลายทางที่นี่ — registry ตอบจาก contract เท่านั้น
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  AssemblyUnitV2, CommandSpec, ConnectionManifestV1, DataContractV1, DataOwnership,
  DerivationContract, EventContractV1, FinancialEffectV1, PortContract, ProjectionV1, StateMachineV1,
} from "./types";

const DATA = join(dirname(fileURLToPath(import.meta.url)), "data");

function load<T>(file: string): readonly T[] {
  const p = join(DATA, file);
  if (!existsSync(p)) return [];
  const parsed = JSON.parse(readFileSync(p, "utf-8"));
  return Array.isArray(parsed) ? parsed : (parsed.items ?? []);
}

export const units = (): readonly AssemblyUnitV2[] => load<AssemblyUnitV2>("assembly-units.json");
export const ports = (): readonly PortContract[] => load<PortContract>("port-contracts.json");
export const dataContracts = (): readonly DataContractV1[] => load<DataContractV1>("data-contracts.json");
export const connections = (): readonly ConnectionManifestV1[] => load<ConnectionManifestV1>("connection-manifests.json");
export const stateMachines = (): readonly StateMachineV1[] => load<StateMachineV1>("state-machines.json");
export const events = (): readonly EventContractV1[] => load<EventContractV1>("event-contracts.json");
export const commands = (): readonly CommandSpec[] => load<CommandSpec>("command-specs.json");
export const ownership = (): readonly DataOwnership[] => load<DataOwnership>("data-ownership.json");
export const derivations = (): readonly DerivationContract[] => load<DerivationContract>("derivation-contracts.json");
export const financialEffects = (): readonly FinancialEffectV1[] => load<FinancialEffectV1>("financial-effects.json");
export const projections = (): readonly ProjectionV1[] => load<ProjectionV1>("projections.json");

export const unitById = (id: string): AssemblyUnitV2 | null => units().find((u) => u.unit_id === id) ?? null;
export const portById = (id: string): PortContract | null => ports().find((p) => p.port_id === id) ?? null;
export const contractById = (id: string): DataContractV1 | null => dataContracts().find((c) => c.schema_id === id) ?? null;
export const commandById = (id: string): CommandSpec | null => commands().find((c) => c.command_id === id) ?? null;

/** unit ที่ประกาศว่าให้ capability นี้ */
export const unitsProviding = (capability: string): readonly AssemblyUnitV2[] =>
  units().filter((u) => u.provides_capabilities.includes(capability));
