/**
 * LINE Rich Menu Controller (owner spec, 2026-07-24).
 *
 * Single place that links/unlinks a per-user Rich Menu — resolves the
 * channel token through the canonical connector lifecycle Run gate
 * (core/connector-loader.ts requireConnector on the "line" connector), the
 * same credential path registry/communication.ts uses. Fail-closed with the
 * loader's own owner-facing message when the connector isn't runnable.
 *
 * HONESTY NOTE: this only LINKS/UNLINKS a Rich Menu that must already exist
 * on the LINE Official Account (owner confirmed 2026-07-24: not created
 * yet). Creating a Rich Menu requires a real uploaded image (2500x1686 or
 * 2500x843px) + defined tap areas via LINE's Create Rich Menu API — that is
 * a one-time design/setup step this file does not attempt (no real button
 * image exists to upload), gated cleanly on LINE_RICHMENU_START_ID being
 * set once that setup is done.
 */

import { requireConnector } from "@/core/connector-loader";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface RichMenuResult {
  ok: boolean
  error?: string
}

// Phase 2.3A convention (same as registry/communication.ts): the caller —
// already allowed to import services/ — passes its real Supabase client in;
// registry/* must not import services/* (registry/dependency-graph.json).
export async function setDriverStartButtonRichMenu(db: SupabaseClient, lineUserId: string, isActive: boolean): Promise<RichMenuResult> {
  let token = "";
  try {
    const connector = await requireConnector(db, "line", "registry/line-richmenu.setDriverStartButtonRichMenu");
    token =
      (connector.secret.channel_access_token as string) ??
      (connector.secret.token as string) ??
      (connector.secret.api_key as string) ??
      "";
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `LINE connector ยังไม่พร้อม (Run gate ปฏิเสธ): ${msg}` };
  }
  if (!token) return { ok: false, error: 'connector "line" ไม่มี channel_access_token ใน secret — แก้ที่ /admin/connectors' }

  if (isActive) {
    const richMenuId = process.env.LINE_RICHMENU_START_ID
    if (!richMenuId) {
      return { ok: false, error: "LINE_RICHMENU_START_ID ยังไม่ได้ตั้งค่า — ต้องสร้าง Rich Menu จริงบน LINE ก่อน (อัปโหลดรูป + กำหนดพื้นที่กด)" }
    }
    const res = await fetch(`https://api.line.me/v2/bot/user/${lineUserId}/richmenu/${richMenuId}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return { ok: false, error: `ผูก Rich Menu ไม่สำเร็จ: HTTP ${res.status}` }
    return { ok: true }
  }

  const res = await fetch(`https://api.line.me/v2/bot/user/${lineUserId}/richmenu`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) return { ok: false, error: `ถอด Rich Menu ไม่สำเร็จ: HTTP ${res.status}` }
  return { ok: true }
}
