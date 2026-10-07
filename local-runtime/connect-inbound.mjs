// Connect inbound-source transport — Node twin of supabase/functions/_shared/connect-inbound.ts
// (owner channel-expansion 2026-10-07, canonical doc "local-runtime helpers" gap).
//
// The ONLY path local-runtime scripts (watch-drive / backfill-slips) may use to
// create a receipt_documents row: POST /api/internal/connect/inbound-source →
// engines/canonical/inbound-write (canonical writer + audit + evidence rules).
// Fail-closed, same contract as the Deno twin:
//   - missing DNA_OS_APP_URL / INBOUND_SOURCE_INTERNAL_SECRET → { ok:false }
//   - non-2xx, writer rejection or network failure → { ok:false, error }
//   - NEVER a direct supabase write, NEVER a silent fallback — the caller
//     handles the failure itself (watch-drive: file stays unprocessed and is
//     retried next round; backfill: counted as failed, row never fabricated)
//
// env ที่ต้องมี (two-sided — ขาดฝั่งใด = fail closed, ไม่มีการ insert ตรง):
//   local-runtime: อ่านจาก .env.local (DNA_OS_APP_URL + INBOUND_SOURCE_INTERNAL_SECRET)
//   Next: INBOUND_SOURCE_INTERNAL_SECRET (.env.local.example มีเอกสารไว้แล้ว)
//
// payload mirror ของ engines/canonical/inbound-write.ts InboundSourceInput —
// รู้จักเฉพาะ field ที่สคริปต์ส่งได้จริง ไม่รู้จักคอลัมน์ตาราง/เงิน/fallback

/**
 * @param {Record<string,string|undefined>} env parsed .env.local map (same pattern as sibling scripts)
 * @param {Record<string,unknown>} payload inbound fields (channel, media_path, document_type, ...)
 * @param {string} actor audit actor, e.g. "local-runtime:watch-drive"
 * @returns {Promise<{ok:boolean,error?:string,data?:Record<string,unknown>}>}
 */
export async function sendConnectInboundSource(env, payload, actor) {
  const appUrl = env.DNA_OS_APP_URL;
  const secret = env.INBOUND_SOURCE_INTERNAL_SECRET;
  if (!appUrl || !secret) {
    return { ok: false, error: "INBOUND_CONNECT_TRANSPORT_NOT_CONFIGURED" };
  }

  try {
    const res = await fetch(`${appUrl.replace(/\/+$/, "")}/api/internal/connect/inbound-source`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-inbound-source-internal-secret": secret },
      body: JSON.stringify({ ...payload, actor }),
      signal: AbortSignal.timeout(8000),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.ok === false) {
      return { ok: false, error: body.error ?? `INBOUND_CONNECT_TRANSPORT_HTTP_${res.status}` };
    }
    return { ok: true, data: body.data };
  } catch (err) {
    return { ok: false, error: `INBOUND_CONNECT_TRANSPORT_FAILED:${err instanceof Error ? err.message : String(err)}` };
  }
}
