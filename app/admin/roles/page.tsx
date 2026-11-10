'use client'

/**
 * /admin/roles — USER ROLE MAPPING (owner, 2026-11-10).
 *
 * "เพิ่มฟิลด์ role ในระบบ เช่น ROLE_CUSTOMER, ROLE_SUPPLIER_SAND,
 *  ROLE_TRANSPORTER, ROLE_ENGINEER"
 *
 * One screen that answers "ใครถือ role อะไร" — because that mapping is what the
 * rules engine reads when an event says "ส่งหา ROLE_TRANSPORTER". A role can be
 * held by a partner record, a LINE user or an app profile; the LINE userId is
 * the field that actually receives the push, so it is editable inline here.
 *
 * The role catalog itself is seeded by migration
 * 20261110120000_role_mapping_and_event_rules.sql — this page maps people to it.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'

interface RoleDefinition {
  code: string
  label_th: string
  label_en: string
  description_th: string | null
  notify_channel: 'line' | 'none'
  sort_order: number
  active: boolean
}

interface RoleAssignment {
  id: string
  role_code: string
  subject_kind: 'partner' | 'line_user' | 'profile'
  subject_id: string
  display_name: string | null
  line_user_id: string | null
  partner_id: string | null
  active: boolean
  note: string | null
  created_at: string
  updated_at: string
}

interface PartnerOption {
  id: string
  name: string
  partner_type_label: string | null
  phone: string | null
  role_name: string | null
}

const SUBJECT_LABEL: Record<RoleAssignment['subject_kind'], string> = {
  partner: 'คู่ค้า',
  line_user: 'LINE',
  profile: 'ผู้ใช้ระบบ',
}

export default function RolesPage() {
  const [roles, setRoles] = useState<RoleDefinition[]>([])
  const [assignments, setAssignments] = useState<RoleAssignment[]>([])
  const [partners, setPartners] = useState<PartnerOption[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // add form
  const [roleCode, setRoleCode] = useState('')
  const [subjectKind, setSubjectKind] = useState<RoleAssignment['subject_kind']>('partner')
  const [partnerId, setPartnerId] = useState('')
  const [lineUserId, setLineUserId] = useState('')
  const [displayName, setDisplayName] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/roles', { cache: 'no-store' })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error ?? 'โหลด role mapping ไม่สำเร็จ')
      setRoles(json.roles ?? [])
      setAssignments(json.assignments ?? [])
      setPartners(json.partners ?? [])
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

  useEffect(() => {
    if (!roleCode && roles.length > 0) setRoleCode(roles[0].code)
  }, [roles, roleCode])

  const countsByRole = useMemo(() => {
    const counts = new Map<string, { total: number; active: number; reachable: number }>()
    for (const role of roles) counts.set(role.code, { total: 0, active: 0, reachable: 0 })
    for (const assignment of assignments) {
      const bucket = counts.get(assignment.role_code)
      if (!bucket) continue
      bucket.total += 1
      if (assignment.active) bucket.active += 1
      if (assignment.active && assignment.line_user_id) bucket.reachable += 1
    }
    return counts
  }, [roles, assignments])

  const partnerName = useCallback(
    (id: string | null) => (id ? partners.find((p) => p.id === id)?.name ?? null : null),
    [partners],
  )

  async function assign() {
    if (!roleCode) return setError('เลือก role ก่อน')
    if (subjectKind === 'partner' && !partnerId) return setError('เลือกคู่ค้าที่จะผูก role')

    setBusy(true)
    try {
      const subjectId = subjectKind === 'partner' ? partnerId : lineUserId.trim()
      if (!subjectId) throw new Error(subjectKind === 'line_user' ? 'ต้องระบุ LINE userId' : 'ต้องระบุ subject id')

      const res = await fetch('/api/admin/roles', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          roleCode,
          subjectKind,
          subjectId,
          displayName: displayName.trim() || partnerName(partnerId) || null,
          lineUserId: lineUserId.trim() || null,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error ?? 'ผูก role ไม่สำเร็จ')

      setPartnerId('')
      setLineUserId('')
      setDisplayName('')
      setError(null)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function toggle(assignment: RoleAssignment) {
    setBusy(true)
    try {
      const res = await fetch('/api/admin/roles', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: assignment.id, active: !assignment.active }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error ?? 'อัปเดตไม่สำเร็จ')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function updateLineId(assignment: RoleAssignment, value: string) {
    setBusy(true)
    try {
      const res = await fetch('/api/admin/roles', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: assignment.id, lineUserId: value.trim() }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error ?? 'อัปเดต LINE userId ไม่สำเร็จ')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function remove(assignment: RoleAssignment) {
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/roles?id=${encodeURIComponent(assignment.id)}`, { method: 'DELETE' })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error ?? 'ลบไม่สำเร็จ')
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
        <h1 className="text-xl font-bold text-stone-900">Role Mapping</h1>
        <p className="mt-1 text-sm text-stone-500">
          ผูกคน/บริษัทในเครือข่ายเข้ากับ role ที่ระบบใช้ตัดสินใจส่งงานและข้อความอัตโนมัติ
          (บทบาทตรงนี้คือ “ใครได้รับงาน” ไม่ใช่สิทธิ์เข้าใช้งานระบบ)
        </p>
      </header>

      {error && (
        <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>
      )}

      <section className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {roles.map((role) => {
          const counts = countsByRole.get(role.code) ?? { total: 0, active: 0, reachable: 0 }
          return (
            <div key={role.code} className="rounded-xl border border-stone-200 bg-white p-4">
              <div className="text-[10px] uppercase tracking-wide text-stone-400">{role.code}</div>
              <div className="mt-1 text-base font-semibold text-stone-900">{role.label_th}</div>
              <div className="text-xs text-stone-500">{role.description_th}</div>
              <div className="mt-3 flex gap-3 text-xs text-stone-600">
                <span>{counts.active} คน</span>
                <span className={counts.reachable === 0 ? 'text-amber-600' : 'text-emerald-600'}>
                  {counts.reachable} รับ LINE ได้
                </span>
              </div>
            </div>
          )
        })}
      </section>

      <section className="mb-5 rounded-xl border border-stone-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-stone-800">ผูก role ใหม่</h2>
        <div className="grid gap-3 md:grid-cols-5">
          <label className="text-xs text-stone-600">
            Role
            <select
              value={roleCode}
              onChange={(event) => setRoleCode(event.target.value)}
              className="mt-1 w-full rounded-lg border border-stone-300 px-2 py-1.5 text-sm"
            >
              {roles.map((role) => (
                <option key={role.code} value={role.code}>
                  {role.label_th} ({role.code})
                </option>
              ))}
            </select>
          </label>

          <label className="text-xs text-stone-600">
            ประเภท
            <select
              value={subjectKind}
              onChange={(event) => setSubjectKind(event.target.value as RoleAssignment['subject_kind'])}
              className="mt-1 w-full rounded-lg border border-stone-300 px-2 py-1.5 text-sm"
            >
              <option value="partner">คู่ค้า</option>
              <option value="line_user">LINE user</option>
            </select>
          </label>

          {subjectKind === 'partner' ? (
            <label className="text-xs text-stone-600 md:col-span-2">
              คู่ค้า
              <select
                value={partnerId}
                onChange={(event) => setPartnerId(event.target.value)}
                className="mt-1 w-full rounded-lg border border-stone-300 px-2 py-1.5 text-sm"
              >
                <option value="">— เลือกคู่ค้า —</option>
                {partners.map((partner) => (
                  <option key={partner.id} value={partner.id}>
                    {partner.name}
                    {partner.partner_type_label ? ` · ${partner.partner_type_label}` : ''}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <label className="text-xs text-stone-600 md:col-span-2">
              LINE userId
              <input
                value={lineUserId}
                onChange={(event) => setLineUserId(event.target.value)}
                placeholder="U..."
                className="mt-1 w-full rounded-lg border border-stone-300 px-2 py-1.5 text-sm"
              />
            </label>
          )}

          <label className="text-xs text-stone-600">
            ชื่อที่ใช้แสดง
            <input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="ไม่ใส่ก็ได้"
              className="mt-1 w-full rounded-lg border border-stone-300 px-2 py-1.5 text-sm"
            />
          </label>

          {subjectKind === 'partner' && (
            <label className="text-xs text-stone-600 md:col-span-2">
              LINE userId ของผู้รับ (ถ้ามี)
              <input
                value={lineUserId}
                onChange={(event) => setLineUserId(event.target.value)}
                placeholder="U... — ใช้เป็นปลายทาง push"
                className="mt-1 w-full rounded-lg border border-stone-300 px-2 py-1.5 text-sm"
              />
            </label>
          )}
        </div>
        <button
          type="button"
          onClick={assign}
          disabled={busy}
          className="mt-3 rounded-lg bg-stone-900 px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          ผูก role
        </button>
      </section>

      <section className="rounded-xl border border-stone-200 bg-white">
        <div className="flex items-center justify-between border-b border-stone-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-stone-800">การผูก role ทั้งหมด ({assignments.length})</h2>
          <button type="button" onClick={() => void load()} className="text-xs text-stone-500 hover:text-stone-800">
            รีเฟรช
          </button>
        </div>

        {loading ? (
          <div className="p-4 text-sm text-stone-500">กำลังโหลด…</div>
        ) : assignments.length === 0 ? (
          <div className="p-4 text-sm text-stone-500">ยังไม่มีการผูก role — เพิ่มรายการแรกด้านบน</div>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="bg-stone-50 text-[11px] uppercase tracking-wide text-stone-500">
              <tr>
                <th className="px-4 py-2">Role</th>
                <th className="px-4 py-2">ผู้ถือ role</th>
                <th className="px-4 py-2">LINE userId (ปลายทาง)</th>
                <th className="px-4 py-2">สถานะ</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {assignments.map((assignment) => {
                const role = roles.find((r) => r.code === assignment.role_code)
                return (
                  <tr key={assignment.id} className="border-t border-stone-100">
                    <td className="px-4 py-2">
                      <div className="font-medium text-stone-800">{role?.label_th ?? assignment.role_code}</div>
                      <div className="text-[10px] text-stone-400">{assignment.role_code}</div>
                    </td>
                    <td className="px-4 py-2">
                      <div className="text-stone-800">
                        {assignment.display_name ?? partnerName(assignment.partner_id) ?? assignment.subject_id}
                      </div>
                      <div className="text-[10px] text-stone-400">{SUBJECT_LABEL[assignment.subject_kind]}</div>
                    </td>
                    <td className="px-4 py-2">
                      <LineIdCell assignment={assignment} busy={busy} onSave={updateLineId} />
                    </td>
                    <td className="px-4 py-2">
                      <span
                        className={
                          'rounded-full px-2 py-0.5 text-[11px] ' +
                          (assignment.active
                            ? 'bg-emerald-50 text-emerald-700'
                            : 'bg-stone-100 text-stone-500')
                        }
                      >
                        {assignment.active ? 'ใช้งาน' : 'ปิด'}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => void toggle(assignment)}
                        disabled={busy}
                        className="mr-2 text-xs text-stone-600 hover:text-stone-900"
                      >
                        {assignment.active ? 'ปิด' : 'เปิด'}
                      </button>
                      <button
                        type="button"
                        onClick={() => void remove(assignment)}
                        disabled={busy}
                        className="text-xs text-rose-600 hover:text-rose-800"
                      >
                        ลบ
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}

/** Inline editor for the push target — the one field the rules engine needs. */
function LineIdCell({
  assignment,
  busy,
  onSave,
}: {
  assignment: RoleAssignment
  busy: boolean
  onSave: (assignment: RoleAssignment, value: string) => Promise<void>
}) {
  const [value, setValue] = useState(assignment.line_user_id ?? '')
  const [editing, setEditing] = useState(false)

  useEffect(() => {
    setValue(assignment.line_user_id ?? '')
  }, [assignment.line_user_id])

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className={
          'rounded px-1 text-left text-xs ' +
          (assignment.line_user_id ? 'font-mono text-stone-700' : 'text-amber-600')
        }
      >
        {assignment.line_user_id ?? 'ยังไม่มี — กดเพื่อกรอก'}
      </button>
    )
  }

  return (
    <span className="flex items-center gap-1">
      <input
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="U..."
        className="w-40 rounded border border-stone-300 px-1.5 py-1 font-mono text-xs"
      />
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          void onSave(assignment, value).then(() => setEditing(false))
        }}
        className="rounded bg-stone-900 px-2 py-1 text-[11px] text-white disabled:opacity-50"
      >
        บันทึก
      </button>
      <button type="button" onClick={() => setEditing(false)} className="text-[11px] text-stone-500">
        ยกเลิก
      </button>
    </span>
  )
}
