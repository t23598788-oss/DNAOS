/**
 * Separate contract for embedding providers. Embeddings are vectors, not text
 * completions, and must not be routed through AiAdapter.invoke().
 */

export interface EmbeddingRequest {
  texts: string[];
}

export interface EmbeddingVector {
  index: number;
  values: number[];
}

export interface EmbeddingResult {
  provider: string;
  model: string;
  vectors: EmbeddingVector[];
  dimensions: number;
  usage: { promptTokens: number | null; totalTokens: number | null };
  latencyMs: number;
}

export interface EmbeddingAdapterContext {
  apiKey: string;
  fetchImpl?: typeof fetch;
  nowMs?: () => number;
}

export interface EmbeddingAdapter {
  id: string;
  model: string;
  embed(request: EmbeddingRequest, context: EmbeddingAdapterContext): Promise<EmbeddingResult>;
}

interface DigitalOceanEmbeddingsResponse {
  data?: Array<{ index?: number; embedding?: unknown }>;
  model?: string;
  usage?: { prompt_tokens?: number; total_tokens?: number };
}

const DO_EMBEDDINGS_URL = "https://inference.do-ai.run/v1/embeddings";
const DEFAULT_MODEL = "qwen3-embedding-0.6b";
const MAX_INPUTS = 32;

/** Experimental DigitalOcean embedding adapter; no database/index writes. */
export const digitalOceanEmbeddingAdapter: EmbeddingAdapter = {
  id: "digitalocean-embeddings",
  model: DEFAULT_MODEL,
  async embed(request, context) {
    if (!context.apiKey.trim()) throw new Error("EMBEDDING_CREDENTIAL_REQUIRED");
    if (request.texts.length === 0 || request.texts.length > MAX_INPUTS || request.texts.some((text) => !text.trim())) {
      throw new Error("EMBEDDING_INPUT_INVALID");
    }

    const fetchImpl = context.fetchImpl ?? fetch;
    const nowMs = context.nowMs ?? Date.now;
    const start = nowMs();
    const response = await fetchImpl(DO_EMBEDDINGS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${context.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        input: request.texts,
        encoding_format: "float",
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) throw new Error(`EMBEDDING_PROVIDER_HTTP_${response.status}`);
    const body = await response.json() as DigitalOceanEmbeddingsResponse;
    const rows = body.data;
    if (!Array.isArray(rows) || rows.length !== request.texts.length) throw new Error("EMBEDDING_RESPONSE_SHAPE_INVALID");

    const vectors = rows.map((row, index) => {
      if (row.index !== index || !Array.isArray(row.embedding) || row.embedding.length === 0) {
        throw new Error("EMBEDDING_RESPONSE_SHAPE_INVALID");
      }
      const values = row.embedding;
      if (!values.every((value) => typeof value === "number" && Number.isFinite(value))) {
        throw new Error("EMBEDDING_RESPONSE_VECTOR_INVALID");
      }
      return { index, values };
    });

    const dimensions = vectors[0].values.length;
    if (!vectors.every((vector) => vector.values.length === dimensions)) throw new Error("EMBEDDING_DIMENSION_MISMATCH");

    return {
      provider: "digitalocean-inference",
      model: body.model ?? DEFAULT_MODEL,
      vectors,
      dimensions,
      usage: {
        promptTokens: Number.isInteger(body.usage?.prompt_tokens) ? body.usage!.prompt_tokens! : null,
        totalTokens: Number.isInteger(body.usage?.total_tokens) ? body.usage!.total_tokens! : null,
      },
      latencyMs: Math.max(0, nowMs() - start),
    };
  },
};
