"use client"

import { useEffect, useState, type FormEvent } from "react"
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
  responsibility_id: string | null
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
  payer_attribution_status?: string
  payer_account?: ResponsibilityAccount | null
  source_account?: ResponsibilityAccount | null
}

type ResponsibilityAccount = {
  id: string
  provider_code: string
  account_kind: "mailbox" | "provider_account" | "platform_account" | "service_account"
  provider_account_ref: string
  display_name: string | null
  email_address: string | null
  owner_kind: "unassigned" | "platform" | "user" | "organization" | "company"
  owner_user_id: string | null
  owner_organization_id: string | null
  owner_company_id: string | null
  attribution_status: "unverified" | "under_review" | "verified"
}

type OwnerOptions = {
  users: Array<{ id: string; email: string; role: string }>
  organizations: Array<{ id: string; name: string | null }>
  companies: Array<{ id: string; name: string | null }>
}

export default function InfrastructurePage() {
  const [data, setData] = useState<InfraData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [subs, setSubs] = useState<SubscriptionService[] | null>(null)
  const [subsError, setSubsError] = useState<string | null>(null)
  const [accounts, setAccounts] = useState<ResponsibilityAccount[]>([])
  const [ownerOptions, setOwnerOptions] = useState<OwnerOptions | null>(null)
  const [accountsError, setAccountsError] = useState<string | null>(null)
  const [accountDraft, setAccountDraft] = useState({ provider_code: "", account_kind: "provider_account", provider_account_ref: "", display_name: "", email_address: "" })
  const [costDraft, setCostDraft] = useState({ provider_code: "", service_name: "", cost_kind: "provider_invoice", amount: "", currency: "THB", billing_cycle: "", source_kind: "provider_invoice", source_reference: "" })
  const [accountOwners, setAccountOwners] = useState<Record<string, { owner_kind: string; owner_id: string; parent_organization_id: string; verification_reference: string }>>({})
  const [subscriptionOwners, setSubscriptionOwners] = useState<Record<string, { payer_account_id: string; source_account_id: string; verification_reference: string }>>({})
  const [savingResponsibility, setSavingResponsibility] = useState<string | null>(null)
  const [responsibilityNotice, setResponsibilityNotice] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  async function refreshResponsibilityAccounts() {
    const response = await fetch("/api/admin/responsibility-accounts")
    const result = await response.json()
    if (!response.ok) throw new Error(result.error ?? "โหลดทะเบียนเจ้าของไม่สำเร็จ")
    setAccounts(result.accounts ?? [])
    setOwnerOptions(result.owners ?? null)
    setAccountOwners(Object.fromEntries((result.accounts ?? []).map((account: ResponsibilityAccount) => [account.id, {
      owner_kind: account.owner_kind === "unassigned" ? "user" : account.owner_kind,
      owner_id: account.owner_kind === "user" ? account.owner_user_id ?? ""
        : account.owner_kind === "organization" ? account.owner_organization_id ?? ""
          : account.owner_company_id ?? "",
      parent_organization_id: account.owner_kind === "company" ? account.owner_organization_id ?? "" : "",
      verification_reference: "",
    }])))
    setAccountsError(null)
  }

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

    refreshResponsibilityAccounts().catch((e) => setAccountsError(e.message ?? "โหลดทะเบียนเจ้าของไม่สำเร็จ"))
  }, [])

  async function registerResponsibilityAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSavingResponsibility("new-account")
    setResponsibilityNotice(null)
    try {
      const response = await fetch("/api/admin/responsibility-accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(accountDraft),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error ?? "เพิ่มบัญชีไม่สำเร็จ")
      setAccountDraft({ provider_code: "", account_kind: "provider_account", provider_account_ref: "", display_name: "", email_address: "" })
      await refreshResponsibilityAccounts()
      setResponsibilityNotice("เพิ่มบัญชีแล้ว — ยังไม่ถือว่ายืนยันเจ้าของจนกว่าจะผูกหลักฐาน")
    } catch (e) {
      setResponsibilityNotice(e instanceof Error ? e.message : "เพิ่มบัญชีไม่สำเร็จ")
    } finally {
      setSavingResponsibility(null)
    }
  }

  async function registerSubscriptionCost(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSavingResponsibility("new-cost")
    setResponsibilityNotice(null)
    try {
      const response = await fetch("/api/admin/subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(costDraft),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error ?? "เพิ่มรายการค่าใช้จ่ายไม่สำเร็จ")
      setCostDraft({ provider_code: "", service_name: "", cost_kind: "provider_invoice", amount: "", currency: "THB", billing_cycle: "", source_kind: "provider_invoice", source_reference: "" })
      const refreshed = await fetch("/api/admin/subscriptions").then((r) => r.json())
      setSubs(refreshed.services ?? [])
      setResponsibilityNotice("เพิ่มค่าบริการพร้อมหลักฐานแล้ว — ผู้จ่ายยังไม่ถูกกำหนดจนกว่าจะยืนยันบัญชี")
    } catch (e) {
      setResponsibilityNotice(e instanceof Error ? e.message : "เพิ่มรายการค่าใช้จ่ายไม่สำเร็จ")
    } finally {
      setSavingResponsibility(null)
    }
  }

  async function saveAccountOwner(accountId: string) {
    const draft = accountOwners[accountId]
    setSavingResponsibility(accountId)
    setResponsibilityNotice(null)
    try {
      const response = await fetch("/api/admin/responsibility-accounts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: accountId, ...draft }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error ?? "ยืนยันเจ้าของไม่สำเร็จ")
      await refreshResponsibilityAccounts()
      setResponsibilityNotice("บันทึกผู้รับผิดชอบพร้อมหลักฐานแล้ว")
    } catch (e) {
      setResponsibilityNotice(e instanceof Error ? e.message : "ยืนยันเจ้าของไม่สำเร็จ")
    } finally {
      setSavingResponsibility(null)
    }
  }

  async function saveSubscriptionOwners(service: SubscriptionService) {
    if (!service.responsibility_id) return
    const draft = subscriptionOwners[service.responsibility_id]
    setSavingResponsibility(service.responsibility_id)
    setResponsibilityNotice(null)
    try {
      const response = await fetch("/api/admin/subscriptions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          responsibility_id: service.responsibility_id,
          payer_account_id: draft?.payer_account_id || null,
          source_account_id: draft?.source_account_id || null,
          verification_reference: draft?.verification_reference ?? "",
        }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error ?? "บันทึกการอ้างอิงค่าใช้จ่ายไม่สำเร็จ")
      const refreshed = await fetch("/api/admin/subscriptions").then((r) => r.json())
      setSubs(refreshed.services ?? [])
      setResponsibilityNotice("บันทึกเส้นทางผู้จ่ายและกล่องอีเมลพร้อมหลักฐานแล้ว")
    } catch (e) {
      setResponsibilityNotice(e instanceof Error ? e.message : "บันทึกการอ้างอิงค่าใช้จ่ายไม่สำเร็จ")
    } finally {
      setSavingResponsibility(null)
    }
  }

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

      <section className="rounded-xl border border-indigo-200 bg-indigo-50/60 p-4 space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-stone-900">ทะเบียนบัญชีและผู้รับผิดชอบ</h2>
          <p className="text-xs text-stone-600 mt-1">
            บัญชีผู้ใช้/องค์กร/บริษัทที่จ่ายค่าบริการแยกจากบัญชีผู้ดูแลระบบและกล่องอีเมลที่ใช้จับหลักฐาน ทุกการยืนยันต้องมีแหล่งอ้างอิง
          </p>
        </div>
        {accountsError && <div className="rounded border border-amber-300 bg-white px-3 py-2 text-xs text-amber-800">{accountsError}</div>}
        {responsibilityNotice && <div className="rounded border border-sky-200 bg-white px-3 py-2 text-xs text-sky-800">{responsibilityNotice}</div>}

        <form onSubmit={registerResponsibilityAccount} className="grid grid-cols-1 md:grid-cols-7 gap-2 rounded-lg border border-indigo-100 bg-white p-3">
          <input required aria-label="ผู้ให้บริการ" placeholder="ผู้ให้บริการ เช่น openai" value={accountDraft.provider_code}
            onChange={(e) => setAccountDraft((v) => ({ ...v, provider_code: e.target.value }))} className="rounded border px-2 py-1.5 text-xs" />
          <select aria-label="ประเภทบัญชี" value={accountDraft.account_kind}
            onChange={(e) => setAccountDraft((v) => ({ ...v, account_kind: e.target.value }))} className="rounded border px-2 py-1.5 text-xs">
            <option value="provider_account">บัญชีผู้ให้บริการ</option>
            <option value="mailbox">กล่องอีเมล</option>
            <option value="platform_account">บัญชีแพลตฟอร์ม</option>
            <option value="service_account">บัญชีบริการ</option>
          </select>
          <input required aria-label="รหัสอ้างอิงบัญชี" placeholder="รหัส/อีเมลบัญชี (ห้ามใส่ secret)" value={accountDraft.provider_account_ref}
            onChange={(e) => setAccountDraft((v) => ({ ...v, provider_account_ref: e.target.value }))} className="rounded border px-2 py-1.5 text-xs md:col-span-2" />
          <input aria-label="ชื่อบัญชี" placeholder="ชื่อบัญชี" value={accountDraft.display_name}
            onChange={(e) => setAccountDraft((v) => ({ ...v, display_name: e.target.value }))} className="rounded border px-2 py-1.5 text-xs" />
          <input aria-label="อีเมลบัญชี" type="email" placeholder="อีเมลบัญชี (ถ้ามี)" value={accountDraft.email_address}
            onChange={(e) => setAccountDraft((v) => ({ ...v, email_address: e.target.value }))} className="rounded border px-2 py-1.5 text-xs" />
          <button disabled={savingResponsibility === "new-account"} className="rounded bg-indigo-700 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">
            {savingResponsibility === "new-account" ? "กำลังบันทึก…" : "เพิ่มบัญชีที่สังเกตพบ"}
          </button>
        </form>

        {!accountsError && accounts.length > 0 && (
          <div className="space-y-2">
            {accounts.map((account) => {
              const draft = accountOwners[account.id] ?? { owner_kind: "user", owner_id: "", parent_organization_id: "", verification_reference: "" }
              const ownerList = draft.owner_kind === "user" ? ownerOptions?.users ?? []
                : draft.owner_kind === "organization" ? ownerOptions?.organizations ?? []
                  : draft.owner_kind === "company" ? ownerOptions?.companies ?? [] : []
              const currentOwnerId = account.owner_user_id ?? account.owner_organization_id ?? account.owner_company_id
              return (
                <div key={account.id} className="grid grid-cols-1 lg:grid-cols-6 gap-2 rounded-lg border border-stone-200 bg-white p-3 items-center">
                  <div className="min-w-0 lg:col-span-2">
                    <div className="text-xs font-medium text-stone-900 truncate">{account.display_name ?? account.provider_account_ref}</div>
                    <div className="text-[10px] text-stone-500 truncate">{account.provider_code} · {account.account_kind} · {account.attribution_status === "verified" ? "ยืนยันเจ้าของแล้ว" : "ยังไม่ยืนยันเจ้าของ"}</div>
                    {account.email_address && <div className="text-[10px] text-stone-500 truncate">อีเมล: {account.email_address}</div>}
                  </div>
                  <select value={draft.owner_kind} onChange={(e) => setAccountOwners((v) => ({ ...v, [account.id]: { ...draft, owner_kind: e.target.value, owner_id: "", parent_organization_id: "" } }))} className="rounded border px-2 py-1.5 text-xs">
                    <option value="user">บัญชีผู้ใช้</option>
                    <option value="organization">องค์กร</option>
                    <option value="company">บริษัท/คู่ค้า</option>
                    <option value="platform">แพลตฟอร์ม DNA OS</option>
                  </select>
                  {draft.owner_kind !== "platform" ? (
                    <select value={draft.owner_id || (draft.owner_kind === account.owner_kind ? currentOwnerId : null) || ""} onChange={(e) => setAccountOwners((v) => ({ ...v, [account.id]: { ...draft, owner_id: e.target.value } }))} className="rounded border px-2 py-1.5 text-xs lg:col-span-1">
                      <option value="">เลือกเจ้าของ…</option>
                      {ownerList.map((owner) => <option key={owner.id} value={owner.id}>{"email" in owner ? owner.email : owner.name || owner.id}</option>)}
                    </select>
                  ) : <div className="text-[10px] text-amber-700">ต้องยืนยันด้วย super admin</div>}
                  {draft.owner_kind === "company" && (
                    <select value={draft.parent_organization_id} onChange={(e) => setAccountOwners((v) => ({ ...v, [account.id]: { ...draft, parent_organization_id: e.target.value } }))} className="rounded border px-2 py-1.5 text-xs">
                      <option value="">องค์กรเจ้าของบริษัท (ถ้าทราบ)</option>
                      {(ownerOptions?.organizations ?? []).map((organization) => <option key={organization.id} value={organization.id}>{organization.name || organization.id}</option>)}
                    </select>
                  )}
                  <input value={draft.verification_reference} onChange={(e) => setAccountOwners((v) => ({ ...v, [account.id]: { ...draft, verification_reference: e.target.value } }))}
                    placeholder="อ้างอิงหลักฐาน" className="rounded border px-2 py-1.5 text-xs" />
                  <button onClick={() => saveAccountOwner(account.id)} disabled={savingResponsibility === account.id}
                    className="rounded border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-xs text-indigo-800 disabled:opacity-50">
                    {savingResponsibility === account.id ? "กำลังบันทึก…" : "ยืนยันผู้รับผิดชอบ"}
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </section>

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
          <h2 className="text-sm font-semibold text-stone-900">Subscription และค่าบริการระบบ</h2>
          <span className="text-[10px] px-1.5 py-0.5 rounded border border-emerald-300 bg-emerald-50 text-emerald-700">มีหลักฐานต้นทาง</span>
        </div>
        <p className="text-xs text-stone-500 mb-3">
          อีเมลเป็นหลักฐานว่าพบรายการบริการ แต่ไม่ได้พิสูจน์เจ้าของกล่องหรือผู้จ่าย ค่าใช้จ่ายระบบอยู่ในทะเบียนส่วนกลาง ไม่ปะปนกับรายจ่ายธุรกิจของบริษัท และจะระบุผู้รับผิดชอบได้เมื่อเลือกบัญชีพร้อมอ้างอิงหลักฐาน — confidence &quot;low&quot; หมายถึงระบบอ่านข้อมูลไม่ครบ
        </p>
        <form onSubmit={registerSubscriptionCost} className="mb-4 grid grid-cols-1 md:grid-cols-8 gap-2 rounded-lg border border-stone-200 bg-stone-50 p-3">
          <input required aria-label="ผู้ให้บริการค่าใช้จ่าย" placeholder="Provider เช่น DigitalOcean" value={costDraft.provider_code}
            onChange={(e) => setCostDraft((v) => ({ ...v, provider_code: e.target.value }))} className="rounded border px-2 py-1.5 text-xs" />
          <input required aria-label="ชื่อบริการ" placeholder="ชื่อบริการ/รายการประมวลผล" value={costDraft.service_name}
            onChange={(e) => setCostDraft((v) => ({ ...v, service_name: e.target.value }))} className="rounded border px-2 py-1.5 text-xs md:col-span-2" />
          <select aria-label="ประเภทค่าบริการ" value={costDraft.cost_kind} onChange={(e) => setCostDraft((v) => ({ ...v, cost_kind: e.target.value }))} className="rounded border px-2 py-1.5 text-xs">
            <option value="provider_invoice">ใบเรียกเก็บเงิน</option><option value="manual_contract">สัญญา/แพ็กเกจ</option><option value="usage_billing">ตามการประมวลผล</option>
          </select>
          <input aria-label="จำนวนเงิน" type="number" min="0" step="0.000001" placeholder="จำนวนเงิน" value={costDraft.amount}
            onChange={(e) => setCostDraft((v) => ({ ...v, amount: e.target.value }))} className="rounded border px-2 py-1.5 text-xs" />
          <input aria-label="สกุลเงิน" maxLength={3} placeholder="สกุลเงิน" value={costDraft.currency}
            onChange={(e) => setCostDraft((v) => ({ ...v, currency: e.target.value.toUpperCase() }))} className="rounded border px-2 py-1.5 text-xs" />
          <select aria-label="หลักฐานต้นทาง" value={costDraft.source_kind} onChange={(e) => setCostDraft((v) => ({ ...v, source_kind: e.target.value }))} className="rounded border px-2 py-1.5 text-xs">
            <option value="provider_invoice">ใบแจ้งหนี้</option><option value="manual_record">บันทึกอ้างอิง</option><option value="provider_api">API ผู้ให้บริการ</option>
          </select>
          <input required aria-label="รหัสอ้างอิงหลักฐาน" placeholder="เลขใบแจ้งหนี้/ลิงก์หลักฐาน" value={costDraft.source_reference}
            onChange={(e) => setCostDraft((v) => ({ ...v, source_reference: e.target.value }))} className="rounded border px-2 py-1.5 text-xs md:col-span-3" />
          <select aria-label="รอบบิล" value={costDraft.billing_cycle} onChange={(e) => setCostDraft((v) => ({ ...v, billing_cycle: e.target.value }))} className="rounded border px-2 py-1.5 text-xs">
            <option value="">ไม่ระบุรอบ</option><option value="monthly">รายเดือน</option><option value="yearly">รายปี</option><option value="usage">ตามการใช้งาน</option>
          </select>
          <button disabled={savingResponsibility === "new-cost"} className="rounded bg-stone-800 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50 md:col-span-2">
            {savingResponsibility === "new-cost" ? "กำลังบันทึก…" : "เพิ่มค่าบริการพร้อมหลักฐาน"}
          </button>
        </form>
        {subsError && <div className="text-xs text-red-600">โหลดไม่สำเร็จ: {subsError}</div>}
        {!subsError && !subs && <div className="text-xs text-stone-400">กำลังโหลด...</div>}
        {subs && subs.length === 0 && (
          <div className="text-xs text-stone-400">ยังไม่พบรายการ — ตัวจับอีเมลยังไม่เคยรันหรือยังไม่เจออีเมลที่ตรงเงื่อนไข</div>
        )}
        {subs && subs.length > 0 && (
          <div className="space-y-2">
            {subs.map((s) => {
              const responsibilityId = s.responsibility_id
              const draft = responsibilityId ? subscriptionOwners[responsibilityId] ?? {
                payer_account_id: s.payer_account?.id ?? "",
                source_account_id: s.source_account?.id ?? "",
                verification_reference: "",
              } : null
              const verifiedAccounts = accounts.filter((account) => account.attribution_status === "verified")
              const payerAccounts = verifiedAccounts.filter((account) => account.account_kind !== "mailbox")
              const mailboxAccounts = verifiedAccounts.filter((account) => account.account_kind === "mailbox")
              return (
                <div key={s.id} className="rounded-lg border border-stone-100 bg-stone-50 px-3 py-2 space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-stone-900 truncate">{s.service_name}</span>
                        <span className="text-[9px] px-1 py-0.5 rounded border border-stone-300 text-stone-500">{s.provider}</span>
                        <span className={`text-[9px] px-1 py-0.5 rounded border ${s.payer_attribution_status === "verified" ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "border-amber-300 bg-amber-50 text-amber-700"}`}>
                          {s.payer_attribution_status === "verified" ? "ผู้จ่ายมีหลักฐานแล้ว" : "ผู้จ่ายยังไม่ยืนยัน"}
                        </span>
                        {s.confidence === "low" && (
                          <span className="text-[9px] px-1 py-0.5 rounded border border-amber-300 bg-amber-50 text-amber-700">ต้องตรวจยอด</span>
                        )}
                      </div>
                      {s.raw_subject && <div className="text-[11px] text-stone-400 truncate mt-0.5">หัวข้ออีเมล: {s.raw_subject}</div>}
                      <div className="text-[10px] text-stone-500 mt-0.5">
                        กล่องต้นทาง: {s.source_account?.email_address ?? s.source_account?.provider_account_ref ?? "ยังไม่ระบุ"}
                        {s.payer_account && ` · ผู้รับผิดชอบ: ${s.payer_account.display_name ?? s.payer_account.email_address ?? s.payer_account.provider_account_ref}`}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-sm font-medium text-stone-900 tabular-nums">
                        {s.amount !== null ? `${Number(s.amount).toLocaleString("th-TH")} ${s.currency}` : "ไม่ทราบยอด"}
                      </div>
                      <div className="text-[10px] text-stone-400">
                        {s.billing_cycle === "monthly" ? "รายเดือน" : s.billing_cycle === "yearly" ? "รายปี" : s.billing_cycle === "usage" ? "ตามการใช้งาน" : "ไม่ทราบรอบบิล"}
                        {s.auto_renew === true && " · ต่ออายุอัตโนมัติ"}
                      </div>
                    </div>
                  </div>
                  {responsibilityId && draft ? (
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-2 border-t border-stone-200 pt-2">
                      <select value={draft.payer_account_id} onChange={(e) => setSubscriptionOwners((v) => ({ ...v, [responsibilityId]: { ...draft, payer_account_id: e.target.value } }))} className="rounded border px-2 py-1.5 text-[11px]">
                        <option value="">เลือกบัญชีผู้จ่ายที่ยืนยันแล้ว…</option>
                        {payerAccounts.map((account) => <option key={account.id} value={account.id}>{account.provider_code} · {account.display_name ?? account.email_address ?? account.provider_account_ref}</option>)}
                      </select>
                      <select value={draft.source_account_id} onChange={(e) => setSubscriptionOwners((v) => ({ ...v, [responsibilityId]: { ...draft, source_account_id: e.target.value } }))} className="rounded border px-2 py-1.5 text-[11px]">
                        <option value="">เลือกกล่องอีเมลต้นทางที่ยืนยันแล้ว…</option>
                        {mailboxAccounts.map((account) => <option key={account.id} value={account.id}>{account.email_address ?? account.provider_account_ref}</option>)}
                      </select>
                      <input value={draft.verification_reference} onChange={(e) => setSubscriptionOwners((v) => ({ ...v, [responsibilityId]: { ...draft, verification_reference: e.target.value } }))}
                        placeholder="หลักฐานเชื่อมผู้จ่ายกับรายการนี้" className="rounded border px-2 py-1.5 text-[11px]" />
                      <button onClick={() => saveSubscriptionOwners(s)} disabled={savingResponsibility === responsibilityId}
                        className="rounded border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-[11px] text-indigo-800 disabled:opacity-50">
                        {savingResponsibility === responsibilityId ? "กำลังบันทึก…" : "บันทึกความสัมพันธ์"}
                      </button>
                    </div>
                  ) : <div className="text-[10px] text-amber-700 border-t border-stone-200 pt-2">ยังไม่มีแถวในทะเบียนกลาง — รอ migration ที่ผ่านการตรวจความขัดแย้งก่อน จึงจะกำหนดผู้จ่ายได้</div>}
                </div>
              )
            })}
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
