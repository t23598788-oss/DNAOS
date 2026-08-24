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
import type { ReportJointInput, ReportViolationInput } from "./types";

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
function parseJointInput(body: unknown): { ok: true; input: ReportJointInput } | { ok: false; reason: string } {
  if (!body || typeof body !== "object") return { ok: false, reason: "body is not an object" };
  const b = body as Record<string, unknown>;
  if (!isNonEmptyString(b.from_capability)) return { ok: false, reason: "from_capability is required" };
  if (!isNonEmptyString(b.to_capability)) return { ok: false, reason: "to_capability is required" };
  if (!isNonEmptyString(b.status)) return { ok: false, reason: "status is required" };
  if (!isNonEmptyString(b.summary)) return { ok: false, reason: "summary is required" };
  if (!isNonEmptyString(b.source)) return { ok: false, reason: "source is required" };
  const task_id = typeof b.task_id === "string" ? b.task_id : null;
  return { ok: true, input: { from_capability: b.from_capability, to_capability: b.to_capability, task_id, status: b.status, summary: b.summary, source: b.source } };
}

function parseViolationInput(body: unknown): { ok: true; input: ReportViolationInput } | { ok: false; reason: string } {
  if (!body || typeof body !== "object") return { ok: false, reason: "body is not an object" };
  const b = body as Record<string, unknown>;
  if (!isNonEmptyString(b.launch_id)) return { ok: false, reason: "launch_id is required" };
  if (!isNonEmptyString(b.reason)) return { ok: false, reason: "reason is required" };
  if (!isNonEmptyString(b.detail)) return { ok: false, reason: "detail is required" };
  if (!isNonEmptyString(b.source)) return { ok: false, reason: "source is required" };
  const enforced = b.enforced === true;
  return { ok: true, input: { launch_id: b.launch_id, reason: b.reason, detail: b.detail, source: b.source, enforced } };
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
  const row = store.recordJoint(outcome.input, hostRandomId, nowIso);
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
  const row = store.recordViolation(outcome.input, hostRandomId, nowIso);
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
#status{color:#8b949e;margin-bottom:8px}</style></head>
<body><h1>DNA OS — Joint Monitor (:5178)</h1><div id="status">connecting...</div><div id="rows"></div>
<script>
const rows = document.getElementById("rows");
const status = document.getElementById("status");
function line(cls, text) { const d = document.createElement("div"); d.className = "row " + cls; d.textContent = text; rows.prepend(d); }
const es = new EventSource("/events");
es.onopen = () => { status.textContent = "live"; };
es.onerror = () => { status.textContent = "disconnected — retrying..."; };
es.onmessage = (msg) => {
  const payload = JSON.parse(msg.data);
  if (payload.type !== "change") return;
  const ev = payload.event;
  if (ev.kind === "joint") line("joint", \`[\${ev.row.at}] JOINT \${ev.row.from_capability} -> \${ev.row.to_capability} (\${ev.row.status}) \${ev.row.summary}\`);
  if (ev.kind === "violation") line("violation", \`[\${ev.row.at}] VIOLATION launch=\${ev.row.launch_id} enforced=\${ev.row.enforced} \${ev.row.reason}: \${ev.row.detail}\`);
};
</script></body></html>`;
}

export function startJointMonitorServer(store: JointStore, port: number): ReturnType<typeof createHttpServer> {
  const dataDir = joinPath(repoRootDirname(), "observability/joint-monitor/data");

  const server = createHttpServer((req, res) => {
    try {
      const url = req.url ?? "/";
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

  server.listen(port);
  return server;
}
