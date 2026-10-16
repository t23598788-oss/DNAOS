/**
 * Phase 1 — the daemon's single HTTP control surface.
 *
 * Security model (Phase 1, 2026-10-16):
 * - Deny-by-default: a request without a valid bearer token matching
 *   DNA_COMPUTE_TOKEN (timing-safe compare) is 401 before any dispatch.
 * - Local-safe by default: binds 127.0.0.1 unless DNA_COMPUTE_BIND_HOST says
 *   otherwise, so an installer-less Phase-1 server can never silently become
 *   a public admin endpoint (Private-network hardening arrives with the
 *   relay/TLS phase).
 * - Only the closed command set from types.ts is callable; payloads are
 *   validated before dispatch; ai.infer requires its endpoint to already be
 *   configured (fail-closed NOT_CONFIGURED otherwise).
 * - No Business Runtime import, no Supabase, no Production credentials —
 *   the process never even looks for them.
 */
import http from "http";
import { timingSafeEqual } from "crypto";
import type { CommandKind, RemoteCommand, RemoteResult, RemoteHeartbeat } from "./types.js";
import { COMMAND_KINDS } from "./types.js";
import { readWorkspaceFile } from "./workspace.js";
import { inferForward } from "./inference.js";
import { runBuildOrTestScript } from "./exec.js";

export interface DaemonConfig {
  token: string | null; // DNA_COMPUTE_TOKEN; null = only /health works
  inferEndpoint: string | null; // DNA_COMPUTE_INFER_ENDPOINT
  bindHost: string; // default 127.0.0.1
  port: number;
  deviceId: string | null; // DNA_COMPUTE_DEVICE_ID (registration is a later phase)
}

function safeEqual(a: string, b: string): boolean {
  const ta = timingSafeEqualT(a);
  const tb = timingSafeEqualT(b);
  if (ta.length !== tb.length) return false;
  return timingSafeEqual(ta, tb);
}
function timingSafeEqualT(s: string): Buffer {
  return Buffer.from(s, "utf-8");
}

export interface DaemonState {
  deviceId: string | null;
  startedAt: string;
  lastCommandAt: string | null;
  inferEndpoint: string;
  version: string;
}

export class RemoteComputeDaemon {
  private state: DaemonState;

  constructor(private config: DaemonConfig) {
    this.state = {
      deviceId: config.deviceId,
      startedAt: new Date().toISOString(),
      lastCommandAt: null,
      inferEndpoint: config.inferEndpoint ?? "not-configured",
      version: "dna-os-compute@0.1.0",
    };
  }

  heartbeat(): RemoteHeartbeat {
    const capabilities = {
      aiInfer: Boolean(this.config.inferEndpoint),
      codeRead: true,
      buildRun: true,
      testRun: true,
    };
    return {
      deviceId: this.config.deviceId,
      status: "UP",
      runtime: this.state.version,
      version: this.state.version,
      capabilities,
      startedAt: this.state.startedAt,
      lastCommandAt: this.state.lastCommandAt,
    };
  }

  /** Real dispatch — every command passes kind validation THEN scope THEN execution. */
  async dispatch(command: RemoteCommand): Promise<RemoteResult> {
    const finished = () => new Date().toISOString();
    const started = Date.now();
    this.state.lastCommandAt = finished();
    const base = { commandId: command.commandId };
    const done = (status: RemoteResult["status"], output: string | null, error: string | null, meta?: Record<string, unknown>): RemoteResult =>
      ({ ...base, status, output, error, durationMs: Date.now() - started, meta, finishedAt: finished() });

    if (!(COMMAND_KINDS as readonly string[]).includes(command.kind)) {
      return done("KIND_UNKNOWN", null, `command_kind '${String(command.kind)}' is not in the closed Phase-1 set: ${COMMAND_KINDS.join(", ")}`);
    }
    const kind = command.kind as CommandKind;

    if (kind === "ai.infer") {
      const payload = command.payload as { system?: string; prompt?: string };
      if (typeof payload?.prompt !== "string" || !payload.prompt.trim() || payload.prompt.length > 200_000) {
        return done("SCOPE_DENIED", null, "ai.infer requires a real prompt within 200k chars");
      }
      const r = await inferForward({ system: payload.system, prompt: payload.prompt, maxTokens: undefined }, this.config.inferEndpoint);
      return done(r.status, r.output, r.error, r.meta);
    }

    if (kind === "code.read") {
      if (!command.workspaceRoot) return done("SCOPE_DENIED", null, "code.read requires a granted workspaceRoot");
      const payload = command.payload as { path?: string; startLine?: number; maxBytes?: number };
      try {
        const r = await readWorkspaceFile(command.workspaceRoot, { path: String(payload?.path ?? ""), startLine: payload?.startLine, maxBytes: payload?.maxBytes });
        return done("SUCCEEDED", r.content, null, { path: r.relPath, bytes: r.bytes, truncated: r.truncated });
      } catch (err) {
        const we = err as { code?: string; message: string };
        const status = we.code === "NOT_FOUND" ? "FAILED" : "SCOPE_DENIED";
        return done(status ?? "FAILED", null, we.message ?? "code.read failed");
      }
    }

    // build.run / test.run
    if (!command.workspaceRoot) return done("SCOPE_DENIED", null, `${kind} requires a granted workspaceRoot`);
    const payload = command.payload as { script?: string };
    const r = await runBuildOrTestScript(kind === "build.run" ? "build.run" : "test.run", command.workspaceRoot, { script: String(payload?.script ?? "") });
    return done(r.status, r.output, r.error, r.meta);
  }

  /** The one HTTP handler. Returns true when the request was consumed. */
  async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

    if (url.pathname === "/health" || url.pathname === "/heartbeat") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, heartbeat: this.heartbeat() }));
      return;
    }

    // Everything else requires the token (deny-by-default).
    if (!this.config.token || !safeEqual(req.headers.authorization ?? "", `Bearer ${this.config.token}`)) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "DNA_COMPUTE_TOKEN missing or bearer mismatch" }));
      return;
    }

    if (req.method === "GET" && url.pathname === "/capabilities") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, capabilities: this.heartbeat().capabilities }));
      return;
    }

    if (req.method === "POST" && url.pathname === "/commands") {
      let body = "";
      let bytes = 0;
      req.on("data", (chunk: Buffer) => {
        bytes += chunk.byteLength;
        if (bytes > 1_000_000) req.destroy();
        body += String(chunk);
      });
      req.on("end", () => {
        void (async () => {
          try {
            const parsed = JSON.parse(body || "{}") as Partial<RemoteCommand>;
            const command: RemoteCommand = {
              commandId: String(parsed.commandId ?? `local-${Date.now()}`),
              kind: String(parsed.kind ?? "") as CommandKind,
              payload: (parsed.payload ?? {}) as RemoteCommand["payload"],
              workspaceRoot: parsed.workspaceRoot ?? null,
              createdAt: new Date().toISOString(),
            };
            const result = await this.dispatch(command);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true, result }));
          } catch (error) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
          }
        })();
      });
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "no such compute surface" }));
  }

  start(): Promise<http.Server> {
    return new Promise((resolve) => {
      const server = http.createServer((req, res) => {
        void this.handleRequest(req, res);
      });
      server.listen(this.config.port, this.config.bindHost, () => resolve(server));
    });
  }
}

/** Bootstrap from env only (no credential file, no business plane). */
export function daemonFromEnv(overrides: Partial<DaemonConfig> = {}): RemoteComputeDaemon {
  const config: DaemonConfig = {
    token: process.env.DNA_COMPUTE_TOKEN ?? null,
    inferEndpoint: process.env.DNA_COMPUTE_INFER_ENDPOINT ?? null,
    bindHost: process.env.DNA_COMPUTE_BIND_HOST ?? "127.0.0.1",
    port: Number(process.env.DNA_COMPUTE_PORT ?? 0),
    deviceId: process.env.DNA_COMPUTE_DEVICE_ID ?? null,
    ...overrides,
  };
  return new RemoteComputeDaemon(config);
}
