export interface FacebookSendResult {
  success: boolean
  messageId?: string
  error?: string
}

export async function sendFacebookMessage(
  recipientId: string,
  text: string,
): Promise<FacebookSendResult> {
  const accessToken = process.env.FACEBOOK_PAGE_ACCESS_TOKEN
  if (!accessToken) {
    return { success: false, error: "FACEBOOK_PAGE_ACCESS_TOKEN not configured" }
  }
  const url = `https://graph.facebook.com/v19.0/me/messages?access_token=${encodeURIComponent(accessToken)}`
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recipient: { id: recipientId },
        message: { text },
      }),
    })
    const body = (await res.json().catch(() => ({}))) as { message_id?: string; error?: { message?: string } }
    if (!res.ok) {
      return { success: false, error: body?.error?.message ?? `Facebook Send API ${res.status}` }
    }
    return { success: true, messageId: body?.message_id }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}
