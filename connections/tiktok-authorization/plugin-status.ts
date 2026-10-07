/**
 * หน้าที่: read model สำหรับ UI — แปลง `TiktokAuthorizationRecord` เป็นสถานะปลั๊กอิน
 * ที่แสดงได้ โดยไม่มี token/code_verifier/field ใกล้ secret ใดๆ คู่ขนานกับ
 * `connections/provider-authorization/plugin-status.ts` ของ GitHub
 *
 * Input: `TiktokAuthorizationRecord | null`.
 * Output: `buildTiktokPluginStatus`.
 * Dependency ที่อนุญาต: ./types.ts.
 * สิ่งที่ห้ามแตะ: ห้ามใส่ token/code_verifier/state_nonce ลง read model.
 */

import type { TiktokAuthorizationRecord, TiktokPluginStatusReadModel } from "./types";

export function buildTiktokPluginStatus(record: TiktokAuthorizationRecord | null): TiktokPluginStatusReadModel {
  const state = record?.state ?? "NOT_CONNECTED";
  const login_status: TiktokPluginStatusReadModel["login_status"] =
    state === "CONNECTED" ? "LOGGED_IN" : state === "AUTHORIZATION_PENDING" ? "PENDING" : "NOT_LOGGED_IN";
  const plugin_status: TiktokPluginStatusReadModel["plugin_status"] =
    state === "CONNECTED" ? "READY" : state === "AUTHORIZATION_PENDING" ? "PENDING" : state === "AUTHORIZATION_FAILED" ? "ERROR" : "NOT_READY";
  return {
    provider: "tiktok",
    display_name: "TikTok",
    logo_key: "tiktok",
    login_status,
    plugin_status,
    account: record?.account ?? null,
    authorization_status: state,
  };
}
