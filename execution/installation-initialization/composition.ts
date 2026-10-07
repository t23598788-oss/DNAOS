/**
 * Production composition owner for the local initialization ceremony.
 *
 * ── ทำไมไฟล์นี้เคยปิดไว้ และทำไมตอนนี้เปิด ──
 * V1 จงใจหยุดก่อนถึงตัวเขียน เพราะยังไม่มีใครสั่งให้เครื่องนี้ประกาศตัวตน
 * ของตัวเอง Owner สั่งใน CLOSE_MACHINE_IDENTITY_AND_RECOVERY_FOUNDATION
 * (2026-08-30) ให้สร้างตัวตนของเครื่องปัจจุบัน ทางที่ติดอาวุธจึงเปิดที่นี่
 * ทางเดียว — `runLocalInitializationCeremony` ยังคงปลดอาวุธไว้เหมือนเดิม
 * ผู้เรียกเดิมทุกตัวจึงพฤติกรรมไม่เปลี่ยน
 *
 * ── ยังเป็นพิธีครั้งเดียว ──
 * ไม่มีทางเขียนทับ: ถ้ามีระเบียนอยู่แล้วจะได้ `ALREADY_INITIALIZED` และถ้าไฟล์
 * เสียจะได้ `CORRUPT` ไม่ใช่การสร้างใหม่ทับของเดิม การอ่านกลับต้องตรงทุกช่อง
 * ก่อนจะเรียกว่าสำเร็จ
 *
 * ── ตัวตนต้องไม่มีที่มาจากเครื่อง ──
 * `installation_id` เป็น UUID สุ่ม ไม่ derive จาก hostname, path, รีโป หรือ
 * เนื้อหาใด ๆ เปลี่ยนชื่อเครื่องแล้วมันไม่เปลี่ยน และย้าย checkout แล้วก็ไม่เปลี่ยน
 */

import { randomUUID } from "node:crypto";
import { buildInitializationRecord } from "../../contracts/installation/installation-initialization";
import { readInstallationInitialization, initializationPath } from "./contract";
import { createInstallationInitializationFromCeremony } from "./restricted";
import { authorizeLocalInstallationCeremonyEntry } from "./ceremony";
import type { LocalInstallationCeremonyInvocationV1 } from "./ceremony";

export { enterLocalInstallationCeremony as runLocalInitializationCeremony } from "./ceremony";
export type { LocalInstallationCeremonyResult } from "./ceremony";

export type LocalInitializationOutcome =
  | { readonly status: "INITIALIZATION_CREATED"; readonly installation_id: string; readonly initialization_id: string; readonly record_digest: string; readonly path: string | null }
  | { readonly status: "ALREADY_INITIALIZED"; readonly installation_id: string; readonly initialization_id: string; readonly path: string | null }
  | { readonly status: "INVALID_INVOCATION" | "CONFLICT" | "CORRUPT" | "FAILED"; readonly reason: string };

/**
 * เส้นทางติดอาวุธเส้นเดียวของการประกาศตัวตนเครื่อง
 *
 * ใช้ state root จริงของเครื่อง ไม่มีการเปลี่ยน `DNA_OS_STATE_ROOT` ให้ชี้ที่อื่น
 * ผู้เรียกต้องส่ง invocation ที่ถูกต้องมาเอง — ไม่มีค่าเริ่มต้นที่ทำให้เรียกโดย
 * บังเอิญได้
 */
export function initializeLocalInstallation(
  invocation: LocalInstallationCeremonyInvocationV1,
  now: string,
  evidenceRefs: readonly string[],
): LocalInitializationOutcome {
  const entry = authorizeLocalInstallationCeremonyEntry(invocation);
  if (entry.status !== "AUTHORIZED_FOR_CEREMONY_ENTRY") {
    return { status: "INVALID_INVOCATION", reason: entry.reason };
  }

  const current = readInstallationInitialization();
  if (current.state === "INITIALIZED") {
    return { status: "ALREADY_INITIALIZED", installation_id: current.initialization.installation_id,
      initialization_id: current.initialization.initialization_id, path: initializationPath() };
  }
  if (current.state === "CORRUPT") return { status: "CORRUPT", reason: current.reason_code };

  const candidate = `installation-${randomUUID()}`;
  const built = buildInitializationRecord({ installation_id: candidate, created_at: now, evidence_refs: evidenceRefs });
  if (!built.ok) return { status: "FAILED", reason: built.reason_code };

  const created = createInstallationInitializationFromCeremony(built.record);
  if (created.result === "REPLAY") {
    return { status: "ALREADY_INITIALIZED", installation_id: created.initialization.installation_id,
      initialization_id: created.initialization.initialization_id, path: initializationPath() };
  }
  if (created.result === "CONFLICT") return { status: "CONFLICT", reason: created.detail };
  if (created.result !== "CREATED") {
    return { status: created.result === "CORRUPT" ? "CORRUPT" : "FAILED", reason: created.detail };
  }

  // สำเร็จก็ต่อเมื่ออ่านกลับได้ตรงทุกช่อง — การเขียนสำเร็จอย่างเดียวไม่พอ
  const readBack = readInstallationInitialization();
  if (readBack.state !== "INITIALIZED"
      || readBack.initialization.installation_id !== candidate
      || readBack.initialization.initialization_id !== built.record.initialization_id
      || readBack.initialization.record_digest !== built.record.record_digest) {
    return { status: "CORRUPT", reason: "READBACK_IDENTITY_MISMATCH" };
  }
  return { status: "INITIALIZATION_CREATED", installation_id: candidate,
    initialization_id: built.record.initialization_id, record_digest: built.record.record_digest, path: initializationPath() };
}
