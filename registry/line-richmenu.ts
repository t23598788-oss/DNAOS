/**
 * LINE Rich Menu Controller (owner spec, 2026-07-24).
 *
 * Single place that links/unlinks a per-user Rich Menu — reuses
 * LINE_CHANNEL_ACCESS_TOKEN (already a real, shared secret in this project,
 * same one registry/communication.ts uses).
 *
 * HONESTY NOTE: this only LINKS/UNLINKS a Rich Menu that must already exist
 * on the LINE Official Account (owner confirmed 2026-07-24: not created
 * yet). Creating a Rich Menu requires a real uploaded image (2500x1686 or
 * 2500x843px) + defined tap areas via LINE's Create Rich Menu API — that is
 * a one-time design/setup step this file does not attempt (no real button
 * image exists to upload), gated cleanly on LINE_RICHMENU_START_ID being
 * set once that setup is done.
 */

export interface RichMenuResult {
  ok: boolean
  error?: string
}

export async function setDriverStartButtonRichMenu(lineUserId: string, isActive: boolean): Promise<RichMenuResult> {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN
  if (!token) return { ok: false, error: "LINE_CHANNEL_ACCESS_TOKEN ยังไม่ได้ตั้งค่า" }

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
