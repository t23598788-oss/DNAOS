/**
 * หน้าที่: วัดเป้าหมายที่ประกาศไว้ใน `./runtime-target.ts` — PID, uptime,
 * พอร์ตที่ฟังอยู่ และสุขภาพของ endpoint
 *
 * ยังเป็น sensor เหมือนเดิม: ทุกอย่างในไฟล์นี้อ่านอย่างเดียว — `/bin/ps`,
 * `lsof`, และ HTTP GET หนึ่งครั้ง ไม่มี start ไม่มี stop ไม่มี restart ไม่มี
 * launchctl และไม่ import `control/runtime-control/` เลย
 *
 * ── ทำไม health probe อยู่ที่นี่ ไม่ใช่ที่ runtime-control ──
 * `control/runtime-control/contract.ts` เขียนไว้เองว่า `httpHealthCheck`
 * จงใจไม่ export เพราะ "a caller able to poll health separately is a second
 * opinion about whether a service is up" — เจตนานั้นถูก และยังคงอยู่:
 * runtime-control ยังเป็นผู้ตัดสินความพร้อม **ของบริการที่มันควบคุม** ส่วนที่นี่
 * วัดเป้าหมายที่ประกาศให้สังเกต ซึ่งเป็นคนละชุดและไม่มีอำนาจสั่งงาน
 *
 * ── ไม่มีอะไรถูกเดา ──
 * ค่าที่วัดไม่ได้จะเป็น `null` พร้อมเหตุผลใน `unknown[]` ไม่มีการเติมศูนย์
 * ไม่มีการอนุมาน pid จากชื่อโปรเซส และ uptime คำนวณจาก `started_at` ที่เคอร์เนล
 * รายงานเท่านั้น
 *
 * Input: `RuntimeObservationTarget`
 * Output: `observeRuntimeTarget`, `listeningPidsOnPort`, `probeHttpHealth`,
 * `persistRuntimeObservation`
 * Dependency ที่อนุญาต: ./runtime-target.ts, ./process-observer.ts,
 * node:child_process (อ่านอย่างเดียว), node:http
 * สิ่งที่ห้ามแตะ: ห้าม import control/runtime-control ห้ามเรียก launchctl และ
 * ห้ามเพิ่มเมธอดที่เปลี่ยนสถานะของสิ่งที่กำลังวัด
 */

import { execFileSync } from "node:child_process";
import { request } from "node:http";
import { listProcesses } from "./process-observer";
import { appendObservation } from "./observation-store";
import type { ObservationRecord } from "./observation-store";
import type { RuntimeObservationTarget } from "./runtime-target";

function readOnly(command: string, args: readonly string[]): string {
  try {
    return String(execFileSync(command, args as string[], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] }));
  } catch {
    return "";
  }
}

/** pid ที่ฟังพอร์ตนี้อยู่จริง — ถามเคอร์เนลผ่าน lsof ไม่ใช่เดาจากชื่อ */
export function listeningPidsOnPort(port: number): readonly number[] {
  const out = readOnly("/usr/sbin/lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"]);
  return out.split("\n").map((l) => Number(l.trim())).filter((n) => Number.isInteger(n) && n > 0);
}

export interface HttpHealthObservation {
  readonly url: string;
  readonly http_status: number | null;
  readonly expected_status: number;
  readonly healthy: boolean | null;
  readonly error: string | null;
  readonly checked_at: string;
}

/**
 * GET หนึ่งครั้ง ไม่มี retry ไม่มี body ที่ส่งไป
 *
 * `healthy` เป็น `null` เมื่อ "ตอบไม่ได้ว่าอย่างไร" (ต่อไม่ติด/หมดเวลา) ซึ่ง
 * ต่างจาก `false` ที่แปลว่า "ตอบแล้วแต่ไม่ใช่สถานะที่คาด" — สองอย่างนี้พาไปคนละ
 * ข้อสรุป การยุบรวมเป็น false จะทำให้ "เน็ตเวิร์กมีปัญหา" อ่านเหมือน "บริการพัง"
 */
export function probeHttpHealth(host: string, port: number, path: string, expectedStatus: number, timeoutMs = 4000): Promise<HttpHealthObservation> {
  const url = `http://${host}:${port}${path}`;
  return new Promise((resolve) => {
    const checkedAt = new Date().toISOString();
    const done = (status: number | null, error: string | null): void =>
      resolve({ url, http_status: status, expected_status: expectedStatus, healthy: status === null ? null : status === expectedStatus, error, checked_at: checkedAt });

    const req = request({ host, port, path, method: "GET", timeout: timeoutMs }, (res) => {
      const status = res.statusCode ?? null;
      res.resume();
      res.on("end", () => done(status, null));
    });
    req.on("timeout", () => { req.destroy(); done(null, `timeout after ${timeoutMs}ms`); });
    req.on("error", (e) => done(null, e instanceof Error ? e.message : String(e)));
    req.end();
  });
}

export interface RuntimeObservationResult {
  readonly runtime_target_id: string;
  readonly capability_id: string;
  readonly observed_at: string;
  readonly pid: number | null;
  readonly started_at: string | null;
  readonly uptime_seconds: number | null;
  readonly listening_pids: readonly number[] | null;
  readonly health: HttpHealthObservation | null;
  /** ทุกอย่างที่วัดไม่ได้ พร้อมเหตุผล — ว่างแปลว่าวัดได้ครบตามที่ประกาศไว้ */
  readonly unknown: readonly string[];
  /** ประกาศซ้ำที่ผลลัพธ์: นี่คือการอ่าน ไม่ได้เปลี่ยนอะไรเลย */
  readonly authority: "OBSERVE_ONLY";
}

/**
 * วัดเป้าหมายหนึ่งตัวตามที่มันประกาศไว้
 *
 * pid มาจากพอร์ตที่ฟังอยู่จริงเป็นหลัก เพราะนั่นคือสิ่งที่ OS ยืนยันได้ว่าเป็น
 * โปรเซสที่ให้บริการอยู่จริง — ไม่ใช่โปรเซสที่ชื่อคล้าย ถ้าไม่มี network ให้ยึด
 * จึงค่อยใช้ `argv_contains` ที่ประกาศไว้
 */
export async function observeRuntimeTarget(target: RuntimeObservationTarget): Promise<RuntimeObservationResult> {
  const unknown: string[] = [];
  const observedAt = new Date().toISOString();

  let listeningPids: readonly number[] | null = null;
  let pid: number | null = null;

  if (target.network?.port) {
    listeningPids = listeningPidsOnPort(target.network.port);
    if (listeningPids.length === 0) unknown.push(`ไม่มีโปรเซสใดฟังพอร์ต ${target.network.port}`);
    else if (listeningPids.length > 1) unknown.push(`มี ${listeningPids.length} โปรเซสฟังพอร์ต ${target.network.port} — ไม่เลือกให้`);
    else pid = listeningPids[0];
  }

  const table = listProcesses();
  if (pid === null && target.process?.argv_contains) {
    const needle = target.process.argv_contains;
    const matches = table.filter((r) => r.argv.includes(needle));
    if (matches.length === 1) pid = matches[0].pid;
    else unknown.push(matches.length === 0 ? `ไม่มีโปรเซสใดที่ argv มี "${needle}"` : `มี ${matches.length} โปรเซสที่ argv มี "${needle}" — ไม่เลือกให้`);
  }
  if (pid === null && !target.network?.port && !target.process?.argv_contains) {
    unknown.push("เป้าหมายไม่ได้ประกาศ network.port หรือ process.argv_contains — หา pid ไม่ได้");
  }

  let startedAt: string | null = null;
  let uptimeSeconds: number | null = null;
  if (pid !== null) {
    const row = table.find((r) => r.pid === pid) ?? null;
    if (!row) unknown.push(`pid ${pid} ฟังพอร์ตอยู่แต่ไม่อยู่ในตารางโปรเซส — อ่านสองครั้งไม่ตรงกัน`);
    else {
      startedAt = row.started_at;
      const ms = Date.parse(row.started_at);
      if (Number.isNaN(ms)) unknown.push(`อ่าน started_at "${row.started_at}" เป็นเวลาไม่ได้ — ไม่คำนวณ uptime`);
      else uptimeSeconds = Math.max(0, Math.floor((Date.now() - ms) / 1000));
    }
  }

  let health: HttpHealthObservation | null = null;
  if (target.health?.path && target.network) {
    health = await probeHttpHealth(target.network.host, target.network.port, target.health.path, target.health.expected_status);
    if (health.healthy === null) unknown.push(`probe health ไม่สำเร็จ: ${health.error ?? "ไม่ทราบสาเหตุ"}`);
  } else if (target.health?.path && !target.network) {
    unknown.push("ประกาศ health.path ไว้แต่ไม่มี network.host/port — probe ไม่ได้");
  }

  return {
    runtime_target_id: target.runtime_target_id,
    capability_id: target.capability_id,
    observed_at: observedAt,
    pid, started_at: startedAt, uptime_seconds: uptimeSeconds,
    listening_pids: listeningPids, health, unknown,
    authority: "OBSERVE_ONLY",
  };
}

/** ตัวตนที่ผู้เรียกถืออยู่แล้วและอยากให้ติดไปกับหลักฐาน — ไม่มีการสร้าง id ใหม่ */
export interface ObservationCorrelation {
  readonly work_id?: string | null;
  readonly execution_id?: string | null;
  readonly task_id?: string | null;
}

export type PersistObservationOutcome =
  | { readonly ok: true; readonly record: ObservationRecord; readonly observation_id: string }
  | { readonly ok: false; readonly reason_code: "PERSIST_FAILED"; readonly detail: string };

/**
 * เก็บผลที่วัดได้ลงสโตร์ของผู้สังเกตเอง
 *
 * ค่าที่วัดถูกเก็บเป็น `runtime_measurement` ทั้งก้อน — ไม่ถูกแปลงเป็นข้อความลง
 * `process_evidence[]` เพราะตัวเลขที่กลายเป็นประโยคแล้วต้อง parse กลับ คือสิ่งที่
 * ทำให้ pid/uptime อ่านด้วยเครื่องไม่ได้มาตลอด `process_evidence[]` ยังถูกเขียน
 * ไว้สำหรับคนอ่าน แต่ไม่ใช่แหล่งความจริงอีกต่อไป
 *
 * แถวนี้เป็น append-only: การวัดครั้งใหม่คือแถวใหม่เสมอ ไม่มีการแก้แถวเดิม
 * บริการที่รีสตาร์ตจึงได้ pid/uptime ชุดใหม่ โดยหลักฐานเดิมยังอยู่ครบ
 *
 * ล้มเหลวแล้วบอกตรง ๆ: ถ้าเขียนไม่สำเร็จจะคืน PERSIST_FAILED และ **ไม่คืน
 * observation_id** ผู้เรียกจึงไม่มีทางอ้างหลักฐานที่ไม่มีอยู่จริง
 */
/**
 * ผู้เขียนถูกฉีดเข้ามาได้ (Owner, PHASE 3 ของการซ่อมเหตุการณ์)
 *
 * ค่าปริยายคือ `appendObservation` ของจริง การทดสอบความล้มเหลวจึงไม่ต้องทำให้
 * ระบบไฟล์จริงพัง — ซึ่งเป็นวิธีที่ทำหลักฐานจริงหายไป 187 แถวเมื่อ 2026-08-29
 *
 * ฉีดได้เฉพาะ "ตัวเขียน" ไม่ได้ฉีด path: พฤติกรรมของ production ไม่อ่อนลง
 * ผู้เรียกที่ไม่ส่ง deps ยังเขียนลงสโตร์จริงเหมือนเดิมทุกประการ
 */
export interface PersistDeps {
  readonly append?: typeof appendObservation;
}

export function persistRuntimeObservation(
  result: RuntimeObservationResult,
  correlation: ObservationCorrelation = {},
  deps: PersistDeps = {},
): PersistObservationOutcome {
  const append = deps.append ?? appendObservation;
  try {
    const record = append({
      event_id: `obs-rt-${result.runtime_target_id}-${Date.parse(result.observed_at)}`,
      resource_id: null,
      // path เป็นช่องบังคับของสัญญาเดิม — เป้าหมายรันไทม์ไม่ใช่ไฟล์ จึงบันทึก
      // ตัวตนของเป้าหมายไว้ตรงนี้ให้อ่านออก แทนที่จะใส่ path ปลอม
      path: `runtime-target://${result.runtime_target_id}`,
      observed_at: result.observed_at,
      process_evidence: [
        `pid=${String(result.pid)}`,
        `uptime_seconds=${String(result.uptime_seconds)}`,
        `http_status=${String(result.health?.http_status ?? null)}`,
      ],
      relationship_evidence: [],
      meaning_records: [],
      source: "control/machine-observation/target-observer.ts#observeRuntimeTarget",
      derived_by: "read-only sensor: /bin/ps + lsof + one HTTP GET (not a caller claim)",
      capability_id: result.capability_id,
      runtime_target_id: result.runtime_target_id,
      runtime_measurement: result,
      work_id: correlation.work_id ?? null,
      execution_id: correlation.execution_id ?? null,
      task_id: correlation.task_id ?? null,
    });
    return { ok: true, record, observation_id: record.event_id };
  } catch (error) {
    return { ok: false, reason_code: "PERSIST_FAILED", detail: error instanceof Error ? error.message : String(error) };
  }
}
