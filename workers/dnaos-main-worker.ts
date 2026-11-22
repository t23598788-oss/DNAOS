/**
 * DNA OS thin edge gateway.
 *
 * HTTP path: validate the internal ingress secret and the canonical event
 * envelope, enqueue it, then acknowledge. It intentionally does not import or
 * run Vinext, business modules, AI providers, or database clients.
 *
 * Queue path: transport only. Forward accepted events to the separately hosted
 * Central Brain and ack only after that service confirms durable acceptance.
 */
import { isCoreEventEnvelope, type CoreEventEnvelope } from "../supabase/functions/_shared/core-event";

interface QueueMessage<T> {
  body: T;
  ack(): void;
  retry(options?: { delaySeconds?: number }): void;
}

interface QueueBatch<T> {
  messages: QueueMessage<T>[];
}

interface DnaOsBindings {
  CORE_EVENTS_INGEST_SECRET?: string;
  CORE_EVENT_RESULT_INGEST_SECRET?: string;
  CORE_EVENT_PROCESSOR_URL?: string;
  CORE_QUEUE_DISPATCH_SECRET?: string;
  CORE_EVENT_RETURN_URL?: string;
  CORE_EVENT_RETURN_SECRET?: string;
  DIGITALOCEAN_RECONCILIATION_URL?: string;
  CRON_SECRET?: string;
  DNAOS_CORE_EVENTS?: {
    sendBatch(messages: Array<{ body: CoreEventEnvelope }>): Promise<unknown>;
  };
}

function equalSecret(left: string, right: string): boolean {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index++) diff |= a[index] ^ b[index];
  return diff === 0;
}

async function receive(request: Request, env: DnaOsBindings): Promise<Response> {
  const url = new URL(request.url);
  const isResult = url.pathname === "/api/internal/core-event-results";
  if (url.pathname !== "/api/internal/core-events" && !isResult) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  if (request.method !== "POST") {
    return Response.json({ error: "method_not_allowed" }, { status: 405, headers: { allow: "POST" } });
  }

  const expected = isResult ? env.CORE_EVENT_RESULT_INGEST_SECRET : env.CORE_EVENTS_INGEST_SECRET;
  const supplied = request.headers.get(isResult ? "x-core-event-result-secret" : "x-core-events-secret") ?? "";
  if (!expected || !equalSecret(supplied, expected)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const events = isResult ? [(body as { event?: unknown } | null)?.event] : (body as { events?: unknown } | null)?.events;
  if (!Array.isArray(events) || events.length < 1 || events.length > 100 || !events.every(isCoreEventEnvelope)) {
    return Response.json({ error: "invalid_core_event_batch" }, { status: 400 });
  }
  if (isResult && events.some((event) =>
    event.source !== "dna-os-core" || !event.event_type.startsWith("core.execution.")
  )) {
    return Response.json({ error: "invalid_core_event_result" }, { status: 400 });
  }
  if (events.some((event) => new TextEncoder().encode(JSON.stringify(event)).byteLength > 96 * 1024)) {
    return Response.json({ error: "core_event_too_large" }, { status: 413 });
  }

  const queue = env.DNAOS_CORE_EVENTS;
  if (!queue) return Response.json({ error: "core_event_queue_unavailable" }, { status: 503 });
  try {
    await queue.sendBatch(events.map((event) => ({ body: event })));
  } catch {
    return Response.json({ error: "core_event_queue_unavailable" }, { status: 503 });
  }

  // The request has been durably accepted by the queue; processing happens
  // asynchronously in the Central Brain.
  return Response.json({ accepted: events.length }, { status: 200 });
}

async function forwardEvent(event: CoreEventEnvelope, env: DnaOsBindings): Promise<boolean> {
  const isResult = event.source === "dna-os-core" && event.event_type.startsWith("core.execution.");
  const destination = isResult ? env.CORE_EVENT_RETURN_URL : env.CORE_EVENT_PROCESSOR_URL;
  const secret = isResult ? env.CORE_EVENT_RETURN_SECRET : env.CORE_QUEUE_DISPATCH_SECRET;
  if (!destination || !secret) return false;

  try {
    const response = await fetch(destination, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [isResult ? "x-core-event-return-secret" : "x-core-queue-dispatch-secret"]: secret,
      },
      body: JSON.stringify(event),
    });
    return response.ok;
  } catch {
    return false;
  }
}

const worker = {
  fetch(request: Request, env: DnaOsBindings): Promise<Response> {
    return receive(request, env);
  },

  async queue(batch: QueueBatch<CoreEventEnvelope>, env: DnaOsBindings): Promise<void> {
    await Promise.all(batch.messages.map(async (message) => {
      if (!isCoreEventEnvelope(message.body)) {
        message.retry({ delaySeconds: 60 });
        return;
      }
      const delivered = await forwardEvent(message.body, env);
      if (delivered) message.ack();
      else message.retry({ delaySeconds: 30 });
    }));
  },

  async scheduled(_controller: { cron: string; scheduledTime: number }, env: DnaOsBindings): Promise<void> {
    const endpoint = env.DIGITALOCEAN_RECONCILIATION_URL;
    const secret = env.CRON_SECRET;
    if (!endpoint || !secret) {
      console.error("digitalocean reconciliation schedule is not configured");
      return;
    }
    let target: URL;
    try { target = new URL(endpoint); } catch {
      console.error("digitalocean reconciliation URL is invalid");
      return;
    }
    if (target.protocol !== "https:" || target.pathname !== "/api/cron/digitalocean-reconciliation") {
      console.error("digitalocean reconciliation URL must be HTTPS and point to the expected cron route");
      return;
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await fetch(target, { method: "POST", headers: { Authorization: `Bearer ${secret}` } });
        if (response.ok) return;
        const retryAfter = Number(response.headers.get("retry-after"));
        if (response.status === 429 && attempt < 2 && Number.isFinite(retryAfter) && retryAfter > 0 && retryAfter <= 60) {
          await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
          continue;
        }
        console.error(`digitalocean reconciliation failed with HTTP ${response.status}`);
        return;
      } catch {
        console.error("digitalocean reconciliation request failed");
        return;
      }
    }
  },
};

export default worker;
