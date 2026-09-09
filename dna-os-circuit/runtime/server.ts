/**
 * หน้าที่: a minimal Node `http` server (no framework, Node built-ins
 * only) that (1) serves the static circuit-board UI + circuit.json, and
 * (2) exposes `GET /events`, an SSE endpoint streaming `CircuitState`
 * snapshots/diffs as they happen. This is the transport layer between
 * ./circuit-state.ts (pure state) and ../ui/circuit-board (rendering) —
 * it holds no state of its own beyond the `CircuitState` instance it's
 * constructed with.
 *
 * Input: a `CircuitState` instance (constructed by the caller, e.g.
 * ../adapter/internal-state-adapter.ts's initializeCircuitFromRepo()
 * result).
 * Output: an HTTP server exposing `GET /`, `GET /circuit-board.html`,
 * `GET /circuit.json`, `GET /events` (SSE), `POST /findings` +
 * `GET /findings` (the real 4173 → 8790 receiver, see
 * ./finding-receiver.ts), `POST /evaluate` + `GET /findings/evaluation-evidence`
 * (DETECTED -> EVALUATED, ./finding-evaluator.ts), and — added
 * 2026-08-18 — `POST /decide` + `GET /findings/decision-evidence`
 * (EVALUATED -> ROUTABLE/BLOCKED/RESOLVED, ./finding-decider.ts). None of
 * these write-capable routes route/dispatch anything (no WorkRequest, no
 * Gateway) — they only validate, classify, decide, and store. Also serves
 * — added 2026-08-19 — `GET /evidence-trace` (+ `/evidence-trace.html`,
 * `/evidence-trace/trace-viewer.js`), the read-only Evidence Trace Viewer
 * (../ui/evidence-trace/) that renders the real DETECTED -> EVALUATED ->
 * DECISION -> status chain straight from the three GET endpoints above;
 * it adds no new server-side logic of its own beyond static file serving.
 * Also serves — added 2026-08-19, Phase 2 — `GET /semantic-model.json`
 * (`handleSemanticModel`), which calls ../definition/semantic-model.ts's
 * real, already-tested `buildSemanticComponents()`/`buildSemanticConnections()`
 * and attaches each element's real `lod_tier` (via `lodTierOf`); this
 * handler adds zero new facts, only serialization + one mechanical
 * per-connection tier derivation (deepest of its two real endpoints).
 * Dependency ที่อนุญาต: ./circuit-state.ts, ./host-runtime.ts,
 * ./finding-receiver.ts, ./finding-evaluator.ts, ./finding-decider.ts,
 * ../definition/circuit.json, ../definition/semantic-model.ts.
 * สิ่งที่ห้ามแตะ: never add express/ws/socket.io or any other npm
 * dependency — plain `http`/`fs`/`path` only, matching the hard
 * "no new frameworks" constraint. Never let one client's dropped
 * connection or one bad event throw uncaught and kill the process — every
 * write to a response stream must be wrapped so one broken SSE client
 * can't take down every other connected client or the adapter driving
 * real state changes.
 */

import type { CircuitState, ChangeEvent } from "./circuit-state";
import { createHttpServer, extname, fileExists, joinPath, readFileUtf8, readRequestBody, repoRootDirname, type HostHttpRequest, type HostHttpResponse } from "./host-runtime";
import { recordFinding, listPersistedFindings } from "./finding-receiver";
import { readPathCircuitGraph, verifyReadPaths } from "../../control/system-read-paths/contract";
import { changeFlowCircuitGraph, observationStatus } from "../../control/realtime-change/contract";
import { buildSystemGraph } from "./derived-graph";
import { observationCircuitGraph, listProcesses, observeProcesses, relationshipsFor, runtimeConsumerEvidenceFor, observationStoreStatus, readObservations, observationsForResource } from "../../control/machine-observation/contract";
import { evaluateAllDetected, listEvaluationEvidence } from "./finding-evaluator";
import { decideAllEvaluated, listDecisionEvidence } from "./finding-decider";
import { buildSemanticComponents, buildSemanticConnections, lodTierOf } from "../definition/semantic-model";
import type { SemanticLodTier } from "../definition/semantic-model";
import { submitTask, getTask, getResult, explain, ownerDecision, listCapabilities, DEFAULT_AGENT_WORKERS, loadAllHandoffs, loadHandoffsForTask } from "../../control/agent-gateway/contract";
import { readTelemetry } from "../../connections/telemetry/summary";
import { startTelemetryCollector } from "../../connections/telemetry/collector-loop";
import { listRegisteredAgents } from "../../connections/agent-registry/registry";
import { verifySharedSecret, evaluateBindPolicy } from "../../permissions/network-auth-gate/contract";
import { applyOwnerReviewDecision, ownerReviewSurfaceSnapshot } from "../../control/canonical-view/contract";
import { invokeSiteTool, listSiteTools } from "../../control/ai-client-bridge/contract";
import { ownerWorkSurfaceSnapshot, openOwnerWorkItem, ownerSearch, requestOwnerWorkAction } from "../../control/owner-work-surface/contract";

// Owner Work Order 2026-08-20 (DATA INTEGRATION BUILD): one periodic
// collector per server process, same recovery-only-heartbeat shape as
// control/agent-gateway/supervisor.ts — this line is the only place the
// telemetry collector loop is started.
startTelemetryCollector();

// 2026-08-20 fix: this used to declare its own local [fileIntelligenceAdapter,
// externalProviderAdapter] array, independently of control/command-router/router.ts's
// own copy — the two had drifted out of sync (this one was missing aiWriteAdapter),
// exactly the "two dispatch entry points, two worker lists" failure the Owner's Work
// Order named. Both now import the same control/agent-gateway/workers.ts constant.
const GATEWAY_ADAPTERS = DEFAULT_AGENT_WORKERS;

async function handleGatewayRequest(req: HostHttpRequest, res: HostHttpResponse, url: string): Promise<void> {
  try {
    if (url === "/gateway/dna_status" && req.method === "GET") {
      safeSend(res, 200, "application/json; charset=utf-8", JSON.stringify({ ok: true, capabilities: listCapabilities().length, adapters: GATEWAY_ADAPTERS.map((a) => a.describe()) }));
      return;
    }
    const bodyResult = req.method === "POST" ? await readRequestBody(req) : { ok: true as const, body: "{}" };
    if (!bodyResult.ok) {
      safeSend(res, 400, "application/json; charset=utf-8", JSON.stringify({ error: bodyResult.reason }));
      return;
    }
    const body = bodyResult.body ? JSON.parse(bodyResult.body) : {};

    if (url === "/gateway/dna_submit_task" && req.method === "POST") {
      const task = await submitTask(body.intent_text, { user_id: body.user_id, workspace_id: body.workspace_id, conversation_id: body.conversation_id, parent_task_id: body.parent_task_id ?? null }, body.client_id ?? "unknown-client", GATEWAY_ADAPTERS);
      safeSend(res, 200, "application/json; charset=utf-8", JSON.stringify(task));
      return;
    }
    if (url === "/gateway/dna_task_status" && (req.method === "GET" || req.method === "POST")) {
      const taskId = body.task_id;
      const task = getTask(taskId);
      safeSend(res, task ? 200 : 404, "application/json; charset=utf-8", JSON.stringify(task ?? { error: "not found" }));
      return;
    }
    if (url === "/gateway/dna_get_result" && (req.method === "GET" || req.method === "POST")) {
      const result = getResult(body.task_id);
      safeSend(res, result ? 200 : 404, "application/json; charset=utf-8", JSON.stringify(result ?? { error: "not found" }));
      return;
    }
    if (url === "/gateway/dna_explain" && (req.method === "GET" || req.method === "POST")) {
      const explanation = explain(body.task_id);
      safeSend(res, explanation ? 200 : 404, "application/json; charset=utf-8", JSON.stringify(explanation ?? { error: "not found" }));
      return;
    }
    if (url === "/gateway/dna_owner_decision" && req.method === "POST") {
      const task = await ownerDecision(body.task_id, body.decision, GATEWAY_ADAPTERS);
      safeSend(res, task ? 200 : 404, "application/json; charset=utf-8", JSON.stringify(task ?? { error: "not found" }));
      return;
    }
    if (url === "/gateway/dna_handoffs" && (req.method === "GET" || req.method === "POST")) {
      const taskId = body.task_id;
      const handoffs = taskId ? loadHandoffsForTask(taskId) : loadAllHandoffs();
      safeSend(res, 200, "application/json; charset=utf-8", JSON.stringify({ handoffs }));
      return;
    }
    if (url === "/gateway/dna_telemetry" && req.method === "GET") {
      safeSend(res, 200, "application/json; charset=utf-8", JSON.stringify(readTelemetry()));
      return;
    }
    if (url === "/gateway/dna_agents" && req.method === "GET") {
      safeSend(res, 200, "application/json; charset=utf-8", JSON.stringify({ agents: listRegisteredAgents() }));
      return;
    }
    safeSend(res, 404, "application/json; charset=utf-8", JSON.stringify({ error: "unknown gateway route" }));
  } catch (error) {
    safeSend(res, 500, "application/json; charset=utf-8", JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
  }
}

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

/**
 * Phase 20 — the one Owner-facing entry: runs
 * `reports/phase16-world-evidence/problem_resolver.mjs` (a real, already-
 * tested standalone script — see that file's own header) against the raw
 * problem text from the request body and returns its real JSON result.
 * This handler makes NO decision itself — it only shells out and relays.
 */
declare const require: (id: string) => unknown;

/**
 * 2026-08-24 (Owner, "Single Process Creation Gate — Consolidation"):
 * this used to `spawn("node", [scriptPath, problemText], ...)` directly
 * — a bare executable name (PATH-resolved, never an authority decision)
 * and a raw, unmediated process-creation path. It now routes through
 * `execution/run/contract.ts#requestProcessExecution` (the Process
 * Gate), `executable_id: "dna-os-circuit.resolve"`, resolved to the real
 * absolute `/usr/local/bin/node` registered in
 * `execution/run/process-registry.ts`, executed via
 * `control/agent-host/`'s real sandbox-exec (reused, no second
 * executor). No raw `child_process.spawn` remains in this file.
 */
async function runResolver(root: string, problemText: string, timeoutMs: number): Promise<{ ok: true; out: string } | { ok: false; error: string }> {
  const { requestProcessExecution } = await import("../../execution/run/contract");
  const nodeCrypto = require("node:crypto") as { randomUUID(): string };
  const scriptPath = joinPath(root, "reports/phase16-world-evidence/problem_resolver.mjs");
  const result = await requestProcessExecution({
    request_id: `pg-req-${nodeCrypto.randomUUID()}`,
    parent_work_order_id: null,
    requester_identity: "dna-os-circuit/runtime/server.ts",
    executable_id: "dna-os-circuit.resolve",
    argv: [scriptPath, problemText],
    cwd: root,
    timeout_ms: timeoutMs,
  });
  if (result.status !== "EXECUTED") return { ok: false, error: `${result.status}: ${result.reason ?? "denied by Process Gate"}` };
  if (result.exit_code === 0) return { ok: true, out: result.stdout };
  return { ok: false, error: `resolver exited with code ${result.exit_code}: ${result.stderr.slice(0, 500)}` };
}
async function handleResolveProblem(req: HostHttpRequest, res: HostHttpResponse, root: string): Promise<void> {
  const bodyResult = await readRequestBody(req);
  if (!bodyResult.ok) {
    safeSend(res, 400, "application/json; charset=utf-8", JSON.stringify({ error: bodyResult.reason }));
    return;
  }
  let problemText: string;
  try {
    problemText = (JSON.parse(bodyResult.body) as { problem_text?: string }).problem_text ?? "";
  } catch {
    safeSend(res, 400, "application/json; charset=utf-8", JSON.stringify({ error: "body must be JSON { problem_text: string }" }));
    return;
  }
  if (!problemText.trim()) {
    safeSend(res, 400, "application/json; charset=utf-8", JSON.stringify({ error: "problem_text is empty" }));
    return;
  }
  const result = await runResolver(root, problemText, 15_000);
  if (result.ok) {
    safeSend(res, 200, "application/json; charset=utf-8", result.out);
  } else {
    safeSend(res, 500, "application/json; charset=utf-8", JSON.stringify({ error: result.error }));
  }
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

function serveStaticFile(root: string, relativePath: string, res: HostHttpResponse): void {
  const filePath = joinPath(root, "dna-os-circuit", relativePath);
  if (!fileExists(filePath)) {
    safeSend(res, 404, "text/plain; charset=utf-8", "not found");
    return;
  }
  const ext = extname(filePath);
  const contentType = CONTENT_TYPES[ext] ?? "application/octet-stream";
  try {
    const body = readFileUtf8(filePath);
    safeSend(res, 200, contentType, body);
  } catch (error) {
    safeSend(res, 500, "text/plain; charset=utf-8", `failed to read file: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Phase 17: serves the real, deterministically-generated Phase 16/17
 * evidence graph (`reports/phase16-world-evidence/evidence_graph.json`)
 * read-only. Additive only — mirrors `serveStaticFile`'s exact pattern
 * but roots at the repo's `reports/` folder instead of `dna-os-circuit/`,
 * since this file lives outside this capability folder by design (it is
 * Owner-facing research output, not Circuit source). Never writes,
 * never regenerates the file — regeneration is `reports/phase16-world-evidence/adapter.mjs`'s
 * job, run by hand, same discipline as `internal-state-adapter.ts` never
 * auto-scanning.
 */
function serveReportsFile(root: string, relativePath: string, res: HostHttpResponse): void {
  const filePath = joinPath(root, "reports", relativePath);
  if (!fileExists(filePath)) {
    safeSend(res, 404, "application/json; charset=utf-8", JSON.stringify({ error: "not found — run node reports/phase16-world-evidence/adapter.mjs first" }));
    return;
  }
  try {
    const body = readFileUtf8(filePath);
    safeSend(res, 200, "application/json; charset=utf-8", body);
  } catch (error) {
    safeSend(res, 500, "text/plain; charset=utf-8", `failed to read file: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * SSE handler — sends an initial full snapshot immediately on connect,
 * then one `data:` event per subsequent CircuitState "change". Every
 * write is try/caught so an exception mid-stream (a disconnected socket,
 * a serialization error) never propagates out of the change listener and
 * silently kills rendering for every other connected client — this is
 * the exact silent-failure mode the task explicitly warned about.
 */
function handleSse(state: CircuitState, req: HostHttpRequest, res: HostHttpResponse): void {
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

  send({ type: "snapshot", snapshot: state.snapshot() });

  const onChange = (event: ChangeEvent): void => {
    try {
      send({ type: "change", event, snapshot: state.snapshot() });
    } catch {
      // never let a listener throw escape into the emitter loop.
    }
  };
  state.on("change", onChange);

  req.on("close", () => {
    state.off("change", onChange);
  });
}

function sendJson(res: HostHttpResponse, status: number, body: unknown): void {
  safeSend(res, status, "application/json; charset=utf-8", JSON.stringify(body));
}

/**
 * Network auth gate (2026-08-24, migration hardening — verified live, this
 * server had none). Every write-capable route here — most sharply
 * /gateway/dna_submit_task and /gateway/dna_owner_decision, which reach
 * real agent-gateway dispatch, and /resolve-problem, which reaches a real
 * Process Gate execution — was written assuming loopback-only reachability.
 * Real decision logic lives in `permissions/network-auth-gate/` (shared
 * with transport/owner-command-http, to avoid two independently-drifting
 * copies of a security check) — this is just the thin transport-specific
 * glue around it.
 */
async function handleCanonicalViewDecision(req: HostHttpRequest, res: HostHttpResponse): Promise<void> {
  const bodyResult = await readRequestBody(req);
  if (!bodyResult.ok) {
    sendJson(res, 400, { error: bodyResult.reason });
    return;
  }
  let parsed: { review_id?: string; decision?: string; ai_client_id?: string; session_id?: string };
  try {
    parsed = JSON.parse(bodyResult.body) as typeof parsed;
  } catch {
    sendJson(res, 400, { error: "body must be JSON" });
    return;
  }
  const review = await applyOwnerReviewDecision({
    review_id: String(parsed.review_id ?? ""),
    decision: String(parsed.decision ?? "") as never,
    ai_client_id: String(parsed.ai_client_id ?? "ai://circuit-ui"),
    session_id: String(parsed.session_id ?? "session-circuit-ui"),
  });
  sendJson(res, "ok" in review && review.ok === false ? 403 : 200, { ok: !("ok" in review && review.ok === false), review });
}

async function handleOwnerWorkSearch(req: HostHttpRequest, res: HostHttpResponse): Promise<void> {
  const bodyResult = await readRequestBody(req);
  if (!bodyResult.ok) {
    sendJson(res, 400, { error: bodyResult.reason });
    return;
  }
  let parsed: { query?: string; ai_client_id?: string; session_id?: string; work_id?: string };
  try {
    parsed = JSON.parse(bodyResult.body) as typeof parsed;
  } catch {
    sendJson(res, 400, { error: "body must be JSON" });
    return;
  }
  const searched = await ownerSearch({
    query: String(parsed.query ?? ""),
    ai_client_id: String(parsed.ai_client_id ?? "ai://circuit-ui"),
    session_id: String(parsed.session_id ?? "session-circuit-ui"),
    work_id: String(parsed.work_id ?? "work-circuit-ui"),
  });
  sendJson(res, 200, { ok: true, search: searched });
}

async function handleOwnerWorkOpen(req: HostHttpRequest, res: HostHttpResponse): Promise<void> {
  const bodyResult = await readRequestBody(req);
  if (!bodyResult.ok) {
    sendJson(res, 400, { error: bodyResult.reason });
    return;
  }
  let parsed: { app_id?: string; ai_client_id?: string; session_id?: string; work_id?: string; logical_path?: string };
  try {
    parsed = JSON.parse(bodyResult.body) as typeof parsed;
  } catch {
    sendJson(res, 400, { error: "body must be JSON" });
    return;
  }
  const opened = await openOwnerWorkItem({
    app_id: String(parsed.app_id ?? ""),
    ai_client_id: String(parsed.ai_client_id ?? "ai://circuit-ui"),
    session_id: String(parsed.session_id ?? "session-circuit-ui"),
    work_id: String(parsed.work_id ?? "work-circuit-ui"),
    logical_path: typeof parsed.logical_path === "string" ? parsed.logical_path : undefined,
  });
  sendJson(res, opened.ok === false ? 403 : 200, opened);
}

async function handleOwnerWorkAction(req: HostHttpRequest, res: HostHttpResponse): Promise<void> {
  const bodyResult = await readRequestBody(req);
  if (!bodyResult.ok) {
    sendJson(res, 400, { error: bodyResult.reason });
    return;
  }
  let parsed: { review_id?: string; action?: string; resource_id?: string; work_id?: string; payload?: Record<string, unknown> };
  try {
    parsed = JSON.parse(bodyResult.body) as typeof parsed;
  } catch {
    sendJson(res, 400, { error: "body must be JSON" });
    return;
  }
  const requested = await requestOwnerWorkAction({
    review_id: String(parsed.review_id ?? ""),
    action: String(parsed.action ?? ""),
    resource_id: String(parsed.resource_id ?? ""),
    work_id: String(parsed.work_id ?? "work-circuit-ui"),
    payload: parsed.payload,
  });
  sendJson(res, requested.ok === false ? 403 : 200, requested);
}

async function handleSiteToolInvoke(req: HostHttpRequest, res: HostHttpResponse): Promise<void> {
  const bodyResult = await readRequestBody(req);
  if (!bodyResult.ok) {
    sendJson(res, 400, { error: bodyResult.reason });
    return;
  }
  let parsed: { tool_name?: string; arguments?: Record<string, unknown>; ai_client_id?: string; session_id?: string; work_id?: string };
  try {
    parsed = JSON.parse(bodyResult.body) as typeof parsed;
  } catch {
    sendJson(res, 400, { error: "body must be JSON" });
    return;
  }
  const invoked = await invokeSiteTool({
    tool_name: String(parsed.tool_name ?? ""),
    arguments: parsed.arguments ?? {},
    ai_client_id: String(parsed.ai_client_id ?? "ai://circuit-ui"),
    session_id: String(parsed.session_id ?? "session-circuit-ui"),
    work_id: parsed.work_id,
  });
  sendJson(res, invoked.ok ? 200 : 403, invoked);
}

function requireSharedSecret(req: HostHttpRequest, res: HostHttpResponse): boolean {
  const expected = process.env.DNA_OS_CIRCUIT_SHARED_SECRET;
  if (!expected) return true;
  const header = req.headers.authorization;
  if (verifySharedSecret(typeof header === "string" ? header : undefined, expected)) return true;
  sendJson(res, 401, { error: "unauthorized" });
  return false;
}

/** Real tier ordering — index = "how deep you must zoom before this becomes prominent". Never touched by ./semantic-model.ts itself (that file only classifies one component at a time); this ordering is a pure presentation-layer fact used only to pick a connection's DEEPEST endpoint tier below. */
const LOD_TIER_ORDER: readonly SemanticLodTier[] = ["DOMAIN_SYSTEM", "CAPABILITY", "COMPONENT_PROCESS", "FUNCTION_PORT_CONNECTION_API_STORAGE", "CONTRACT_RUNTIME_EVIDENCE_SOURCE"];

/**
 * Phase 2 (Owner, 2026-08-19): serves ../definition/semantic-model.ts's
 * already-real, already-tested `buildSemanticComponents()`/
 * `buildSemanticConnections()` as JSON so the browser-side viewer
 * (../ui/circuit-board/circuit-board.js) can consume real semantic data —
 * this handler adds ZERO new facts, it only (a) calls the two real
 * exported functions and (b) computes each connection's `lod_tier` as the
 * DEEPER of its two real endpoint components' tiers (a pure, mechanical
 * derivation, never a new source of truth).
 */
function handleSemanticModel(res: HostHttpResponse): void {
  const components = buildSemanticComponents();
  const connections = buildSemanticConnections();
  const tierByComponentId = new Map(components.map((c) => [c.component_id, lodTierOf(c)]));
  const componentsWithTier = components.map((c) => ({ ...c, lod_tier: lodTierOf(c) }));
  const connectionsWithTier = connections.map((conn) => {
    const sourceTier = tierByComponentId.get(conn.source_component_id);
    const targetTier = tierByComponentId.get(conn.target_component_id);
    const deepestIndex = Math.max(sourceTier ? LOD_TIER_ORDER.indexOf(sourceTier) : 0, targetTier ? LOD_TIER_ORDER.indexOf(targetTier) : 0);
    return { ...conn, lod_tier: LOD_TIER_ORDER[deepestIndex] };
  });
  sendJson(res, 200, { ok: true, components: componentsWithTier, connections: connectionsWithTier, lod_tier_order: LOD_TIER_ORDER });
}

/**
 * The one write-capable route on this server. Reads the real request
 * body, hands it to ./finding-receiver.ts's recordFinding (which
 * validates loosely and never trusts capability_id/severity from the
 * sender), and echoes back exactly what was actually stored — real
 * finding_id/scan_id/received_at, never a guessed/optimistic response.
 * Explicitly does NOT create a WorkRequest, route anywhere, or invoke
 * any gateway — this round's hard scope limit.
 */
async function handleReceiveFinding(req: HostHttpRequest, res: HostHttpResponse): Promise<void> {
  const bodyResult = await readRequestBody(req);
  if (!bodyResult.ok) {
    sendJson(res, 400, { ok: false, reason: bodyResult.reason });
    return;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyResult.body);
  } catch (error) {
    sendJson(res, 400, { ok: false, reason: `request body is not valid JSON: ${error instanceof Error ? error.message : String(error)}` });
    return;
  }
  const outcome = recordFinding(parsed);
  if (!outcome.ok) {
    sendJson(res, 400, { ok: false, reason: outcome.reason });
    return;
  }
  sendJson(res, 200, {
    ok: true,
    finding_id: outcome.received.finding.finding_id,
    scan_id: outcome.received.finding.scan_id,
    status: outcome.received.finding.status,
    received_at: outcome.received.received_at,
    receiver_evidence_id: outcome.received.receiver_evidence_id,
  });
}

/** Real evidence of every finding this Circuit instance has ever received (durable across restarts — see finding-receiver.ts's listPersistedFindings) — this is what lets Circuit "show RECEIVED/DETECTED state" without creating any WorkRequest. */
function handleListFindings(res: HostHttpResponse): void {
  sendJson(res, 200, { ok: true, findings: listPersistedFindings() });
}

/**
 * The real "Evaluation Engine" trigger — runs ./finding-evaluator.ts's
 * deterministic classifier over every currently-DETECTED finding in the
 * authoritative store, moving each to EVALUATED with a real,
 * evidence-traceable rule. Still does NOT create a WorkRequest, route
 * anywhere, or invoke a Gateway — same hard scope limit as
 * handleReceiveFinding.
 */
function handleEvaluate(res: HostHttpResponse): void {
  const outcomes = evaluateAllDetected();
  sendJson(res, 200, { ok: true, evaluated_count: outcomes.filter((o) => o.ok).length, outcomes });
}

/** The full durable evaluation-evidence trail — lets any finding's EVALUATED verdict be traced back to the exact real rule + matched field that produced it, independent of the finding's own current record. */
function handleListEvaluationEvidence(res: HostHttpResponse): void {
  sendJson(res, 200, { ok: true, evaluation_evidence: listEvaluationEvidence() });
}

/**
 * The real "Decision Engine" trigger — runs ./finding-decider.ts's
 * deterministic decision rules over every currently-EVALUATED finding,
 * moving each to ROUTABLE/BLOCKED/RESOLVED with a real, evidence-
 * traceable decision linked back to its own evaluation. Still does NOT
 * create a WorkRequest, route anywhere, or invoke a Gateway.
 */
function handleDecide(res: HostHttpResponse): void {
  const outcomes = decideAllEvaluated();
  sendJson(res, 200, { ok: true, decided_count: outcomes.filter((o) => o.ok).length, outcomes });
}

/** The full durable decision-evidence trail — every decision traces back to its own rule, matched field, AND the exact evaluation-evidence entry it was based on (Owner's explicit requirement). */
function handleListDecisionEvidence(res: HostHttpResponse): void {
  sendJson(res, 200, { ok: true, decision_evidence: listDecisionEvidence() });
}

export function startCircuitServer(state: CircuitState, port: number): ReturnType<typeof createHttpServer> {
  const root = repoRootDirname();

  const server = createHttpServer((req, res) => {
    try {
      const url = req.url ?? "/";
      if (req.method !== "GET" && req.method !== "HEAD" && req.method !== undefined && !requireSharedSecret(req, res)) {
        return;
      }
      if (url === "/events") {
        handleSse(state, req, res);
        return;
      }
      if (url === "/findings" && req.method === "POST") {
        handleReceiveFinding(req, res).catch((error) => {
          // Structural guarantee, same as the outer catch below — an async route's
          // rejection must never escape uncaught.
          safeSend(res, 500, "text/plain; charset=utf-8", `internal error: ${error instanceof Error ? error.message : String(error)}`);
        });
        return;
      }
      if (url === "/findings" && (req.method === "GET" || req.method === undefined)) {
        handleListFindings(res);
        return;
      }
      if (url === "/evaluate" && req.method === "POST") {
        handleEvaluate(res);
        return;
      }
      if (url === "/findings/evaluation-evidence" && (req.method === "GET" || req.method === undefined)) {
        handleListEvaluationEvidence(res);
        return;
      }
      if (url === "/decide" && req.method === "POST") {
        handleDecide(res);
        return;
      }
      if (url === "/findings/decision-evidence" && (req.method === "GET" || req.method === undefined)) {
        handleListDecisionEvidence(res);
        return;
      }
      // The declared read paths, as TWO directed edges each — REQUEST and
      // RESPONSE are separate relationships with separate schemas, never one
      // bidirectional arrow (Owner, 2026-08-26). Generated from
      // control/system-read-paths/'s declarations only: no node or edge here is
      // guessed, and each carries its provider contract as evidence.
      if (url === "/read-paths.json" && (req.method === "GET" || req.method === undefined)) {
        sendJson(res, 200, { ok: true, ...readPathCircuitGraph(), verification: verifyReadPaths() });
        return;
      }
      // The realtime change path, as five DIRECTED edges — observation,
      // request, response, interrupt+context, ack. `observation` reports the
      // observer's real status, so the UI can show OBSERVATION_UNAVAILABLE
      // rather than an empty graph that looks like "nothing changed".
      if (url === "/change-flow.json" && (req.method === "GET" || req.method === undefined)) {
        sendJson(res, 200, { ok: true, ...changeFlowCircuitGraph(), observation: observationStatus() });
        return;
      }
      // Machine observation, rendered from real OS evidence only. `pids` is
      // required: this endpoint observes what a caller names, never the whole
      // machine, and every edge it returns carries the lsof/ps field it came
      // from. Nodes that could not be proven come back as `unresolved:` rather
      // than being drawn as facts.
      if (url?.startsWith("/observation.json") && (req.method === "GET" || req.method === undefined)) {
        const requested = new URL(url, "http://localhost").searchParams.get("pids");
        const pids = (requested ?? "").split(",").map((value) => Number(value.trim())).filter((value) => Number.isFinite(value) && value > 0);
        if (pids.length === 0) {
          sendJson(res, 400, { ok: false, reason: "pids query parameter is required — this endpoint never sweeps the whole machine", observable_process_count: listProcesses().length });
          return;
        }
        const observed = observeProcesses(pids);
        const graph = observationCircuitGraph({ relationships: observed.flatMap(relationshipsFor), correlations: [], meanings: [] });
        sendJson(res, 200, { ok: true, ...graph, processes: observed.map((observation) => ({ pid: observation.pid, executable: observation.executable, cwd: observation.cwd, unknown: observation.unknown })) });
        return;
      }
      if (url === "/observation/runtime-consumer" && (req.method === "GET" || req.method === undefined)) {
        sendJson(res, 400, { ok: false, reason: "use /observation/runtime-consumer?path=<repo-relative path>" });
        return;
      }
      if (url?.startsWith("/observation/runtime-consumer?") && (req.method === "GET" || req.method === undefined)) {
        const wanted = new URL(url, "http://localhost").searchParams.get("path");
        if (!wanted) { sendJson(res, 400, { ok: false, reason: "path query parameter is required" }); return; }
        sendJson(res, 200, { ok: true, ...runtimeConsumerEvidenceFor(wanted) });
        return;
      }
      // The observation store's own state, and the resource identities it has
      // bound. Counts and real records only — no inferred edge, no node that
      // is not backed by an appended observation.
      if (url?.startsWith("/observation-store.json") && (req.method === "GET" || req.method === undefined)) {
        const wanted = new URL(url, "http://localhost").searchParams.get("resource_id");
        const records = wanted ? observationsForResource(wanted) : readObservations().slice(-25);
        sendJson(res, 200, {
          ok: true,
          store: observationStoreStatus(),
          filter: wanted ? { resource_id: wanted } : { newest: 25 },
          records: records.map((record) => ({
            event_id: record.event_id,
            record_type: record.record_type,
            resource_id: record.resource_id,
            path: record.path,
            observed_at: record.observed_at,
            meaning_types: record.meaning_records.map((meaning) => meaning.meaning_type),
            process_evidence: record.process_evidence.slice(0, 3),
            derived_by: record.derived_by,
          })),
        });
        return;
      }
      // The graph DERIVED from the running system. Every node and edge here
      // came out of a source list — read paths, the census snapshot, the
      // observation store, the watch scopes, the service registry — so a
      // capability, read path or service added later appears with no edit to
      // this file and none to the UI.
      // Path compared without the query string: the page takes `?live=0`, and
      // an exact-match route silently 404'd it.
      if ((url === "/system-graph" || url === "/system-graph/" || url.startsWith("/system-graph?")) && (req.method === "GET" || req.method === undefined)) {
        serveStaticFile(root, "ui/system-graph/index.html", res);
        return;
      }
      if (url === "/system-graph.json" && (req.method === "GET" || req.method === undefined)) {
        sendJson(res, 200, { ok: true, ...buildSystemGraph() });
        return;
      }
      if (url === "/circuit.json") {
        serveStaticFile(root, "definition/circuit.json", res);
        return;
      }
      if (url === "/circuit-sbgn.json") {
        serveStaticFile(root, "definition/circuit-sbgn.json", res);
        return;
      }
      if (url === "/semantic-model.json") {
        handleSemanticModel(res);
        return;
      }
      if (url === "/" || url === "/circuit-board.html" || url === "/index.html") {
        serveStaticFile(root, "ui/circuit-board/index.html", res);
        return;
      }
      if (url === "/circuit-board.js") {
        serveStaticFile(root, "ui/circuit-board/circuit-board.js", res);
        return;
      }
      if (url === "/evidence-trace" || url === "/evidence-trace.html" || url === "/evidence-trace/") {
        serveStaticFile(root, "ui/evidence-trace/index.html", res);
        return;
      }
      if (url === "/evidence-trace/trace-viewer.js") {
        serveStaticFile(root, "ui/evidence-trace/trace-viewer.js", res);
        return;
      }
      if (url === "/world-evidence" && (req.method === "GET" || req.method === undefined)) {
        serveReportsFile(root, "phase16-world-evidence/evidence_graph.json", res);
        return;
      }
      if (url === "/world-evidence/pipeline" && (req.method === "GET" || req.method === undefined)) {
        serveReportsFile(root, "phase16-world-evidence/pipeline_results.json", res);
        return;
      }
      if (url === "/world-evidence/services" && (req.method === "GET" || req.method === undefined)) {
        serveReportsFile(root, "phase16-world-evidence/service_candidates.json", res);
        return;
      }
      if (url === "/world-evidence/autonomous-loop" && (req.method === "GET" || req.method === undefined)) {
        serveReportsFile(root, "phase16-world-evidence/control_case_result.json", res);
        return;
      }
      if (url === "/world-evidence/action-loop" && (req.method === "GET" || req.method === undefined)) {
        serveReportsFile(root, "phase16-world-evidence/action_loop_result.json", res);
        return;
      }
      if (url === "/world-evidence/capability-index" && (req.method === "GET" || req.method === undefined)) {
        serveReportsFile(root, "phase16-world-evidence/capability_index.json", res);
        return;
      }
      if (url && url.startsWith("/gateway/") && (req.method === "GET" || req.method === "POST")) {
        void handleGatewayRequest(req, res, url);
        return;
      }
      if (url === "/canonical-view.json" && (req.method === "GET" || req.method === undefined)) {
        sendJson(res, 200, { ok: true, ...ownerReviewSurfaceSnapshot() });
        return;
      }
      if (url === "/owner-work.json" && (req.method === "GET" || req.method === undefined)) {
        sendJson(res, 200, { ok: true, ...ownerWorkSurfaceSnapshot() });
        return;
      }
      if (url === "/owner-work/search" && req.method === "POST") {
        void handleOwnerWorkSearch(req, res);
        return;
      }
      if (url === "/owner-work/open" && req.method === "POST") {
        void handleOwnerWorkOpen(req, res);
        return;
      }
      if (url === "/owner-work/action" && req.method === "POST") {
        void handleOwnerWorkAction(req, res);
        return;
      }
      if ((url === "/.well-known/webmcp.json" || url === "/site-tools.json") && (req.method === "GET" || req.method === undefined)) {
        sendJson(res, 200, { ok: true, ...listSiteTools() });
        return;
      }
      if (url === "/site-tools/invoke" && req.method === "POST") {
        void handleSiteToolInvoke(req, res);
        return;
      }
      if (url === "/canonical-view/decision" && req.method === "POST") {
        void handleCanonicalViewDecision(req, res);
        return;
      }
      if (url === "/resolve-problem" && req.method === "POST") {
        void handleResolveProblem(req, res, root);
        return;
      }
      safeSend(res, 404, "text/plain; charset=utf-8", "not found");
    } catch (error) {
      // Structural guarantee: no request handler exception is ever allowed to escape uncaught (would kill every connected client's rendering, the exact silent-failure mode this task warned against).
      safeSend(res, 500, "text/plain; charset=utf-8", `internal error: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  // Bind host is explicit and env-driven (2026-08-24, migration hardening
  // — verified live: `server.listen(port)` with no host arg defaults to
  // `0.0.0.0`, so this server was already listening on every interface,
  // the one of the four Railway candidates whose exposure was implicit
  // rather than chosen). Default stays 127.0.0.1, matching
  // transport/owner-command-http/server.ts's existing pattern and this
  // server's real current Mac-local usage.
  const host = process.env.HOST ?? "127.0.0.1";
  const bindPolicy = evaluateBindPolicy(host, process.env.DNA_OS_CIRCUIT_SHARED_SECRET);
  if (!bindPolicy.allowed) {
    // A thrown Error here previously left the process alive with empty
    // stdout/stderr (peer review, 2026-08-24, live-verified): this file's
    // own top-level `startTelemetryCollector()` call (line 61) creates a
    // live timer handle independent of this server, so an uncaught throw
    // during startup did not terminate the event loop or print anything —
    // a silent zombie: no listening socket (secure) but no diagnostic
    // either (undebuggable on Railway, where "process alive" alone reads
    // as healthy). Explicit console.error + process.exit(1) makes the
    // refusal loud and the exit code real, matching
    // transport/owner-command-http/server.ts's and
    // observability/joint-monitor/server.ts's already-correct behavior.
    console.error(`dna-os-circuit/runtime refusing to start: ${bindPolicy.reason}`);
    process.exit(1);
  }
  server.listen(port, host);
  return server;
}
