import { createClient } from "@supabase/supabase-js";
import { normalizeMetaWebhook, verifyMetaSignature, metaVerifyChallenge } from "../../engines/integration-gateway/adapters/meta";
import { publish } from "../../engines/integration-gateway/event-bus/bus";

interface Env {
  META_APP_SECRET: string;
  META_VERIFY_TOKEN: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
}

const CALLBACK_PATH = "/api/gateway/observe/meta";

function json(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== CALLBACK_PATH) return json({ error: "not found" }, 404);

    if (request.method === "GET") {
      if (!env.META_VERIFY_TOKEN) return json({ error: "META_VERIFY_TOKEN not configured" }, 503);
      const challenge = metaVerifyChallenge({
        mode: url.searchParams.get("hub.mode"),
        verifyToken: url.searchParams.get("hub.verify_token"),
        challenge: url.searchParams.get("hub.challenge"),
      }, env.META_VERIFY_TOKEN);
      if (challenge === null) return json({ error: "invalid verification request" }, 403);
      return new Response(challenge, {
        status: 200,
        headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
      });
    }

    if (request.method !== "POST") return json({ error: "method not allowed" }, 405);
    if (!env.META_APP_SECRET) return json({ error: "META_APP_SECRET not configured" }, 503);
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
      return json({ error: "event store is not configured" }, 503);
    }

    const rawBody = await request.text();
    if (rawBody.length > 1_000_000) return json({ error: "payload too large" }, 413);
    if (!verifyMetaSignature(rawBody, request.headers.get("x-hub-signature-256"), env.META_APP_SECRET)) {
      return json({ error: "invalid signature" }, 401);
    }

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return json({ error: "unparseable JSON body" }, 400);
    }

    const { events, skipped } = normalizeMetaWebhook(payload);
    const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    for (const event of events) {
      try {
        const result = await publish(db, event);
        if (!result.ok) return json({ error: result.reason }, 500);
      } catch {
        return json({ error: "event gateway unavailable" }, 500);
      }
    }

    return json({ ok: true, accepted: events.length, skipped }, 200);
  },
};

export default worker;
