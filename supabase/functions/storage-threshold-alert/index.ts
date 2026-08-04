// Storage Intelligence — threshold alert relay. Called by
// local-runtime/storage-threshold-watcher.mjs (runs on the dev Mac every 6h)
// when free disk space drops below the 150GB target. This function does the
// one thing it needs to: push a LINE message to the owner. It does NOT scan,
// classify, or move anything — that's engines/storage/engine.ts's job, which
// only runs on the Mac (it needs real filesystem access this Edge Function
// doesn't have).
//
// Reuses the same LINE push mechanics as
// supabase/functions/line-webhook-v2/engines/owner-dispatcher.ts's
// alertOwnerAnomaly() — duplicated here rather than cross-imported because
// Supabase Edge Functions don't share code across function directories
// except via supabase/functions/_shared/. Known, small, non-blocking dup;
// worth moving into _shared/owner-notify.ts in a follow-up pass.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req: Request) => {
  const expectedSecret = Deno.env.get("AI_CALLBACK_SECRET");
  const givenSecret = req.headers.get("X-DNA-Internal-Secret");
  if (!expectedSecret || givenSecret !== expectedSecret) {
    return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const { freeBytes, thresholdBytes, reclaimableBytes } = body;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  const { data: ownerProfile } = await supabase
    .from("line_profiles").select("line_user_id").eq("role", "owner").limit(1).maybeSingle();
  const ownerId = ownerProfile?.line_user_id ?? null;
  if (!ownerId) {
    return new Response(JSON.stringify({ ok: false, error: "no owner line_profile found" }), { status: 200 });
  }

  const gb = (n: number) => (n / 1e9).toFixed(1);
  const text = `💾 พื้นที่ SSD ต่ำกว่าเป้าหมาย\nว่างอยู่: ${gb(freeBytes)}GB (เป้าหมาย ${gb(thresholdBytes)}GB)\n` +
    (reclaimableBytes != null ? `คืนได้จริง (SAFE): ${gb(reclaimableBytes)}GB — เปิด /admin/storage เพื่อดูรายละเอียด` : `เปิด /admin/storage เพื่อสแกนและดูว่าจะคืนพื้นที่ได้เท่าไร`);

  const lineAccessToken = Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN");
  if (lineAccessToken) {
    await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${lineAccessToken}` },
      body: JSON.stringify({ to: ownerId, messages: [{ type: "text", text }] }),
    }).catch(() => {});
  }

  return new Response(JSON.stringify({ ok: true, notified: !!lineAccessToken }), { status: 200 });
});
