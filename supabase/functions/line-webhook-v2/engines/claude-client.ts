// LINE webhook AI call sites — thin, provider-neutral wrappers over the shared
// Deno AI capability runtime (supabase/functions/_shared/ai/runtime.ts).
//
// A7 cutover (owner, 2026-09-23): the file keeps its name and its three exported
// functions, so no LINE engine changes shape — but the code inside no longer
// selects Anthropic, no longer names a model and no longer reads
// ANTHROPIC_API_KEY. Each call states the CAPABILITY it needs and the shared
// resolver (same policy as Node/Next) decides which adapter serves it.
//
// The `string | null` contract is unchanged on purpose: every existing caller
// already treats null as "AI could not help", so LINE continuation semantics
// (and the best-effort memory/fallback behaviour) are untouched.
import { runAiCapability } from "../../_shared/ai/runtime.ts";

const ORIGIN = "line-webhook-v2/claude-client";
const LINE_CONTEXT = { origin: ORIGIN, ownerId: "line", sessionId: "line-webhook" } as const;

function firstJsonObject(text: string): string | null {
  const match = text.match(/\{[\s\S]*\}/);
  return match ? match[0] : null;
}

/** Capability is named by the caller — "conversation.answer" (reply) or
 *  "memory.draft" (customer-memory notes). Never a provider or a model. */
export async function callClaudeText(
  systemPrompt: string,
  userText: string,
  maxTokens: number,
  capability: "conversation.answer" | "memory.draft" = "conversation.answer",
): Promise<string | null> {
  const result = await runAiCapability(capability, { systemPrompt, prompt: userText, maxTokens }, LINE_CONTEXT);
  if (!result.ok) {
    console.error("[ai-capability]", capability, "failed:", result.error);
    return null;
  }
  return result.output;
}

export async function callClaudeVision(
  systemPrompt: string,
  promptText: string,
  image: { base64: string; mediaType: string },
  maxTokens: number,
): Promise<string | null> {
  const result = await runAiCapability(
    "document.ocr",
    { systemPrompt, prompt: promptText, image: { base64: image.base64, mediaType: image.mediaType }, maxTokens },
    LINE_CONTEXT,
  );
  if (!result.ok) {
    console.error("[ai-capability] document.ocr failed:", result.error);
    return null;
  }
  return result.output;
}

export interface ClaudeTool {
  name: string;
  description: string;
}

/**
 * Returns the chosen tool name, or null if the model didn't choose one.
 * (Legacy name kept for its callers; the body is provider-neutral now. The old
 * Anthropic tool-call JSON shape is gone — the capability asks the same question
 * as text and the answer is matched against the real tool names.)
 */
export async function callClaudeTool(systemPrompt: string, userText: string, tools: ClaudeTool[], maxTokens: number): Promise<string | null> {
  const toolBlock = tools.map((t) => `- ${t.name}: ${t.description}`).join("\n");
  const result = await runAiCapability(
    "intent.classify",
    {
      systemPrompt,
      prompt: `${userText}\n\nเครื่องมือที่เลือกได้:\n${toolBlock}\n\nตอบชื่อเครื่องมือเดียวจากรายการนี้เท่านั้น ถ้าไม่มีเหมาะสมให้ตอบ NONE`,
      maxTokens,
    },
    LINE_CONTEXT,
  );
  if (!result.ok || !result.output) {
    console.error("[ai-capability] intent.classify failed:", result.error);
    return null;
  }
  const answer = result.output.trim();
  const chosen = tools.find((t) => answer.includes(t.name));
  if (chosen) return chosen.name;
  const json = firstJsonObject(answer);
  if (json) {
    try {
      const parsed = JSON.parse(json) as { tool?: string; name?: string };
      const named = parsed.tool ?? parsed.name;
      if (named && tools.some((t) => t.name === named)) return named;
    } catch {
      // fall through to null — an unparsable answer is honestly "no tool chosen"
    }
  }
  return null;
}
