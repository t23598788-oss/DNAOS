// Development Machine Policy — drift alert relay (Constitution Rule 117,
// owner 2026-08-04). Called by local-runtime/storage-threshold-watcher.ts
// when a real local AI runtime/model is detected on the dev Mac. Same
// pattern as storage-threshold-alert — this function only pushes a LINE
// message, it does no detection itself (that's engines/workspace/
// architectureDriftDetector.ts, which needs real filesystem/process access
// this Edge Function doesn't have).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getLineChannelAccessToken } from "../_shared/line-client.ts";

Deno.serve(async (req: Request) => {
  const expectedSecret = Deno.env.get("AI_CALLBACK_SECRET");
  const givenSecret = req.headers.get("X-DNA-Internal-Secret");
  if (!expectedSecret || givenSecret !== expectedSecret) {
    return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const { findings } = body as { findings: { kind: string; detail: string }[] };

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

  const lines = (findings ?? []).slice(0, 8).map((f) => `- [${f.kind}] ${f.detail}`).join("\n");
  const text = `⚠️ Architecture Drift: พบ Local AI Runtime/Model บนเครื่องพัฒนา\n${lines}${(findings?.length ?? 0) > 8 ? `\n...และอีก ${findings.length - 8} รายการ` : ""}\n\nนโยบาย: เครื่อง Local เก็บเฉพาะ Source Code/Build Tools/Dev Environment — AI Runtime ต้องอยู่บน Cloud เท่านั้น`;

  // Canonical credential path (LINE cutover): bridge → connector lifecycle Run gate.
  const lineAccessToken = await getLineChannelAccessToken();
  if (lineAccessToken) {
    await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${lineAccessToken}` },
      body: JSON.stringify({ to: ownerId, messages: [{ type: "text", text }] }),
    }).catch(() => {});
  }

  return new Response(JSON.stringify({ ok: true, notified: !!lineAccessToken }), { status: 200 });
});
