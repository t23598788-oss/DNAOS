/**
 * Phase 1 — AI inference forwarding for a remote compute server.
 *
 * Exactly ONE configured endpoint (zero second gateway by construction):
 * this is the same wire contract the DNA OS AI Gateway's ollama adapter and
 * local-runtime/ai/device-ai-runtime.mjs already speak — POST
 * {endpoint}/api/generate with { model, system, prompt, stream:false }.
 * The endpoint comes from DNA_COMPUTE_INFER_ENDPOINT (no stored secret in
 * this package; if the deployment needs an internal token it lives in the
 * relay, never here). Without a configured endpoint the capability is
 * honestly unavailable — NOT_CONFIGURED, never a silent fallback.
 */
export interface InferForwardResult {
  status: "SUCCEEDED" | "FAILED" | "NOT_CONFIGURED";
  output: string | null;
  error: string | null;
  meta?: Record<string, unknown>;
}

export async function inferForward(
  payload: { system?: string; prompt: string; model?: string; maxTokens?: number },
  endpoint: string | null,
  fetchFn: typeof fetch = fetch,
): Promise<InferForwardResult> {
  if (!endpoint) {
    return { status: "NOT_CONFIGURED", output: null, error: "DNA_COMPUTE_INFER_ENDPOINT is not configured — AI inference is honestly unavailable on this server" };
  }
  const url = endpoint.replace(/\/$/, "") + "/api/generate";
  const body = {
    model: payload.model ?? "qwen2.5vl:7b",
    system: payload.system ?? undefined,
    prompt: payload.prompt,
    stream: false,
  };
  try {
    const res = await fetchFn(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) {
      return { status: "FAILED", output: null, error: `inference endpoint returned HTTP ${res.status}` };
    }
    const json = (await res.json()) as { response?: unknown };
    if (typeof json.response !== "string" || !json.response.trim()) {
      return { status: "FAILED", output: null, error: "inference endpoint returned an empty response" };
    }
    return { status: "SUCCEEDED", output: json.response, error: null, meta: { endpoint_scheme: new URL(endpoint).protocol } };
  } catch (error) {
    return { status: "FAILED", output: null, error: `inference endpoint unreachable: ${error instanceof Error ? error.message : String(error)}` };
  }
}
