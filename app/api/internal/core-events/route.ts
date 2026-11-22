import { env } from "cloudflare:workers";
import { NextResponse } from "next/server";
import { isCoreEventEnvelope, type CoreEventEnvelope } from "@/supabase/functions/_shared/core-event";

export const runtime = "edge";
export const dynamic = "force-dynamic";

function equalSecret(left: string, right: string): boolean {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function POST(req: Request) {
  const expected = (env as unknown as { CORE_EVENTS_INGEST_SECRET?: string }).CORE_EVENTS_INGEST_SECRET;
  const supplied = req.headers.get("x-core-events-secret") ?? "";
  if (!expected || !equalSecret(supplied, expected)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const events = (body as { events?: unknown })?.events;
  if (!Array.isArray(events) || events.length < 1 || events.length > 100 || !events.every(isCoreEventEnvelope)) {
    return NextResponse.json({ error: "invalid core event batch" }, { status: 400 });
  }

  const queue = (env as unknown as { DNAOS_CORE_EVENTS?: { sendBatch(messages: Array<{ body: CoreEventEnvelope }>): Promise<unknown> } }).DNAOS_CORE_EVENTS;
  if (!queue) return NextResponse.json({ error: "core event queue is not bound" }, { status: 503 });

  try {
    await queue.sendBatch(events.map((event) => ({ body: event })));
    return NextResponse.json({ accepted: events.length }, { status: 202 });
  } catch {
    // The Edge webhook retries on a non-202 response; no event is acknowledged
    // unless Cloudflare accepted the whole batch.
    return NextResponse.json({ error: "core event queue unavailable" }, { status: 503 });
  }
}
