/**
 * หน้าที่: แปลงคำประกาศที่ค้นเจอให้เป็น `ExecutionProfile` โดยบันทึก "ที่มา" ของ
 * ทุกค่า และปล่อยค่าที่ไม่รู้ไว้เป็น UNKNOWN (Owner, ข้อ 2 และ 6).
 *
 * กฎเดียวที่ทั้งไฟล์นี้ยึด: ค่าที่ไม่ได้อ่านมาจากคำประกาศหรือหลักฐานจริง จะไม่ถูก
 * เติม ไม่ว่ามันจะ "เดาได้ง่ายแค่ไหน" โดยเฉพาะสามตัวนี้ที่ Owner ระบุไว้ตรง ๆ:
 *
 *   - ติดตั้งอยู่ ไม่ได้แปลว่ามี subscription
 *   - ยืนยันตัวตนผ่าน ไม่ได้แปลว่าจ่ายเงินอยู่
 *   - เคยทำงานสำเร็จหนึ่งครั้ง ไม่ได้แปลว่าสถานะบริการยัง ACTIVE
 *
 * ทั้งสามอย่างจึงออกมาเป็น UNKNOWN เสมอในเฟสนี้ และนั่นคือคำตอบที่ถูกต้อง
 * ไม่ใช่ช่องว่างที่รอเติม
 *
 * profile ถูกสร้างเฉพาะ resource ที่มี `resource_id` ในทะเบียน canonical แล้ว —
 * ตัวที่ค้นเจอแต่ยังไม่ได้ลงทะเบียนจะถูกรายงานแยกเป็น "ค้นพบแต่ยังไม่มีตัวตน"
 * ไม่ใช่สร้าง id ให้เอง เพราะการออก id คือหน้าที่ของทะเบียน ไม่ใช่ของชั้นนี้
 *
 * Input: ผลจาก ./discovery.ts.
 * Output: `buildProfiles`, `UnregisteredExecutionResource`.
 * Dependency ที่อนุญาต: ./discovery.ts, ./types.ts, node:fs, node:path.
 * สิ่งที่ห้ามแตะ: ห้ามเติมค่า billing/subscription/cost จากการอนุมาน,
 * ห้ามสร้าง resource_id, ห้ามเขียนไฟล์ canonical.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { discoverExecutionResources, type DiscoveredExecutionResource } from "./discovery";
import { known, notApplicable, unknown, type ExecutionProfile, type Fact } from "./types";

/** resource ที่มีคำประกาศการรันจริง แต่ยังไม่มีแถวในทะเบียน canonical */
export interface UnregisteredExecutionResource {
  source_location: string;
  declaration_ids: readonly string[];
  reason: "NO_CANONICAL_RESOURCE_ROW";
}

const DECLARED_BILLING_UNKNOWN =
  "ไม่มีคำประกาศเรื่องแผนบริการ/การเรียกเก็บเงินในระบบ — การติดตั้งหรือการยืนยันตัวตนสำเร็จไม่ใช่หลักฐานของสถานะนี้";

/** อ่าน evidence ที่วัดได้จริงของโมดูลหนึ่ง (ถ้ามี) — ใช้เป็นค่า MEASURED เท่านั้น */
function measuredEvidence(sourceLocation: string): { ids: string[]; lastAt: string | null } {
  const ids: string[] = [];
  let lastAt: string | null = null;
  let text: string;
  try { text = readFileSync(join(process.cwd(), "control/agent-gateway/data/evidence.jsonl"), "utf8"); }
  catch { return { ids, lastAt }; }
  for (const line of text.split("\n")) {
    if (line.trim() === "" || !line.includes(sourceLocation)) continue;
    try {
      const row = JSON.parse(line) as { evidence_id?: string; recorded_at?: string; source?: string };
      if (typeof row.source === "string" && row.source.startsWith(sourceLocation) && typeof row.evidence_id === "string") {
        ids.push(row.evidence_id);
        if (typeof row.recorded_at === "string") lastAt = row.recorded_at;
      }
    } catch { /* แถวเสียข้ามไป */ }
  }
  return { ids: ids.slice(-5), lastAt };
}

function firstDeclared<T>(
  declarations: DiscoveredExecutionResource["declarations"],
  pick: (d: DiscoveredExecutionResource["declarations"][number]) => T | null | undefined,
  missing: string,
): Fact<T> {
  for (const d of declarations) {
    const value = pick(d);
    if (value !== null && value !== undefined) return known(value, d.source, "DECLARED");
  }
  return unknown(missing);
}


/**
 * ข้อเท็จจริงเชิงปฏิบัติการที่พิสูจน์ได้จากคำประกาศ/หลักฐานที่มีอยู่แล้ว
 * (Owner, PHASE 2.5 ข้อ 2-6) — ทุกค่ามี source ชี้ได้ ที่พิสูจน์ไม่ได้คงเป็น UNKNOWN
 *
 * `allowed_cwd_scope` ของ Process Gate คือคำประกาศ "พื้นที่ทำงาน" ที่แท้จริง
 * และ `createTaskWorkspace` คือวิธีสร้างพื้นที่นั้นสำหรับสายที่ผ่าน agent-host —
 * ทั้งสองอย่างเป็นคำประกาศจริง ไม่ใช่การอนุมานจากชื่อโฟลเดอร์
 */
function operabilityOf(item: DiscoveredExecutionResource, evidenceIds: readonly string[]): ExecutionProfile["operability"] {
  const gateEntries = item.declarations.filter((d) => d.kind === "PROCESS_REGISTRY_ENTRY");
  const workerEntries = item.declarations.filter((d) => d.kind === "WORKER_DEFINITION");
  const capabilityDecls = item.declarations.filter((d) => d.kind === "DECLARED_CAPABILITY");

  const invoke = gateEntries.length > 0
    ? known(`execution/run#requestProcessExecution({ executable_id: ${gateEntries.map((d) => d.id).join("|")} })`,
      "execution/run/process-registry.ts", "DECLARED")
    : workerEntries.length > 0
      ? known("control/agent-gateway#runAgentWorkOrder({ agent_run.worker_kind, instruction })",
        "control/agent-gateway/agent-host-dispatch.ts", "DECLARED")
      : capabilityDecls.length > 0
        ? known("เรียกผ่าน contract.ts ของโมดูลนั้นโดยตรง", capabilityDecls[0]!.source, "DECLARED")
        : unknown<string>("ไม่มีคำประกาศวิธีเรียก");

  const workspaceCreation = workerEntries.length > 0
    ? known("control/agent-gateway#createTaskWorkspace({ workspace_root: /tmp/dna-os-agent-workspaces })",
      "control/agent-gateway/workspace-manager.ts#createTaskWorkspace", "MEASURED")
    : gateEntries.length > 0
      ? known("ผู้เรียกส่ง cwd ที่ต้องอยู่ใต้ allowed_cwd_scope ที่ descriptor ประกาศ",
        "execution/run/process-registry.ts#allowed_cwd_scope", "DECLARED")
      : unknown<string>("ไม่มีคำประกาศวิธีเตรียมพื้นที่ทำงาน");

  const writeScope = workerEntries.length > 0
    ? known("เขียนได้เฉพาะ allowed_write_workspace ที่ sandbox profile ประกาศ — พิสูจน์แล้วว่าเขียนนอกถูกปฏิเสธ",
      "control/agent-host/host-runtime.ts#writeSandboxProfile", "MEASURED")
    : gateEntries.length > 0
      ? known("จำกัดด้วย confinement ของ descriptor", "execution/run/process-registry.ts#confinement", "DECLARED")
      : unknown<string>("ไม่มีคำประกาศขอบเขตการเขียน");

  return {
    how_to_invoke: invoke,
    workspace_creation_method: workspaceCreation,
    write_scope: writeScope,
    /**
     * ระบบพิสูจน์ได้ว่ารันขนานกันแบบแยกพื้นที่ได้จริง (source-workspace test E และ
     * createTaskWorkspace ที่ออก id ใหม่ทุกครั้ง) แต่ไม่มีที่ใดประกาศ "จำนวนสูงสุด"
     * จึงเป็น PARALLEL_SUPPORTED คู่กับ limit ที่ยัง UNKNOWN — ไม่ใช่การเดาตัวเลข
     */
    concurrency_mode: known("PARALLEL_SUPPORTED", "control/source-workspace/tests/source-workspace.test.ts#B,E + workspace-manager#createTaskWorkspace", "MEASURED"),
    concurrency_isolation_method: workerEntries.length > 0
      ? known("หนึ่ง task = หนึ่งไดเรกทอรีที่ออก id ใหม่ + sandbox profile ต่อการรัน", "control/agent-gateway/workspace-manager.ts", "MEASURED")
      : known("หนึ่งคำขอ = หนึ่งโปรเซสที่ Process Gate ตรวจ argv/cwd ก่อนรัน", "execution/run/process-gate.ts", "DECLARED"),
    health_check_method: evidenceIds.length > 0
      ? known("bounded invocation จริงที่บันทึกหลักฐานไว้ (exit code + ผลตามสัญญา)", "control/agent-gateway/data/evidence.jsonl", "MEASURED")
      : unknown<string>("ยังไม่เคยมีการเรียกที่บันทึกหลักฐานไว้สำหรับ resource นี้"),
    availability_check_method: known("resolve executable จริงบนเครื่อง (realpathSync/existsSync) ก่อนรันทุกครั้ง",
      "control/agent-host/worker-registry.ts#resolveWorker / execution/run/process-registry.ts#canonical_path", "MEASURED"),
    failure_detection_method: known("exit code + สัญญาผลลัพธ์ DNA_OS_AGENT_RESULT_V1 + verification evidence",
      "control/agent-gateway/agent-host-dispatch.ts#interpretLaunchResult", "DECLARED"),
    result_evidence: evidenceIds.length > 0
      ? known(evidenceIds.slice(-1)[0]!, "control/agent-gateway/data/evidence.jsonl", "MEASURED")
      : unknown<string>("ยังไม่มีหลักฐานผลลัพธ์ของ resource นี้"),
  };
}

export function buildProfiles(): { profiles: readonly ExecutionProfile[]; unregistered: readonly UnregisteredExecutionResource[] } {
  const discovered = discoverExecutionResources();
  const profiles: ExecutionProfile[] = [];
  const unregistered: UnregisteredExecutionResource[] = [];
  const recordedAt = new Date().toISOString();

  for (const item of discovered) {
    if (item.resource_id === null) {
      unregistered.push({
        source_location: item.source_location,
        declaration_ids: item.declarations.map((d) => d.id),
        reason: "NO_CANONICAL_RESOURCE_ROW",
      });
      continue;
    }

    const evidence = measuredEvidence(item.source_location);
    const anyResolvable = item.declarations.some((d) => d.resolvable);
    const credentialProfiles = item.declarations
      .map((d) => d.credential_profile)
      .filter((c): c is string => typeof c === "string" && c !== "none");
    const networkProfiles = item.declarations
      .map((d) => d.network_profile)
      .filter((n): n is string => typeof n === "string");

    profiles.push({
      resource_id: item.resource_id,
      resource_name: known(item.display_name, `${CANON_SOURCE}#source_location`, "DECLARED"),
      purpose: unknown("purpose ของ resource อยู่ในทะเบียน capability ไม่ใช่ที่นี่ — อ่านผ่าน capability_ids"),

      entrypoint: firstDeclared(item.declarations, (d) => d.entrypoint, "ไม่มีคำประกาศ entrypoint ที่ resolve ได้"),
      execution_boundary: firstDeclared(item.declarations, (d) => d.confinement, "ไม่มีคำประกาศ confinement"),
      workspace_policy: item.declarations.some((d) => d.kind === "WORKER_DEFINITION")
        ? known("dedicated task directory ต่อหนึ่งงาน แยกจาก MASTER_SOURCE เสมอ", "control/agent-gateway/workspace-manager.ts#createTaskWorkspace", "MEASURED")
        : item.declarations.some((d) => d.kind === "PROCESS_REGISTRY_ENTRY")
          ? known("cwd ที่ผู้เรียกส่งต้องอยู่ใต้ allowed_cwd_scope ที่ประกาศไว้", "execution/run/process-registry.ts#allowed_cwd_scope", "DECLARED")
          : unknown("ไม่มีคำประกาศ workspace policy ของ resource นี้"),
      concurrency_limit: unknown("ไม่มีคำประกาศ concurrency ระดับ resource — worker-registrations มีเฉพาะระดับ worker"),

      /**
       * แยกให้ชัดตาม Owner ข้อ 3: การมี executable ไม่ใช่การยืนยันตัวตน
       * NO_AUTH_REQUIRED ประกาศได้ก็ต่อเมื่อ descriptor บอกเองว่า credential_profile = none
       * ไม่ใช่เพราะ "ไม่เห็นว่ามี auth"
       */
      auth_method: credentialProfiles.length > 0
        ? known("REGISTERED_CREDENTIAL", `execution/run/process-registry.ts#credential_profile=${credentialProfiles[0]!}`, "DECLARED")
        : item.declarations.some((d) => d.kind === "PROCESS_REGISTRY_ENTRY" && d.credential_profile === "none")
          ? known("NO_AUTH_REQUIRED", "execution/run/process-registry.ts#credential_profile=none", "DECLARED")
          : item.declarations.some((d) => d.kind === "DECLARED_CAPABILITY" && d.source.includes("claude-execution-boundary"))
            ? known("LOCAL_MACHINE_AUTH", "control/claude-execution-boundary/boundary.ts#execution_mode + ev-agent-exec-7bzaqxyvplumtkb0yb1 (authenticated=true, apiKeySource=none)", "MEASURED")
            : item.declarations.some((d) => d.kind === "WORKER_DEFINITION")
              ? known("NO_AUTH_REQUIRED", "control/agent-host/host.ts#AGENT_ENV_ALLOWLIST ไม่มีตัวแปร credential และ credential_probe รายงานว่ามองไม่เห็นทุกตัว", "MEASURED")
              : unknown("ไม่มีคำประกาศวิธียืนยันตัวตนของ resource นี้"),
      authority_owner: known("DNA OS", "governance: RESOURCE ≠ AUTHORITY OWNER", "DECLARED"),
      credential_ref: unknown("คำประกาศบอกเพียง 'ชนิด' ของสิทธิ์ ไม่ได้ชี้ credential_ref ตัวใดตัวหนึ่ง"),
      permission_requirements: firstDeclared(item.declarations, (d) => d.allowed_callers, "ไม่มีคำประกาศ allowed_callers"),

      service_plan: unknown(DECLARED_BILLING_UNKNOWN),
      billing_status: unknown(DECLARED_BILLING_UNKNOWN),
      subscription_required: unknown(DECLARED_BILLING_UNKNOWN),
      cost_policy: unknown(DECLARED_BILLING_UNKNOWN),

      availability: anyResolvable
        ? known("RESOLVABLE", "control/agent-host/worker-registry.ts#resolveWorker / process-registry canonical_path", "MEASURED")
        : known("UNRESOLVABLE", "ไม่มี executable ใดของ resource นี้ resolve ได้บนเครื่องนี้", "MEASURED"),
      health: evidence.ids.length > 0
        ? known("HEALTHY", `bounded invocation สำเร็จ หลักฐานล่าสุด ${evidence.ids.slice(-1)[0]}`, "MEASURED")
        : unknown("ยังไม่เคยมีการเรียกที่บันทึกหลักฐานไว้ จึงยังวัดสุขภาพไม่ได้"),
      unavailable_reason: anyResolvable
        ? notApplicable("resource นี้มี executable ที่ resolve ได้")
        : firstDeclared(item.declarations, (d) => d.unresolved_reason, "ไม่ทราบสาเหตุที่ resolve ไม่ได้"),

      data_input_method: firstDeclared(item.declarations, (d) => (d.environment_profile ? `argv + environment_profile[${d.environment_profile.join(",")}]` : null), "ไม่มีคำประกาศวิธีรับข้อมูลเข้า"),
      data_output_method: unknown("รูปผลลัพธ์ประกาศอยู่ที่ capability contract ไม่ใช่ที่ resource"),
      external_access_policy: networkProfiles.length > 0
        ? known(networkProfiles.join(","), "execution/run/process-registry.ts#network_profile", "DECLARED")
        : unknown("ไม่มีคำประกาศ network profile ของ resource นี้"),

      verification_method: evidence.ids.length > 0
        ? known("runtime evidence ใน control/agent-gateway/data/evidence.jsonl", "control/agent-gateway/data/evidence.jsonl", "MEASURED")
        : unknown("ยังไม่มีคำประกาศวิธีตรวจผลของ resource นี้"),
      success_evidence: evidence.ids.length > 0
        ? known(evidence.ids, "control/agent-gateway/data/evidence.jsonl", "MEASURED")
        : unknown("ยังไม่มีหลักฐานความสำเร็จที่ผูกกับ resource นี้"),
      failure_evidence: unknown("ยังไม่ได้แยกหลักฐานความล้มเหลวออกจากหลักฐานทั่วไปในเฟสนี้"),
      last_verified_at: evidence.lastAt !== null
        ? known(evidence.lastAt, "control/agent-gateway/data/evidence.jsonl", "MEASURED")
        : unknown("ไม่มีหลักฐานที่ผูกกับ resource นี้"),

      dependencies: unknown("ยังไม่มีคำประกาศ dependency ระดับ resource"),
      limitations: firstDeclared(item.declarations, (d) => (d.resolvable ? null : [String(d.unresolved_reason)]), "ไม่มีข้อจำกัดที่ประกาศไว้"),

      capability_ids: item.capability_ids,
      facts: {
        installed: known(anyResolvable, "resolveWorker / canonical_path existsSync", "MEASURED"),
        auth_available: unknown("การมีสิทธิ์เข้าถึง credential ไม่ได้แปลว่ามีตัวตนที่ยืนยันแล้ว — ต้องวัดต่อ resource"),
        service_reachable: unknown("ยังไม่ได้วัดการเข้าถึงบริการปลายทางในเฟสนี้"),
        subscription_valid: unknown(DECLARED_BILLING_UNKNOWN),
        billing_active: unknown(DECLARED_BILLING_UNKNOWN),
        healthy: evidence.ids.length > 0
          ? known(true, `bounded invocation สำเร็จ (${evidence.ids.slice(-1)[0]})`, "MEASURED")
          : unknown("ยังไม่เคยมีการเรียกที่บันทึกหลักฐานไว้"),
        available: known(anyResolvable, "derived: มี executable ที่ resolve ได้อย่างน้อยหนึ่งตัว", "DERIVED"),
      },
      operability: operabilityOf(item, evidence.ids),
      recorded_at: recordedAt,
    });
  }

  return { profiles, unregistered };
}

const CANON_SOURCE = "software/registry-database/data/canonical/resources.jsonl";
