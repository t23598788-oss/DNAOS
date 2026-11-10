'use client'

/**
 * /admin/god-view — the owner's dashboard (2026-11-10).
 *
 * "หน้าจอของเฮียจะกลายเป็น God View Dashboard ที่ไม่ต้องมานั่งพิมพ์ตอบหรือ
 *  สั่งงานทีละคน แต่เอาไว้นั่งดู Flow การไหลของงาน (Job Flows), สถานะรถวิ่ง,
 *  ยอดเงินเข้า-ออก และกด Override เฉพาะเคสที่มีปัญหา (Accident Exception)"
 *
 * Layout mirrors that decision order: เงิน → งาน → รถ → เคสที่ต้องตัดสินใจ.
 * Everything is read-only except the Override column, which records the owner's
 * decision on ONE exception (audit_logs) instead of mutating business state.
 * Auto-refreshes every 30s so it can stay open on a second monitor.
 */

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'

interface ActiveOrder {
  id: string
  orderNo: string | null
  status: string | null
  customer: string | null
  updatedAt: string
  ageHours: number
}

interface InFlightJob {
  jobId: string
  orderNo: string | null
  customer: string | null
  truckId: string | null
  driverId: string | null
  status: string
  updatedAt: string
  ageMinutes: number
}

interface TruckEvent {
  id: string
  jobId: string
  eventType: string
  actor: string
  createdAt: string
}

interface ExceptionItem {
  kind: string
  label: string
  detail: string
  refId: string
  href: string
}

interface RuleActivity {
  id: string
  rule_code: string | null
  event_type: string
  mode: 'dry_run' | 'live'
  matched: boolean
  status: string
  error: string | null
  created_at: string
}

interface GodView {
  generatedAt: string
  scope: string
  flow: {
    orderStatusCounts: Record<string, number>
    activeOrders: ActiveOrder[]
    truckStatusCounts: Record<string, number>
    inFlight: InFlightJob[]
    recentTruckEvents: TruckEvent[]
  }
  money: {
    windowDays: number
    currency: string
    billed: number
    paid: number
    open: number
    costOut: number
    margin: number
    invoices: number
  }
  exceptions: ExceptionItem[]
  ruleActivity: RuleActivity[]
}

const TRUCK_STAGES = [
  'BROADCASTED',
  'ACCEPTED',
  'EN_ROUTE_TO_PICKUP',
  'PICKED_UP',
  'EN_ROUTE_TO_CUSTOMER',
  'AT_SITE',
  'DELIVERED',
]

const STAGE_LABEL: Record<string, string> = {
  BROADCASTED: 'ประกาศงาน',
  ACCEPTED: 'รถรับงาน',
  EN_ROUTE_TO_PICKUP: 'ไปรับของ',
  PICKED_UP: 'รับของแล้ว',
  EN_ROUTE_TO_CUSTOMER: 'กำลังไปส่ง',
  AT_SITE: 'ถึงหน้างาน',
  DELIVERED: 'ส่งเสร็จ',
}

const EXCEPTION_LABEL: Record<string, string> = {
  STUCK_BROADCAST: 'งานไม่มีรถรับ',
  STALLED_ORDER: 'ออเดอร์ค้าง',
  RULE_SEND_FAILED: 'ส่งข้อความอัตโนมัติไม่สำเร็จ',
}

function money(value: number, currency = 'THB') {
  return new Intl.NumberFormat('th-TH', { style: 'currency', currency, maximumFractionDigits: 0 }).format(
    Number.isFinite(value) ? value : 0,
  )
}

export default function GodViewPage() {
  const [data, setData] = useState<GodView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busyRef, setBusyRef] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/god-view', { cache: 'no-store' })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error ?? 'โหลดภาพรวมไม่สำเร็จ')
      setData(json as GodView)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    const timer = setInterval(() => void load(), 30_000)
    return () => clearInterval(timer)
  }, [load])

  async function override(item: ExceptionItem, action: 'acknowledge' | 'escalate' | 'resolved') {
    setBusyRef(item.refId)
    try {
      const res = await fetch('/api/admin/god-view/override', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: item.kind, refId: item.refId, action }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error ?? 'บันทึก override ไม่สำเร็จ')
      setError(null)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyRef(null)
    }
  }

  if (loading && !data) {
    return <div className="p-6 text-sm text-stone-500">กำลังโหลดภาพรวมเครือข่าย…</div>
  }

  return (
    <div className="mx-auto max-w-[1400px] p-6">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-stone-900">God View</h1>
          <p className="mt-1 text-sm text-stone-500">
            ภาพรวมเครือข่ายทั้งเส้น — เงิน งาน รถ และเคสที่ต้องตัดสินใจ (รีเฟรชอัตโนมัติทุก 30 วินาที)
          </p>
        </div>
        <div className="text-right text-xs text-stone-500">
          <div>ขอบเขตข้อมูล: {data?.scope ?? '—'}</div>
          <div>อัปเดต {data ? new Date(data.generatedAt).toLocaleTimeString('th-TH') : '—'}</div>
        </div>
      </header>

      {error && (
        <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>
      )}

      {data && (
        <>
          {/* 1. เงิน */}
          <section className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Kpi label={`ยอดเรียกเก็บ ${data.money.windowDays} วัน`} value={money(data.money.billed)} />
            <Kpi label="เก็บเงินได้แล้ว" value={money(data.money.paid)} tone="good" />
            <Kpi label="ยังค้างชำระ" value={money(data.money.open)} tone="warn" />
            <Kpi label="ต้นทุนจ่ายออก" value={money(data.money.costOut)} />
            <Kpi label="กำไรขั้นต้น" value={money(data.money.margin)} tone={data.money.margin >= 0 ? 'good' : 'bad'} />
          </section>

          {/* 2. Flow งาน + 3. รถ */}
          <div className="mb-5 grid gap-5 xl:grid-cols-[1.1fr_1fr]">
            <section className="rounded-xl border border-stone-200 bg-white">
              <div className="border-b border-stone-100 px-4 py-3">
                <h2 className="text-sm font-semibold text-stone-800">Job Flow</h2>
                <p className="text-xs text-stone-500">งานที่ยังไม่จบ เรียงตามความเคลื่อนไหวล่าสุด</p>
              </div>
              {data.flow.activeOrders.length === 0 ? (
                <div className="p-4 text-sm text-stone-500">ไม่มีงานค้างในระบบ</div>
              ) : (
                <ul className="divide-y divide-stone-100">
                  {data.flow.activeOrders.map((order) => (
                    <li key={order.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                      <div className="min-w-0">
                        <div className="truncate font-medium text-stone-800">
                          {order.orderNo ?? order.id.slice(0, 8)}
                          {order.customer && <span className="ml-2 text-xs text-stone-500">{order.customer}</span>}
                        </div>
                        <div className="text-xs text-stone-500">{order.status ?? 'ไม่ทราบสถานะ'}</div>
                      </div>
                      <div className={'shrink-0 text-xs ' + (order.ageHours > 48 ? 'text-amber-600' : 'text-stone-400')}>
                        {order.ageHours < 1 ? 'เมื่อสักครู่' : `${order.ageHours} ชม.`}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex flex-wrap gap-2 border-t border-stone-100 px-4 py-2 text-[11px] text-stone-500">
                {Object.entries(data.flow.orderStatusCounts).map(([status, count]) => (
                  <span key={status} className="rounded-full bg-stone-100 px-2 py-0.5">
                    {status} · {count}
                  </span>
                ))}
              </div>
            </section>

            <section className="rounded-xl border border-stone-200 bg-white">
              <div className="border-b border-stone-100 px-4 py-3">
                <h2 className="text-sm font-semibold text-stone-800">สถานะรถวิ่ง</h2>
                <p className="text-xs text-stone-500">ทุกเที่ยวที่ยังไม่ถึงหน้างาน</p>
              </div>
              <div className="flex flex-wrap gap-2 border-b border-stone-100 px-4 py-2">
                {TRUCK_STAGES.map((stage) => {
                  const count = data.flow.truckStatusCounts[stage] ?? 0
                  return (
                    <span
                      key={stage}
                      className={
                        'rounded-full px-2 py-1 text-[11px] ' +
                        (count > 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-stone-100 text-stone-400')
                      }
                    >
                      {STAGE_LABEL[stage]} · {count}
                    </span>
                  )
                })}
              </div>
              {data.flow.inFlight.length === 0 ? (
                <div className="p-4 text-sm text-stone-500">ไม่มีรถอยู่ระหว่างทาง</div>
              ) : (
                <ul className="divide-y divide-stone-100">
                  {data.flow.inFlight.map((job) => (
                    <li key={job.jobId} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                      <div className="min-w-0">
                        <div className="truncate text-stone-800">
                          {job.orderNo ?? job.jobId.slice(0, 8)}
                          {job.customer && <span className="ml-2 text-xs text-stone-500">{job.customer}</span>}
                        </div>
                        <div className="text-xs text-stone-500">
                          {STAGE_LABEL[job.status] ?? job.status}
                          {job.truckId ? ` · รถ ${job.truckId}` : ''}
                          {job.driverId ? ` · คนขับ ${job.driverId}` : ''}
                        </div>
                      </div>
                      <div className={'shrink-0 text-xs ' + (job.ageMinutes > 60 ? 'text-amber-600' : 'text-stone-400')}>
                        {job.ageMinutes < 1 ? 'ตอนนี้' : `${job.ageMinutes} น.`}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {data.flow.recentTruckEvents.length > 0 && (
                <div className="border-t border-stone-100 px-4 py-2">
                  <div className="mb-1 text-[11px] uppercase tracking-wide text-stone-400">event ล่าสุด</div>
                  <ul className="space-y-0.5 text-[11px] text-stone-500">
                    {data.flow.recentTruckEvents.slice(0, 6).map((event) => (
                      <li key={event.id} className="truncate">
                        {new Date(event.createdAt).toLocaleTimeString('th-TH')} · {event.eventType} · {event.actor}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          </div>

          {/* 4. Exceptions + Override */}
          <section className="mb-5 rounded-xl border border-stone-200 bg-white">
            <div className="flex items-center justify-between border-b border-stone-100 px-4 py-3">
              <div>
                <h2 className="text-sm font-semibold text-stone-800">เคสที่ต้องตัดสินใจ ({data.exceptions.length})</h2>
                <p className="text-xs text-stone-500">
                  Override = บันทึกว่าเฮียรับเรื่อง/สั่งต่อแล้ว (ไม่เปลี่ยนสถานะงานข้ามขั้น)
                </p>
              </div>
              <button type="button" onClick={() => void load()} className="text-xs text-stone-500 hover:text-stone-800">
                รีเฟรช
              </button>
            </div>

            {data.exceptions.length === 0 ? (
              <div className="p-4 text-sm text-emerald-700">ไม่มีเคสค้าง — ทุกงานเดินตามปกติ</div>
            ) : (
              <ul className="divide-y divide-stone-100">
                {data.exceptions.map((item) => (
                  <li key={`${item.kind}-${item.refId}`} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] text-amber-700">
                      {EXCEPTION_LABEL[item.kind] ?? item.kind}
                    </span>
                    <div className="min-w-[220px] flex-1">
                      <div className="text-sm font-medium text-stone-800">{item.label}</div>
                      <div className="text-xs text-stone-500">{item.detail}</div>
                    </div>
                    <Link href={item.href} className="text-xs text-stone-500 underline hover:text-stone-800">
                      เปิดรายการ
                    </Link>
                    <div className="flex gap-1">
                      {(['acknowledge', 'escalate', 'resolved'] as const).map((action) => (
                        <button
                          key={action}
                          type="button"
                          disabled={busyRef === item.refId}
                          onClick={() => void override(item, action)}
                          className={
                            'rounded-lg px-2.5 py-1 text-[11px] disabled:opacity-50 ' +
                            (action === 'resolved'
                              ? 'bg-emerald-600 text-white'
                              : 'border border-stone-300 text-stone-700')
                          }
                        >
                          {action === 'acknowledge' ? 'รับเรื่อง' : action === 'escalate' ? 'สั่งต่อ' : 'แก้แล้ว'}
                        </button>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* 5. กฎอัตโนมัติที่ทำงานอยู่ */}
          <section className="rounded-xl border border-stone-200 bg-white">
            <div className="flex items-center justify-between border-b border-stone-100 px-4 py-3">
              <h2 className="text-sm font-semibold text-stone-800">การทำงานของกฎอัตโนมัติ</h2>
              <Link href="/admin/rules" className="text-xs text-stone-500 underline hover:text-stone-800">
                ไปที่ Rules Engine
              </Link>
            </div>
            {data.ruleActivity.length === 0 ? (
              <div className="p-4 text-sm text-stone-500">ยังไม่มีการประเมินกฎ</div>
            ) : (
              <ul className="divide-y divide-stone-100 text-xs">
                {data.ruleActivity.map((run) => (
                  <li key={run.id} className="flex flex-wrap items-center gap-2 px-4 py-2">
                    <span className="text-stone-400">{new Date(run.created_at).toLocaleTimeString('th-TH')}</span>
                    <span className="font-mono text-stone-700">{run.rule_code ?? run.event_type}</span>
                    <span className="rounded-full bg-stone-100 px-2 py-0.5 text-stone-600">{run.mode}</span>
                    <span
                      className={
                        'rounded-full px-2 py-0.5 ' +
                        (run.status === 'sent'
                          ? 'bg-emerald-50 text-emerald-700'
                          : run.status === 'failed'
                            ? 'bg-rose-50 text-rose-700'
                            : 'bg-stone-50 text-stone-500')
                      }
                    >
                      {run.status}
                    </span>
                    {run.error && <span className="truncate text-rose-600">{run.error}</span>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  )
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'warn' | 'bad' }) {
  const color =
    tone === 'good' ? 'text-emerald-700' : tone === 'warn' ? 'text-amber-700' : tone === 'bad' ? 'text-rose-700' : 'text-stone-900'
  return (
    <div className="rounded-xl border border-stone-200 bg-white px-4 py-3">
      <div className="text-[10px] uppercase tracking-wide text-stone-400">{label}</div>
      <div className={'mt-1 text-xl font-semibold ' + color}>{value}</div>
    </div>
  )
}
