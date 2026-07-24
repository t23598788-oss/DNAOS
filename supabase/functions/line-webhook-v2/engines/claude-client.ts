// Shared Claude (Anthropic Messages API) caller for the LINE webhook engines
// (owner instruction 2026-07-25: "เขียน AI ที่กูเอามาผูกไว้ในระบบ (ChatGPT)
// ออกไปจากระบบให้ถาวรเลย"). Replaces the OpenAI-fetch pattern each of
// auto-build-event.ts / ocr-classify.ts / tool-router.ts used to duplicate
// independently — Rule 103 (reuse before build): one real HTTP-call helper,
// three call sites, instead of the same fetch boilerplate three times.
//
// No SDK — raw fetch, same convention this Deno runtime already used for
// OpenAI (esm.sh imports are avoided here on purpose; the Messages API is a
// simple enough POST that a dependency isn't worth it).
//
// HONESTY NOTE: image-url support (callClaudeVision) uses Anthropic's
// {type:"image", source:{type:"url", url}} content block shape — not
// exercised against a live key in this session (no ANTHROPIC_API_KEY set
// yet). Verify once a real key exists, per Rule 109.

const ANTHROPIC_API = "https://api.anthropic.com/v1/messages"
const MODEL = "claude-haiku-4-5-20251001"
const ANTHROPIC_VERSION = "2023-06-01"

function headers(apiKey: string) {
  return {
    "Content-Type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": ANTHROPIC_VERSION,
  }
}

function firstText(json: any): string {
  const block = json?.content?.find((c: any) => c.type === "text")
  return (block?.text ?? "").trim()
}

export async function callClaudeText(systemPrompt: string, userText: string, maxTokens: number): Promise<string | null> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY")
  if (!apiKey) {
    console.error("[claude-client] ANTHROPIC_API_KEY not set")
    return null
  }
  const res = await fetch(ANTHROPIC_API, {
    method: "POST",
    headers: headers(apiKey),
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      temperature: 0,
      system: systemPrompt,
      messages: [{ role: "user", content: userText }],
    }),
  })
  if (!res.ok) {
    console.error("[claude-client] Claude text call failed:", res.status, await res.text())
    return null
  }
  return firstText(await res.json())
}

export async function callClaudeVision(systemPrompt: string, promptText: string, imageUrl: string, maxTokens: number): Promise<string | null> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY")
  if (!apiKey) {
    console.error("[claude-client] ANTHROPIC_API_KEY not set")
    return null
  }
  const res = await fetch(ANTHROPIC_API, {
    method: "POST",
    headers: headers(apiKey),
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      temperature: 0,
      system: systemPrompt,
      messages: [{
        role: "user",
        content: [
          { type: "text", text: promptText },
          { type: "image", source: { type: "url", url: imageUrl } },
        ],
      }],
    }),
  })
  if (!res.ok) {
    console.error("[claude-client] Claude vision call failed:", res.status, await res.text())
    return null
  }
  return firstText(await res.json())
}

export interface ClaudeTool {
  name: string
  description: string
}

// Returns the chosen tool name, or null if the model didn't call one.
export async function callClaudeTool(systemPrompt: string, userText: string, tools: ClaudeTool[], maxTokens: number): Promise<string | null> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY")
  if (!apiKey) {
    console.error("[claude-client] ANTHROPIC_API_KEY not set")
    return null
  }
  const res = await fetch(ANTHROPIC_API, {
    method: "POST",
    headers: headers(apiKey),
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      temperature: 0,
      system: systemPrompt,
      messages: [{ role: "user", content: userText }],
      tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: { type: "object", properties: {} } })),
    }),
  })
  if (!res.ok) {
    console.error("[claude-client] Claude tool call failed:", res.status, await res.text())
    return null
  }
  const json = await res.json()
  const toolUse = json?.content?.find((c: any) => c.type === "tool_use")
  return toolUse?.name ?? null
}
