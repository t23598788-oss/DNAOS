/**
 * หน้าที่: ต่อ resolveCapabilityRoute เข้ากับทะเบียนจริงบนดิสก์ — ที่เดียวใน
 * โมดูลนี้ที่แตะ I/O (Owner, 2026-09-02).
 *
 * ทุกไฟล์อ่านผ่าน observation-integrity ไม่ใช่ readFileSync ตรง ๆ เพราะการอ่าน
 * ที่ไม่ได้ยืนยันเคยทำให้ join ที่มีอยู่จริงกลายเป็น "ไม่มีความสัมพันธ์" มาแล้ว
 * ในระบบนี้ ถ้าอ่านไม่ได้ ต้องรู้ว่าอ่านไม่ได้ ไม่ใช่ได้ list ว่าง
 *
 * Input: none (path คงที่)
 * Output: resolveRouteFromDisk, loadRouteStores
 * Dependency ที่อนุญาต: ./contract, ../observation-integrity/verified-read
 * สิ่งที่ห้ามแตะ: ห้ามคืน list ว่างเมื่ออ่านไม่สำเร็จ, ห้ามเขียนไฟล์.
 */
import { join } from "node:path";
import { verifiedReadJsonl } from "../observation-integrity/verified-read";
import { resolveCapabilityRoute, type RouteResolution, type RouteStores } from "./contract";

const P = {
  capabilities: "software/registry-database/data/canonical/capabilities.jsonl",
  resources: "software/registry-database/data/canonical/resources.jsonl",
  resourceCapabilities: "software/registry-database/data/canonical/resource_capabilities.jsonl",
  runtimeTargets: "control/machine-observation/data/runtime-targets.jsonl",
  connectionDeclarations: "connections/connection-registry/data/connection-declarations.jsonl",
} as const;

export class RouteStoreUnreadable extends Error {
  constructor(public readonly path: string, public readonly outcome: string, public readonly reason: string) {
    super(`ROUTE_STORE_UNREADABLE: ${path} (${outcome}/${reason}) — ไม่ resolve จากการอ่านที่ยืนยันไม่ได้`);
  }
}

function read<T>(rel: string): readonly T[] {
  const v = verifiedReadJsonl<T>(join(process.cwd(), rel));
  // ไฟล์ที่ยังไม่เคยมี = ยังไม่มีการประกาศ ซึ่งเป็นคำตอบที่ถูก ไม่ใช่ความผิดพลาด
  if (v.outcome === "READ_FAILED" && v.integrity.reason === "ALL_METHODS_ERRORED") return [];
  if (v.outcome !== "READ_SUCCEEDED") throw new RouteStoreUnreadable(rel, v.outcome, v.integrity.reason);
  return v.rows ?? [];
}

export function loadRouteStores(): RouteStores {
  return {
    capabilities: read(P.capabilities),
    resources: read(P.resources),
    resourceCapabilities: read(P.resourceCapabilities),
    runtimeTargets: read(P.runtimeTargets),
    connectionDeclarations: read(P.connectionDeclarations),
  };
}

/** Resolve จากทะเบียนจริง — capability ที่ลงทะเบียนถูกต้องต้องได้ผลโดยไม่ต้องแก้ไฟล์นี้ */
export function resolveRouteFromDisk(query: string, now: () => Date = () => new Date()): RouteResolution {
  return resolveCapabilityRoute(query, loadRouteStores(), now);
}
