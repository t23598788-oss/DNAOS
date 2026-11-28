"use client"

import { useEffect, useState } from "react"
import { ChevronDown, ChevronRight, ShieldCheck, ShieldAlert, ShieldX } from "lucide-react"

// Cost/infrastructure dashboard (owner, 2026-08-03): "หน้าจอค่าใช้จ่าย...
// ขึ้นมาแสดงผลในค่าใช้จ่ายและตัวประมวลผลต่างๆ ... ทำงานวิจัยตัววัดค่าต่างๆ"
// Reads registry/infrastructure.json (already real data, Rule 103) via
// /api/admin/infrastructure — no new data source, this is display-only.

type DependencyGraph = {
  modules: string[]
  api_routes: string[]
  edge_functions: string[]
  scheduled_jobs: Array<{ jobname: string; schedule: string; active: boolean }> | "not_refreshed"
}

type HealthCheck = {
  service_key: string
  check_kind: string
  status: string
  last_check_at: string | null
  detail: Record<string, unknown>
}

type Health = {
  status: "active" | "warning" | "critical"
  reasons: string[]
  last_verified_at: string | null
  checks: HealthCheck[]
}

type Service = {
  name: string
  organ?: string
  purpose?: string
  critical?: boolean
  status?: string
  owner?: string
  cost_monthly_thb?: number
  plan?: string
  renew?: string
  expiration?: string
  quota_used_pct?: number
  if_down?: string
  if_removed_saves_thb?: number
  if_removed_loses?: string
  affected_workflows?: string[]
  dependency_graph?: DependencyGraph
  health?: Health
}

function HealthBadge({ health }: { health?: Health }) {
  if (!health) return null
  const map = {
    active: { icon: ShieldCheck, cls: "border-emerald-300 bg-emerald-50 text-emerald-700", label: "Active" },
    warning: { icon: ShieldAlert, cls: "border-amber-300 bg-amber-50 text-amber-700", label: "Warning" },
    critical: { icon: ShieldX, cls: "border-red-300 bg-red-50 text-red-700", label: "Critical" },
  }[health.status]
  const Icon = map.icon
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border ${map.cls}`} title={health.reasons.join(", ")}>
      <Icon size={11} /> {map.label}
    </span>
  )
}

type ResearchMetrics = {
  policy?: string
  financial?: Record<string, number | null>
  intelligence?: Record<string, number | null | unknown>
  hardware?: Record<string, number | null>
  data_source_when_built?: string
}

// Infrastructure Control & Billing Center extension (owner, 2026-08-10,
// DigitalOcean AI Inference Infrastructure Control & Billing Layer) —
// same page, same discipline: every field below is served by
// /api/admin/infrastructure, which merges real, already-built sources
// (providerRegistryRuntime.ts, computeResourceRegistryRuntime.ts,
// costLedgerViewRuntime.ts, usageMeterRuntime.ts) at request time. No new
// page, per the Owner's explicit instruction.

type ProviderWorkerAdapterView = {
  id: string
  type: string
  capabilities: string[]
  availability: { available: boolean; reason: string }
  credentialStatus: "CONFIGURED" | "MISSING" | "INVALID" | "NOT_APPLICABLE"
}

type ProviderRegistryEntry = {
  provider: string
  directoryStatus: string
  purpose: string
  workerAdapters: ProviderWorkerAdapterView[]
  costMonthlyThb: number | null
  infraStatus: string | null
}

type ComputeResource = {
  provider: string
  provider_resource_id: string
  cpu_cores: number | null
  ram_gb: number | null
  gpu: string | null
  vram_gb: number | null
  storage_gb: number | null
  region: string | null
  price_per_hour: number | null
  currency: string | null
  runtime_status: string
  health: string
  current_workload: string | null
}

type CostLedgerEntryWithMargin = {
  entryId: string
  provider: string
  model: string | null
  timestamp: string
  providerCost: number | null
  currency: string
  providerCostThb: number | null
  customerChargeThb: number | null
  grossMarginThb: number | null
}

type ProviderPayable = {
  provider: string
  entryCount: number
  totalOwed: Record<string, number>
  paymentStatus: "OWED_NOT_PAID"
}

type UsageWithCost = {
  requestId: string
  provider: string
  service: string
  model: string | null
  adapterId: string
  inputTokens: number | null
  outputTokens: number | null
  totalTokens: number | null
  tokenSource: "PROVIDER_REPORTED" | "UNKNOWN"
  tokenUnknownReason: string | null
  latencyMs: number
  status: string
  error: string | null
  startedAt: string
  completedAt: string
  providerCost: number | null
  currency: string | null
  providerCostThb: number | null
  costStatus: "ACTUAL" | "NO_COST_RECORDED"
}

type AccumulatedUsageSummary = {
  provider: string
  requestCount: number
  successCount: number
  totalInputTokens: number | null
  totalOutputTokens: number | null
  totalTokens: number | null
  unknownTokenRequestCount: number
  totalProviderCostByCurrency: Record<string, number>
  totalProviderCostThb: number | null
  hasLiveUsage: boolean
}

function credentialBadge(status: ProviderWorkerAdapterView["credentialStatus"]) {
  const map: Record<string, string> = {
    CONFIGURED: "border-emerald-300 bg-emerald-50 text-emerald-700",
    MISSING: "border-amber-300 bg-amber-50 text-amber-700",
    INVALID: "border-red-300 bg-red-50 text-red-700",
    NOT_APPLICABLE: "border-stone-200 bg-stone-50 text-stone-400",
  }
  const label = status === "MISSING" ? "WAITING_FOR_CREDENTIAL" : status
  return <span className={`text-[10px] px-1.5 py-0.5 rounded border ${map[status]}`}>{label}</span>
}

type InfraData = {
  version?: number
  policy?: string
  services?: Record<string, Service>
  backup?: Record<string, unknown>
  future_additions?: unknown[]
  cost_summary?: { monthly_thb?: number; yearly_thb?: number }
  research_metrics?: ResearchMetrics
  providers?: ProviderRegistryEntry[]
  computeResources?: ComputeResource[]
  costLedger?: CostLedgerEntryWithMargin[]
  providerPayables?: ProviderPayable[]
  usage?: UsageWithCost[]
  usageError?: string | null
  accumulatedUsage?: AccumulatedUsageSummary[]
  accumulatedUsageError?: string | null
}

function fmtMetric(v: unknown, unit?: string) {
  if (v === null || v === undefined) return "ยังไม่มีข้อมูลจริง"
  return unit ? `${v} ${unit}` : String(v)
}

function statusColor(status?: string) {
  switch (status) {
    case "active": return "bg-emerald-100 text-emerald-800 border-emerald-300"
    case "pending_credential": return "bg-amber-100 text-amber-800 border-amber-300"
    case "removed": return "bg-stone-100 text-stone-500 border-stone-300"
    case "planned": return "bg-sky-100 text-sky-800 border-sky-300"
    default: return "bg-stone-100 text-stone-700 border-stone-300"
  }
}

type SubscriptionService = {
  id: string
  provider: string
  service_name: string
  category: string | null
  amount: number | null
  currency: string
  billing_cycle: string | null
  status: string
  auto_renew: boolean | null
  confidence: string
  raw_subject: string | null
}

export default function InfrastructurePage() {
  const [data, setData] = useState<InfraData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [subs, setSubs] = useState<SubscriptionService[] | null>(null)
  const [subsError, setSubsError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  useEffect(() => {
    fetch("/api/admin/infrastructure")
      .then(async (r) => {
        if (!r.ok) throw new Error(await r.text())
        return r.json()
      })
      .then(setData)
      .catch((e) => setError(e.message ?? "โหลดข้อมูลไม่สำเร็จ"))

    fetch("/api/admin/subscriptions")
      .then(async (r) => {
        if (!r.ok) throw new Error(await r.text())
        return r.json()
      })
      .then((d) => setSubs(d.services ?? []))
      .catch((e) => setSubsError(e.message ?? "โหลดข้อมูลไม่สำเร็จ"))
  }, [])

  if (error) {
    return <div className="p-6 text-red-700">โหลดข้อมูลค่าใช้จ่ายไม่สำเร็จ: {error}</div>
  }
  if (!data) {
    return <div className="p-6 text-stone-500">กำลังโหลด...</div>
  }

  const services = Object.entries(data.services ?? {})
  const activeCount = services.filter(([, s]) => s.status === "active").length
  const monthly = data.cost_summary?.monthly_thb ?? 0
  const yearly = data.cost_summary?.yearly_thb ?? 0

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-2xl font-semibold text-stone-900">ค่าใช้จ่ายระบบ / โครงสร้างพื้นฐาน</h1>
        <p className="text-sm text-stone-500 mt-1">
          บริการภายนอกทั้งหมดที่ DNA OS พึ่งพา — อ่านจาก registry/infrastructure.json
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-xl border border-stone-200 bg-white p-4">
          <div className="text-xs text-stone-500">ค่าใช้จ่ายต่อเดือน</div>
          <div className="text-2xl font-semibold text-stone-900 tabular-nums">
            {monthly.toLocaleString("th-TH")} บาท
          </div>
        </div>
        <div className="rounded-xl border border-stone-200 bg-white p-4">
          <div className="text-xs text-stone-500">ค่าใช้จ่ายต่อปี</div>
          <div className="text-2xl font-semibold text-stone-900 tabular-nums">
            {yearly.toLocaleString("th-TH")} บาท
          </div>
        </div>
        <div className="rounded-xl border border-stone-200 bg-white p-4">
          <div className="text-xs text-stone-500">บริการที่ใช้งานอยู่</div>
          <div className="text-2xl font-semibold text-stone-900 tabular-nums">
            {activeCount} / {services.length}
          </div>
        </div>
      </div>

      <div className="space-y-3">
        {services.map(([key, s]) => {
          const isOpen = expanded.has(key)
          const dg = s.dependency_graph
          const hasGraph = dg && (dg.modules.length || dg.api_routes.length || dg.edge_functions.length)
          return (
          <div key={key} className="rounded-xl border border-stone-200 bg-white p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-stone-900">{s.name ?? key}</span>
                  {s.critical && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded border border-red-300 bg-red-50 text-red-700">
                      สำคัญ
                    </span>
                  )}
                  <span className={`text-[10px] px-1.5 py-0.5 rounded border ${statusColor(s.status)}`}>
                    {s.status ?? "unknown"}
                  </span>
                  <HealthBadge health={s.health} />
                </div>
                {s.purpose && <div className="text-sm text-stone-600 mt-1">{s.purpose}</div>}
                {s.organ && <div className="text-xs text-stone-400 mt-1">ทำหน้าที่: {s.organ}</div>}
              </div>
              <div className="text-right shrink-0">
                <div className="text-sm font-medium text-stone-900 tabular-nums">
                  {(s.cost_monthly_thb ?? 0).toLocaleString("th-TH")} บาท/เดือน
                </div>
                {s.plan && <div className="text-xs text-stone-400">{s.plan}</div>}
              </div>
            </div>

            {typeof s.quota_used_pct === "number" && (
              <div className="mt-3">
                <div className="flex items-center justify-between text-xs text-stone-500 mb-1">
                  <span>โควต้าใช้ไป</span>
                  <span className="tabular-nums">{s.quota_used_pct}%</span>
                </div>
                <div className="h-1.5 rounded-full bg-stone-100 overflow-hidden">
                  <div
                    className={`h-full rounded-full ${s.quota_used_pct >= 80 ? "bg-red-500" : s.quota_used_pct >= 50 ? "bg-amber-500" : "bg-emerald-500"}`}
                    style={{ width: `${Math.min(100, s.quota_used_pct)}%` }}
                  />
                </div>
              </div>
            )}

            {s.if_down && (
              <div className="mt-3 text-xs text-stone-500">
                <span className="text-stone-400">ถ้าล่ม:</span> {s.if_down}
              </div>
            )}

            {hasGraph && (
              <button
                onClick={() => setExpanded((prev) => {
                  const next = new Set(prev)
                  if (next.has(key)) next.delete(key); else next.add(key)
                  return next
                })}
                className="mt-3 flex items-center gap-1 text-xs text-stone-500 hover:text-stone-800"
              >
                {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                Dependency Graph &amp; Impact Analysis
                {dg && (dg.modules.length + dg.api_routes.length + dg.edge_functions.length) > 0 && (
                  <span className="text-stone-400">({dg.modules.length + dg.api_routes.length + dg.edge_functions.length} รายการ)</span>
                )}
              </button>
            )}

            {isOpen && dg && (
              <div className="mt-2 rounded-lg bg-stone-50 border border-stone-100 p-3 text-xs space-y-3">
                <div className="text-stone-600">
                  <span className="font-medium">ถ้าบริการนี้หายไป จะกระทบ:</span>{" "}
                  {dg.modules.length} module, {dg.api_routes.length} API route, {dg.edge_functions.length} scheduled/edge function
                  {Array.isArray(s.affected_workflows) && s.affected_workflows.length > 0 && (
                    <> และ workflow: {s.affected_workflows.join(", ")}</>
                  )}
                </div>
                {dg.modules.length > 0 && (
                  <div>
                    <div className="text-stone-400 mb-1">Runtime modules ({dg.modules.length})</div>
                    <div className="flex flex-wrap gap-1">
                      {dg.modules.map((m) => <code key={m} className="bg-white border border-stone-200 rounded px-1 py-0.5 text-[10px]">{m}</code>)}
                    </div>
                  </div>
                )}
                {dg.api_routes.length > 0 && (
                  <div>
                    <div className="text-stone-400 mb-1">API routes ({dg.api_routes.length})</div>
                    <div className="flex flex-wrap gap-1">
                      {dg.api_routes.map((m) => <code key={m} className="bg-white border border-stone-200 rounded px-1 py-0.5 text-[10px]">{m}</code>)}
                    </div>
                  </div>
                )}
                {dg.edge_functions.length > 0 && (
                  <div>
                    <div className="text-stone-400 mb-1">Edge functions ({dg.edge_functions.length})</div>
                    <div className="flex flex-wrap gap-1">
                      {dg.edge_functions.map((m) => <code key={m} className="bg-white border border-stone-200 rounded px-1 py-0.5 text-[10px]">{m}</code>)}
                    </div>
                  </div>
                )}
                {Array.isArray(dg.scheduled_jobs) && dg.scheduled_jobs.length > 0 && (
                  <div>
                    <div className="text-stone-400 mb-1">Scheduled jobs (จาก pg_cron จริง)</div>
                    <div className="space-y-1">
                      {dg.scheduled_jobs.map((j) => (
                        <div key={j.jobname} className="flex items-center justify-between bg-white border border-stone-200 rounded px-2 py-1">
                          <code className="text-[10px]">{j.jobname}</code>
                          <span className="text-[10px] text-stone-400">{j.schedule}{!j.active && " · ปิดอยู่"}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {s.health && s.health.checks.length > 0 && (
                  <div>
                    <div className="text-stone-400 mb-1">Runtime verification ล่าสุด</div>
                    <div className="space-y-1">
                      {s.health.checks.map((c) => (
                        <div key={c.service_key} className="flex items-center justify-between bg-white border border-stone-200 rounded px-2 py-1">
                          <span className="text-[10px]">{c.service_key} · {c.check_kind}</span>
                          <span className={`text-[10px] ${c.status === "healthy" ? "text-emerald-600" : "text-red-600"}`}>
                            {c.status}{c.last_check_at ? ` · ${new Date(c.last_check_at).toLocaleTimeString("th-TH")}` : ""}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
          )
        })}
      </div>

      <div className="rounded-xl border border-stone-200 bg-white p-4">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-sm font-semibold text-stone-900">บริการที่ระบบตรวจจับเองจากอีเมล</h2>
          <span className="text-[10px] px-1.5 py-0.5 rounded border border-emerald-300 bg-emerald-50 text-emerald-700">observer</span>
        </div>
        <p className="text-xs text-stone-500 mb-3">
          ระบบไล่อ่านอีเมลใบเสร็จ/แจ้งต่ออายุอัตโนมัติเอง (Gmail, ทุก 5 นาที) ไม่ต้องเฮียไล่เช็คเอง — รายการ confidence &quot;low&quot; คือรูปแบบที่ระบบไม่แน่ใจ ควรตรวจด้วยตา
        </p>
        {subsError && <div className="text-xs text-red-600">โหลดไม่สำเร็จ: {subsError}</div>}
        {!subsError && !subs && <div className="text-xs text-stone-400">กำลังโหลด...</div>}
        {subs && subs.length === 0 && (
          <div className="text-xs text-stone-400">ยังไม่พบรายการ — ตัวจับอีเมลยังไม่เคยรันหรือยังไม่เจออีเมลที่ตรงเงื่อนไข</div>
        )}
        {subs && subs.length > 0 && (
          <div className="space-y-2">
            {subs.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-3 rounded-lg border border-stone-100 bg-stone-50 px-3 py-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-stone-900 truncate">{s.service_name}</span>
                    <span className="text-[9px] px-1 py-0.5 rounded border border-stone-300 text-stone-500">{s.provider}</span>
                    {s.confidence === "low" && (
                      <span className="text-[9px] px-1 py-0.5 rounded border border-amber-300 bg-amber-50 text-amber-700">ต้องตรวจสอบ</span>
                    )}
                  </div>
                  {s.raw_subject && <div className="text-[11px] text-stone-400 truncate mt-0.5">{s.raw_subject}</div>}
                </div>
                <div className="text-right shrink-0">
                  <div className="text-sm font-medium text-stone-900 tabular-nums">
                    {s.amount !== null ? `${s.amount.toLocaleString("th-TH")} ${s.currency}` : "ไม่ทราบยอด"}
                  </div>
                  <div className="text-[10px] text-stone-400">
                    {s.billing_cycle === "monthly" ? "รายเดือน" : s.billing_cycle === "yearly" ? "รายปี" : s.billing_cycle === "usage" ? "ตามการใช้งาน" : "ไม่ทราบรอบบิล"}
                    {s.auto_renew === true && " · ต่ออายุอัตโนมัติ"}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-stone-200 bg-white p-4">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-sm font-semibold text-stone-900">งานวิจัยตัววัดค่า (Cloud GPU — ยังไม่ได้สมัคร)</h2>
          <span className="text-[10px] px-1.5 py-0.5 rounded border border-sky-300 bg-sky-50 text-sky-700">planned</span>
        </div>
        <p className="text-xs text-stone-500 mb-4">
          พารามิเตอร์ที่ขอไว้ — แสดงเป็น &quot;ยังไม่มีข้อมูลจริง&quot; ตรงๆ จนกว่าจะสมัคร Cloud GPU และต่อ telemetry จริง จะไม่ใส่ตัวเลขสมมติ
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
          <div>
            <div className="text-xs font-medium text-stone-700 mb-2">การเงิน</div>
            <ul className="space-y-1 text-stone-500">
              <li>Real-time Spent: {fmtMetric(data.research_metrics?.financial?.realtime_spent_thb, "บาท")}</li>
              <li>Cost/Task เฉลี่ย: {fmtMetric(data.research_metrics?.financial?.cost_per_task_thb, "บาท")}</li>
              <li>เปิดค้าง 24 ชม.: {fmtMetric(data.research_metrics?.financial?.always_on_projection_thb_per_month, "บาท/เดือน")}</li>
              <li>Dynamic Trigger จริง: {fmtMetric(data.research_metrics?.financial?.dynamic_trigger_actual_thb_per_month, "บาท/เดือน")}</li>
              <li>ประหยัดได้: {fmtMetric(data.research_metrics?.financial?.savings_pct, "%")}</li>
            </ul>
          </div>
          <div>
            <div className="text-xs font-medium text-stone-700 mb-2">ความฉลาด</div>
            <ul className="space-y-1 text-stone-500">
              <li>Accuracy Rate: {fmtMetric(data.research_metrics?.intelligence?.accuracy_rate_pct_by_model)}</li>
              <li>Hallucination/Refuse Rate: {fmtMetric(data.research_metrics?.intelligence?.hallucination_refuse_rate_pct, "%")}</li>
              <li>Latency: {fmtMetric(data.research_metrics?.intelligence?.latency_ms, "ms")}</li>
            </ul>
          </div>
          <div>
            <div className="text-xs font-medium text-stone-700 mb-2">ฮาร์ดแวร์</div>
            <ul className="space-y-1 text-stone-500">
              <li>VRAM Usage: {fmtMetric(data.research_metrics?.hardware?.vram_usage_mb, "MB")}</li>
              <li>RAM Usage: {fmtMetric(data.research_metrics?.hardware?.ram_usage_mb, "MB")}</li>
              <li>Tokens/Second: {fmtMetric(data.research_metrics?.hardware?.tokens_per_second, "tok/s")}</li>
            </ul>
          </div>
        </div>

        {data.research_metrics?.data_source_when_built && (
          <div className="mt-4 text-xs text-stone-400 border-t border-stone-100 pt-3">
            {data.research_metrics.data_source_when_built}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-stone-200 bg-white p-4">
        <h2 className="text-lg font-semibold text-stone-900">Infrastructure Control & Billing Center</h2>
        <p className="text-xs text-stone-500 mt-1">Provider Registry, Compute Resources, Cost Ledger, Usage Meter — DigitalOcean AI Inference, 2026-08-10</p>

        <div className="mt-4">
          <div className="text-sm font-medium text-stone-700 mb-2">Providers</div>
          <div className="space-y-2">
            {(data.providers ?? []).map((p) => (
              <div key={p.provider} className="border border-stone-100 rounded-lg p-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-stone-900">{p.provider}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded border border-stone-200 bg-stone-50 text-stone-500">{p.directoryStatus}</span>
                    {typeof p.costMonthlyThb === "number" && <span className="text-[10px] text-stone-400">{p.costMonthlyThb.toLocaleString("th-TH")} บาท/เดือน</span>}
                  </div>
                </div>
                <div className="text-xs text-stone-500 mt-1">{p.purpose}</div>
                {p.workerAdapters.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {p.workerAdapters.map((a) => (
                      <div key={a.id} className="flex items-center gap-2 text-xs">
                        <span className="text-stone-600">{a.id}</span>
                        <span className="text-stone-400">{a.capabilities.join(", ")}</span>
                        {credentialBadge(a.credentialStatus)}
                        <span className="text-stone-400">{a.availability.reason}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="mt-5">
          <div className="text-sm font-medium text-stone-700 mb-2">Compute Resources</div>
          {(data.computeResources ?? []).length === 0 ? (
            <div className="text-xs text-stone-400">ยังไม่มี Compute Resource จริงลงทะเบียน — ไม่มีการ query สด RunPod/DigitalOcean รอบนี้</div>
          ) : (
            <div className="space-y-2">
              {(data.computeResources ?? []).map((r) => (
                <div key={`${r.provider}-${r.provider_resource_id}`} className="text-xs border border-stone-100 rounded-lg p-2 flex flex-wrap gap-3">
                  <span className="font-medium text-stone-800">{r.provider}/{r.provider_resource_id}</span>
                  <span className="text-stone-500">{r.gpu ?? "no GPU"} {r.vram_gb ? `(${r.vram_gb}GB VRAM)` : ""}</span>
                  <span className="text-stone-500">{r.cpu_cores ?? "?"} vCPU / {r.ram_gb ?? "?"}GB RAM</span>
                  <span className="text-stone-500">{r.region ?? "?"}</span>
                  <span className="text-stone-500">{r.price_per_hour != null ? `${r.price_per_hour} ${r.currency}/hr` : "?"}</span>
                  <span className="text-stone-500">{r.runtime_status} / {r.health}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="mt-5">
          <div className="text-sm font-medium text-stone-700 mb-2">Provider Payable (ยอดที่ต้องจ่าย — ยังไม่มีการชำระอัตโนมัติ)</div>
          {(data.providerPayables ?? []).length === 0 ? (
            <div className="text-xs text-stone-400">ยังไม่มีรายการต้นทุนจริงในบัญชี</div>
          ) : (
            <div className="space-y-1">
              {(data.providerPayables ?? []).map((pp) => (
                <div key={pp.provider} className="text-xs flex flex-wrap gap-3 items-center">
                  <span className="font-medium text-stone-800">{pp.provider}</span>
                  <span className="text-stone-500">{Object.entries(pp.totalOwed).map(([cur, amt]) => `${amt.toFixed(4)} ${cur}`).join(", ")}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded border border-amber-300 bg-amber-50 text-amber-700">{pp.paymentStatus}</span>
                  <span className="text-stone-400">({pp.entryCount} รายการ)</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="mt-5">
          <div className="text-sm font-medium text-stone-700 mb-2">Accumulated Usage (สะสม ต่อ provider)</div>
          {data.accumulatedUsageError && <div className="text-xs text-amber-700 mb-2">{data.accumulatedUsageError}</div>}
          {(data.accumulatedUsage ?? []).filter((s) => s.hasLiveUsage).length === 0 ? (
            <div className="text-[10px] px-1.5 py-0.5 rounded border border-stone-200 bg-stone-50 text-stone-500 inline-block">NO_LIVE_USAGE</div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {(data.accumulatedUsage ?? []).filter((s) => s.hasLiveUsage).map((s) => (
                <div key={s.provider} className="border border-stone-100 rounded-lg p-3 text-xs">
                  <div className="font-medium text-stone-900">{s.provider}</div>
                  <div className="text-stone-500 mt-1">{s.requestCount} requests ({s.successCount} success)</div>
                  <div className="text-stone-500">
                    tokens: {s.totalTokens != null ? s.totalTokens.toLocaleString() : "NO_LIVE_USAGE"}
                    {s.unknownTokenRequestCount > 0 && <span className="text-amber-600"> ({s.unknownTokenRequestCount} request มี token UNKNOWN ไม่ถูกนับรวม)</span>}
                  </div>
                  <div className="text-stone-500">
                    cost: {Object.keys(s.totalProviderCostByCurrency).length > 0
                      ? Object.entries(s.totalProviderCostByCurrency).map(([cur, amt]) => `${amt.toFixed(4)} ${cur}`).join(", ")
                      : "NO_LIVE_USAGE"}
                    {s.totalProviderCostThb != null && <span> (~{s.totalProviderCostThb.toFixed(2)} บาท)</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="mt-5">
          <div className="text-sm font-medium text-stone-700 mb-2">Usage ล่าสุด (request_id / token / latency / cost / THB / status)</div>
          {data.usageError && <div className="text-xs text-amber-700 mb-2">{data.usageError}</div>}
          {(data.usage ?? []).length === 0 ? (
            <div className="text-[10px] px-1.5 py-0.5 rounded border border-stone-200 bg-stone-50 text-stone-500 inline-block">NO_LIVE_USAGE</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="text-xs w-full">
                <thead className="text-stone-400 text-left">
                  <tr>
                    <th className="pr-3">request_id</th><th className="pr-3">provider</th><th className="pr-3">model</th>
                    <th className="pr-3">tokens</th><th className="pr-3">latency</th><th className="pr-3">cost</th><th className="pr-3">THB</th><th className="pr-3">status</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.usage ?? []).map((u) => (
                    <tr key={u.requestId} className="border-t border-stone-100">
                      <td className="pr-3 py-1 text-stone-400 font-mono">{u.requestId.slice(0, 8)}…</td>
                      <td className="pr-3 py-1 text-stone-700">{u.provider}</td>
                      <td className="pr-3 py-1 text-stone-500">{u.model ?? "-"}</td>
                      <td className="pr-3 py-1 text-stone-500" title={u.tokenSource === "UNKNOWN" ? (u.tokenUnknownReason ?? "") : ""}>
                        {u.tokenSource === "PROVIDER_REPORTED" ? u.totalTokens : "UNKNOWN"}
                      </td>
                      <td className="pr-3 py-1 text-stone-500">{u.latencyMs}ms</td>
                      <td className="pr-3 py-1 text-stone-500">{u.costStatus === "ACTUAL" ? `${u.providerCost?.toFixed(4)} ${u.currency}` : "NO_COST_RECORDED"}</td>
                      <td className="pr-3 py-1 text-stone-500">{u.providerCostThb != null ? u.providerCostThb.toFixed(2) : "NO_COST_RECORDED"}</td>
                      <td className="pr-3 py-1 text-stone-500">{u.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {Array.isArray(data.future_additions) && data.future_additions.length > 0 && (
        <div className="rounded-xl border border-dashed border-stone-300 bg-stone-50 p-4">
          <div className="text-sm font-medium text-stone-700 mb-2">รอเพิ่มในอนาคต</div>
          <pre className="text-xs text-stone-500 overflow-x-auto whitespace-pre-wrap">
            {JSON.stringify(data.future_additions, null, 2)}
          </pre>
        </div>
      )}
    </div>
  )
}
