/**
 * Cline worker bridge (OWNER WORKSPACE AI TOOL INTEGRATION, 2026-10-11).
 *
 * หน้าที่เดียว: ส่งคำสั่งภาษาคนจาก Owner Workspace ไปให้ **Cline** (AI ที่ owner
 * ติดตั้งจริง — cline CLI, provider = cline account ไม่ใช่ OpenAI) คิด/ค้นเครื่องมือ/
 * เรียบเรียงผล แล้วส่ง structured result กลับ render ด้วย result contract เดิม
 * ไม่มี runtime/AI ใหม่ ไม่มี business reader ใหม่ ไม่มี writer ใหม่
 *
 * เส้นจริง:
 *   /api/chat (requireAuth) → runCognitivePipeline → deterministic paths ตอบไม่ได้
 *   → runOwnerRequestViaCline → spawn `cline --json` headless
 *   → Cline เรียก POST {origin}/api/v1/mcp/business/dispatch
 *     (owner session cookie → requireAuth → READ whitelist → engines/validation/
 *      dispatcher → business readers เดิม) → Cline ตอบ strict JSON
 *   → sanitizeClineResult() → Workspace result renderer เดิม
 *
 * Authority ไม่เปลี่ยนมือ: DNA OS authenticate Owner (cookie) + whitelist +
 * registry gate ใน dispatcher — Cline ไม่มี credential ของตัวเอง
 * Fail-closed ทุกขั้น: ไม่มี binary / timeout / JSON พัง / ผลนอก whitelist
 * → null → เส้นทางเดิม (deterministic/bridge/owner-runtime) ต่อตามเดิม
 */
import { spawn } from "node:child_process"
import { createServer as createProxyServer, request as httpRequest } from "node:http"
import { request as httpsRequest } from "node:https"
import { existsSync, mkdirSync } from "node:fs"
import type { ChatResult } from "./chatResultTypes"
import type { PartnerSummary, PartnerTimelineEntry } from "@/core/shared/types"

export interface ClineWorkerTransport {
  origin: string
  cookie: string | null
  /** port ของ local auth proxy (127.0.0.1) ที่ worker เปิดให้ Cline เรียกแทน —
   * cookie ไม่เคยออกจาก worker process */
  proxyPort?: number
}

export interface ClineWorkerReply {
  text: string
  result: ChatResult | null
  evidence: {
    taskId: string | null
    durationMs: number
    totalCost: number | null
    totalOutputTokens: number | null
    iterations: number | null
  }
}

const CLINE_TIMEOUT_SECONDS = Number(process.env.CLINE_TIMEOUT_SECONDS ?? 180)
const WORKDIR = "/tmp/dnaos-cline-worker"
const KNOWN_BIN =
  "/Users/tam/.nvm/versions/node/v22.23.2/lib/node_modules/cline/node_modules/@cline/cli-darwin-arm64/bin/cline"

/** per chat sessionKey — taskId ของ Cline ล่าสุด (evidence) */
const clineSessions = new Map<string, string>()
/** rolling บริบทสนทนา (ถาม→ตอบ 4 ครั้งล่าสุด) — DNA OS เป็นเจ้าของ context (phase 4) */
const sessionHistory = new Map<string, string[]>()
export function __setClineSessionForTest(key: string, id: string): void {
  clineSessions.set(key, id)
}
export function __getClineSessionsForTest(): Map<string, string> {
  return clineSessions
}

export function resolveClineBin(): string | null {
  const override = process.env.CLINE_BIN
  if (override && existsSync(override)) return override
  if (existsSync(KNOWN_BIN)) return KNOWN_BIN
  return null
}

const str = (v: unknown, cap = 500): string | null =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, cap) : null

/** strict sanitize — Cline ไม่มี authority สร้างรูปผลนอกสัญญา ChatResult */
export function sanitizeClineResult(raw: unknown): ChatResult | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  switch (r.type) {
    case "sections": {
      const blocks = Array.isArray(r.blocks) ? r.blocks.slice(0, 5) : []
      const cleanBlocks = blocks.map((b, i) => {
        const block = (b ?? {}) as Record<string, unknown>
        const fields = Array.isArray(block.fields) ? block.fields.slice(0, 20) : []
        return {
          kind: "fields" as const,
          id: str(block.id, 80) ?? `cline-fields-${i}`,
          title: str(block.title, 200) ?? "",
          fields: fields.map((f, j) => {
            const field = (f ?? {}) as Record<string, unknown>
            const value = field.value
            return {
              kind: "field" as const,
              id: str(field.id, 80) ?? `f${j}`,
              label: str(field.label, 120) ?? "",
              value:
                typeof value === "number" || typeof value === "boolean"
                  ? String(value)
                  : str(value, 300) ?? "—",
            }
          }),
        }
      })
      if (cleanBlocks.length === 0) return null
      return { type: "sections", blocks: cleanBlocks }
    }
    case "table": {
      const table = (r.table ?? {}) as Record<string, unknown>
      const columns = Array.isArray(table.columns) ? table.columns.slice(0, 12) : []
      const rows = Array.isArray(table.rows) ? table.rows.slice(0, 50) : []
      if (columns.length === 0) return null
      return {
        type: "table",
        title: str(r.title, 300) ?? "",
        table: {
          columns: columns.map((c, i) => {
            const col = (c ?? {}) as Record<string, unknown>
            return { key: str(col.key, 60) ?? `c${i}`, label: str(col.label, 120) ?? `c${i}` }
          }),
          rows: rows.map((row) =>
            (Array.isArray(row) ? row : []).slice(0, 12).map((cell) =>
              cell === null || cell === undefined ? "—" : String(cell).slice(0, 200),
            ),
          ),
        },
      }
    }
    case "file": {
      const path = str(r.path, 500)
      const name = str(r.name, 300)
      if (!path || !name || path.includes("..")) return null
      return { type: "file", name, path, mime: str(r.mime, 120) ?? "application/octet-stream", size: Number(r.size ?? 0) || 0 }
    }
    case "document": {
      const title = str(r.title, 300)
      const html = str(r.html, 200_000)
      if (!title || !html) return null
      return { type: "document", title, html }
    }
    case "timeline": {
      const title = str(r.title, 300)
      if (!title) return null
      const items = Array.isArray(r.items) ? r.items.slice(0, 50) : []
      const cleanItems = items.map((it) => {
        const item = (it ?? {}) as Record<string, unknown>
        return {
          date: str(item.date, 40) ?? "-",
          kind: "document",
          template_id: "generic",
          template_key: "generic",
          event_type: str(item.event_type, 80) ?? "info",
          title: str(item.title, 300) ?? "-",
          subtitle: str(item.subtitle, 300),
          amount: typeof item.amount === "number" ? item.amount : null,
          status: str(item.status, 80),
        } as unknown as PartnerTimelineEntry
      })
      return {
        type: "timeline",
        title,
        summary: (r.summary && typeof r.summary === "object" ? r.summary : null) as PartnerSummary | null,
        items: cleanItems,
      }
    }
    default:
      return null
  }
}

/** ดึง JSON ก้อนแรกถึง last } จากข้อความตอบของ Cline (รองรับ ```json fences) */
export function extractClineJson(text: string): unknown | null {
  const cleaned = text.replace(/```(?:json)?\s*/gi, "").trim()
  const start = cleaned.indexOf("{")
  const end = cleaned.lastIndexOf("}")
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(cleaned.slice(start, end + 1))
  } catch {
    return null
  }
}

interface ClineRunOutcome {
  text: string
  taskId: string | null
  durationMs: number
  totalCost: number | null
  totalOutputTokens: number | null
  iterations: number | null
}

/** parse NDJSON ของ cline --json → outcome สุดท้าย (run_result + taskId) */
export function parseClineRunOutput(ndjson: string): ClineRunOutcome | null {
  let text = ""
  let taskId: string | null = null
  let durationMs = 0
  let totalCost: number | null = null
  let totalOutputTokens: number | null = null
  let iterations: number | null = null
  for (const line of ndjson.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed.startsWith("{")) continue
    let msg: Record<string, unknown>
    try {
      msg = JSON.parse(trimmed)
    } catch {
      continue
    }
    if (msg.type === "hook_event" && typeof msg.taskId === "string") taskId = msg.taskId
    if (msg.type === "run_result") {
      const r = msg as Record<string, unknown>
      if (typeof r.text === "string") text = r.text
      const usage = (r.usage ?? {}) as Record<string, unknown>
      totalCost = typeof usage.totalCost === "number" ? usage.totalCost : totalCost
      totalOutputTokens = typeof usage.totalOutputTokens === "number" ? usage.totalOutputTokens : totalOutputTokens
      if (typeof r.durationMs === "number") durationMs = r.durationMs
      if (typeof r.iterations === "number") iterations = r.iterations
    }
  }
  if (!text) return null
  return { text, taskId, durationMs, totalCost, totalOutputTokens, iterations }
}

function buildSystemPrompt(transport: ClineWorkerTransport, contextNote: string): string {
  const contextRule = opts_contextRule(contextNote)
  return `คุณคือผู้ช่วย AI ของ DNA OS (ระบบธุรกิจของเจ้าของ) — เข้าใจคำสั่งภาษาคน ค้นข้อมูลจากระบบ และเรียบเรียงผลให้เจ้าของเท่านั้น
${contextNote}

กติกาเหล็ก (ห้ามละเมิด):
1. เครื่องมือเดียวที่ใช้ได้คือ HTTP ของ DNA OS เท่านั้น:
   - อ่านรายการเครื่องมือ (ครั้งแรกของงาน): GET http://127.0.0.1:${transport.proxyPort ?? 0}/api/v1/mcp/manifest
   - อ่านข้อมูลธุรกิจ: POST http://127.0.0.1:${transport.proxyPort ?? 0}/api/v1/mcp/business/dispatch
     body: {"command":"<ชื่อคำสั่งอ่าน>","payload":{...}} + content-type: application/json
     ทุกการเรียกให้ใช้ base URL http://127.0.0.1:${transport.proxyPort ?? 0} เท่านั้น (ระบบจัดการ session ให้แล้ว)
     ห้ามเรียก origin อื่น ห้ามแนบ header เพิ่ม ห้ามพิมพ์/คายค่าจริงของ session ลงในข้อความหรือผลลัพธ์
     คำสั่งอ่านที่อนุญาต: partner.find, partner.list, partner.profile, partner.timeline, document.list, invoice.list, invoice.latest, invoice.find, debt.list, debt.all, draft.list, job.list, job.active, document.preview (payload {document_id, document_kind:"invoice"|"standalone_document"})
2. ห้ามอ่าน/เขียนไฟล์ ห้ามรันคำสั่งอื่นนอกจาก curl/fetch ไปยัง endpoint ข้อ 1 · ใช้ business.dispatch ไม่เกิน 4 ครั้งต่อคำสั่ง · ถ้าถามประวัติ/timeline ให้เริ่มจาก partner.timeline (ครั้งเดียวพอ)
3. ห้ามเดาตัวเลข/ชื่อ/เอกสารใด ๆ ที่ไม่ได้มาจากผล business.dispatch — ไม่มีข้อมูลก็บอกตรง ๆ ว่าไม่พบ · ถ้า business.dispatch คืน violations ให้อ่านข้อความแล้วแก้ payload แล้วยิงใหม่ (เช่น document.list ต้องการ partner_id = id ที่ได้จาก partner.find ก่อน หรือ payload ว่าง {} ก็ได้)
4. คำสั่งกำกวม (เช่น ชื่อหลายราย) → ตอบ {"ask":"คำถามเพื่อให้เจ้าของเลือก"} ห้ามเลือกเอง
5. คำตอบสุดท้าย: JSON เท่านั้น {"answer":"ข้อความไทยสั้น ๆ","result":<ด้านล่าง>,"ask":null|"คำถาม"}
   result.type ที่อนุญาต (result contract เดิมของ Workspace):
   - "sections" โปรไฟล์บริษัท: {"type":"sections","blocks":[{"kind":"fields","id":"company","title":"ชื่อบริษัท","fields":[{"kind":"field","id":"phone","label":"โทรศัพท์","value":"..."}]}]}
   - "table" รายการ: {"type":"table","title":"...","table":{"columns":[{"key":"c1","label":"..."}],"rows":[["..."]]}}
   - "timeline" ประวัติ: {"type":"timeline","title":"...","summary":null,"items":[{"date":"YYYY-MM-DD","event_type":"...","title":"...","amount":123,"status":"..."}]}
   - "file" เปิดไฟล์ต้นฉบับ: {"type":"file","name":"...","path":"<storage_path จาก document.preview>","mime":"application/pdf","size":123}
   - "document" สรุปเอกสาร (เมื่อ document.preview คืน mode summary): {"type":"document","title":"...","html":"..."}
${contextRule}`
}
function opts_contextRule(contextNote: string): string {
  return contextNote.includes("id:")
    ? "หมายเหตุบริบท: ถ้าคำสั่งพูดถึง 'บริษัทนี้/ของบริษัทนี้/เอกสารล่าสุด' ให้ใช้คู่ค้าในบริบทนี้ต่อ — แต่ข้อมูลทุกชิ้นต้องดึงจาก business.dispatch เท่านั้น"
    : ""
}

function argsFor(transport: ClineWorkerTransport, contextNote: string, historyNote: string, promptArg: string): string[] {
  return [
    // quirk จริงของ cline CLI 3.0.62: prompt ต้องเป็น arg ตัวแรก และห้ามเป็น
    // single-token (ไม่มี space เลย) — จึงเติม space ท้าย string
    promptArg,
    "--json",
    "--auto-approve", "true",
    "-t", String(CLINE_TIMEOUT_SECONDS),
    "-c", WORKDIR,
    "-s", `${buildSystemPrompt(transport, contextNote)}\n${historyNote}`,
  ]
}

export async function runOwnerRequestViaCline(
  message: string,
  opts: { sessionKey?: string | null; transport: ClineWorkerTransport; who?: string | null; whoId?: string | null },
): Promise<ClineWorkerReply | null> {
  const bin = resolveClineBin()
  if (!bin || !opts.transport.origin) {
    console.info(`[clineWorker] skip (bin=${bin ? "found" : "MISSING"} origin=${opts.transport.origin || "-"})`)
    return null
  }
  console.info(`[clineWorker] attempt sessionKey=${opts.sessionKey ?? "-"} msg="${message.slice(0, 40)}" history=${opts.sessionKey ? (sessionHistory.get(opts.sessionKey) ?? []).length : 0}`)
  try {
    mkdirSync(WORKDIR, { recursive: true })
  } catch {
    return null
  }

  const contextNote = opts.who
    ? `บริบทจาก memory ของระบบ: คู่ค้าที่กำลังคุยด้วย = "${opts.who}"${opts.whoId ? ` (id: ${opts.whoId})` : ""}`
    : "บริบทจาก memory ของระบบ: ยังไม่มีคู่ค้าที่ระบุใน session"

  // NOTE: cline 3.0.62 มีบั๊กจริง — `--id` (resume) + `--json` ปฏิเสธ prompt
  // ("JSON output mode requires a prompt argument") และ piped stdin ก็ใช้ไม่ได้
  // → บริบทสนทนาจึงดูแลโดย DNA OS เอง: memory who/who_id (สัญญาเดิม) + rolling
  // history ใน worker ใส่ system prompt ทุกครั้ง — สอดคล้องกฎของ mission
  // "Context is not an authority source": ประวัติ = บริบท ข้อมูลจริงดึงจาก
  // business.dispatch เท่านั้นทุกครั้ง
  const key = opts.sessionKey ?? "-"
  const historyLines = sessionHistory.get(key) ?? []
  const historyNote = historyLines.length
    ? `บทสนทนาก่อนหน้า (บริบท ไม่ใช่ข้อมูลจริง — ดึงข้อมูลใหม่จาก business.dispatch เสมอ):\n${historyLines.join("\n")}`
    : ""
  const promptArg = `${message.trim().slice(0, 2000)} `

  const env: NodeJS.ProcessEnv = { ...process.env }

  // LOCAL AUTH PROXY — cline CLI sandbox ตัด custom env ทิ้ง (ทดสอบแล้ว:
  // DNA_OS_OWNER_COOKIE ไม่เห็นจาก bash tool ของ Cline) และการใส่ cookie ใน
  // prompt จะรั่วเข้า cline log → ทางที่ปลอดภัยและใช้ได้จริงคือ proxy
  // 127.0.0.1 ชั่วคราวต่อ request: allow-list แค่ 2 path ของ MCP + แนบ cookie
  // ฝั่ง server เท่านั้น — cookie ไม่เคยออกจาก process นี้
  const originUrl = new URL(opts.transport.origin)
  const proxy = createProxyServer((req, res) => {
    const url = req.url ?? ""
    const allowed = url === "/api/v1/mcp/manifest" || url.startsWith("/api/v1/mcp/business/dispatch")
    if (!allowed || (req.method !== "GET" && req.method !== "POST")) {
      res.writeHead(403, { "content-type": "application/json" })
      res.end(JSON.stringify({ ok: false, error: "PROXY_PATH_NOT_ALLOWED" }))
      return
    }
    const headers: Record<string, string> = { "content-type": "application/json" }
    if (opts.transport.cookie) headers.cookie = opts.transport.cookie
    const mod = originUrl.protocol === "https:" ? httpsRequest : httpRequest
    const up = mod(
      {
        hostname: originUrl.hostname,
        port: originUrl.port || (originUrl.protocol === "https:" ? 443 : 80),
        path: url,
        method: req.method,
        headers,
      },
      (ur) => {
        res.writeHead(ur.statusCode ?? 502, { "content-type": "application/json" })
        ur.pipe(res)
      },
    )
    up.on("error", () => {
      res.writeHead(502, { "content-type": "application/json" })
      res.end(JSON.stringify({ ok: false, error: "PROXY_UPSTREAM_ERROR" }))
    })
    req.pipe(up)
  })
  const proxyPort = await new Promise<number | null>((resolvePort) => {
    proxy.once("error", () => resolvePort(null))
    proxy.listen(0, "127.0.0.1", () => {
      const addr = proxy.address()
      resolvePort(typeof addr === "object" && addr ? addr.port : null)
    })
  })
  if (!proxyPort) return null
  const transport: ClineWorkerTransport = { ...opts.transport, proxyPort }

  return await new Promise<ClineWorkerReply | null>((resolve) => {
    let out = ""
    let err = ""
    const child = spawn(bin, argsFor(transport, contextNote, historyNote, promptArg), {
      env,
      cwd: WORKDIR,
      stdio: ["ignore", "pipe", "pipe"],
    })
    const killer = setTimeout(() => child.kill("SIGKILL"), (CLINE_TIMEOUT_SECONDS + 20) * 1000)
    child.stdout.on("data", (d) => { out += d.toString() })
    child.stderr.on("data", (d) => { err += d.toString() })
    child.on("error", () => { clearTimeout(killer); proxy.close(); resolve(null) })
    child.on("close", () => {
      clearTimeout(killer)
      proxy.close()
      const outcome = parseClineRunOutput(out)
      if (!outcome) {
        console.error("[clineWorker] no run_result", err.slice(0, 300))
        resolve(null)
        return
      }
      if (opts.sessionKey && outcome.taskId) clineSessions.set(opts.sessionKey, outcome.taskId)
      const loggedParsed = extractClineJson(outcome.text)
      const loggedResult = sanitizeClineResult(
        loggedParsed && typeof loggedParsed === "object" ? (loggedParsed as Record<string, unknown>).result : null,
      )
      console.info(
        `[clineWorker] round-trip ok sessionKey=${opts.sessionKey ?? "-"} taskId=${outcome.taskId ?? "-"} ` +
          `durationMs=${outcome.durationMs} cost=$${outcome.totalCost ?? "?"} outTokens=${outcome.totalOutputTokens ?? "?"} ` +
          `result=${loggedResult?.type ?? "text"}`,
      )
      const parsed = extractClineJson(outcome.text)
      // เก็บ rolling history (ถาม→ตอบ) เป็นบริบทคำสั่งถัดไป — DNA OS เป็นเจ้าของ
      if (opts.sessionKey) {
        const hist = sessionHistory.get(key) ?? []
        const parsedObj = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {}
        const histAnswer = typeof parsedObj.answer === "string" ? parsedObj.answer : outcome.text
        sessionHistory.set(key, [...hist, `เจ้าของ: ${message.slice(0, 100)} → ผู้ช่วย: ${histAnswer.slice(0, 250)}`].slice(-4))
      }
      const obj = (parsed && typeof parsed === "object" ? parsed : {}) as Record<string, unknown>
      const answer =
        typeof obj.answer === "string" && obj.answer.trim()
          ? obj.answer.trim()
          : outcome.text.trim().slice(0, 2000)
      const ask = typeof obj.ask === "string" && obj.ask.trim() ? obj.ask.trim() : null
      const result = sanitizeClineResult(obj.result)
      resolve({
        text: ask ? `${answer}\n\n❓ ${ask}` : answer,
        result,
        evidence: {
          taskId: outcome.taskId,
          durationMs: outcome.durationMs,
          totalCost: outcome.totalCost,
          totalOutputTokens: outcome.totalOutputTokens,
          iterations: outcome.iterations,
        },
      })
    })
  })
}
