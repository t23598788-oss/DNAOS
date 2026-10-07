/**
 * หน้าที่: metadata สำหรับ "การแสดงผล" ของทรัพยากรและการกระทำ — ชื่อที่คนอ่าน
 * กับกุญแจไอคอน (Owner, PHASE 11).
 *
 * เป็น presentation ล้วน ๆ: ไม่มีบรรทัดใดในระบบที่เลือกทรัพยากรจากค่าที่นี่
 * การเลือกยังเป็น required_capability -> ทะเบียน -> execution-profile -> eligibility
 * เสมอ ไฟล์นี้แค่ตอบว่า "เมื่อเลือกได้แล้ว จะวาดมันยังไง"
 *
 * ชื่อที่แสดงมาจาก resource_name ของ profile ซึ่งอ่านมาจาก source_location ของ
 * ทะเบียนอีกที — ไม่ได้เขียนชื่อผู้ให้บริการไว้ตายตัวในตรรกะใด
 *
 * Input: resource_id.
 * Output: presentationFor, iconForAction.
 * Dependency ที่อนุญาต: ../../software/execution-profile/contract.ts.
 * สิ่งที่ห้ามแตะ: ห้ามให้ตรรกะการเลือกทรัพยากรอ่านไฟล์นี้.
 */
import { latestProfiles } from "../../software/execution-profile/contract";
import type { ActionKind } from "./types";

export interface ResourcePresentation {
  resource_id: string;
  display_name: string;
  icon_key: string;
  resource_category: string;
}

/** ชนิดการกระทำ -> กุญแจไอคอน (ไอคอนจริงอยู่ในชั้น asset ของ UI) */
const ACTION_ICON: Readonly<Record<ActionKind, string>> = {
  OWNER_REQUEST: "owner", SUBJECT_RESOLUTION: "search", KNOWLEDGE_LOOKUP: "book",
  REGISTRY_LOOKUP: "registry", SOURCE_LOCATION: "registry", FOLDER_OPEN: "folder",
  FILE_READ: "file", SEARCH: "search", CAPABILITY_PLAN: "registry",
  RESOURCE_RESOLUTION: "search", RESOURCE_INVOCATION: "tool", TEST: "test",
  BUILD: "build", EVIDENCE: "evidence", VERIFICATION: "check", RESULT: "check",
};

export const iconForAction = (action: ActionKind): string => ACTION_ICON[action] ?? "dot";

/**
 * หมวดของทรัพยากรอนุมานจาก "ความสามารถที่มันถือ" ไม่ใช่จากชื่อ
 * ทรัพยากรที่ถือความสามารถด้านความลับ = หมวด credential ฯลฯ
 */
function categoryOf(capabilityCount: number, name: string): { category: string; icon: string } {
  if (/keychain|credential/i.test(name)) return { category: "credential-store", icon: "key" };
  if (/registry/i.test(name)) return { category: "registry", icon: "registry" };
  if (/gateway/i.test(name)) return { category: "execution-gateway", icon: "build" };
  if (/boundary/i.test(name)) return { category: "execution-boundary", icon: "tool" };
  if (/host/i.test(name)) return { category: "worker-host", icon: "tool" };
  return { category: capabilityCount > 0 ? "execution-resource" : "unknown", icon: "tool" };
}

export function presentationFor(resourceId: string): ResourcePresentation | null {
  const profile = latestProfiles().find((p) => p.resource_id === resourceId);
  if (!profile) return null;
  const name = String(profile.resource_name.value ?? resourceId);
  const { category, icon } = categoryOf(profile.capability_ids.length, name);
  return { resource_id: resourceId, display_name: name, icon_key: icon, resource_category: category };
}
