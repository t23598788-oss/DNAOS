"use client"

/**
 * /playground — Live API Tester
 *
 * ทดลองเรียก command ผ่านเบราว์เซอร์
 * ใส่ token + เลือก command + กด Run → เห็นผลจริงทันที
 */

import { useState, useEffect } from "react"
import Link from "next/link"

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

export default function PlaygroundPage() {
  const [token, setToken] = useState("")
  const [specs, setSpecs] = useState<CommandSpec[]>([])
  const [loadingSpec, setLoadingSpec] = useState(true)
  const [selectedCommand, setSelectedCommand] = useState("")
  const [argsText, setArgsText] = useState("{}")
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<unknown>(null)
  const [error, setError] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState<number | null>(null)

  useEffect(() => {
    fetch("/api/v1/spec")
      .then(r => r.json())
      .then(d => {
        setSpecs(d.tools ?? [])
        if (d.tools?.[0]) setSelectedCommand(d.tools[0].function._dna_command)
      })
      .finally(() => setLoadingSpec(false))
  }, [])

  const currentSpec = specs.find(s => s.function._dna_command === selectedCommand)
  const params = currentSpec?.function.parameters.properties ?? {}
  const required = currentSpec?.function.parameters.required ?? []

  const run = async () => {
    if (!token.trim()) { setError("ใส่ token ก่อน — ดูได้ที่ /admin/api-tokens"); return }
    if (!selectedCommand) { setError("เลือก command ก่อน"); return }

    let args: Record<string, unknown>
    try {
      args = JSON.parse(argsText)
    } catch {
      setError("args ต้องเป็น JSON ที่ถูกต้อง"); return
    }

    setRunning(true)
    setError(null)
    setResult(null)
    setElapsed(null)
    const t0 = Date.now()

    try {
      const res = await fetch("/api/v1/query", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-DNA-Token": token.trim() },
        body: JSON.stringify({ command: selectedCommand, args }),
      })
      const json = await res.json()
      setElapsed(Date.now() - t0)
      if (!res.ok || !json.ok) {
        setError(json.error ?? json.hint ?? `HTTP ${res.status}`)
        setResult(json)
      } else {
        setResult(json)
      }
    } catch (e) {
      setError(String(e))
    } finally {
      setRunning(false)
    }
  }

  const fillArgs = () => {
    if (!currentSpec) return
    const defaults: Record<string, string> = {}
    for (const [key, p] of Object.entries(params)) {
      defaults[key] = p.type === "number" ? "0" : `<${key}>`
    }
    setArgsText(JSON.stringify(defaults, null, 2))
  }

  return (
    <div className="min-h-screen bg-stone-900 text-stone-100 font-mono">
      <div className="max-w-5xl mx-auto px-6 py-8">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="text-[10px] text-stone-500 mb-1">
              <Link href="/start" className="hover:text-stone-300">Developer Portal</Link>
              {" · "}
              <Link href="/examples" className="hover:text-stone-300">Examples</Link>
            </div>
            <h1 className="text-lg font-bold">DNA OS Playground</h1>
            <p className="text-xs text-stone-400 mt-0.5">ทดลองเรียก command ด้วย token ของท่าน</p>
          </div>
          <a
            href="/api/v1/spec"
            target="_blank"
            className="text-xs text-stone-400 hover:text-stone-200 border border-stone-700 px-3 py-1.5 rounded-lg"
          >
            API Spec ↗
          </a>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

          {/* ── Left: Input ── */}
          <div className="space-y-4">

            {/* Token */}
            <div className="bg-stone-800 rounded-2xl p-4 border border-stone-700">
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

            {/* Command selector */}
            <div className="bg-stone-800 rounded-2xl p-4 border border-stone-700">
              <label className="text-[10px] text-stone-400 uppercase font-semibold block mb-2">Command</label>
              {loadingSpec ? (
                <div className="text-xs text-stone-500">กำลังโหลด spec...</div>
              ) : (
                <select
                  value={selectedCommand}
                  onChange={e => { setSelectedCommand(e.target.value); setArgsText("{}"); setResult(null); setError(null) }}
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

            {/* Args */}
            <div className="bg-stone-800 rounded-2xl p-4 border border-stone-700">
              <div className="flex items-center justify-between mb-2">
                <label className="text-[10px] text-stone-400 uppercase font-semibold">Args (JSON)</label>
                <button
                  onClick={fillArgs}
                  disabled={Object.keys(params).length === 0}
                  className="text-[10px] text-stone-400 hover:text-stone-200 disabled:opacity-30"
                >
                  fill template
                </button>
              </div>

              {/* Required fields hint */}
              {required.length > 0 && (
                <div className="text-[11px] text-amber-400 mb-2">
                  Required: {required.map(r => <code key={r} className="bg-stone-900 px-1 rounded mr-1">{r}</code>)}
                </div>
              )}

              <textarea
                value={argsText}
                onChange={e => setArgsText(e.target.value)}
                rows={5}
                className="w-full bg-stone-900 border border-stone-600 rounded-xl px-3 py-2 text-sm font-mono text-stone-100 focus:outline-none focus:ring-1 focus:ring-sky-500 resize-none"
              />
            </div>

            {/* Run button */}
            <button
              onClick={run}
              disabled={running}
              className="w-full py-3 rounded-2xl font-bold text-sm bg-sky-500 hover:bg-sky-400 text-white disabled:opacity-50 transition"
            >
              {running ? "กำลังรัน..." : "▶ Run Command"}
            </button>
          </div>

          {/* ── Right: Output ── */}
          <div className="bg-stone-800 rounded-2xl p-4 border border-stone-700 flex flex-col">
            <div className="flex items-center justify-between mb-3">
              <div className="text-[10px] text-stone-400 uppercase font-semibold">Output</div>
              {elapsed !== null && (
                <div className="text-[10px] text-stone-500">{elapsed} ms</div>
              )}
            </div>

            {error && (
              <div className="mb-3 text-xs text-rose-400 bg-rose-900/30 rounded-xl px-3 py-2 border border-rose-800">
                {error}
              </div>
            )}

            {result === null && !running && (
              <div className="flex-1 flex items-center justify-center text-stone-600 text-xs">
                กด Run เพื่อเห็นผล
              </div>
            )}

            {result !== null && (
              <pre className="flex-1 text-[11px] text-stone-300 overflow-auto leading-relaxed whitespace-pre-wrap">
                {JSON.stringify(result, null, 2)}
              </pre>
            )}
          </div>
        </div>

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
