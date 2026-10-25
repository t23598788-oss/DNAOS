/**
 * DNA OS — provider output normalization (2026-10-20).
 *
 * ONE standard applied to EVERY adapter's text before it leaves the gateway:
 *   - chat-template special tokens that leaked into the text (e.g. `<|im_end|>`
 *     from mlx_lm.server, observed in the 2026-10-20 MLX check)
 *   - reasoning blocks (`<think>…</think>`) that must never reach a business
 *     caller as if they were the answer
 *   - surrounding whitespace
 * It does NOT validate business meaning — that is the Canonical Engine's job.
 * Deno mirrors this exact rule in supabase/functions/_shared/ai/runtime.ts.
 */
export function normalizeProviderText(raw: string): string {
  return raw
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .replace(/<\|[a-z_]+\|>/gi, "")
    .trim();
}
