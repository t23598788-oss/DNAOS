// Local Event Buffer (owner, 2026-07-30): real gap found live — saveEvent()
// in events/store.ts silently returns null on any DB error, and every
// handler (handlers/image.ts, handlers/text.ts, etc.) just gives up
// entirely when that happens: no reply sent, nothing recorded, the
// customer's message is gone. This buffer is the fallback: when the real
// insert fails (DB unreachable — the exact scenario this whole session's
// local-migration work exists to eventually eliminate, but a real risk
// until then), the event is appended to a local file instead of dropped,
// so the webhook can still respond to LINE immediately (Non-Blocking
// Execution) and nothing is lost. flushBufferedEvents() drains it back
// into the real table once the DB is reachable again.
//
// File-based, not pure in-memory: a Deno edge-runtime container/process
// can restart between requests — an in-memory array would lose everything
// on restart, defeating the whole point of not losing customer messages.

const BUFFER_PATH = Deno.env.get("EVENT_BUFFER_PATH") ?? "/tmp/dna_os_event_buffer.jsonl"

export interface BufferedEventRecord {
  bufferedAt: string
  insertRow: Record<string, unknown>
}

export async function bufferEvent(insertRow: Record<string, unknown>): Promise<string> {
  const record: BufferedEventRecord = { bufferedAt: new Date().toISOString(), insertRow }
  await Deno.writeTextFile(BUFFER_PATH, JSON.stringify(record) + "\n", { append: true, create: true })
  return `buffered:${crypto.randomUUID()}`
}

async function readBufferedLines(): Promise<string[]> {
  try {
    const text = await Deno.readTextFile(BUFFER_PATH)
    return text.split("\n").filter((l) => l.trim().length > 0)
  } catch {
    return [] // file doesn't exist yet — nothing buffered, not an error
  }
}

// Drains the buffer into the real line_events table. Called opportunistically
// at the start of every new webhook request (cheap — no-op when the file is
// empty/missing) AND on a schedule via the flush cron, so recovery doesn't
// depend on a new message arriving.
export async function flushBufferedEvents(supabase: any): Promise<{ flushed: number; remaining: number }> {
  const lines = await readBufferedLines()
  if (lines.length === 0) return { flushed: 0, remaining: 0 }

  const stillFailing: string[] = []
  let flushed = 0

  for (const line of lines) {
    let record: BufferedEventRecord
    try {
      record = JSON.parse(line)
    } catch {
      continue // corrupt line — drop it, nothing recoverable
    }
    const { error } = await supabase.from("line_events").insert(record.insertRow)
    if (error) {
      stillFailing.push(line) // DB still unreachable (or a real row-level error) — keep for next attempt
    } else {
      flushed++
    }
  }

  if (stillFailing.length > 0) {
    await Deno.writeTextFile(BUFFER_PATH, stillFailing.join("\n") + "\n")
  } else {
    // Everything flushed — remove the file entirely to free the memory/disk
    // it held, per the owner's explicit instruction ("ลบ Cache/Buffer
    // ชั่วคราวออกทันที เพื่อคืน Memory").
    await Deno.remove(BUFFER_PATH).catch(() => {})
  }

  return { flushed, remaining: stillFailing.length }
}
