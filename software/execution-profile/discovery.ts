/**
 * หน้าที่: ค้นหา "resource ที่รันงานได้" จากคำประกาศที่ระบบมีอยู่แล้ว แล้วผูกกลับ
 * เข้ากับ `resource_id` ของทะเบียน canonical (Owner, ข้อ 5).
 *
 * ไม่เริ่มจากรายชื่อที่เขียนไว้ในโค้ด การค้นเริ่มจาก "คำประกาศการรัน" ที่มีอยู่จริง
 * สองแหล่ง แล้ว join กลับทะเบียนด้วย `source_location`:
 *
 *   execution/run/process-registry.ts#PROCESS_REGISTRY
 *       ทุก entry ประกาศ canonical_path, allowed_callers, confinement,
 *       environment/network/credential profile ไว้แล้ว — นี่คือ "ขอบเขตการรัน"
 *       ที่ระบบยอมรับ และ allowed_callers บอกว่าโมดูลไหนเป็นเจ้าของการรันนั้น
 *
 *   control/agent-host/worker-registry.ts#resolveWorker
 *       ประกาศ executable จริงต่อหนึ่ง worker — อ่านผ่าน listWorkerKinds()
 *       ไม่ใช่การเขียนชื่อไว้ที่นี่
 *
 * ทำไมไม่ค้นด้วยการอ่านคำใน purpose/side_effects: ลองแล้วได้ 82 จาก 149 capability
 * ซึ่งแปลว่ามันจับคำ ไม่ได้จับความสามารถ — เกณฑ์แบบนั้นคือการเดาชื่อในอีกรูปหนึ่ง
 * เกณฑ์ที่ใช้จริงคือ "มีคำประกาศการรันที่ชี้มาที่โมดูลนี้หรือไม่" ซึ่งตรวจได้
 *
 * ชื่อ provider ที่ปรากฏในผลลัพธ์เป็น metadata ที่อ่านมาจากคำประกาศ ไม่มีบรรทัดใด
 * ในไฟล์นี้ที่ตัดสินใจอะไรจากชื่อนั้น
 *
 * Input: none (อ่านทะเบียนและคำประกาศจากดิสก์).
 * Output: `discoverExecutionResources`.
 * Dependency ที่อนุญาต: ../../execution/run/contract.ts,
 * ../../control/agent-host/contract.ts, ./types.ts, node:fs, node:path.
 * สิ่งที่ห้ามแตะ: ห้ามเขียนไฟล์ canonical, ห้าม hard-code รายชื่อ resource,
 * ห้ามเดาค่าที่อ่านไม่ได้.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PROCESS_REGISTRY } from "../../execution/run/contract";
import { listWorkerKinds, resolveWorker } from "../../control/agent-host/contract";
import { TASK_CAPABILITIES } from "./task-capability";

const CANON = "software/registry-database/data/canonical";

interface CanonRow { resource_id: string; source_location?: string | null; status?: string }

function readJsonl<T>(rel: string): readonly T[] {
  let text: string;
  try { text = readFileSync(join(process.cwd(), rel), "utf8"); } catch { return []; }
  const rows: T[] = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    try { rows.push(JSON.parse(line) as T); } catch { /* แถวเสียข้ามไป ไม่ลบ ไม่ซ่อม */ }
  }
  return rows;
}

/**
 * โมดูล -> ทุก resource_id ที่ทะเบียนออกให้ตำแหน่งนั้น
 *
 * ทะเบียนออก resource แถวใหม่ทุกครั้งที่มี candidate ใหม่ แม้ `source_location`
 * จะซ้ำกับของเดิม — เห็นได้จริงตอนลงทะเบียนคำศัพท์ความสามารถรอบนี้ ตำแหน่งเดียว
 * จึงมีได้หลาย resource_id และความสามารถกระจายอยู่ตามแถวเหล่านั้น
 *
 * ตัวตนที่ใช้อ้าง (`resource_id` ของ profile) ยังเป็นแถวแรกเสมอเพื่อให้คงที่
 * แต่ความสามารถต้องรวมจากทุกแถวของตำแหน่งเดียวกัน ไม่งั้นจะอ่านไม่เห็นสิ่งที่
 * ทะเบียนผูกไว้จริง
 */
function canonicalIndex(): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const row of readJsonl<CanonRow>(`${CANON}/resources.jsonl`)) {
    const location = (row.source_location ?? "").replace(/\/+$/, "");
    if (location === "") continue;
    const list = index.get(location) ?? [];
    list.push(row.resource_id);
    index.set(location, list);
  }
  return index;
}

function capabilityIndex(): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const row of readJsonl<{ resource_id: string; capability_id: string }>(`${CANON}/resource_capabilities.jsonl`)) {
    const list = index.get(row.resource_id) ?? [];
    list.push(row.capability_id);
    index.set(row.resource_id, list);
  }
  return index;
}

/** หนึ่ง resource ที่รันงานได้ พร้อมคำประกาศดิบที่ทำให้มันถูกนับ */
export interface DiscoveredExecutionResource {
  resource_id: string | null;
  source_location: string;
  /** ชื่อที่มนุษย์อ่าน — metadata */
  display_name: string;
  capability_ids: readonly string[];
  /** คำประกาศที่ทำให้ resource นี้ถูกนับว่ารันงานได้ */
  declarations: readonly {
    kind: "PROCESS_REGISTRY_ENTRY" | "WORKER_DEFINITION" | "DECLARED_CAPABILITY";
    id: string;
    entrypoint: string | null;
    confinement: string | null;
    environment_profile: readonly string[] | null;
    network_profile: string | null;
    credential_profile: string | null;
    allowed_callers: readonly string[] | null;
    resolvable: boolean;
    unresolved_reason: string | null;
    source: string;
  }[];
}

export function discoverExecutionResources(): readonly DiscoveredExecutionResource[] {
  const canonical = canonicalIndex();
  const caps = capabilityIndex();
  const byLocation = new Map<string, DiscoveredExecutionResource>();

  const ensure = (location: string, displayName: string): DiscoveredExecutionResource => {
    const key = location.replace(/\/+$/, "");
    const existing = byLocation.get(key);
    if (existing) return existing;
    const resourceIds = canonical.get(key) ?? [];
    const capabilityIds = [...new Set(resourceIds.flatMap((id) => caps.get(id) ?? []))];
    const created: DiscoveredExecutionResource = {
      resource_id: resourceIds[0] ?? null,
      source_location: key,
      display_name: displayName,
      capability_ids: capabilityIds,
      declarations: [],
    };
    byLocation.set(key, created);
    return created;
  };

  // ---- แหล่งที่ 1: ขอบเขตการรันที่ Process Gate ยอมรับ ----
  // เจ้าของการรันคือ `allowed_callers` — โมดูลที่ระบบอนุญาตให้สั่ง entry นั้น
  for (const [executableId, descriptor] of Object.entries(PROCESS_REGISTRY)) {
    for (const caller of descriptor.allowed_callers) {
      const module = caller.replace(/\/[^/]+\.ts$/, "");
      const entry = ensure(module, module.split("/").at(-1) ?? module);
      (entry.declarations as DiscoveredExecutionResource["declarations"][number][]).push({
        kind: "PROCESS_REGISTRY_ENTRY",
        id: executableId,
        entrypoint: descriptor.canonical_path,
        confinement: descriptor.confinement,
        environment_profile: [...descriptor.environment_profile],
        network_profile: descriptor.network_profile,
        credential_profile: descriptor.credential_profile,
        allowed_callers: [...descriptor.allowed_callers],
        resolvable: true,
        unresolved_reason: null,
        source: "execution/run/process-registry.ts#PROCESS_REGISTRY",
      });
    }
  }

  // ---- แหล่งที่ 2: worker ที่ agent-host ประกาศไว้ ----
  // อ่านรายชื่อจาก listWorkerKinds() ไม่ได้เขียนชื่อไว้ในไฟล์นี้
  for (const kind of listWorkerKinds()) {
    const resolution = resolveWorker(kind);
    const entry = ensure("control/agent-host", "agent-host");
    (entry.declarations as DiscoveredExecutionResource["declarations"][number][]).push({
      kind: "WORKER_DEFINITION",
      id: String(kind),
      entrypoint: resolution.ok ? resolution.worker.executable : null,
      confinement: "sandbox-exec (control/agent-host/host-runtime.ts#writeSandboxProfile)",
      environment_profile: null,
      network_profile: null,
      credential_profile: null,
      allowed_callers: null,
      resolvable: resolution.ok,
      unresolved_reason: resolution.ok ? null : resolution.detail,
      source: "control/agent-host/worker-registry.ts#resolveWorker",
    });
  }

  /**
   * ---- แหล่งที่ 3: โมดูลที่ประกาศ "ความสามารถของงาน" พร้อมหลักฐาน ----
   *
   * บางขอบเขตการรันไม่ได้ผ่าน Process Gate และไม่ใช่ worker ของ agent-host —
   * มันประกาศ argv/env/โปรไฟล์ของตัวเองแล้วถูกเรียกโดยตรง ขอบเขตแบบนั้นจะหาย
   * จากสองแหล่งแรกทั้งที่มันรันงานจริง
   *
   * เกณฑ์ที่ใช้ไม่ใช่ชื่อโมดูล แต่คือ "มีคำประกาศความสามารถพร้อมหลักฐานชี้มาที่
   * ตำแหน่งนี้หรือไม่" ซึ่ง ./task-capability.ts บังคับไว้แล้วว่าทุกตัวต้องมี
   * `provided_by` ที่มี proof จริง
   */
  for (const capability of TASK_CAPABILITIES) {
    for (const provider of capability.provided_by) {
      const module = provider.source_location.replace(/\/+$/, "");
      const entry = ensure(module, module.split("/").at(-1) ?? module);
      if (entry.declarations.some((d) => d.kind === "DECLARED_CAPABILITY" && d.id === capability.canonical_name)) continue;
      (entry.declarations as DiscoveredExecutionResource["declarations"][number][]).push({
        kind: "DECLARED_CAPABILITY",
        id: capability.canonical_name,
        entrypoint: null,
        confinement: null,
        environment_profile: null,
        network_profile: null,
        credential_profile: null,
        allowed_callers: null,
        resolvable: true,
        unresolved_reason: null,
        source: provider.proof.source,
      });
    }
  }

  return [...byLocation.values()].sort((a, b) => a.source_location.localeCompare(b.source_location));
}
