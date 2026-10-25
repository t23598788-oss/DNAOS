"use client"

/**
 * /admin/api-tokens — จัดการ Token สำหรับ AI ภายนอก
 *
 * ทำได้:
 *  - สร้าง token ใหม่ (ผูกกับ email ของตัวเอง)
 *  - ดู token ที่มีอยู่ + วันที่ใช้งานล่าสุด
 *  - Revoke token
 *
 * Token ที่ได้ → นำไปวางใน X-DNA-Token header แล้ว AI ภายนอกสามารถ query DNA OS ได้
 */

import { useState, useEffect, useCallback } from "react"

interface ApiToken {
  id: string
  user_email: string
  token: string
  label: string
  scopes: string[]
  last_used_at: string | null
  created_at: string
  revoked_at: string | null
}

interface FetchState {
  tokens: ApiToken[]
  loading: boolean
  error: string | null
}

const SPEC_URL = "/api/v1/spec"
const QUERY_URL = "/api/v1/query"

function formatDate(iso: string | null) {
  if (!iso) return "—"
  return new Date(iso).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" })
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <button
      onClick={copy}
      className="text-[10px] px-2 py-0.5 rounded bg-stone-100 hover:bg-stone-200 text-stone-500 transition"
    >
      {copied ? "copied" : "copy"}
    </button>
  )
}

export default function ApiTokensPage() {
  const [state, setState] = useState<FetchState>({ tokens: [], loading: true, error: null })
  const [newLabel, setNewLabel] = useState("")
  const [creating, setCreating] = useState(false)
  const [revoking, setRevoking] = useState<string | null>(null)
  const [justCreated, setJustCreated] = useState<ApiToken | null>(null)

  const load = useCallback(async () => {
    setState(s => ({ ...s, loading: true, error: null }))
    try {
      const res = await fetch("/api/admin/api-tokens")
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
      setState({ tokens: json.tokens ?? [], loading: false, error: null })
    } catch (e) {
      setState(s => ({ ...s, loading: false, error: String(e) }))
    }
  }, [])

  useEffect(() => { load() }, [load])

  const createToken = async () => {
    if (!newLabel.trim()) return
    setCreating(true)
    try {
      const res = await fetch("/api/admin/api-tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: newLabel.trim() }),
      })
      if (!res.ok) throw new Error(`${res.status}`)
      const json = await res.json()
      setJustCreated(json.token)
      setNewLabel("")
      await load()
    } catch (e) {
      alert("สร้าง token ไม่สำเร็จ: " + String(e))
    } finally {
      setCreating(false)
    }
  }

  const revokeToken = async (id: string) => {
    if (!confirm("ยืนยัน: revoke token นี้? AI ที่ใช้ token นี้อยู่จะไม่สามารถ query ได้อีก")) return
    setRevoking(id)
    try {
      const res = await fetch(`/api/admin/api-tokens/${id}`, { method: "DELETE" })
      if (!res.ok) throw new Error(`${res.status}`)
      setJustCreated(prev => prev?.id === id ? null : prev)
      await load()
    } catch (e) {
      alert("Revoke ไม่สำเร็จ: " + String(e))
    } finally {
      setRevoking(null)
    }
  }

  return (
    <div className="max-w-3xl mx-auto px-6 py-8 space-y-8">

      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-stone-900">API Tokens</h1>
        <p className="text-xs text-stone-500 mt-1">
          ท่อเชื่อม DNA OS กับ AI ภายนอก — Gemini, ChatGPT, Claude หรือ app อื่นใด
        </p>
      </div>

      {/* How it works */}
      <div className="bg-sky-50 border border-sky-200 rounded-2xl p-5 space-y-3">
        <div className="font-bold text-sky-800 text-sm">วิธีใช้ท่อ (External AI Pipe)</div>
        <ol className="text-xs text-sky-700 space-y-1.5 list-none">
          <li><span className="font-bold">1.</span> สร้าง Token ด้านล่าง (ผูกกับอีเมลของท่าน)</li>
          <li><span className="font-bold">2.</span> ดึง tool spec ของระบบก่อน เพื่อให้รู้โครงสร้างระบบ: <code className="bg-sky-100 px-1 rounded">GET {SPEC_URL}</code> — ได้รายการ command ทั้งหมด</li>
          <li><span className="font-bold">3.</span> ดูความสามารถที่เปิดให้ใช้ได้: <code className="bg-sky-100 px-1 rounded">GET /api/v1/capabilities</code></li>
          <li><span className="font-bold">4.</span> AI เรียก command: <code className="bg-sky-100 px-1 rounded">POST {QUERY_URL}</code> พร้อม header <code className="bg-sky-100 px-1 rounded">X-DNA-Token: &lt;token&gt;</code></li>
        </ol>
        <div className="border-t border-sky-200 pt-3 space-y-2">
          <div className="text-[10px] font-semibold text-sky-700 uppercase">ตัวอย่าง request</div>
          <pre className="text-[10px] bg-sky-100 rounded-xl p-3 overflow-x-auto text-sky-900 leading-relaxed">{`POST /api/v1/query
X-DNA-Token: <your-token>
Content-Type: application/json

{
  "command": "partner.list",
  "args": {}
}

// หรือ OpenAI style:
{
  "command": "partner__timeline",
  "args": { "partner_id": "uuid-..." }
}`}</pre>
        </div>
      </div>

      {/* Create new token */}
      <div className="bg-white border border-stone-200 rounded-2xl p-5">
        <div className="font-bold text-stone-800 text-sm mb-3">สร้าง Token ใหม่</div>
        <div className="flex gap-2">
          <input
            type="text"
            value={newLabel}
            onChange={e => setNewLabel(e.target.value)}
            onKeyDown={e => e.key === "Enter" && createToken()}
            placeholder="ชื่อ token เช่น 'Gemini Desktop', 'ChatGPT Mobile'"
            className="flex-1 text-sm border border-stone-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-stone-400"
          />
          <button
            onClick={createToken}
            disabled={creating || !newLabel.trim()}
            className="px-4 py-2 rounded-xl text-sm font-semibold bg-stone-900 text-white hover:bg-stone-800 disabled:opacity-40 transition"
          >
            {creating ? "กำลังสร้าง..." : "+ สร้าง Token"}
          </button>
        </div>

        {/* Show newly created token — only shown once */}
        {justCreated && (
          <div className="mt-4 border border-emerald-200 bg-emerald-50 rounded-xl p-4">
            <div className="text-xs font-bold text-emerald-800 mb-2">Token สร้างสำเร็จ — คัดลอกและเก็บไว้ (จะไม่แสดงอีก)</div>
            <div className="flex items-center gap-2 bg-white rounded-lg px-3 py-2 border border-emerald-200">
              <code className="text-xs font-mono text-stone-800 flex-1 break-all">{justCreated.token}</code>
              <CopyButton text={justCreated.token} />
            </div>
            <div className="text-[10px] text-emerald-700 mt-2">Label: {justCreated.label} · Scopes: {justCreated.scopes.join(", ")}</div>
          </div>
        )}
      </div>

      {/* Token list */}
      <div className="bg-white border border-stone-200 rounded-2xl p-5">
        <div className="font-bold text-stone-800 text-sm mb-3">
          Token ที่มีอยู่ ({state.tokens.length})
        </div>

        {state.loading && (
          <div className="text-xs text-stone-400 py-4 text-center">กำลังโหลด...</div>
        )}
        {state.error && (
          <div className="text-xs text-rose-500 py-2">Error: {state.error}</div>
        )}

        {!state.loading && state.tokens.length === 0 && (
          <div className="text-xs text-stone-400 py-4 text-center">ยังไม่มี token — สร้างด้านบน</div>
        )}

        <div className="space-y-3">
          {state.tokens.map(t => (
            <div key={t.id} className="border border-stone-100 rounded-xl p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm text-stone-800 truncate">{t.label}</span>
                    {t.scopes.map(s => (
                      <span key={s} className="text-[10px] bg-sky-100 text-sky-700 px-2 py-0.5 rounded-full font-semibold">{s}</span>
                    ))}
                  </div>
                  <div className="flex items-center gap-2 mt-1.5">
                    <code className="text-[10px] font-mono text-stone-400 truncate">
                      {t.token.slice(0, 8)}...{t.token.slice(-4)}
                    </code>
                    <CopyButton text={t.token} />
                  </div>
                  <div className="text-[10px] text-stone-400 mt-1.5 space-x-3">
                    <span>สร้าง: {formatDate(t.created_at)}</span>
                    <span>ใช้ล่าสุด: {formatDate(t.last_used_at)}</span>
                  </div>
                </div>
                <button
                  onClick={() => revokeToken(t.id)}
                  disabled={revoking === t.id}
                  className="text-xs px-3 py-1.5 rounded-lg border border-rose-200 text-rose-600 hover:bg-rose-50 disabled:opacity-40 transition shrink-0"
                >
                  {revoking === t.id ? "..." : "Revoke"}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

    </div>
  )
}
