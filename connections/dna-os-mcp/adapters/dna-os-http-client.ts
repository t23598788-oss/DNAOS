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
 * API, or a file directly — only these seven endpoints, all already real
 * and already canonical.
 */

export interface DnaOsHttpResponse<T = unknown> {
  status: number;
  body: T;
}

export interface DnaOsHttpClientOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export class DnaOsHttpClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: DnaOsHttpClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? "http://127.0.0.1:8791";
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private async postJson(path: string, body: unknown): Promise<DnaOsHttpResponse> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(body),
    });
    const parsed = await response.json().catch(() => ({}));
    return { status: response.status, body: parsed };
  }

  private async getJson(path: string): Promise<DnaOsHttpResponse> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`);
    const parsed = await response.json().catch(() => ({}));
    return { status: response.status, body: parsed };
  }

  /** POST /command — the real owner-command Input Ingress. */
  submitCommand(input: { commandText: string; idempotencyKey?: string; ownerIdentity?: { id: string; email: string } }): Promise<DnaOsHttpResponse> {
    return this.postJson("/command", input);
  }

  /** POST /registry/candidates — the real Registration Ingress (evaluateRegistration -> registerCandidate). */
  submitRegistrationCandidate(input: Record<string, unknown>): Promise<DnaOsHttpResponse> {
    return this.postJson("/registry/candidates", input);
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
