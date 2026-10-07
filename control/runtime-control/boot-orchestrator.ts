/**
 * หน้าที่: BOOT SENSOR → DEPENDENCY START → HEALTH SENSOR — พา DNA OS ทั้งชุด
 * ขึ้นตามลำดับที่ประกาศไว้ ไม่ใช่รอให้ Chrome มาปลุกทีละตัว
 *
 * ปัญหาจริงที่ไฟล์นี้แก้: บริการหลายตัวเคยเป็น process ชั่วคราวที่ใครสักคนสตาร์ท
 * ไว้ในเทอร์มินัลแล้วลืม พอมันตาย เบราว์เซอร์ได้ ERR_CONNECTION_REFUSED และทาง
 * แก้เดียวคือเปิดเทอร์มินัลใหม่ — ซึ่งแปลว่าความพร้อมของระบบขึ้นกับความจำของคน
 *
 * ลำดับมาจาก `depends_on` ใน ./host-runtime.ts#SERVICES ที่เดียว ไม่ได้เรียงมือ
 * ที่นี่: ลำดับคือข้อเท็จจริงของระบบ การเก็บไว้สองที่คือจุดที่มันจะขัดกันเงียบ ๆ
 *
 * FAILED_LOCKED — ข้อ 9 ของ Owner
 * ปลุกได้ไม่เกิน MAX_START_ATTEMPTS ครั้งต่อบริการต่อรอบ boot ถ้ายังไม่ขึ้นให้
 * หยุดปลุกและล็อกสถานะไว้พร้อมหลักฐาน ไม่ใช่วนจนเครื่องพัง การวนปลุกบริการที่
 * พังจริงไม่ได้ทำให้มันหาย มันแค่ทำให้ log ท่วมจนอ่านสาเหตุจริงไม่เจอ
 *
 * ไม่มี AI อยู่ในเส้นทางการกู้ ทุกการตัดสินใจที่นี่เป็นกฎตายตัวที่อ่านได้จากโค้ด
 *
 * Input: none (อ่าน SERVICES + สถานะจริงของเครื่อง)
 * Output: `bootAll`, `BootReport`.
 * Dependency ที่อนุญาต: ./types.ts, ./host-runtime.ts, ./resolver.ts.
 * สิ่งที่ห้ามแตะ: ห้ามเพิ่ม retry ที่ไม่มีขอบเขต และห้ามรายงานบริการว่า READY
 * โดยไม่ผ่าน health probe จริง — launchd บอกว่ามี pid ไม่ได้แปลว่าพอร์ตเปิดแล้ว
 */

import type { ServiceDefinition, ServiceId } from "./types";
import {
  SERVICES, getLaunchdState, launchctlBootstrap, launchctlKickstart,
  httpHealthCheck, appendEvidence, nowIso, newOperationId, sleep,
} from "./host-runtime";
import { buildRequesterFields } from "./requester";
import type { HealthCheckResult } from "./types";
import { runtimeNodePlatform } from "../../contracts/architecture/runtime-node-and-optional-provider";
import { PortableProcessSupervisor } from "./portable-supervisor";
import { serviceNodeEligibility } from "./service-eligibility";

/**
 * ตัวตนของผู้ขอ boot — โปรเซสที่เรียก `bootAll()` ใน production มีจุดเดียวคือ
 * `control/owner-backbone/start.ts` ซึ่ง **คือ entrypoint ของ recovery-supervisor
 * เอง** boot จึงไม่ใช่ผู้กระทำตัวที่สาม แต่เป็นเฟส cold-start ของบริการนั้น
 * ตัวตนนี้จึงเป็นตัวเดียวกับที่สายกู้คืนใช้อยู่แล้ว ไม่ได้ประกาศตัวตนใหม่
 */
const BOOT_REQUESTER_IDENTITY = { identity_id: "identity-recovery-supervisor", kind: "service" } as const;

/**
 * ── ขอบเขตที่ฉีดของปลอมเข้าได้ (2026-08-29) ──
 * เท่าที่ boot แตะระบบปฏิบัติการและเวลาเท่านั้น ไม่ใช่ abstraction ทั่วไป: ถ้าไม่มี
 * ขอบเขตนี้ การทดสอบพฤติกรรม boot แปลว่าต้อง bootstrap/kickstart บริการ
 * production จริง ซึ่งไม่ใช่การพิสูจน์ ค่า default ทุกตัวคือฟังก์ชันจริงเดิม
 * production จึงเดินเส้นทางเดิมทุกประการ
 */
export interface BootDeps {
  readonly bootstrap?: typeof launchctlBootstrap;
  readonly kickstart?: typeof launchctlKickstart;
  readonly launchdState?: typeof getLaunchdState;
  readonly healthCheck?: typeof httpHealthCheck;
  readonly append?: typeof appendEvidence;
  readonly now?: () => string;
  /** นาฬิกาสำหรับ "ระยะเวลาที่ผ่านไปจริง" — แยกจาก now() ที่ให้เวลานาฬิกาแขวน */
  readonly elapsedMs?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
}

interface ResolvedDeps {
  bootstrap: typeof launchctlBootstrap; kickstart: typeof launchctlKickstart;
  launchdState: typeof getLaunchdState; healthCheck: typeof httpHealthCheck;
  append: typeof appendEvidence; now: () => string; elapsedMs: () => number;
  sleep: (ms: number) => Promise<void>;
}

function resolve(deps: BootDeps = {}): ResolvedDeps {
  return {
    bootstrap: deps.bootstrap ?? launchctlBootstrap,
    kickstart: deps.kickstart ?? launchctlKickstart,
    launchdState: deps.launchdState ?? getLaunchdState,
    healthCheck: deps.healthCheck ?? httpHealthCheck,
    append: deps.append ?? appendEvidence,
    now: deps.now ?? nowIso,
    elapsedMs: deps.elapsedMs ?? Date.now,
    sleep: deps.sleep ?? sleep,
  };
}

/** ปลุกได้กี่ครั้งต่อบริการต่อรอบ boot ก่อนล็อก */
export const MAX_START_ATTEMPTS = 3;

/** สถานะที่เครื่องอ่านได้ ตามที่ Owner กำหนดในข้อ 5 */
export type ServiceState = "READY" | "DEGRADED" | "DOWN" | "RECOVERING" | "FAILED_LOCKED" | "SKIPPED_DEPENDENCY";

export interface ServiceBootResult {
  readonly service_id: ServiceId;
  readonly state: ServiceState;
  readonly attempts: number;
  readonly pid: number | null;
  readonly port: number;
  readonly http_status: number | null;
  readonly reason: string;
  readonly depends_on: readonly ServiceId[];
  readonly checked_at: string;
  readonly evidence_ref: string;
}

export interface BootReport {
  readonly boot_id: string;
  readonly started_at: string;
  readonly finished_at: string;
  readonly order: readonly ServiceId[];
  readonly results: readonly ServiceBootResult[];
  readonly ready: number;
  readonly failed_locked: number;
  readonly skipped: number;
}

/**
 * ลำดับการสตาร์ท — topological sort บน depends_on
 *
 * วงจรพึ่งพากันเองเป็นข้อผิดพลาดของ registry ไม่ใช่สิ่งที่ควรแก้ตอน runtime
 * ด้วยการเดา จึงคืนบริการที่เหลือต่อท้ายและให้รอบ boot รายงานว่ามันไม่ได้ถูก
 * เรียงจริง แทนที่จะวนไม่รู้จบหรือเงียบ
 */
export function resolveStartOrder(services: Record<ServiceId, ServiceDefinition> = SERVICES): {
  order: ServiceId[]; cyclic: ServiceId[];
} {
  const ids = Object.keys(services) as ServiceId[];
  const order: ServiceId[] = [];
  const placed = new Set<ServiceId>();
  let progress = true;
  while (progress) {
    progress = false;
    for (const id of ids) {
      if (placed.has(id)) continue;
      const deps = services[id].depends_on ?? [];
      if (deps.every((d) => placed.has(d))) {
        order.push(id);
        placed.add(id);
        progress = true;
      }
    }
  }
  const cyclic = ids.filter((id) => !placed.has(id));
  return { order: [...order, ...cyclic], cyclic };
}

/**
 * probe จริง: launchd มี pid ไหม + พอร์ตตอบ HTTP ตามเกณฑ์ของบริการนั้นไหม
 *
 * `httpHealthCheck(port, path, timeoutMs)` — พารามิเตอร์ที่สามคือ TIMEOUT
 * ไม่ใช่ expected status เวอร์ชันแรกของไฟล์นี้ส่ง `health_expect_status` (200)
 * เข้าไปตรงนั้น ผลคือ timeout 200 มิลลิวินาที และบริการที่ตอบช้ากว่านั้นแต่ปกติดี
 * จะถูกอ่านว่าตายทุกครั้ง เกณฑ์สถานะจึงต้องตรวจที่นี่เอง
 */
async function observe(service: ServiceDefinition, d: ResolvedDeps): Promise<{ pid: number | null; loaded: boolean; http: number | null; healthy: boolean; error: string | null; checked_at: string }> {
  const launchd = d.launchdState(service.launchd_label);
  const health = await d.healthCheck(service.port, service.health_path);
  // แต่ละบริการประกาศเกณฑ์สำเร็จของตัวเอง — 2xx ทั่วไปไม่พอ
  const healthy = health.http_status === service.health_expect_status;
  return {
    pid: launchd.pid ?? null,
    // สถานะ loaded ที่ launchd รายงานจริง เดิมค่านี้ถูกวัดแล้วทิ้ง แล้วไปอนุมาน
    // ใหม่จาก pid ตอนเขียนหลักฐาน — job ที่โหลดแล้วแต่ไม่รันจึงถูกบันทึกว่าไม่โหลด
    loaded: launchd.loaded,
    http: health.http_status,
    healthy,
    error: healthy ? null : (health.error ?? `HTTP ${health.http_status} (ต้องการ ${service.health_expect_status})`),
    checked_at: health.checked_at,
  };
}

/** รอจนพอร์ตตอบจริง ไม่ใช่รอให้ launchd บอกว่ามี pid */
async function waitReady(service: ServiceDefinition, d: ResolvedDeps): Promise<{ healthy: boolean; http: number | null; error: string | null; waited_ms: number; checked_at: string }> {
  const started = d.elapsedMs();
  const deadline = started + service.readiness_timeout_ms;
  let last: Awaited<ReturnType<typeof observe>> | null = null;
  while (d.elapsedMs() < deadline) {
    last = await observe(service, d);
    if (last.healthy) return { healthy: true, http: last.http, error: null, waited_ms: d.elapsedMs() - started, checked_at: last.checked_at };
    await d.sleep(1000);
  }
  // ระยะเวลาที่ "วัดได้จริงจนล้มเหลว" ไม่ใช่ค่า timeout ที่ตั้งไว้ — ทั้งสองค่านี้
  // ต่างกันเสมอ และการเขียนค่าที่ตั้งไว้ลงช่องที่สัญญาบอกว่าเป็นค่าที่สังเกตได้
  // คือการรายงานสิ่งที่ไม่ได้วัด
  return { healthy: false, http: last?.http ?? null, error: last?.error ?? "readiness timeout", waited_ms: d.elapsedMs() - started, checked_at: last?.checked_at ?? d.now() };
}

/**
 * เขียน evidence ผ่านสัญญาจริงของ ./types.ts#OperationEvidence
 *
 * ── ทุกช่องมาจากสิ่งที่วัดได้จริง (แก้ 2026-08-29) ──
 * เวอร์ชันก่อนหน้าแต่งค่าไว้ห้าจุด: `health_before` เขียนตายตัวเป็น healthy:false
 * ทั้งที่ probe ก่อน boot วัดมาแล้ว, `duplicate_check` รายงานผลของการตรวจที่ไม่เคย
 * เกิดขึ้น, `timestamp_started` ประทับตอนเขียนไม่ใช่ตอนเริ่ม, `readiness_wait_ms`
 * ในเส้นทางล้มเหลวคัดลอกค่า timeout ที่ตั้งไว้, และ `launchd_loaded_before`
 * อนุมานจาก pid ทั้งที่ค่าจริงถูกวัดแล้ว หลักฐาน 64 แถวที่เขียนด้วยตรรกะเดิมยังอยู่
 * ครบและไม่ถูกแก้ — มันคือหลักฐานว่าเคยมีข้อบกพร่องนี้จริง
 *
 * `duplicate_check` **ไม่ถูกใส่เลย** เพราะ boot ไม่เรียก `getListeningPids`
 * ช่องที่หายไปคือ NOT_MEASURED ไม่ใช่ "ตรวจแล้วไม่พบซ้ำ" และสไลซ์นี้ไม่เพิ่ม
 * การตรวจซ้ำให้ boot จึงไม่มีโหมดล้มเหลวใหม่เกิดขึ้น
 *
 * `executed_by` **ไม่ถูกใส่เลย** เช่นกัน: boot เรียก launchctl เอง ไม่ได้ผ่าน
 * `runOperation` การเขียนว่า runtime-control เป็นผู้ลงมือเพียงเพราะสัญญาหลักฐาน
 * เป็นของ runtime-control คือการบันทึกผู้ลงมือผิดตัว
 */
function writeBootEvidence(d: ResolvedDeps, input: {
  operationId: string; service: ServiceDefinition; action: "start" | "health";
  bootId: string;
  /** ผลของการสังเกตก่อนลงมือ ตามที่วัดได้จริง ไม่ใช่ค่าคงที่ */
  before: { pid: number | null; loaded: boolean; http: number | null; healthy: boolean; error: string | null; checked_at: string };
  pidAfter: number | null; loadedAfter: boolean; health: HealthCheckResult;
  waitedMs: number; result: "SUCCESS" | "FAILED"; reason: string;
  /** เวลาจริงที่ความพยายามนี้เริ่ม จับก่อนการวัดใด ๆ */
  startedAt: string;
}): void {
  d.append({
    operation_id: input.operationId,
    service_id: input.service.service_id,
    launchd_label: input.service.launchd_label,
    requested_action: input.action,
    port: input.service.port,
    pid_before: input.before.pid,
    pid_after: input.pidAfter,
    launchd_loaded_before: input.before.loaded,
    launchd_loaded_after: input.loadedAfter,
    health_before: {
      checked_at: input.before.checked_at,
      http_status: input.before.http,
      healthy: input.before.healthy,
      error: input.before.error,
    },
    health_after: input.health,
    readiness_wait_ms: input.waitedMs,
    readiness_deadline_ms: input.service.readiness_timeout_ms,
    timestamp_started: input.startedAt,
    timestamp_completed: d.now(),
    result: input.result,
    failure_reason: input.result === "FAILED" ? input.reason : null,
    // ผู้ขอมีตัวตนที่ประกาศไว้แล้ว ส่วนผู้ลงมือยังไม่มีตัวตนที่พิสูจน์ได้
    ...buildRequesterFields({
      requested_by: BOOT_REQUESTER_IDENTITY,
      lineage: { correlation_id: input.bootId },
    }),
  });
}

async function bootOne(service: ServiceDefinition, bootId: string, d: ResolvedDeps): Promise<ServiceBootResult> {
  const base = { service_id: service.service_id, port: service.port, depends_on: service.depends_on ?? [] };

  // เวลาเริ่มจริงของการสังเกตก่อน boot — จับ **ก่อน** probe ไม่ใช่ตอนเขียนหลักฐาน
  const preStartedAt = d.now();
  // ถ้าดีอยู่แล้ว ห้ามแตะ — ข้อ 7 ของ Owner ("ถ้า process มีอยู่แล้ว ห้าม spawn ซ้ำ")
  const initial = await observe(service, d);
  if (initial.healthy) {
    const operationId = newOperationId();
    // action = "health": ไม่มีการเปลี่ยนสถานะทางกายภาพเกิดขึ้นเลย การเรียกมันว่า
    // start จะทำให้ประวัติดูเหมือนมีการปลุกบริการที่ไม่เคยเกิดขึ้น
    writeBootEvidence(d, {
      operationId, service, action: "health", bootId,
      before: initial, pidAfter: initial.pid, loadedAfter: initial.loaded,
      health: { checked_at: initial.checked_at, http_status: initial.http, healthy: true, error: null },
      waitedMs: 0, result: "SUCCESS",
      reason: "already healthy — not restarted", startedAt: preStartedAt,
    });
    return {
      ...base, state: "READY", attempts: 0, pid: initial.pid, http_status: initial.http,
      reason: "ทำงานอยู่แล้วและ health ผ่าน — ไม่แตะ", checked_at: d.now(),
      evidence_ref: operationId,
    };
  }

  let attempts = 0;
  let lastReason = initial.error ?? "not healthy at boot";
  let lastHttp = initial.http;
  let lastPid = initial.pid;
  let lastOperationId = "";

  while (attempts < MAX_START_ATTEMPTS) {
    attempts += 1;
    // ความพยายามทางกายภาพหนึ่งครั้ง = หนึ่ง operation_id และหนึ่งแถวหลักฐานเสมอ
    // ไม่ว่าจะสำเร็จหรือไม่ ทั้งหมดผูกกันด้วย correlation_id เดียวคือ bootId
    const operationId = newOperationId();
    lastOperationId = operationId;
    const attemptStartedAt = d.now();
    const before = attempts === 1 ? initial : await observe(service, d);
    const launchd = d.launchdState(service.launchd_label);
    try {
      // ยังไม่โหลด job → bootstrap; โหลดแล้วแต่ไม่ตอบ → kickstart
      if (!launchd.loaded) d.bootstrap(service.plist_path);
      else d.kickstart(service.launchd_label);
    } catch (error) {
      lastReason = `launchctl ล้มเหลว: ${error instanceof Error ? error.message : String(error)}`;
      const stateNow = d.launchdState(service.launchd_label);
      writeBootEvidence(d, {
        operationId, service, action: "start", bootId,
        before, pidAfter: stateNow.pid ?? null, loadedAfter: stateNow.loaded,
        health: { checked_at: d.now(), http_status: null, healthy: false, error: lastReason },
        waitedMs: 0, result: "FAILED", reason: lastReason, startedAt: attemptStartedAt,
      });
      continue;
    }
    const ready = await waitReady(service, d);
    lastHttp = ready.http;
    const stateAfter = d.launchdState(service.launchd_label);
    lastPid = stateAfter.pid ?? null;
    writeBootEvidence(d, {
      operationId, service, action: "start", bootId,
      before, pidAfter: lastPid, loadedAfter: stateAfter.loaded,
      health: { checked_at: ready.checked_at, http_status: ready.http, healthy: ready.healthy, error: ready.error },
      waitedMs: ready.waited_ms,
      result: ready.healthy ? "SUCCESS" : "FAILED",
      reason: ready.healthy ? `started and health probe passed on attempt ${attempts}` : (ready.error ?? "readiness timeout"),
      startedAt: attemptStartedAt,
    });
    if (ready.healthy) {
      return {
        ...base, state: "READY", attempts, pid: lastPid, http_status: lastHttp,
        reason: `ปลุกสำเร็จในครั้งที่ ${attempts} (รอ ${ready.waited_ms}ms)`,
        checked_at: d.now(), evidence_ref: operationId,
      };
    }
    lastReason = ready.error ?? "readiness timeout";
  }

  // ถึงเพดานแล้ว — ล็อก ไม่ปลุกต่อ ทุกความพยายามมีแถวหลักฐานของตัวเองไปแล้ว
  // จึงไม่เขียนแถวสรุปซ้ำ ซึ่งจะนับเป็นความพยายามที่ไม่เคยเกิดขึ้น
  return {
    ...base, state: "FAILED_LOCKED", attempts, pid: lastPid, http_status: lastHttp,
    reason: `ปลุก ${attempts} ครั้งแล้วยังไม่ขึ้น: ${lastReason}`,
    checked_at: d.now(), evidence_ref: lastOperationId,
  };
}

/**
 * พาทั้งระบบขึ้นตามลำดับ dependency
 *
 * บริการที่ dependency ยังไม่ READY จะถูกข้ามพร้อมเหตุผล ไม่ใช่ปลุกแล้วปล่อยให้
 * มันตายเพราะสิ่งที่มันต้องใช้ยังไม่มา — อาการแบบนั้นอ่านเหมือนบริการนั้นพังเอง
 */
export async function bootAll(options: { only?: readonly ServiceId[]; deps?: BootDeps } = {}): Promise<BootReport> {
  const d = resolve(options.deps);
  const bootId = newOperationId();
  const startedAt = d.now();
  const { order } = resolveStartOrder();

  // Non-Darwin Core: launchd filter would drop portable services. Route them
  // through PortableProcessSupervisor instead of returning an empty success.
  if (runtimeNodePlatform() !== "darwin") {
    return bootAllPortable(order, options.only, bootId, startedAt, d);
  }

  const launchdOrder = order.filter((id) => SERVICES[id].launchd_job !== "not_installed");
  const targets = options.only
    ? launchdOrder.filter((id) => options.only!.includes(id))
    : launchdOrder;

  const results: ServiceBootResult[] = [];
  const readyIds = new Set<ServiceId>();

  for (const id of targets) {
    const service = SERVICES[id];
    const dependsOn = service.depends_on ?? [];
    const missing = dependsOn.filter((dep) => !readyIds.has(dep));
    if (missing.length > 0) {
      results.push({
        service_id: id, state: "SKIPPED_DEPENDENCY", attempts: 0, pid: null, port: service.port,
        http_status: null, depends_on: dependsOn,
        reason: `ข้าม เพราะ dependency ยังไม่ READY: ${missing.join(", ")}`,
        checked_at: d.now(), evidence_ref: `boot:${bootId}:${id}`,
      });
      continue;
    }
    const result = await bootOne(service, bootId, d);
    if (result.state === "READY") readyIds.add(id);
    results.push(result);
  }

  return {
    boot_id: bootId, started_at: startedAt, finished_at: d.now(),
    order: targets, results,
    ready: results.filter((r) => r.state === "READY").length,
    failed_locked: results.filter((r) => r.state === "FAILED_LOCKED").length,
    skipped: results.filter((r) => r.state === "SKIPPED_DEPENDENCY").length,
  };
}

async function bootAllPortable(
  order: readonly ServiceId[],
  only: readonly ServiceId[] | undefined,
  bootId: string,
  startedAt: string,
  d: ResolvedDeps,
): Promise<BootReport> {
  const portableOrder = order.filter((id) => {
    const def = SERVICES[id];
    if (!def?.portable_process) return false;
    return serviceNodeEligibility(id) === "CORE_NODE_CAPABLE";
  });
  const targets = only ? portableOrder.filter((id) => only.includes(id)) : portableOrder;
  const results: ServiceBootResult[] = [];
  const readyIds = new Set<ServiceId>();
  const supervisor = new PortableProcessSupervisor({
    healthCheck: d.healthCheck,
    append: d.append,
  });

  for (const id of targets) {
    const service = SERVICES[id];
    const dependsOn = service.depends_on ?? [];
    const missing = dependsOn.filter((dep) => !readyIds.has(dep));
    if (missing.length > 0) {
      results.push({
        service_id: id,
        state: "SKIPPED_DEPENDENCY",
        attempts: 0,
        pid: null,
        port: service.port,
        http_status: null,
        depends_on: dependsOn,
        reason: `ข้าม เพราะ dependency ยังไม่ READY: ${missing.join(", ")}`,
        checked_at: d.now(),
        evidence_ref: `boot:${bootId}:${id}`,
      });
      continue;
    }
    const ev = await supervisor.run(id, "start");
    const ready = ev.result === "SUCCESS" && ev.health_after.http_status === service.health_expect_status;
    if (ready) readyIds.add(id);
    results.push({
      service_id: id,
      state: ready ? "READY" : "FAILED_LOCKED",
      attempts: 1,
      pid: ev.pid_after,
      port: service.port,
      http_status: ev.health_after.http_status,
      depends_on: dependsOn,
      reason: ready
        ? `portable supervisor started ${id}`
        : (ev.failure_reason ?? "portable start failed"),
      checked_at: d.now(),
      evidence_ref: ev.operation_id,
    });
  }

  return {
    boot_id: bootId,
    started_at: startedAt,
    finished_at: d.now(),
    order: targets,
    results,
    ready: results.filter((r) => r.state === "READY").length,
    failed_locked: results.filter((r) => r.state === "FAILED_LOCKED").length,
    skipped: results.filter((r) => r.state === "SKIPPED_DEPENDENCY").length,
  };
}
