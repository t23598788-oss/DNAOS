// Human Reality Timeline (owner, 2026-07-16/17): "รูปภาพ → เห็นรูปเดิม" —
// the original image a human sent must actually be kept, not just logged as
// a text placeholder. Fetches the real binary from LINE's Content API
// (separate from the Messaging API — LINE never sends media inline in the
// webhook payload, only a message id) and stores it in the same private
// 'attachments' Storage bucket app/api/admin/upload/route.ts already uses,
// under line-media/ so it's clearly a different real source than admin
// uploads. Returns a storage PATH, not a URL — the bucket is private, so a
// signed URL must be generated fresh on each read, not persisted stale.

// Extended to PDF/file and voice (owner, TASK-001 Restore Original Human
// Data, 2026-07-17) — same fetch-and-store mechanism, works for any LINE
// message type that carries a content id (image/file/audio/video all use
// the same Content API endpoint). extHint comes from LINE's own fileName
// when the message type provides one (real, not guessed); falls back to
// sniffing the response's content-type otherwise.
function extensionFor(contentType: string, extHint?: string | null): string {
  if (extHint) return extHint.replace(/^\./, "")
  if (contentType.includes("png")) return "png"
  if (contentType.includes("gif")) return "gif"
  if (contentType.includes("pdf")) return "pdf"
  if (contentType.includes("mp4") || contentType.includes("m4a")) return "m4a"
  if (contentType.includes("jpeg") || contentType.includes("jpg")) return "jpg"
  return "bin"
}

export async function fetchAndStoreLineMedia(
  supabase: any,
  messageId: string,
  contentTypeHint: string,
  fileNameHint?: string | null
): Promise<string | null> {
  const token = Deno.env.get('LINE_CHANNEL_ACCESS_TOKEN')
  if (!token) {
    console.error('[media] LINE_CHANNEL_ACCESS_TOKEN not set — cannot fetch original content')
    return null
  }

  const res = await fetch(`https://api-data.line.me/v2/bot/message/${messageId}/content`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    console.error(`[media] LINE Content API failed for ${messageId}: HTTP ${res.status}`)
    return null
  }

  const contentType = res.headers.get('content-type') ?? contentTypeHint
  const extFromName = fileNameHint?.includes(".") ? fileNameHint.split(".").pop() : null
  const ext = extensionFor(contentType, extFromName)
  const bytes = new Uint8Array(await res.arrayBuffer())
  const path = `line-media/${messageId}.${ext}`

  const { error } = await supabase.storage.from('attachments').upload(path, bytes, {
    contentType,
    upsert: true,
  })
  if (error) {
    console.error(`[media] Storage upload failed for ${messageId}:`, error.message)
    return null
  }

  return path
}
