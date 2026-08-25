/**
 * หน้าที่: a minimal Node `http` server (no framework, Node built-ins
 * only — same "no express/ws/socket.io" constraint
 * `../../dna-os-circuit/runtime/server.ts` documents for itself) that (1)
 * accepts `POST /joints` / `POST /violations` from any real cross-
 * capability call site (Pillar 1's two hook points, plus
 * `control/circuit-breaker/`), and (2) exposes `GET /events`, an SSE
 * endpoint streaming those rows live, plus a tiny static HTML viewer at
 * `GET /`. This is the transport layer between ./joint-store.ts (pure
 * state) and a browser — it holds no state of its own beyond the
 * `JointStore` instance it's constructed with, matching
 * `../../dna-os-circuit/runtime/server.ts`'s own split.
 *
 * Input: a `JointStore` instance (constructed by ./start.ts).
 * Output: an HTTP server exposing `GET /`, `GET /events` (SSE),
 * `GET /joints`, `GET /violations`, `POST /joints`, `POST /violations`.
 * Dependency ที่อนุญาต: ./joint-store.ts, ./host-runtime.ts, ./types.ts.
 * สิ่งที่ห้ามแตะ: never add express/ws/socket.io or any other npm
 * dependency. Never let one client's dropped connection or one bad
 * event throw uncaught and kill the process — every write to a response
 * stream is wrapped, same discipline as
 * `../../dna-os-circuit/runtime/server.ts`'s `handleSse`/`safeSend`.
 */

import { appendJsonlLine, createHttpServer, hostRandomId, joinPath, nowIso, readRequestBody, repoRootDirname, type HostHttpRequest, type HostHttpResponse } from "./host-runtime";
import { JointStore } from "./joint-store";
import type { OccurrenceStamp, ReportJointInput, ReportViolationInput } from "./types";
import { verifySharedSecret, evaluateBindPolicy } from "../../permissions/network-auth-gate/contract";

declare const process: { env: Record<string, string | undefined> };

/**
 * Network auth gate (2026-08-24, migration hardening). Lower risk than
 * transport/owner-command-http or dna-os-circuit/runtime — this server
 * reaches no execution path, only its own JointStore — but its two POST
 * routes are unauthenticated writes into an evidence store that the
 * census/registry derive real facts from (see peer review finding, same
 * date: forged joint/violation rows could make the system believe false
 * things about itself). Same shared decision logic as the other two
 * servers, see `permissions/network-auth-gate/`.
 */
function requireSharedSecret(req: HostHttpRequest, res: HostHttpResponse): boolean {
  const expected = process.env.JOINT_MONITOR_SHARED_SECRET;
  if (!expected) return true;
  const header = req.headers.authorization;
  if (verifySharedSecret(typeof header === "string" ? header : undefined, expected)) return true;
  sendJson(res, 401, { error: "unauthorized" });
  return false;
}

function safeSend(res: HostHttpResponse, status: number, contentType: string, body: string): void {
  try {
    if (res.headersSent) return;
    res.writeHead(status, { "Content-Type": contentType });
    res.end(body);
  } catch {
    // A client that disconnected mid-response must never crash the server.
  }
}

function sendJson(res: HostHttpResponse, status: number, body: unknown): void {
  safeSend(res, status, "application/json; charset=utf-8", JSON.stringify(body));
}

function handleSse(store: JointStore, req: HostHttpRequest, res: HostHttpResponse): void {
  try {
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    });
  } catch {
    return;
  }

  const send = (payload: unknown): void => {
    try {
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    } catch {
      // dropped client — the listener is removed on "close" below.
    }
  };

  send({ type: "snapshot", snapshot: store.snapshot() });

  const onChange = (event: { kind: "joint" | "violation"; row: unknown }): void => {
    try {
      send({ type: "change", event, snapshot: store.snapshot() });
    } catch {
      // never let a listener throw escape into the emitter loop.
    }
  };
  store.on("change", onChange);

  req.on("close", () => {
    store.off("change", onChange);
  });
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** Loose validation, never trusts shape beyond "the required fields are real strings" — mirrors `../../dna-os-circuit/runtime/finding-receiver.ts`'s "validates loosely, never guesses a missing field" discipline. Rejects rather than silently coercing a malformed report. */
/**
 * EVENT_OCCURRED_ORDER off the wire, or `undefined` when the reporter did
 * not send one. Deliberately optional rather than required: a reporter
 * running code older than 2026-08-26 (and every row already on disk from
 * before it) has no stamp, and refusing those reports would turn an
 * ordering fix into an outage for anything not yet redeployed. Unstamped
 * reports are labelled as such at the call site below, never quietly
 * given a stamp that looks reporter-supplied.
 */
function parseOccurrenceStamp(b: Record<string, unknown>): OccurrenceStamp | undefined {
  if (!isNonEmptyString(b.occurred_at)) return undefined;
  if (typeof b.occurred_seq !== "number" || !Number.isFinite(b.occurred_seq)) return undefined;
  if (!isNonEmptyString(b.reporter_run_id)) return undefined;
  return { occurred_at: b.occurred_at, occurred_seq: b.occurred_seq, reporter_run_id: b.reporter_run_id };
}

function parseJointInput(body: unknown): { ok: true; input: ReportJointInput; stamp: OccurrenceStamp | undefined } | { ok: false; reason: string } {
  if (!body || typeof body !== "object") return { ok: false, reason: "body is not an object" };
  const b = body as Record<string, unknown>;
  if (!isNonEmptyString(b.from_capability)) return { ok: false, reason: "from_capability is required" };
  if (!isNonEmptyString(b.to_capability)) return { ok: false, reason: "to_capability is required" };
  if (!isNonEmptyString(b.status)) return { ok: false, reason: "status is required" };
  if (!isNonEmptyString(b.summary)) return { ok: false, reason: "summary is required" };
  if (!isNonEmptyString(b.source)) return { ok: false, reason: "source is required" };
  const task_id = typeof b.task_id === "string" ? b.task_id : null;
  return { ok: true, input: { from_capability: b.from_capability, to_capability: b.to_capability, task_id, status: b.status, summary: b.summary, source: b.source }, stamp: parseOccurrenceStamp(b) };
}

function parseViolationInput(body: unknown): { ok: true; input: ReportViolationInput; stamp: OccurrenceStamp | undefined } | { ok: false; reason: string } {
  if (!body || typeof body !== "object") return { ok: false, reason: "body is not an object" };
  const b = body as Record<string, unknown>;
  if (!isNonEmptyString(b.launch_id)) return { ok: false, reason: "launch_id is required" };
  if (!isNonEmptyString(b.reason)) return { ok: false, reason: "reason is required" };
  if (!isNonEmptyString(b.detail)) return { ok: false, reason: "detail is required" };
  if (!isNonEmptyString(b.source)) return { ok: false, reason: "source is required" };
  const enforced = b.enforced === true;
  return { ok: true, input: { launch_id: b.launch_id, reason: b.reason, detail: b.detail, source: b.source, enforced }, stamp: parseOccurrenceStamp(b) };
}

/**
 * The stamp used for a reporter that sent none. `reporter_run_id` says so
 * in plain text instead of inventing a plausible-looking id, so a row
 * whose order came from arrival time can always be told apart from one
 * whose order is the reporter's real emission order — the whole point of
 * separating the two clocks.
 */
function unstampedFallback(): OccurrenceStamp {
  return { occurred_at: nowIso(), occurred_seq: 0, reporter_run_id: "legacy-reporter-unstamped" };
}

async function handleReceiveJoint(store: JointStore, dataDir: string, req: HostHttpRequest, res: HostHttpResponse): Promise<void> {
  const bodyResult = await readRequestBody(req);
  if (!bodyResult.ok) return sendJson(res, 400, { ok: false, reason: bodyResult.reason });
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyResult.body);
  } catch (error) {
    return sendJson(res, 400, { ok: false, reason: `request body is not valid JSON: ${error instanceof Error ? error.message : String(error)}` });
  }
  const outcome = parseJointInput(parsed);
  if (!outcome.ok) return sendJson(res, 400, { ok: false, reason: outcome.reason });
  const row = store.recordJoint({ ...outcome.input, ...(outcome.stamp ?? unstampedFallback()) }, hostRandomId, nowIso);
  appendJsonlLine(joinPath(dataDir, "joints.jsonl"), row);
  sendJson(res, 200, { ok: true, event: row });
}

async function handleReceiveViolation(store: JointStore, dataDir: string, req: HostHttpRequest, res: HostHttpResponse): Promise<void> {
  const bodyResult = await readRequestBody(req);
  if (!bodyResult.ok) return sendJson(res, 400, { ok: false, reason: bodyResult.reason });
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyResult.body);
  } catch (error) {
    return sendJson(res, 400, { ok: false, reason: `request body is not valid JSON: ${error instanceof Error ? error.message : String(error)}` });
  }
  const outcome = parseViolationInput(parsed);
  if (!outcome.ok) return sendJson(res, 400, { ok: false, reason: outcome.reason });
  const row = store.recordViolation({ ...outcome.input, ...(outcome.stamp ?? unstampedFallback()) }, hostRandomId, nowIso);
  appendJsonlLine(joinPath(dataDir, "violations.jsonl"), row);
  sendJson(res, 200, { ok: true, event: row });
}

/** A tiny, dependency-free static viewer — plain HTML + inline JS consuming `GET /events`. Not a separate `ui/` folder (unlike `../../dna-os-circuit/ui/`) since this is a single-purpose ops readout, not a multi-view app; keeping it inline avoids a second capability-boundary decision for one file. */
function renderViewerHtml(): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>DNA OS — Joint Monitor</title>
<style>body{font:13px/1.4 ui-monospace,monospace;background:#0b0e14;color:#c9d1d9;margin:0;padding:16px}
h1{font-size:15px;color:#58a6ff}
.row{padding:6px 8px;border-bottom:1px solid #21262d;white-space:pre-wrap}
.joint{color:#7ee787}.violation{color:#ff7b72;font-weight:bold}
.lag{color:#8b949e}
#status{color:#8b949e;margin-bottom:8px}</style></head>
<body><h1>DNA OS — Joint Monitor</h1><div id="status">connecting...</div><div id="rows"></div>
<script>
const rows = document.getElementById("rows");
const status = document.getElementById("status");

// The viewer's whole state: event_id -> row. A Map, not an append-only
// DOM (real bug, found live 2026-08-26 on a real task): every snapshot
// used to be appended to whatever was already on screen, so each
// EventSource reconnect — which re-sends the full snapshot by design,
// see handleSse — redrew the same five events again, with identical
// event_id and identical timestamps. Keying by the collector's own
// unique event_id makes redelivery idempotent no matter how often the
// same row arrives.
const state = new Map();

// EVENT_OCCURRED_ORDER, mirroring joint-store.ts#compareByOccurrence.
// Duplicated deliberately: this file's viewer is inline, dependency-free
// JS served as a string (see this function's own header) and cannot
// import the TypeScript one. Both are proven against the same
// out-of-order arrival by tests/event-order-proof.test.ts — if one
// changes, that test fails on the other.
function compareByOccurrence(a, b) {
  if (a.occurred_at !== b.occurred_at) return a.occurred_at < b.occurred_at ? -1 : 1;
  if (a.reporter_run_id !== b.reporter_run_id) return a.reporter_run_id < b.reporter_run_id ? -1 : 1;
  if (a.occurred_seq !== b.occurred_seq) return a.occurred_seq - b.occurred_seq;
  if (a.received_at !== b.received_at) return a.received_at < b.received_at ? -1 : 1;
  return a.event_id < b.event_id ? -1 : a.event_id > b.event_id ? 1 : 0;
}

// Both clocks stay visible: the occurrence time orders the row, and the
// arrival lag beside it is the transport measurement that separating the
// two clocks exists to make possible.
function lagMs(row) {
  const lag = Date.parse(row.received_at) - Date.parse(row.occurred_at);
  return Number.isFinite(lag) ? lag : 0;
}
function text(entry) {
  const row = entry.row;
  const lag = \` (+\${lagMs(row)}ms to collector)\`;
  if (entry.kind === "violation") return \`[\${row.occurred_at}] VIOLATION launch=\${row.launch_id} enforced=\${row.enforced} \${row.reason}: \${row.detail}\${lag}\`;
  return \`[\${row.occurred_at}] JOINT \${row.from_capability} -> \${row.to_capability} (\${row.status}) \${row.summary}\${lag}\`;
}

// Full redraw from state, newest occurrence first. Cheap: the store is a
// bounded ring buffer (MAX_JOINTS_IN_MEMORY), so this is never unbounded
// work, and it removes any chance of the DOM and the state disagreeing.
function render() {
  const entries = [...state.values()].sort((a, b) => compareByOccurrence(a.row, b.row)).reverse();
  rows.replaceChildren(...entries.map((entry) => {
    const d = document.createElement("div");
    d.className = "row " + entry.kind;
    d.textContent = text(entry);
    return d;
  }));
}

function upsert(kind, row) { state.set(row.event_id, { kind: kind, row: row }); }

const es = new EventSource("/events");
es.onopen = () => { status.textContent = "live"; };
es.onerror = () => { status.textContent = "disconnected — retrying..."; };
es.onmessage = (msg) => {
  const payload = JSON.parse(msg.data);
  if (payload.type === "snapshot") {
    // Snapshot REPLACES state rather than adding to it (Owner,
    // 2026-08-26). The server sends one on every connect, so on a
    // reconnect this is the authoritative current state, not a delta.
    state.clear();
    for (const row of payload.snapshot.recent_joints) upsert("joint", row);
    for (const row of payload.snapshot.recent_violations) upsert("violation", row);
    render();
    status.textContent = state.size === 0 ? "live — no joints or violations recorded yet" : "live";
    return;
  }
  if (payload.type !== "change") return;
  const ev = payload.event;
  if (ev.kind === "joint" || ev.kind === "violation") { upsert(ev.kind, ev.row); render(); }
};
</script></body></html>`;
}

export function startJointMonitorServer(store: JointStore, port: number): ReturnType<typeof createHttpServer> {
  const dataDir = joinPath(repoRootDirname(), "observability/joint-monitor/data");

  const server = createHttpServer((req, res) => {
    try {
      const url = req.url ?? "/";
      if (req.method !== "GET" && req.method !== "HEAD" && req.method !== undefined && !requireSharedSecret(req, res)) {
        return;
      }
      if (url === "/events") return handleSse(store, req, res);
      if (url === "/joints" && req.method === "POST") {
        handleReceiveJoint(store, dataDir, req, res).catch((error) => safeSend(res, 500, "text/plain; charset=utf-8", `internal error: ${error instanceof Error ? error.message : String(error)}`));
        return;
      }
      if (url === "/violations" && req.method === "POST") {
        handleReceiveViolation(store, dataDir, req, res).catch((error) => safeSend(res, 500, "text/plain; charset=utf-8", `internal error: ${error instanceof Error ? error.message : String(error)}`));
        return;
      }
      if (url === "/joints" && (req.method === "GET" || req.method === undefined)) return sendJson(res, 200, { ok: true, joints: store.snapshot().recent_joints });
      if (url === "/violations" && (req.method === "GET" || req.method === undefined)) return sendJson(res, 200, { ok: true, violations: store.snapshot().recent_violations });
      if (url === "/" || url === "/index.html") return safeSend(res, 200, "text/html; charset=utf-8", renderViewerHtml());
      safeSend(res, 404, "text/plain; charset=utf-8", "not found");
    } catch (error) {
      // Structural guarantee: no request handler exception may ever escape uncaught.
      safeSend(res, 500, "text/plain; charset=utf-8", `internal error: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  const host = process.env.HOST ?? "127.0.0.1";
  const bindPolicy = evaluateBindPolicy(host, process.env.JOINT_MONITOR_SHARED_SECRET);
  if (!bindPolicy.allowed) {
    throw new Error(`joint-monitor refusing to start: ${bindPolicy.reason}`);
  }
  server.listen(port, host);
  return server;
}
