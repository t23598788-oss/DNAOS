/**
 * หน้าที่: §1 — the REAL network edge of `control/owner-backbone/`.
 * Real HTTP in, persisted command, immediate ACK, real SSE out.
 *
 * NO NEW SERVER. These handlers mount onto the transport that already
 * exists (`./server.ts`) and already carries the shared-secret gate, the
 * bind policy and the supervisor entry. Adding a second listener would mean
 * a second auth surface, which is exactly the thing this repo refuses.
 *
 * ROUTES (namespaced under /owner/ deliberately: `/command` is ALREADY the
 * command-router's own route, and silently changing its meaning would break
 * the existing caller):
 *   POST /owner/command          -> persist + ack RECEIVED (never waits on execution)
 *   GET  /owner/command/:id      -> the persisted envelope + its events
 *   GET  /owner/work/:id         -> the work read model
 *   GET  /owner/incident/:id     -> incident-remediation's state
 *   GET  /owner/events?work_id=  -> SSE, replayed from Last-Event-ID
 *
 * Input: HTTP requests.
 * Output: `handleOwnerBackboneRoute` (returns false when the URL is not ours).
 * Dependency ที่อนุญาต: node:http, ../../control/owner-backbone/contract.ts.
 * สิ่งที่ห้ามแตะ: never execute here, and never let the request body supply
 * a work_id that did not come from the Owner as `work_id_if_existing` —
 * the transport must not be able to mint or hijack work.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import {
  submitOwnerCommandEnvelope,
  newOwnerCommand,
  getWorkState,
  loadCommand,
  commandsForWork,
  eventsForCommand,
  eventsSince,
  onSystemEvent,
  getIncidentState,
  waitingRowFor,
} from "../../control/owner-backbone/contract";
import type { SystemEvent } from "../../control/owner-backbone/contract";
import { listOwnerConsoleItems } from "../../control/owner-error-lane/contract";
import { getCurrentActionQueue } from "../../control/owner-backbone/action-queue";

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(payload) });
  res.end(payload);
}

async function body(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

/** SSE frame. `id:` is the event_id, which is exactly what a reconnecting client sends back as Last-Event-ID. */
function frame(event: SystemEvent): string {
  return `id: ${event.event_id}\nevent: ${event.event_type}\ndata: ${JSON.stringify(event)}\n\n`;
}

/**
 * Returns true when it handled the request. `server.ts` calls this before
 * its own 404 so the existing routes keep priority.
 */
export function handleOwnerBackboneRoute(req: IncomingMessage, res: ServerResponse): boolean {
  const url = req.url ?? "";
  if (!url.startsWith("/owner/")) return false;
  const path = url.split("?")[0];

  if (req.method === "POST" && path === "/owner/command") {
    void (async () => {
      let parsed: Record<string, unknown>;
      try { parsed = JSON.parse(await body(req)) as Record<string, unknown>; }
      catch { json(res, 400, { error: "invalid JSON body" }); return; }

      const requested = typeof parsed.requested_action === "string" ? parsed.requested_action : "";
      const target = typeof parsed.target === "string" ? parsed.target : "";
      if (requested === "" || target === "") {
        json(res, 400, { error: "requested_action and target are required" });
        return;
      }
      const command = newOwnerCommand({
        source: (parsed.source as never) ?? "TEXT",
        command_type: (parsed.command_type as never) ?? "QUERY",
        requested_action: requested,
        target,
        parameters: (parsed.parameters as never) ?? {},
        work_id_if_existing: (parsed.work_id_if_existing as string | null) ?? null,
        incident_id_if_existing: (parsed.incident_id_if_existing as string | null) ?? null,
      });
      // Awaited only up to the ACK. Dispatch is already running by the time
      // this responds — the gateway scheduled it; nothing here starts it.
      const ack = await submitOwnerCommandEnvelope(command);
      json(res, 202, { ...ack, command });
    })();
    return true;
  }

  const commandMatch = path.match(/^\/owner\/command\/([^/]+)$/);
  if (req.method === "GET" && commandMatch) {
    const commandId = decodeURIComponent(commandMatch[1]);
    const events = eventsForCommand(commandId);
    const workId = events[0]?.work_id ?? null;
    const envelope = workId ? loadCommand(workId, commandId) : null;
    if (envelope === null && events.length === 0) { json(res, 404, { error: "COMMAND_NOT_FOUND", command_id: commandId }); return true; }
    json(res, 200, { command_id: commandId, work_id: workId, command: envelope, events });
    return true;
  }

  const workMatch = path.match(/^\/owner\/work\/([^/]+)$/);
  if (req.method === "GET" && workMatch) {
    const workId = decodeURIComponent(workMatch[1]);
    const state = getWorkState(workId);
    if (!state.known) { json(res, 404, { error: "WORK_NOT_FOUND", work_id: workId }); return true; }
    const waiting = waitingRowFor(workId);
    json(res, 200, {
      ...state,
      commands: commandsForWork(workId),
      // A parked wait is reported explicitly. Work that is waiting must not
      // look identical to work that simply stopped producing events.
      waiting: waiting === null ? null : { status: waiting.status, blocked_on: waiting.blocked_on, next_action: waiting.next_action },
    });
    return true;
  }

  const incidentMatch = path.match(/^\/owner\/incident\/([^/]+)$/);
  if (req.method === "GET" && incidentMatch) {
    const incidentId = decodeURIComponent(incidentMatch[1]);
    void getIncidentState(incidentId)
      .then((state) => json(res, state.known ? 200 : 404, { incident_id: incidentId, ...state }))
      .catch((error) => json(res, 500, { error: error instanceof Error ? error.message : String(error) }));
    return true;
  }

  // §5/§6 คอนโซลสองเลน: หน้าจอ #command อ่านทั้งคำสั่งของ Owner และความผิดพลาด
  // ที่ระบบสร้างเอง จากสโตร์สายเลือดเดียวกัน — ไม่มีหน้าจอที่สองและไม่มีสโตร์ใหม่
  if (req.method === "GET" && path === "/owner/console") {
    const query = new URLSearchParams(url.includes("?") ? url.slice(url.indexOf("?") + 1) : "");
    const rawLimit = Number(query.get("limit") ?? "50");
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 200) : 50;
    json(res, 200, { items: listOwnerConsoleItems(limit) });
    return true;
  }

  if (req.method === "GET" && path === "/owner/action-queue") {
    json(res, 200, getCurrentActionQueue());
    return true;
  }

  if (req.method === "GET" && path === "/owner/events") {
    const query = new URLSearchParams(url.includes("?") ? url.slice(url.indexOf("?") + 1) : "");
    const workId = query.get("work_id");
    if (workId === null) { json(res, 400, { error: "work_id is required" }); return true; }

    // §14 RECONNECT. The header wins over the query parameter, because a
    // browser's EventSource sets the header automatically and a client that
    // sends both means the header.
    const headerId = req.headers["last-event-id"];
    const lastEventId = (Array.isArray(headerId) ? headerId[0] : headerId) ?? query.get("since") ?? null;

    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
    const replayed = eventsSince(workId, lastEventId);
    // DOUBLE DELIVERY, found live 2026-08-26 by the Control Workspace's own
    // acceptance test. `emitSystemEvent` persists the event, then awaits its
    // transport call, and only notifies listeners afterwards. A client that
    // connects inside that gap reads the event from the replay AND receives
    // it again from the live tail. Remembering what was replayed closes it
    // at the source, so every consumer stops having to de-duplicate.
    const delivered = new Set<string>();
    for (const event of replayed) { delivered.add(event.event_id); res.write(frame(event)); }
    res.write(`: replayed ${replayed.length} event(s) after ${lastEventId ?? "the beginning"}\n\n`);

    const unsubscribe = onSystemEvent((event) => {
      if (event.work_id !== workId) return;
      if (delivered.has(event.event_id)) return;
      delivered.add(event.event_id);
      res.write(frame(event));
    });
    req.on("close", unsubscribe);
    res.on("close", unsubscribe);
    return true;
  }

  json(res, 404, { error: "not found" });
  return true;
}
