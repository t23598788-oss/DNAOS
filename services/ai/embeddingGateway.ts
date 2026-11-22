/**
 * Experimental embedding entry point, intentionally separate from the
 * text-generation resolver and AiAdapter contract. This pilot has no retrieval
 * or persistence side effects.
 */
import {
  digitalOceanEmbeddingAdapter,
  type EmbeddingAdapter,
  type EmbeddingAdapterContext,
  type EmbeddingRequest,
  type EmbeddingResult,
} from "./embeddingAdapter";

export type { EmbeddingRequest, EmbeddingResult, EmbeddingVector } from "./embeddingAdapter";

export interface EmbeddingGatewayDependencies {
  /** Test/pilot credential injection. The value is never returned or logged. */
  apiKey?: string;
  adapter?: EmbeddingAdapter;
  fetchImpl?: typeof fetch;
  nowMs?: () => number;
}

export async function embedThroughAiGateway(
  request: EmbeddingRequest,
  deps: EmbeddingGatewayDependencies = {},
): Promise<EmbeddingResult> {
  const apiKey = deps.apiKey ?? process.env.DIGITALOCEAN_INFERENCE_API_KEY;
  if (!apiKey) throw new Error("EMBEDDING_CREDENTIAL_REQUIRED:DIGITALOCEAN_INFERENCE_API_KEY");

  const adapter = deps.adapter ?? digitalOceanEmbeddingAdapter;
  const context: EmbeddingAdapterContext = {
    apiKey,
    fetchImpl: deps.fetchImpl,
    nowMs: deps.nowMs,
  };
  return adapter.embed(request, context);
}
