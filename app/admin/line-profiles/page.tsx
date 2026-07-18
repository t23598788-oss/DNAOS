'use client'

import { useState, useEffect, useCallback } from "react"

interface Contact {
  line_user_id: string
  line_name: string | null
  line_picture: string | null
  first_seen_at: string
  role: string | null
  department: string | null
  trust_level: string | null
  notes: string | null
  profile_company: { id: string; name: string } | null
  matched_company: { id: string; name: string } | null
}

const ROLE_OPTIONS = [
  { value: "", label: "— ยังไม่กำหนด —" },
  { value: "employee", label: "พนักงานบริษัท" },
  { value: "customer", label: "ลูกค้า" },
  { value: "supplier", label: "ซัพพลายเออร์" },
  { value: "driver", label: "คนขับรถ" },
  { value: "owner", label: "เจ้าของรถ" },
  { value: "contractor", label: "ผู้รับเหมา" },
  { value: "accountant", label: "บัญชี" },
  { value: "manager", label: "ผู้จัดการ" },
  { value: "admin", label: "แอดมิน" },
  { value: "external", label: "บุคคลภายนอก" },
]

const TRUST_OPTIONS = [
  { value: "unverified", label: "ยังไม่ยืนยัน" },
  { value: "verified", label: "ยืนยันแล้ว" },
  { value: "flagged", label: "ต้องระวัง" },
]

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString("th-TH", { year: "numeric", month: "short", day: "numeric" })
}

export default function LineProfilesPage() {
  const [contacts, setContacts] = useState<Contact[]>([])
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await fetch("/api/admin/line-profiles")
    const data = await res.json()
    setContacts(data.contacts ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  async function updateProfile(lineUserId: string, patch: Record<string, unknown>) {
    setSavingId(lineUserId)
    setContacts((prev) => prev.map((c) => (c.line_user_id === lineUserId ? { ...c, ...mapPatchToContact(patch) } : c)))
    await fetch(`/api/admin/line-profiles/${lineUserId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    })
    setSavingId(null)
  }

  function mapPatchToContact(patch: Record<string, unknown>) {
    const out: Partial<Contact> = {}
    if ("role" in patch) out.role = (patch.role as string) || null
    if ("trustLevel" in patch) out.trust_level = patch.trustLevel as string
    if ("department" in patch) out.department = (patch.department as string) || null
    if ("notes" in patch) out.notes = (patch.notes as string) || null
    return out
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <div className="px-6 py-4 bg-white border-b border-stone-200 shrink-0">
        <div className="font-bold text-stone-800 text-sm">LINE Profile</div>
        <div className="text-[10px] text-stone-400 mt-0.5">
          {contacts.length} ราย — กำหนดบทบาทของผู้ติดต่อ LINE เพื่อช่วย AI จำแนกเอกสารที่ส่งเข้ามาได้แม่นยำขึ้น
          ไม่ใช่กฎตายตัว เป็นเพียงบริบทช่วยจำแนก
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading && <div className="text-center text-sm text-stone-400 py-16">กำลังโหลด...</div>}
        {!loading && contacts.length === 0 && (
          <div className="text-center text-sm text-stone-400 py-16">ยังไม่มีผู้ติดต่อ LINE ในระบบ</div>
        )}

        {!loading && contacts.length > 0 && (
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-stone-50 border-b border-stone-200 z-10">
              <tr>
                <th className="text-left px-5 py-2.5 font-semibold text-stone-500">ผู้ติดต่อ</th>
                <th className="text-left px-3 py-2.5 font-semibold text-stone-500">บริษัทที่จับคู่</th>
                <th className="text-left px-3 py-2.5 font-semibold text-stone-500">บทบาท</th>
                <th className="text-left px-3 py-2.5 font-semibold text-stone-500">แผนก</th>
                <th className="text-left px-3 py-2.5 font-semibold text-stone-500">ความน่าเชื่อถือ</th>
                <th className="text-left px-3 py-2.5 font-semibold text-stone-500">หมายเหตุ</th>
                <th className="text-right px-5 py-2.5 font-semibold text-stone-500">พบครั้งแรก</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {contacts.map((c) => (
                <tr key={c.line_user_id} className={`hover:bg-stone-50 transition ${savingId === c.line_user_id ? "opacity-50" : ""}`}>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      {c.line_picture && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={c.line_picture} alt="" className="w-6 h-6 rounded-full" />
                      )}
                      <span className="font-semibold text-stone-800">{c.line_name ?? c.line_user_id.slice(0, 12)}</span>
                    </div>
                  </td>
                  <td className="px-3 py-3 text-stone-500">
                    {c.matched_company?.name ?? c.profile_company?.name ?? "—"}
                  </td>
                  <td className="px-3 py-3">
                    <select
                      className="text-xs border border-stone-200 rounded-lg px-2 py-1 bg-white"
                      value={c.role ?? ""}
                      onChange={(e) => updateProfile(c.line_user_id, { role: e.target.value })}
                    >
                      {ROLE_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                    </select>
                  </td>
                  <td className="px-3 py-3">
                    <input
                      className="text-xs border border-stone-200 rounded-lg px-2 py-1 bg-white w-24"
                      defaultValue={c.department ?? ""}
                      onBlur={(e) => { if (e.target.value !== (c.department ?? "")) updateProfile(c.line_user_id, { department: e.target.value }) }}
                      placeholder="—"
                    />
                  </td>
                  <td className="px-3 py-3">
                    <select
                      className={`text-xs border rounded-lg px-2 py-1 ${
                        c.trust_level === "flagged" ? "border-rose-200 bg-rose-50 text-rose-700"
                        : c.trust_level === "verified" ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                        : "border-stone-200 bg-white"
                      }`}
                      value={c.trust_level ?? "unverified"}
                      onChange={(e) => updateProfile(c.line_user_id, { trustLevel: e.target.value })}
                    >
                      {TRUST_OPTIONS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                  </td>
                  <td className="px-3 py-3">
                    <input
                      className="text-xs border border-stone-200 rounded-lg px-2 py-1 bg-white w-32"
                      defaultValue={c.notes ?? ""}
                      onBlur={(e) => { if (e.target.value !== (c.notes ?? "")) updateProfile(c.line_user_id, { notes: e.target.value }) }}
                      placeholder="—"
                    />
                  </td>
                  <td className="px-5 py-3 text-right text-stone-400">{fmtDate(c.first_seen_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
