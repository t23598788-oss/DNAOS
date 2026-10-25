/**
 * Intent routing: deterministic alias/description matching FIRST, ai.translate
 * (a real, registered, read-only command called via /api/v1/query) ONLY as a
 * tiebreaker when deterministic confidence is low. Most messages never touch
 * an AI provider at all — matching your instruction not to make every
 * message depend on one.
 */
import { EXECUTABLE_READ_COMMANDS, RECOGNITION_ONLY_WRITE_INTENTS } from "./commandCorpus"
import { callQuery } from "./apiClient"

const HIGH_CONFIDENCE = 0.5
const LOW_CONFIDENCE = 0.18

export type RoutedIntent =
  | { kind: "read"; command: string; confidence: number }
  | { kind: "write"; command: string }
  | { kind: "clarify"; candidates: { command: string; label: string }[] }
  | { kind: "unmatched" }

interface CorpusEntry {
  command: string
  bucket: "read" | "write"
  texts: string[] // aliases (+ description if available)
}

function buildCorpus(specDescriptions: Record<string, string>): CorpusEntry[] {
  const entries: CorpusEntry[] = []
  for (const [command, def] of Object.entries(EXECUTABLE_READ_COMMANDS)) {
    entries.push({ command, bucket: "read", texts: [...def.aliases, specDescriptions[command] ?? ""] })
  }
  for (const [command, def] of Object.entries(RECOGNITION_ONLY_WRITE_INTENTS)) {
    entries.push({ command, bucket: "write", texts: [...def.aliases] })
  }
  return entries
}

function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, "")
}

function bigrams(s: string): Set<string> {
  const out = new Set<string>()
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2))
  if (s.length === 1) out.add(s)
  return out
}

function similarity(a: string, b: string): number {
  const na = normalize(a)
  const nb = normalize(b)
  if (!na || !nb) return 0
  if (na.includes(nb) || nb.includes(na)) {
    return 0.7 + 0.3 * (Math.min(na.length, nb.length) / Math.max(na.length, nb.length))
  }
  const ba = bigrams(na)
  const bb = bigrams(nb)
  let intersect = 0
  for (const g of ba) if (bb.has(g)) intersect++
  const union = ba.size + bb.size - intersect
  return union === 0 ? 0 : intersect / union
}

function scoreEntry(input: string, entry: CorpusEntry): number {
  let best = 0
  for (const text of entry.texts) {
    if (!text) continue
    best = Math.max(best, similarity(input, text))
  }
  return best
}

export interface RouteOptions {
  token: string | null
  specDescriptions: Record<string, string>
}

export async function routeIntent(input: string, options: RouteOptions): Promise<RoutedIntent> {
  const corpus = buildCorpus(options.specDescriptions)
  const ranked = corpus
    .map(entry => ({ entry, score: scoreEntry(input, entry) }))
    .sort((a, b) => b.score - a.score)

  const top = ranked[0]
  if (!top || top.score === 0) return { kind: "unmatched" }

  if (top.score >= HIGH_CONFIDENCE) {
    return top.entry.bucket === "write"
      ? { kind: "write", command: top.entry.command }
      : { kind: "read", command: top.entry.command, confidence: top.score }
  }

  // Low/medium confidence — ask ai.translate for a second opinion, but only
  // if we actually have a token to call /api/v1/query with. No token means
  // no AI tiebreaker; fall straight to clarify/unmatched below.
  if (options.token) {
    const aiResult = await callQuery(options.token, "ai.translate", { text: input })
    if (aiResult.ok && aiResult.data && typeof aiResult.data === "object") {
      const guessed = (aiResult.data as Record<string, unknown>).command
      if (typeof guessed === "string") {
        const matchInReadCorpus = EXECUTABLE_READ_COMMANDS[guessed]
        const matchInWriteCorpus = RECOGNITION_ONLY_WRITE_INTENTS[guessed]
        if (matchInReadCorpus) return { kind: "read", command: guessed, confidence: Math.max(top.score, LOW_CONFIDENCE) }
        if (matchInWriteCorpus) return { kind: "write", command: guessed }
      }
    }
  }

  // Still ambiguous — offer the closest 2-3 candidates rather than guess.
  const candidates = ranked
    .filter(r => r.score >= LOW_CONFIDENCE)
    .slice(0, 3)
    .map(r => ({
      command: r.entry.command,
      label: r.entry.texts[0] || r.entry.command,
    }))

  if (candidates.length === 0) return { kind: "unmatched" }
  if (candidates.length === 1 && top.score >= LOW_CONFIDENCE) {
    const entry = corpus.find(e => e.command === candidates[0].command)!
    return entry.bucket === "write"
      ? { kind: "write", command: entry.command }
      : { kind: "read", command: entry.command, confidence: top.score }
  }
  return { kind: "clarify", candidates }
}
