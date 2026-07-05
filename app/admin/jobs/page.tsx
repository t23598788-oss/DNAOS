'use client'

import { useEffect, useState } from "react"
import Link from "next/link"
import { TX_TYPE_LABELS, type TxType } from "@/lib/transactions/workflows"

interface Job {
  id: string
  tx_type: string
  state: string
  title: string | null
  project_name: string | null
  net_amount: number | null
  created_at: string
  state_changed_at: string
  partners: { id: string; name: string } | null
}

function fmtMoney(n: number) {
  return n.toLocaleString("th-TH", { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString("th-TH", { month: "short", day: "numeric", year: "numeric" })
}

const STATE_COLOR: Record<string, string> = {
  draft:         "bg-stone-100 text-stone-500",
  confirmed:     "bg-blue-100 text-blue-700",
  started:       "bg-indigo-100 text-indigo-700",
  in_progress:   "bg-violet-100 text-violet-700",
  delivered:     "bg-amber-100 text-amber-700",
  completed:     "bg-teal-100 text-teal-700",
  invoiced:      "bg-orange-100 text-orange-700",
  paid:          "bg-emerald-100 text-emerald-700",
  closed:        "bg-stone-200 text-stone-500",
}

const TX_COLOR: Record<string, string> = {
  sale:       "bg-blue-500",
  purchase:   "bg-green-500",
  contract:   "bg-violet-500",
  service:    "bg-sky-500",
  rental:     "bg-amber-500",
  transport:  "bg-orange-500",
}

const TX_TYPES: (TxType | "all")[] = ["all", "sale", "purchase", "contract", "service", "rental", "transport"]

export default function JobsPage() {
  const [jobs, setJobs] = useState<Job[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<TxType | "all">("all")
  const [search, setSearch] = useState("")

  useEffect(() => {
    fetch("/api/admin/transactions")
      .then((r) => r.json())
      .then((d) => setJobs(d.transactions ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const filtered = jobs
    .filter((j) => filter === "all" || j.tx_type === filter)
    .filter((j) => {
      if (!search) return true
      const q = search.toLowerCase()
      return (
        (j.title ?? "").toLowerCase().includes(q) ||
        (j.project_name ?? "").toLowerCase().includes(q) ||
        (j.partners?.name ?? "").toLowerCase().includes(q)
      )
    })

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-stone-50">
      {/* Header */}
      <div className="shrink-0 bg-white border-b border-stone-200 px-6 py-4 flex items-center gap-3">
        <div>
          <div className="text-base font-bold text-stone-800">งานทั้งหมด</div>
          <div className="text-xs text-stone-400">ทุก Job / Transaction ในระบบ</div>
        </div>
        <div className="flex-1" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="ค้นหา..."
          className="text-xs border border-stone-200 rounded-xl px-3 py-2 w-48 focus:outline-none focus:border-stone-400 bg-stone-50"
        />
        <Link
          href="/admin/jobs/create"
          className="text-xs font-semibold px-4 py-2 rounded-xl bg-stone-900 text-white hover:bg-stone-800 transition whitespace-nowrap"
        >
          + สร้างงานใหม่
        </Link>
      </div>

      {/* Filter bar */}
      <div className="shrink-0 bg-white border-b border-stone-100 px-6 py-2 flex items-center gap-1.5 flex-wrap">
        {TX_TYPES.map((t) => (
          <button
            key={t}
            onClick={() => setFilter(t)}
            className={`text-[10px] font-semibold px-2.5 py-1 rounded-full transition border ${
              filter === t
                ? "bg-stone-900 text-white border-stone-900"
                : "bg-white text-stone-500 border-stone-200 hover:border-stone-400"
            }`}
          >
            {t === "all" ? "ทั้งหมด" : TX_TYPE_LABELS[t]}
          </button>
        ))}
        <span className="ml-auto text-[10px] text-stone-400">{filtered.length} งาน</span>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-40 text-sm text-stone-400 animate-pulse">กำลังโหลด...</div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 gap-3">
            <div className="text-sm text-stone-400">ยังไม่มีงาน</div>
            <Link href="/admin/jobs/create" className="text-xs font-semibold text-indigo-600 hover:underline">
              + สร้างงานแรก
            </Link>
          </div>
        ) : (
          <div className="divide-y divide-stone-100">
            {filtered.map((job) => {
              const stateCls = STATE_COLOR[job.state] ?? "bg-stone-100 text-stone-500"
              const txDot = TX_COLOR[job.tx_type] ?? "bg-stone-400"

              return (
                <Link
                  key={job.id}
                  href={`/admin/jobs/${job.id}`}
                  className="flex items-center gap-4 px-6 py-3.5 hover:bg-stone-50 transition group"
                >
                  <span className={`w-2 h-2 rounded-full shrink-0 ${txDot}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-stone-400 shrink-0">
                        {TX_TYPE_LABELS[job.tx_type as TxType] ?? job.tx_type}
                      </span>
                      <span className="text-sm font-semibold text-stone-800 truncate">
                        {job.title ?? job.project_name ?? "ไม่มีชื่อ"}
                      </span>
                    </div>
                    {job.partners && (
                      <div className="text-xs text-stone-400 mt-0.5 truncate">{job.partners.name}</div>
                    )}
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {job.net_amount != null && job.net_amount > 0 && (
                      <span className="text-xs text-stone-600 tabular-nums">฿{fmtMoney(job.net_amount)}</span>
                    )}
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${stateCls}`}>
                      {job.state}
                    </span>
                    <span className="text-[10px] text-stone-400 w-20 text-right">{fmtDate(job.created_at)}</span>
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
