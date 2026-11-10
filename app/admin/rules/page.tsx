'use client'

/**
 * /admin/rules — EVENT-DRIVEN RULES ENGINE (owner, 2026-11-10).
 *
 * "ตั้งเงื่อนไขว่าถ้าเกิด Event แบบนี้ → ให้ระบบยิงข้อความ/งานไปหา Role ไหน
 *  โดยอัตโนมัติ (เช่น EVENT_ORDER_CREATED → ROLE_SUPPLIER_SAND + ROLE_TRANSPORTER)"
 *
 * The rulebook is data (public.event_rules), not code: a rule is
 *   event_type + conditions → target roles + action + message template
 * and it is evaluated by engines/rules/dispatch.ts.
 *
 * The tester at the bottom runs the SAME engine in dry-run mode: it resolves the
 * roles and renders the message but sends nothing until "ยิงจริง" is ticked.
 * That is the safety rail — testing a rule must never message a customer.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'

interface EventRule {
  id: string
  code: string
  name: string
  event_type: string
  target_roles: string[]
  action: 'notify_line' | 'flag_exception'
  channel: 'line' | 'in_app'
  message_template: string | null
  conditions: Record<string, unknown>
  priority: number
  active: boolean
}

interface RuleRun {
  id: string
  rule_code: string | null
  event_type: string
  event_key: string | null
  mode: 'dry_run' | 'live'
  matched: boolean
  targets: Array<{ role: string; line_user_id: string | null; name: string | null }>
  status: 'logged' | 'sent' | 'partial' | 'failed' | 'skipped'
  error: string | null
  created_at: string
}

interface RoleOption {
  code: string
  label_th: string
}

interface RunOutcome {
  ruleCode: string
  ruleName: string
  matched: boolean
  reason: string
  recipients: Array<{ roleCode: string; lineUserId: string | null; displayName: string | null }>
  status: string
  error: string | null
}

interface RunResult {
  mode: 'dry_run' | 'live'
  evaluated: number
  matched: number
  sent: number
  failed: number
  outcomes: RunOutcome[]
}

const KNOWN_EVENTS = [
  'EVENT_ORDER_CREATED',
  'EVENT_ORDER_PAID',
  'EVENT_JOB_BROADCASTED',
  'EVENT_TRUCK_ACCEPTED',
  'EVENT_TRUCK_AT_SITE',
  'EVENT_TRUCK_DELIVERED',
]

const STATUS_STYLE: Record<RuleRun['status'], string> = {
  logged: 'bg-stone-100 text-stone-600',
  sent: 'bg-emerald-50 text-emerald-700',
  partial: 'bg-amber-50 text-amber-700',
  failed: 'bg-rose-50 text-rose-700',
  skipped: 'bg-stone-50 text-stone-400',
}

export default function RulesPage() {
  const [rules, setRules] = useState<EventRule[]>([])
  const [runs, setRuns] = useState<RuleRun[]>([])
  const [roles, setRoles] = useState<RoleOption[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // create form
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [eventType, setEventType] = useState('EVENT_ORDER_CREATED')
  const [targetRoles, setTargetRoles] = useState<string[]>(['ROLE_SUPPLIER_SAND'])
  const [action, setAction] = useState<'notify_line' | 'flag_exception'>('notify_line')
  const [messageTemplate, setMessageTemplate] = useState(
    'งานใหม่ {{order_no}}\nลูกค้า: {{customer_name}}\nวัสดุ: {{material}}\nปลายทาง: {{destination}}',
  )
  const [conditionsText, setConditionsText] = useState('{}')
  const [priority, setPriority] = useState(100)

  // tester
  const [testEventType, setTestEventType] = useState('EVENT_ORDER_CREATED')
  const [testPayload, setTestPayload] = useState(
    '{\n  "order_no": "ORD-TEST-001",\n  "customer_name": "ลูกค้าทดสอบ",\n  "material": "ทรายหยาบ",\n  "quantity": "10 คิว",\n  "destination": "หนองแขม"\n}',
  )
  const [live, setLive] = useState(false)
  const [result, setResult] = useState<RunResult | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [rulesRes, rolesRes] = await Promise.all([
        fetch('/api/admin/rules', { cache: 'no-store' }),
        fetch('/api/admin/roles', { cache: 'no-store' }),
      ])
      const rulesJson = await rulesRes.json()
      const rolesJson = await rolesRes.json()
      if (!rulesRes.ok) throw new Error(rulesJson?.error ?? 'โหลดกฎไม่สำเร็จ')
      setRules(rulesJson.rules ?? [])
      setRuns(rulesJson.runs ?? [])
      setRoles(rolesJson.roles ?? [])
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const roleLabel = useMemo(() => {
    const map = new Map(roles.map((role) => [role.code, role.label_th]))
    return (code: string) => map.get(code) ?? code
  }, [roles])

  function toggleRole(roleCode: string) {
    setTargetRoles((current) =>
      current.includes(roleCode) ? current.filter((c) => c !== roleCode) : [...current, roleCode],
    )
  }

  async function createRule() {
    setBusy(true)
    try {
      let conditions: unknown = {}
      try {
        conditions = JSON.parse(conditionsText || '{}')
      } catch {
        throw new Error('conditions ต้องเป็น JSON ที่ถูกต้อง')
      }

      const res = await fetch('/api/admin/rules', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          code,
          name,
          eventType,
          targetRoles,
          action,
          messageTemplate,
          conditions,
          priority,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error ?? 'สร้างกฎไม่สำเร็จ')

      setCode('')
      setName('')
      setError(null)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function toggleRule(rule: EventRule) {
    setBusy(true)
    try {
      const res = await fetch('/api/admin/rules', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: rule.id, active: !rule.active }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error ?? 'อัปเดตกฎไม่สำเร็จ')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function runRule() {
    setBusy(true)
    setResult(null)
    try {
      let payload: unknown = {}
      try {
        payload = JSON.parse(testPayload || '{}')
      } catch {
        throw new Error('payload ต้องเป็น JSON ที่ถูกต้อง')
      }

      const res = await fetch('/api/admin/rules/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: testEventType, payload, live }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error ?? 'รันกฎไม่สำเร็จ')
      setResult(json as RunResult)
      setError(null)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-6xl p-6">
      <header className="mb-4">
        <h1 className="text-xl font-bold text-stone-900">Rules Engine</h1>
        <p className="mt-1 text-sm text-stone-500">
          กำหนดว่าเมื่อเกิด event อะไร ให้ส่งงาน/ข้อความไปหา role ไหนโดยอัตโนมัติ — ทดสอบได้แบบไม่ส่งจริงก่อนเปิดใช้
        </p>
      </header>

      {error && (
        <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>
      )}

      <section className="mb-5 rounded-xl border border-stone-200 bg-white">
        <div className="flex items-center justify-between border-b border-stone-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-stone-800">กฎทั้งหมด ({rules.length})</h2>
          <button type="button" onClick={() => void load()} className="text-xs text-stone-500 hover:text-stone-800">
            รีเฟรช
          </button>
        </div>
        {loading ? (
          <div className="p-4 text-sm text-stone-500">กำลังโหลด…</div>
        ) : rules.length === 0 ? (
          <div className="p-4 text-sm text-stone-500">ยังไม่มีกฎ — สร้างใบแรกด้านล่าง</div>
        ) : (
          <ul className="divide-y divide-stone-100">
            {rules.map((rule) => (
              <li key={rule.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
                <div className="min-w-[220px] flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-stone-900">{rule.name}</span>
                    <span className="rounded bg-stone-100 px-1.5 py-0.5 font-mono text-[10px] text-stone-500">
                      {rule.code}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-stone-500">
                    <span className="font-mono">{rule.event_type}</span>
                    <span className="mx-1">→</span>
                    {rule.target_roles.map((r) => (
                      <span key={r} className="mr-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700">
                        {roleLabel(r)}
                      </span>
                    ))}
                  </div>
                  {rule.message_template && (
                    <pre className="mt-1 whitespace-pre-wrap text-[11px] text-stone-400">{rule.message_template}</pre>
                  )}
                </div>
                <div className="text-right text-xs text-stone-500">
                  <div>ลำดับ {rule.priority}</div>
                  <div>{rule.action === 'notify_line' ? 'ยิงข้อความ' : 'ติดธง exception'}</div>
                </div>
                <button
                  type="button"
                  onClick={() => void toggleRule(rule)}
                  disabled={busy}
                  className={
                    'rounded-full px-3 py-1 text-[11px] ' +
                    (rule.active ? 'bg-emerald-600 text-white' : 'bg-stone-200 text-stone-600')
                  }
                >
                  {rule.active ? 'เปิดใช้' : 'ปิด'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="rounded-xl border border-stone-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-stone-800">สร้างกฎใหม่</h2>

          <div className="grid gap-3">
            <label className="text-xs text-stone-600">
              ชื่อกฎ
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="ออเดอร์ใหม่ → แจ้งบ่อทราย"
                className="mt-1 w-full rounded-lg border border-stone-300 px-2 py-1.5 text-sm"
              />
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs text-stone-600">
                code
                <input
                  value={code}
                  onChange={(event) => setCode(event.target.value.toUpperCase())}
                  placeholder="RULE_ORDER_CREATED"
                  className="mt-1 w-full rounded-lg border border-stone-300 px-2 py-1.5 font-mono text-sm"
                />
              </label>
              <label className="text-xs text-stone-600">
                ลำดับความสำคัญ
                <input
                  type="number"
                  value={priority}
                  onChange={(event) => setPriority(Number(event.target.value))}
                  className="mt-1 w-full rounded-lg border border-stone-300 px-2 py-1.5 text-sm"
                />
              </label>
            </div>

            <label className="text-xs text-stone-600">
              Event
              <input
                value={eventType}
                onChange={(event) => setEventType(event.target.value.toUpperCase())}
                list="known-events"
                className="mt-1 w-full rounded-lg border border-stone-300 px-2 py-1.5 font-mono text-sm"
              />
              <datalist id="known-events">
                {KNOWN_EVENTS.map((event) => (
                  <option key={event} value={event} />
                ))}
              </datalist>
            </label>

            <div className="text-xs text-stone-600">
              ส่งไปหา role
              <div className="mt-1 flex flex-wrap gap-2">
                {roles.map((role) => (
                  <button
                    key={role.code}
                    type="button"
                    onClick={() => toggleRole(role.code)}
                    className={
                      'rounded-full px-3 py-1 text-[11px] ' +
                      (targetRoles.includes(role.code)
                        ? 'bg-stone-900 text-white'
                        : 'bg-stone-100 text-stone-600')
                    }
                  >
                    {role.label_th}
                  </button>
                ))}
              </div>
            </div>

            <label className="text-xs text-stone-600">
              การทำงาน
              <select
                value={action}
                onChange={(event) => setAction(event.target.value as typeof action)}
                className="mt-1 w-full rounded-lg border border-stone-300 px-2 py-1.5 text-sm"
              >
                <option value="notify_line">ยิงข้อความ LINE</option>
                <option value="flag_exception">ติดธง exception (ไม่ส่งข้อความ)</option>
              </select>
            </label>

            <label className="text-xs text-stone-600">
              ข้อความ (ใช้ {'{{key}}'} จาก payload)
              <textarea
                value={messageTemplate}
                onChange={(event) => setMessageTemplate(event.target.value)}
                rows={4}
                className="mt-1 w-full rounded-lg border border-stone-300 px-2 py-1.5 font-mono text-xs"
              />
            </label>

            <label className="text-xs text-stone-600">
              เงื่อนไข (JSON — เว้นว่างได้)
              <textarea
                value={conditionsText}
                onChange={(event) => setConditionsText(event.target.value)}
                rows={3}
                className="mt-1 w-full rounded-lg border border-stone-300 px-2 py-1.5 font-mono text-xs"
              />
            </label>

            <button
              type="button"
              onClick={() => void createRule()}
              disabled={busy}
              className="rounded-lg bg-stone-900 px-4 py-2 text-sm text-white disabled:opacity-50"
            >
              สร้างกฎ
            </button>
          </div>
        </section>

        <section className="rounded-xl border border-stone-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-stone-800">ทดสอบยิงกฎ</h2>

          <div className="grid gap-3">
            <label className="text-xs text-stone-600">
              Event
              <input
                value={testEventType}
                onChange={(event) => setTestEventType(event.target.value.toUpperCase())}
                list="known-events"
                className="mt-1 w-full rounded-lg border border-stone-300 px-2 py-1.5 font-mono text-sm"
              />
            </label>

            <label className="text-xs text-stone-600">
              Payload (JSON)
              <textarea
                value={testPayload}
                onChange={(event) => setTestPayload(event.target.value)}
                rows={8}
                className="mt-1 w-full rounded-lg border border-stone-300 px-2 py-1.5 font-mono text-xs"
              />
            </label>

            <label className="flex items-center gap-2 text-xs text-stone-600">
              <input type="checkbox" checked={live} onChange={(event) => setLive(event.target.checked)} />
              ยิงจริง (ส่ง LINE จริง — ปล่อยว่างไว้เพื่อดูผลก่อน)
            </label>

            <button
              type="button"
              onClick={() => void runRule()}
              disabled={busy}
              className={
                'rounded-lg px-4 py-2 text-sm text-white disabled:opacity-50 ' +
                (live ? 'bg-rose-600' : 'bg-stone-900')
              }
            >
              {live ? 'ยิงจริง' : 'ทดสอบ (dry run)'}
            </button>

            {result && (
              <div className="rounded-lg border border-stone-200 bg-stone-50 p-3 text-xs text-stone-700">
                <div className="font-medium">
                  {result.mode === 'live' ? 'ยิงจริง' : 'dry run'} · ประเมิน {result.evaluated} กฎ · ตรงเงื่อนไข{' '}
                  {result.matched} · ส่งสำเร็จ {result.sent} · ล้มเหลว {result.failed}
                </div>
                <ul className="mt-2 space-y-2">
                  {result.outcomes.map((outcome) => (
                    <li key={outcome.ruleCode} className="rounded border border-stone-200 bg-white p-2">
                      <div className="font-medium text-stone-800">
                        {outcome.ruleName} <span className="font-mono text-[10px] text-stone-400">{outcome.ruleCode}</span>
                      </div>
                      <div className="text-stone-500">{outcome.reason}</div>
                      {outcome.recipients.length > 0 ? (
                        <div className="mt-1">
                          ผู้รับ:{' '}
                          {outcome.recipients.map((r) => (
                            <span
                              key={`${outcome.ruleCode}-${r.roleCode}-${r.lineUserId ?? r.displayName}`}
                              className="mr-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700"
                            >
                              {roleLabel(r.roleCode)} · {r.displayName ?? r.lineUserId ?? 'ยังไม่มี LINE'}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <div className="mt-1 text-amber-600">ยังไม่มีคนถือ role นี้ (หรือยังไม่ได้ใส่ LINE userId)</div>
                      )}
                      {outcome.error && <div className="mt-1 text-rose-600">{outcome.error}</div>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </section>
      </div>

      <section className="mt-5 rounded-xl border border-stone-200 bg-white">
        <div className="border-b border-stone-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-stone-800">ประวัติการทำงานล่าสุด</h2>
        </div>
        {runs.length === 0 ? (
          <div className="p-4 text-sm text-stone-500">ยังไม่มีการประเมินกฎ</div>
        ) : (
          <table className="w-full text-left text-xs">
            <thead className="bg-stone-50 text-[11px] uppercase tracking-wide text-stone-500">
              <tr>
                <th className="px-4 py-2">เวลา</th>
                <th className="px-4 py-2">กฎ</th>
                <th className="px-4 py-2">Event</th>
                <th className="px-4 py-2">โหมด</th>
                <th className="px-4 py-2">ผู้รับ</th>
                <th className="px-4 py-2">สถานะ</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.id} className="border-t border-stone-100">
                  <td className="px-4 py-2 text-stone-500">{new Date(run.created_at).toLocaleString('th-TH')}</td>
                  <td className="px-4 py-2 font-mono text-stone-700">{run.rule_code ?? '—'}</td>
                  <td className="px-4 py-2 font-mono text-stone-500">{run.event_type}</td>
                  <td className="px-4 py-2 text-stone-500">{run.mode === 'live' ? 'ยิงจริง' : 'dry run'}</td>
                  <td className="px-4 py-2 text-stone-500">{run.targets?.length ?? 0}</td>
                  <td className="px-4 py-2">
                    <span className={'rounded-full px-2 py-0.5 text-[10px] ' + STATUS_STYLE[run.status]}>
                      {run.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}
