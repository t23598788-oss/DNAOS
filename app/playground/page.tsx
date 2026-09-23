"use client"

/**
 * /playground — Conversational Command Surface (default) + Developer Mode (raw)
 *
 * Default mode: natural language only. No command names, no JSON, no UUIDs
 * ever shown to the user. Pipeline: deterministic alias match → ai.translate
 * (only when confidence is low, itself a real /api/v1/query call) → entity
 * resolution via *.find commands → /api/v1/query → human-readable result.
 * Every step is a separate real HTTP call to /api/v1/query — no dispatcher
 * import, no batch endpoint, max 3 chained calls per message.
 *
 * Developer Mode: raw command dropdown + JSON args, unchanged from before.
 *
 * command-registry.json and /api/v1/query's contract are untouched.
 */

import { useState, useEffect, useRef } from "react"
import Link from "next/link"
import { EXECUTABLE_READ_COMMANDS, RECOGNITION_ONLY_WRITE_INTENTS } from "./_lib/commandCorpus"
import { routeIntent } from "./_lib/intentRouter"
import { resolveEntity } from "./_lib/entityResolver"
import { callQuery } from "./_lib/apiClient"
import { formatResult } from "./_lib/resultFormatters"
import type { ChatMessage, PendingState } from "./_lib/conversationState"
import { ChatMessageList } from "@/presentation/ai/ChatMessageList"
import { ChatInput } from "@/presentation/ai/ChatInput"

interface CommandSpec {
  type: string
  function: {
    name: string
    description: string
    parameters: {
      properties?: Record<string, { type: string; description: string }>
      required?: string[]
    }
    _dna_command: string
  }
}

const MAX_CHAIN_STEPS = 3

let msgCounter = 0
function nextId() {
  msgCounter += 1
  return `m${msgCounter}`
}

export default function PlaygroundPage() {
  const [mode, setMode] = useState<"human" | "developer">("human")
  const [token, setToken] = useState("")

  const [specs, setSpecs] = useState<CommandSpec[]>([])
  const [loadingSpec, setLoadingSpec] = useState(true)

  // ── Human mode (Conversational Command Surface) ──
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [pending, setPending] = useState<PendingState>(null)
  const [running, setRunning] = useState(false)
  const activeClarifyIdRef = useRef<string | null>(null)

  // ── Developer mode (unchanged raw selector) ──
  const [selectedCommand, setSelectedCommand] = useState("")
  const [argsText, setArgsText] = useState("{}")
  const [devRunning, setDevRunning] = useState(false)
  const [devResult, setDevResult] = useState<unknown>(null)
  const [devError, setDevError] = useState<string | null>(null)
  const [devElapsed, setDevElapsed] = useState<number | null>(null)

  useEffect(() => {
    fetch("/api/v1/spec")
      .then(r => r.json())
      .then(d => {
        setSpecs(d.tools ?? [])
        if (d.tools?.[0]) setSelectedCommand(d.tools[0].function._dna_command)
      })
      .finally(() => setLoadingSpec(false))
  }, [])

  const specDescriptions: Record<string, string> = {}
  for (const s of specs) specDescriptions[s.function._dna_command] = s.function.description

  const pushMessage = (msg: Omit<ChatMessage, "id">) => {
    const withId = { ...msg, id: nextId() }
    setMessages(prev => [...prev, withId])
    if (msg.kind === "clarify") activeClarifyIdRef.current = withId.id
    return withId.id
  }

  const pushWritePreview = (commandLabel: string, adminUrl: string, adminLabel: string) => {
    pushMessage({ sender: "system", kind: "write-preview", text: `${commandLabel}|||${adminUrl}|||${adminLabel}` })
  }

  /** Executes a resolved read command, formats and pushes the result. Counts as one chain step. */
  const executeReadCommand = async (command: string, args: Record<string, unknown>) => {
    const res = await callQuery(token, command, args)
    if (!res.ok) {
      pushMessage({ sender: "system", kind: "error", text: res.error ?? res.hint ?? "เกิดข้อผิดพลาด" })
      return
    }
    const label = EXECUTABLE_READ_COMMANDS[command]?.aliases[0] ?? command
    pushMessage({ sender: "system", kind: "result", text: `${label}:\n${formatResult(command, res.data)}` })
  }

  /** Handles a "read" route that may need entity resolution or a search keyword first. */
  const startReadFlow = async (command: string) => {
    const meta = EXECUTABLE_READ_COMMANDS[command]
    if (!meta) return
    if (meta.needsEntity) {
      pushMessage({ sender: "system", kind: "text", text: "ต้องการดูของลูกค้าคนไหน? พิมพ์ชื่อลูกค้า" })
      setPending({ kind: "await_entity_keyword", command, entityType: meta.needsEntity.type, argKey: meta.needsEntity.argKey })
      return
    }
    if (meta.needsKeyword) {
      pushMessage({ sender: "system", kind: "text", text: meta.needsKeyword.prompt })
      setPending({ kind: "await_keyword", command, argKey: meta.needsKeyword.argKey })
      return
    }
    await executeReadCommand(command, {})
  }

  const startWriteFlow = (command: string) => {
    const def = RECOGNITION_ONLY_WRITE_INTENTS[command]
    if (!def) return
    pushWritePreview(def.aliases[0], def.adminUrl, def.adminLabel)
  }

  const handleSend = async (text: string) => {
    pushMessage({ sender: "user", kind: "text", text })

    if (!token.trim()) {
      pushMessage({ sender: "system", kind: "error", text: "ใส่ token ก่อน — ดูได้ที่ /admin/api-tokens" })
      return
    }

    setRunning(true)
    try {
      // ── Resume a pending flow first ──
      if (pending?.kind === "await_keyword") {
        const p = pending
        setPending(null)
        await executeReadCommand(p.command, { [p.argKey]: text })
        return
      }

      if (pending?.kind === "await_entity_keyword") {
        const p = pending
        let steps = 1 // the resolution call itself
        const resolution = await resolveEntity(token, p.entityType, text)
        if (resolution.kind === "none") {
          pushMessage({ sender: "system", kind: "text", text: `ไม่พบ "${text}" ในระบบ ลองพิมพ์ชื่อใหม่อีกครั้ง` })
          return // keep pending as-is, let them retry
        }
        if (resolution.kind === "error") {
          pushMessage({ sender: "system", kind: "error", text: resolution.message })
          setPending(null)
          return
        }
        if (resolution.kind === "multiple") {
          const candidates = resolution.options.map(o => o.label)
          const clarifyId = pushMessage({ sender: "system", kind: "clarify", text: "พบหลายรายการ เลือกรายการที่ต้องการ:", options: candidates })
          setPending({ kind: "clarify_entity", command: p.command, entityType: p.entityType, argKey: p.argKey, options: resolution.options })
          activeClarifyIdRef.current = clarifyId
          return
        }
        // resolved — chain into the actual command (step 2)
        steps += 1
        if (steps > MAX_CHAIN_STEPS) {
          pushMessage({ sender: "system", kind: "error", text: "คำสั่งนี้ต้องใช้หลายขั้นตอนเกินกำหนด ระบบจึงหยุดเพื่อความปลอดภัย" })
          setPending(null)
          return
        }
        setPending(null)
        await executeReadCommand(p.command, { [p.argKey]: resolution.id })
        return
      }

      if (pending?.kind === "clarify_entity") {
        const p = pending
        const chosen = matchChoice(text, p.options.map(o => o.label))
        if (chosen === -1) {
          pushMessage({ sender: "system", kind: "text", text: "กรุณาเลือกจากตัวเลือกที่แสดง หรือพิมพ์ชื่อให้ตรงมากขึ้น" })
          return
        }
        setPending(null)
        await executeReadCommand(p.command, { [p.argKey]: p.options[chosen].id })
        return
      }

      if (pending?.kind === "clarify_command") {
        const p = pending
        const chosen = matchChoice(text, p.candidates.map(c => c.label))
        setPending(null)
        if (chosen === -1) {
          // Not a match — treat as a brand new message instead of forcing a re-pick.
          await routeAndHandle(text)
          return
        }
        const picked = p.candidates[chosen].command
        if (EXECUTABLE_READ_COMMANDS[picked]) await startReadFlow(picked)
        else if (RECOGNITION_ONLY_WRITE_INTENTS[picked]) startWriteFlow(picked)
        return
      }

      // ── No pending flow — fresh routing ──
      await routeAndHandle(text)
    } finally {
      setRunning(false)
    }
  }

  const routeAndHandle = async (text: string) => {
    const route = await routeIntent(text, { token: token.trim() || null, specDescriptions })
    if (route.kind === "unmatched") {
      pushMessage({ sender: "system", kind: "text", text: "ยังไม่เข้าใจคำถามนี้ ลองพิมพ์ใหม่ เช่น \"ดูหนี้ของลูกค้า ABC\" หรือ \"ดูเอกสาร\"" })
      return
    }
    if (route.kind === "clarify") {
      const clarifyId = pushMessage({ sender: "system", kind: "clarify", text: "หมายถึงอันไหน?", options: route.candidates.map(c => c.label) })
      setPending({ kind: "clarify_command", candidates: route.candidates, originalText: text })
      activeClarifyIdRef.current = clarifyId
      return
    }
    if (route.kind === "write") {
      startWriteFlow(route.command)
      return
    }
    await startReadFlow(route.command)
  }

  const matchChoice = (text: string, labels: string[]): number => {
    const trimmed = text.trim()
    const asNumber = Number(trimmed)
    if (Number.isInteger(asNumber) && asNumber >= 1 && asNumber <= labels.length) return asNumber - 1
    const lower = trimmed.toLowerCase()
    const exact = labels.findIndex(l => l.toLowerCase() === lower)
    if (exact !== -1) return exact
    return labels.findIndex(l => l.toLowerCase().includes(lower) || lower.includes(l.toLowerCase()))
  }

  // ── Developer mode (unchanged logic) ──
  const currentSpec = specs.find(s => s.function._dna_command === selectedCommand)
  const devParams = currentSpec?.function.parameters.properties ?? {}
  const devRequired = currentSpec?.function.parameters.required ?? []

  const runDeveloper = async () => {
    if (!token.trim()) { setDevError("ใส่ token ก่อน — ดูได้ที่ /admin/api-tokens"); return }
    if (!selectedCommand) { setDevError("เลือก command ก่อน"); return }
    let args: Record<string, unknown>
    try {
      args = JSON.parse(argsText)
    } catch {
      setDevError("args ต้องเป็น JSON ที่ถูกต้อง"); return
    }
    setDevRunning(true)
    setDevError(null)
    setDevResult(null)
    setDevElapsed(null)
    const t0 = Date.now()
    const res = await callQuery(token.trim(), selectedCommand, args)
    setDevElapsed(Date.now() - t0)
    if (!res.ok) {
      setDevError(res.error ?? res.hint ?? "error")
    }
    setDevResult(res)
    setDevRunning(false)
  }

  const fillArgs = () => {
    if (!currentSpec) return
    const defaults: Record<string, string> = {}
    for (const [key, p] of Object.entries(devParams)) {
      defaults[key] = p.type === "number" ? "0" : `<${key}>`
    }
    setArgsText(JSON.stringify(defaults, null, 2))
  }

  return (
    <div className="min-h-screen bg-stone-900 text-stone-100 font-mono">
      <div className="max-w-3xl mx-auto px-6 py-8 flex flex-col" style={{ minHeight: "100vh" }}>

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="text-[10px] text-stone-500 mb-1">
              <Link href="/start" className="hover:text-stone-300">Developer Portal</Link>
              {" · "}
              <Link href="/examples" className="hover:text-stone-300">Examples</Link>
            </div>
            <h1 className="text-lg font-bold">DNA OS Playground</h1>
            <p className="text-xs text-stone-400 mt-0.5">
              {mode === "human" ? "บอก DNA OS ว่าต้องการให้ทำอะไร" : "ทดลองเรียก command ดิบด้วย token ของท่าน"}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex bg-stone-800 border border-stone-700 rounded-xl p-1 text-xs">
              <button
                onClick={() => setMode("human")}
                className={`px-3 py-1.5 rounded-lg transition ${mode === "human" ? "bg-sky-500 text-white" : "text-stone-400 hover:text-stone-200"}`}
              >
                โหมดปกติ
              </button>
              <button
                onClick={() => setMode("developer")}
                className={`px-3 py-1.5 rounded-lg transition ${mode === "developer" ? "bg-sky-500 text-white" : "text-stone-400 hover:text-stone-200"}`}
              >
                Developer Mode
              </button>
            </div>
            <a
              href="/api/v1/spec"
              target="_blank"
              className="text-xs text-stone-400 hover:text-stone-200 border border-stone-700 px-3 py-1.5 rounded-lg"
            >
              API Spec ↗
            </a>
          </div>
        </div>

        {/* Token — shared by both modes */}
        <div className="bg-stone-800 rounded-2xl p-4 border border-stone-700 mb-4">
          <label className="text-[10px] text-stone-400 uppercase font-semibold block mb-2">
            X-DNA-Token{" "}
            <Link href="/admin/api-tokens" className="text-sky-400 hover:underline normal-case">
              (สร้างที่นี่)
            </Link>
          </label>
          <input
            type="password"
            value={token}
            onChange={e => setToken(e.target.value)}
            placeholder="วาง token ที่นี่..."
            className="w-full bg-stone-900 border border-stone-600 rounded-xl px-3 py-2 text-sm text-stone-100 placeholder-stone-600 focus:outline-none focus:ring-1 focus:ring-sky-500"
          />
        </div>

        {mode === "human" ? (
          <div className="flex-1 flex flex-col bg-stone-800 rounded-2xl border border-stone-700 p-4 min-h-[500px]">
            <ChatMessageList
              messages={messages}
              activeClarifyId={activeClarifyIdRef.current}
              running={running}
              onChoose={(index) => {
                if (pending?.kind === "clarify_command") {
                  handleSend(pending.candidates[index].label)
                } else if (pending?.kind === "clarify_entity") {
                  handleSend(pending.options[index].label)
                }
              }}
            />
            <div className="mt-3 pt-3 border-t border-stone-700">
              <ChatInput onSend={handleSend} disabled={running || loadingSpec} />
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="space-y-4">
              <div className="bg-stone-800 rounded-2xl p-4 border border-stone-700">
                <label className="text-[10px] text-stone-400 uppercase font-semibold block mb-2">Command</label>
                {loadingSpec ? (
                  <div className="text-xs text-stone-500">กำลังโหลด spec...</div>
                ) : (
                  <select
                    value={selectedCommand}
                    onChange={e => { setSelectedCommand(e.target.value); setArgsText("{}"); setDevResult(null); setDevError(null) }}
                    className="w-full bg-stone-900 border border-stone-600 rounded-xl px-3 py-2 text-sm text-stone-100 focus:outline-none focus:ring-1 focus:ring-sky-500"
                  >
                    {specs.map(s => (
                      <option key={s.function._dna_command} value={s.function._dna_command}>
                        {s.function._dna_command}
                      </option>
                    ))}
                  </select>
                )}
                {currentSpec && (
                  <p className="text-[11px] text-stone-400 mt-2">{currentSpec.function.description}</p>
                )}
              </div>

              <div className="bg-stone-800 rounded-2xl p-4 border border-stone-700">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-[10px] text-stone-400 uppercase font-semibold">Args (JSON)</label>
                  <button
                    onClick={fillArgs}
                    disabled={Object.keys(devParams).length === 0}
                    className="text-[10px] text-stone-400 hover:text-stone-200 disabled:opacity-30"
                  >
                    fill template
                  </button>
                </div>
                {devRequired.length > 0 && (
                  <div className="text-[11px] text-amber-400 mb-2">
                    Required: {devRequired.map(r => <code key={r} className="bg-stone-900 px-1 rounded mr-1">{r}</code>)}
                  </div>
                )}
                <textarea
                  value={argsText}
                  onChange={e => setArgsText(e.target.value)}
                  rows={5}
                  className="w-full bg-stone-900 border border-stone-600 rounded-xl px-3 py-2 text-sm font-mono text-stone-100 focus:outline-none focus:ring-1 focus:ring-sky-500 resize-none"
                />
              </div>

              <button
                onClick={runDeveloper}
                disabled={devRunning}
                className="w-full py-3 rounded-2xl font-bold text-sm bg-sky-500 hover:bg-sky-400 text-white disabled:opacity-50 transition"
              >
                {devRunning ? "กำลังรัน..." : "▶ Run Command"}
              </button>
            </div>

            <div className="bg-stone-800 rounded-2xl p-4 border border-stone-700 flex flex-col">
              <div className="flex items-center justify-between mb-3">
                <div className="text-[10px] text-stone-400 uppercase font-semibold">Output</div>
                {devElapsed !== null && <div className="text-[10px] text-stone-500">{devElapsed} ms</div>}
              </div>
              {devError && (
                <div className="mb-3 text-xs text-rose-400 bg-rose-900/30 rounded-xl px-3 py-2 border border-rose-800">
                  {devError}
                </div>
              )}
              {devResult === null && !devRunning && (
                <div className="flex-1 flex items-center justify-center text-stone-600 text-xs">
                  กด Run เพื่อเห็นผล
                </div>
              )}
              {devResult !== null && (
                <pre className="flex-1 text-[11px] text-stone-300 overflow-auto leading-relaxed whitespace-pre-wrap">
                  {JSON.stringify(devResult, null, 2)}
                </pre>
              )}
            </div>
          </div>
        )}

        {/* Bottom hint */}
        <div className="mt-6 text-[10px] text-stone-600 text-center space-x-4">
          <span>Read-only commands เท่านั้น — write commands ถูกบล็อก (Rule 72)</span>
          <span>·</span>
          <Link href="/examples" className="hover:text-stone-400">ดู Screen Examples</Link>
        </div>
      </div>
    </div>
  )
}
