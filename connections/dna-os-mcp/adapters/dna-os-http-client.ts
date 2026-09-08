/**
 * หน้าที่: the ONLY place this capability folder talks to anything —
 * DNA OS's own already-running, already-canonical HTTP transport
 * (`transport/owner-command-http/server.ts`, default
 * http://127.0.0.1:8791). Every method here is a thin JSON passthrough to
 * an endpoint that already exists and is already exercised by that
 * transport's own callers (the Dead Board app, this repo's own tests) —
 * no new route, no new decision, no new store.
 *
 * This file makes exactly one kind of network call: plain `fetch` to a
 * loopback HTTP endpoint owned by this same repo. It never opens a
 * database connection pool of any kind, never holds a database
 * credential, never calls GitHub/Vercel/Supabase/any provider directly,
 * and never issues SQL.
 *
 * Input: per-method request bodies/ids, matching what each real endpoint
 * already accepts.
 * Output: `{ status, body }` — the real HTTP status and parsed JSON body,
 * unmodified, so the tool layer can decide what to surface, never this
 * adapter deciding on the caller's behalf.
 * Dependency ที่อนุญาต: none — plain fetch only.
 * สิ่งที่ห้ามแตะ: never add a method that queries a database, a provider
 * API, or a file directly — only these already-real Core endpoints.
 * Command submission must stay on POST /owner/submit-command (the
 * submitOwnerCommand path). Never send typed Owner commands to POST
 * /command — that door is chat-intake only.
 *
 * Network auth: Core `requireSharedSecret` checks Authorization with
 * `verifySharedSecret` against `OWNER_COMMAND_HTTP_SHARED_SECRET` (same
 * env name the LaunchAgent already gives the Core process). This client
 * sends `Bearer <that env value>` when present — the existing trusted-
 * client pattern used by `observability/joint-monitor/client.ts`. The
 * secret is never hardcoded, logged, or returned. Missing env omits the
 * header; Core then answers 401/503. This is not Owner authentication.
 * Owner session: when a pointer is bound (`ownerSessionId` or
 * `DNA_OS_OWNER_SESSION_ID`), it is sent as `x-dna-os-owner-session`.
 * Core runs `validateOwnerSession`. This adapter does not mint sessions
 * and does not take identity from tool arguments.
 */

export interface DnaOsHttpResponse<T = unknown> {
  status: number;
  body: T;
}

export interface DnaOsHttpClientOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  /** Already-validated Owner session pointer, or the same env stdio MCP already uses. Never taken from tool arguments. */
  ownerSessionId?: string | null;
}

export class DnaOsHttpClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly ownerSessionId: string | null;
  private readonly ownerSessionExplicit: boolean;

  constructor(options: DnaOsHttpClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? "http://127.0.0.1:8791";
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.ownerSessionExplicit = Object.prototype.hasOwnProperty.call(options, "ownerSessionId");
    this.ownerSessionId = typeof options.ownerSessionId === "string" && options.ownerSessionId.trim() !== ""
      ? options.ownerSessionId.trim()
      : null;
  }

  /**
   * Bind this client to a caller-context session pointer. Does not mint
   * identity; Core still runs validateOwnerSession on the header.
   * Passing null means this caller presented no session — do not inherit
   * process env (that would let an unauthenticated HTTP caller steal stdio's pointer).
   */
  bindOwnerSession(ownerSessionId: string | null | undefined): DnaOsHttpClient {
    return new DnaOsHttpClient({
      baseUrl: this.baseUrl,
      fetchImpl: this.fetchImpl,
      ownerSessionId: ownerSessionId ?? null,
    });
  }

  /**
   * Same env var Core's `requireSharedSecret` reads. Trusted local clients
   * already obtain this from the LaunchAgent / process environment — they
   * do not invent a second store.
   */
  private authorizationHeader(): string | undefined {
    const secret = process.env.OWNER_COMMAND_HTTP_SHARED_SECRET;
    if (typeof secret !== "string" || secret.length === 0) return undefined;
    return `Bearer ${secret}`;
  }

  /**
   * Existing Owner session pointer: constructor (MCP caller context) or
   * `DNA_OS_OWNER_SESSION_ID` (stdio MCP). Core validates it; this adapter
   * never treats the value as proof and never logs it.
   */
  private ownerSessionPointer(): string | undefined {
    if (this.ownerSessionId !== null) return this.ownerSessionId;
    if (this.ownerSessionExplicit) return undefined;
    const fromEnv = process.env.DNA_OS_OWNER_SESSION_ID;
    if (typeof fromEnv === "string" && fromEnv.trim() !== "") return fromEnv.trim();
    return undefined;
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = { ...extra };
    const authorization = this.authorizationHeader();
    if (authorization !== undefined) headers.Authorization = authorization;
    const session = this.ownerSessionPointer();
    if (session !== undefined) headers["x-dna-os-owner-session"] = session;
    return headers;
  }

  private async postJson(path: string, body: unknown): Promise<DnaOsHttpResponse> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/json; charset=utf-8" }),
      body: JSON.stringify(body),
    });
    const parsed = await response.json().catch(() => ({}));
    return { status: response.status, body: parsed };
  }

  private async getJson(path: string): Promise<DnaOsHttpResponse> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: "GET",
      headers: this.headers(),
    });
    const parsed = await response.json().catch(() => ({}));
    return { status: response.status, body: parsed };
  }

  /**
   * POST /owner/submit-command — the real submitOwnerCommand ingress
   * (classify → routeOwnerCommand → execution-policy → executor/task).
   * Does not use POST /command (chat intake / WorkOrder door).
   */
  submitCommand(input: { commandText: string; work_id?: string; payload?: Record<string, unknown>; ownerIdentity?: { id: string; email: string } }): Promise<DnaOsHttpResponse> {
    return this.postJson("/owner/submit-command", {
      commandText: input.commandText,
      ...(input.work_id ? { work_id: input.work_id } : {}),
      ...(input.payload ? { payload: input.payload } : {}),
      ...(input.ownerIdentity ? { ownerIdentity: input.ownerIdentity } : {}),
    });
  }

  /** GET /registry/capabilities/:id — the real software_registry Lookup API. */
  lookupCapability(capabilityId: string): Promise<DnaOsHttpResponse> {
    return this.getJson(`/registry/capabilities/${encodeURIComponent(capabilityId)}`);
  }

  /** GET /registry/resources/:id — the real findResourceById lookup. */
  getResource(resourceId: string): Promise<DnaOsHttpResponse> {
    return this.getJson(`/registry/resources/${encodeURIComponent(resourceId)}`);
  }

  /** GET /task/:id — the real task/result/evidence/handoff lookup. */
  getTask(taskId: string): Promise<DnaOsHttpResponse> {
    return this.getJson(`/task/${encodeURIComponent(taskId)}`);
  }

  /** POST /handoff — the real canonical work-result ingress (admission checks: task exists, EXECUTING/VERIFYING, no duplicate active submission). */
  submitWorkResult(input: Record<string, unknown>): Promise<DnaOsHttpResponse> {
    return this.postJson("/handoff", input);
  }

  /** GET /runtime/inventory — the real live capability/runtime status, each entry with its own evidence array. */
  getSystemStatus(): Promise<DnaOsHttpResponse> {
    return this.getJson("/runtime/inventory");
  }
}
