'use client'

import { Fragment, useState, useEffect, useMemo, useCallback } from "react"
import Link from "next/link"

interface PitMaterial {
  id: string
  material_type_id: string
  name: string
  price: number
}

interface Publication {
  id: string
  source_table: string
  source_record_id: string
  status: "draft" | "published" | "expired" | "withdrawn"
  public_url: string | null
  expires_at: string | null
}

interface Pit {
  id: string
  name: string
  address: string | null
  province: string | null
  lat: number | null
  lng: number | null
  materials: PitMaterial[]
  active: boolean
  line_user_id: string | null
}

interface MaterialType {
  id: string
  name: string
}

export default function PitsPage() {
  const [pits, setPits] = useState<Pit[]>([])
  const [materialTypes, setMaterialTypes] = useState<MaterialType[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<"" | "active" | "inactive">("")
  const [priceFilter, setPriceFilter] = useState<"" | "yes" | "no">("")
  const [sortKey, setSortKey] = useState<"name" | "province" | "materials">("name")

  // Owner-reported gap 2026-07-11: this page could only SHOW that 91 of 96
  // pits had no price set — no way to actually enter one. This is the
  // missing write path.
  const [editingPitId, setEditingPitId] = useState<string | null>(null)
  const [newMaterialId, setNewMaterialId] = useState("")
  const [newPrice, setNewPrice] = useState("")
  const [editLat, setEditLat] = useState("")
  const [editLng, setEditLng] = useState("")
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // Outbound Supplier RFQ (owner, 2026-07-24) — admin-confirmed "ขอราคา"
  // send to a pit's real LINE contact; reply is parsed by the LINE webhook,
  // never auto-sent.
  const [quoteMaterialId, setQuoteMaterialId] = useState("")
  const [quoteQty, setQuoteQty] = useState("")
  const [quoteSending, setQuoteSending] = useState(false)
  const [quoteMessage, setQuoteMessage] = useState<string | null>(null)

  // Per-item publication permission (owner task 2026-10-25). A price goes on the
  // public website ONLY when its own publication_records row exists — see
  // app/api/admin/publications/route.ts. No price is public by default.
  const [publications, setPublications] = useState<Record<string, Publication>>({})
  const [publishDays, setPublishDays] = useState<string>("90")
  const [publishingId, setPublishingId] = useState<string | null>(null)
  const [pubNotice, setPubNotice] = useState<string | null>(null)
  const [pubUnavailable, setPubUnavailable] = useState<string | null>(null)

  const loadPublications = useCallback(async () => {
    const res = await fetch("/api/admin/publications")
    if (res.status === 409) {
      const d = await res.json().catch(() => ({}))
      setPubUnavailable(d.error ?? "ตาราง publication_records ยังไม่มีในฐานข้อมูลจริง")
      return
    }
    const d = await res.json().catch(() => ({}))
    setPubUnavailable(null)
    const map: Record<string, Publication> = {}
    for (const p of (d.publications ?? []) as Publication[]) {
      map[`${p.source_table}:${p.source_record_id}`] = p
    }
    setPublications(map)
  }, [])

  const setPublication = async (material: PitMaterial, publish: boolean) => {
    setPublishingId(material.id)
    setPubNotice(null)
    try {
      const res = await fetch("/api/admin/publications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: publish ? "publish" : "withdraw",
          source_table: "pit_materials",
          source_record_id: material.id,
          // publishing asserts the price was verified against the source row
          confirm_facts: publish,
          expires_in_days: publish && publishDays !== "none" ? Number(publishDays) : null,
        }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        setPubNotice(d.error ?? "อัปเดตสิทธิ์เผยแพร่ไม่สำเร็จ")
        return
      }
      setPubNotice(
        publish
          ? `เผยแพร่ "${material.name}" ที่ ${material.price.toLocaleString()}฿ แล้ว → ${d.publication?.public_url ?? ""}`
          : `ถอน "${material.name}" จากเว็บสาธารณะแล้ว`,
      )
      await loadPublications()
    } finally {
      setPublishingId(null)
    }
  }

  const load = useCallback(() => {
    setLoading(true)
    fetch("/api/admin/pits")
      .then((r) => r.json())
      .then((d) => { setPits(d.pits ?? []); setMaterialTypes(d.materialTypes ?? []) })
      .finally(() => setLoading(false))
    void loadPublications()
  }, [loadPublications])

  useEffect(() => { load() }, [load])

  const startEdit = (pit: Pit) => {
    setEditingPitId(pit.id)
    setNewMaterialId("")
    setNewPrice("")
    setEditLat(pit.lat != null ? String(pit.lat) : "")
    setEditLng(pit.lng != null ? String(pit.lng) : "")
    setSaveError(null)
    setQuoteMaterialId("")
    setQuoteQty("")
    setQuoteMessage(null)
  }

  const sendPriceRequest = async (pitId: string) => {
    if (!quoteMaterialId) return
    setQuoteSending(true)
    setQuoteMessage(null)
    try {
      const res = await fetch(`/api/admin/pits/${pitId}/request-quote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          material_type_id: quoteMaterialId,
          quantity: quoteQty.trim() ? Number(quoteQty) : null,
        }),
      })
      const d = await res.json()
      setQuoteMessage(res.ok ? "ส่งขอราคาแล้ว รอคำตอบจาก LINE" : (d.error ?? "ส่งไม่สำเร็จ"))
      if (res.ok) { setQuoteMaterialId(""); setQuoteQty("") }
    } finally {
      setQuoteSending(false)
    }
  }

  const saveMaterialPrice = async (pitId: string) => {
    if (!newMaterialId || !newPrice.trim()) return
    setSaving(true)
    setSaveError(null)
    try {
      const res = await fetch(`/api/admin/pits/${pitId}/materials`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ material_type_id: newMaterialId, price: Number(newPrice) }),
      })
      const d = await res.json()
      if (!res.ok) { setSaveError(d.error ?? "บันทึกราคาไม่สำเร็จ"); return }
      setNewMaterialId("")
      setNewPrice("")
      load()
    } finally {
      setSaving(false)
    }
  }

  const saveGps = async (pitId: string) => {
    setSaving(true)
    setSaveError(null)
    try {
      const res = await fetch(`/api/admin/pits/${pitId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ latitude: Number(editLat), longitude: Number(editLng) }),
      })
      const d = await res.json()
      if (!res.ok) { setSaveError(d.error ?? "บันทึกพิกัดไม่สำเร็จ"); return }
      load()
    } finally {
      setSaving(false)
    }
  }

  const stats = useMemo(() => {
    const active = pits.filter((p) => p.active).length
    const withGps = pits.filter((p) => p.lat).length
    const withPrice = pits.filter((p) => p.materials.length > 0).length
    return { total: pits.length, active, withGps, withPrice }
  }, [pits])

  const provinceCounts = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of pits) {
      const key = p.province ?? "ไม่ระบุในที่อยู่"
      m.set(key, (m.get(key) ?? 0) + 1)
    }
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1])
  }, [pits])

  const materialCounts = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of pits) for (const mat of p.materials) m.set(mat.name, (m.get(mat.name) ?? 0) + 1)
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1])
  }, [pits])

  const maxProvince = Math.max(1, ...provinceCounts.map(([, n]) => n))

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    let rows = pits.filter((p) => {
      if (q && !(p.name.toLowerCase().includes(q) || (p.address ?? "").toLowerCase().includes(q))) return false
      if (statusFilter === "active" && !p.active) return false
      if (statusFilter === "inactive" && p.active) return false
      if (priceFilter === "yes" && p.materials.length === 0) return false
      if (priceFilter === "no" && p.materials.length > 0) return false
      return true
    })
    rows = [...rows].sort((a, b) => {
      if (sortKey === "materials") return b.materials.length - a.materials.length
      if (sortKey === "province") return (a.province ?? "").localeCompare(b.province ?? "", "th")
      return a.name.localeCompare(b.name, "th")
    })
    return rows
  }, [pits, search, statusFilter, priceFilter, sortKey])

  return (
    <div className="min-h-screen bg-stone-50">
      <div className="bg-white border-b border-stone-200 px-6 py-3">
        <h1 className="text-base font-bold text-stone-900">🪨 บ่อวัสดุ</h1>
        <p className="text-xs text-stone-600 mt-0.5">
          ข้อมูลจริงจาก pit_profiles / pit_materials — จุดเดียวกับที่สูตรคำนวณราคา (
          <code className="text-stone-400">engines/cost.ts</code>) ใช้จริง ถ้าบ่อไหนไม่มีราคาผูกไว้ที่นี่ ระบบคำนวณราคาอัตโนมัติให้ไม่ได้
        </p>
      </div>

      <div className="p-6 space-y-6">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-white rounded-xl border border-stone-200 px-4 py-3">
            <div className="text-2xl font-bold text-stone-900 tabular-nums">{loading ? "—" : stats.total}</div>
            <div className="text-xs text-stone-500 mt-0.5">บ่อทั้งหมด</div>
          </div>
          <div className="bg-white rounded-xl border border-stone-200 px-4 py-3">
            <div className="text-2xl font-bold text-emerald-700 tabular-nums">{loading ? "—" : stats.active}</div>
            <div className="text-xs text-stone-500 mt-0.5">ใช้งานอยู่</div>
          </div>
          <div className="bg-white rounded-xl border border-stone-200 px-4 py-3">
            <div className="text-2xl font-bold text-stone-900 tabular-nums">{loading ? "—" : stats.withGps}</div>
            <div className="text-xs text-stone-500 mt-0.5">มีพิกัด GPS จริง</div>
          </div>
          <div className="bg-white rounded-xl border border-stone-200 px-4 py-3">
            <div className="text-2xl font-bold text-amber-700 tabular-nums">{loading ? "—" : stats.withPrice}</div>
            <div className="text-xs text-stone-500 mt-0.5">มีราคาผูกไว้จริง</div>
          </div>
        </div>

        {!loading && stats.total > 0 && stats.withPrice < stats.total && (
          <div className="text-sm bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-4 py-3">
            เหลืออีก <strong>{stats.total - stats.withPrice} บ่อ</strong> ที่ยังไม่มีราคาผูกไว้ — คำนวณราคาอัตโนมัติให้ลูกค้าไม่ได้จนกว่าจะกรอกราคาเพิ่ม ดูคำขอราคาที่ค้างอยู่ที่{" "}
            <Link href="/admin/quotation-queue" className="underline font-medium">คำขอราคาค้าง →</Link>
          </div>
        )}

        {pubUnavailable && (
          <div className="text-sm bg-stone-100 border border-stone-300 text-stone-700 rounded-lg px-4 py-3">
            <strong>ยังกำหนดสิทธิ์เผยแพร่รายรายการไม่ได้:</strong> {pubUnavailable}
          </div>
        )}
        {pubNotice && (
          <div className="text-sm bg-sky-50 border border-sky-200 text-sky-900 rounded-lg px-4 py-3">{pubNotice}</div>
        )}

        <div className="flex flex-wrap items-center gap-2 text-xs text-stone-600">
          <span className="font-medium">ระยะเวลาเผยแพร่เมื่อกด &quot;เผยแพร่&quot;:</span>
          <select
            value={publishDays}
            onChange={(e) => setPublishDays(e.target.value)}
            className="text-xs border border-stone-300 rounded-lg px-2 py-1.5 bg-white"
          >
            <option value="30">30 วัน</option>
            <option value="90">90 วัน</option>
            <option value="180">180 วัน</option>
            <option value="none">ไม่กำหนดวันหมดอายุ</option>
          </select>
          <span className="text-stone-400">
            ราคาที่ไม่ถูกเผยแพร่จะไม่ปรากฏบนเว็บสาธารณะเลย — แม้จะกรอกไว้ในระบบแล้ว
          </span>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          <div>
            <div className="text-xs font-bold text-stone-500 uppercase tracking-wide mb-2">กระจายตามจังหวัด</div>
            <div className="bg-white rounded-xl border border-stone-200 p-4 space-y-2.5">
              {provinceCounts.map(([prov, n]) => (
                <div key={prov} className="flex items-center gap-3 text-sm">
                  <div className="w-28 shrink-0 font-medium text-stone-700 truncate">{prov}</div>
                  <div className="flex-1 h-2.5 bg-stone-100 rounded-full overflow-hidden">
                    <div className="h-full bg-amber-600 rounded-full" style={{ width: `${(n / maxProvince) * 100}%` }} />
                  </div>
                  <div className="w-8 text-right text-stone-500 tabular-nums">{n}</div>
                </div>
              ))}
            </div>
          </div>
          <div>
            <div className="text-xs font-bold text-stone-500 uppercase tracking-wide mb-2">ชนิดวัสดุที่มีราคาจริง</div>
            <div className="bg-white rounded-xl border border-stone-200 p-4 flex flex-wrap gap-2 content-start">
              {materialCounts.length === 0 && <span className="text-sm text-stone-400">ยังไม่มีวัสดุที่มีราคา</span>}
              {materialCounts.map(([name, n]) => (
                <span key={name} className="text-xs font-medium px-3 py-1.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                  {name} <span className="opacity-60">×{n}</span>
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ค้นหาชื่อบ่อหรือที่อยู่..."
            className="flex-1 min-w-[200px] text-sm border border-stone-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-500"
          />
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)} className="text-sm border border-stone-300 rounded-lg px-3 py-2 bg-white">
            <option value="">ทุกสถานะ</option>
            <option value="active">ใช้งานอยู่</option>
            <option value="inactive">ปิด/ลบแล้ว</option>
          </select>
          <select value={priceFilter} onChange={(e) => setPriceFilter(e.target.value as any)} className="text-sm border border-stone-300 rounded-lg px-3 py-2 bg-white">
            <option value="">ทุกบ่อ</option>
            <option value="yes">มีราคาแล้ว</option>
            <option value="no">ยังไม่มีราคา</option>
          </select>
          <select value={sortKey} onChange={(e) => setSortKey(e.target.value as any)} className="text-sm border border-stone-300 rounded-lg px-3 py-2 bg-white">
            <option value="name">เรียงตามชื่อ</option>
            <option value="province">เรียงตามจังหวัด</option>
            <option value="materials">เรียงตามจำนวนราคา</option>
          </select>
        </div>

        <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-stone-200 bg-stone-50 text-stone-700">
                <th className="text-left font-bold uppercase tracking-wide px-4 py-2.5">ชื่อบ่อ</th>
                <th className="text-left font-bold uppercase tracking-wide px-3 py-2.5">จังหวัด</th>
                <th className="text-left font-bold uppercase tracking-wide px-3 py-2.5">พิกัด GPS</th>
                <th className="text-left font-bold uppercase tracking-wide px-3 py-2.5">วัสดุที่มีราคา</th>
                <th className="text-right font-bold uppercase tracking-wide px-4 py-2.5">สถานะ</th>
                <th className="px-3 py-2.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {loading && <tr><td colSpan={6} className="text-center text-stone-500 py-8 animate-pulse">โหลด...</td></tr>}
              {!loading && filtered.length === 0 && <tr><td colSpan={6} className="text-center text-stone-500 py-8">ไม่พบบ่อที่ตรงเงื่อนไข</td></tr>}
              {filtered.map((p) => {
                const isEditing = editingPitId === p.id
                const unpriced = materialTypes.filter((mt) => !p.materials.some((m) => m.material_type_id === mt.id))
                return (
                  <Fragment key={p.id}>
                    <tr className="hover:bg-stone-50 transition">
                      <td className="px-4 py-3">
                        <div className="font-semibold text-stone-900">{p.name}</div>
                        <div className="text-xs text-stone-400 mt-0.5 max-w-[32ch] truncate">{p.address}</div>
                      </td>
                      <td className="px-3 py-3 text-stone-700">{p.province ?? "—"}</td>
                      <td className="px-3 py-3 text-stone-500 tabular-nums text-xs whitespace-nowrap">
                        {p.lat ? `${p.lat.toFixed(4)}, ${p.lng!.toFixed(4)}` : "—"}
                      </td>
                      <td className="px-3 py-3">
                        {p.materials.length > 0 ? (
                          <div className="flex flex-wrap gap-1.5">
                            {p.materials.map((m) => {
                              const pub = publications[`pit_materials:${m.id}`]
                              const live = pub?.status === "published"
                              return (
                                <span
                                  key={m.id}
                                  className={`inline-flex items-center gap-1 text-[11px] rounded-full border px-2 py-0.5 ${
                                    live
                                      ? "bg-emerald-50 text-emerald-800 border-emerald-300"
                                      : "bg-white text-stone-700 border-stone-300"
                                  }`}
                                >
                                  <span>
                                    {m.name} ({m.price.toLocaleString()}฿)
                                  </span>
                                  <span className={`text-[10px] ${live ? "text-emerald-600" : "text-stone-400"}`}>
                                    {live ? "● บนเว็บ" : "○ ส่วนตัว"}
                                  </span>
                                  <button
                                    onClick={() => setPublication(m, !live)}
                                    disabled={publishingId === m.id}
                                    title={
                                      live
                                        ? "ถอนการเผยแพร่ — ราคาจะหายจากเว็บสาธารณะ"
                                        : `เผยแพร่ราคานี้บนเว็บ (ยืนยันว่าราคา ${m.price.toLocaleString()}฿ ถูกต้องแล้ว)`
                                    }
                                    className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border disabled:opacity-40 ${
                                      live
                                        ? "border-rose-300 text-rose-700 hover:bg-rose-50"
                                        : "border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                                    }`}
                                  >
                                    {publishingId === m.id ? "…" : live ? "ถอน" : "เผยแพร่"}
                                  </button>
                                </span>
                              )
                            })}
                          </div>
                        ) : (
                          <span className="text-stone-400 italic text-xs">ยังไม่มีราคา</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${p.active ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-stone-100 text-stone-500 border border-stone-200"}`}>
                          {p.active ? "ใช้งานอยู่" : "ปิด/ลบแล้ว"}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-right">
                        <button
                          onClick={() => isEditing ? setEditingPitId(null) : startEdit(p)}
                          className="text-[11px] font-medium px-2.5 py-1 rounded-lg border border-amber-200 text-amber-700 hover:bg-amber-50 transition"
                        >
                          {isEditing ? "ปิด" : "แก้ไข"}
                        </button>
                      </td>
                    </tr>
                    {isEditing && (
                      <tr className="bg-amber-50/40">
                        <td colSpan={6} className="px-4 py-4">
                          {saveError && <div className="text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 mb-3">{saveError}</div>}
                          <div className="grid md:grid-cols-2 gap-4">
                            <div>
                              <div className="text-[11px] font-bold text-stone-500 uppercase tracking-wide mb-2">พิกัด GPS</div>
                              <div className="flex gap-2">
                                <input value={editLat} onChange={(e) => setEditLat(e.target.value)} placeholder="latitude" className="w-32 text-xs border border-stone-300 rounded-lg px-2 py-1.5" />
                                <input value={editLng} onChange={(e) => setEditLng(e.target.value)} placeholder="longitude" className="w-32 text-xs border border-stone-300 rounded-lg px-2 py-1.5" />
                                <button onClick={() => saveGps(p.id)} disabled={saving} className="text-xs font-medium px-3 py-1.5 rounded-lg bg-stone-800 text-white disabled:opacity-40">บันทึกพิกัด</button>
                              </div>
                            </div>
                            <div>
                              <div className="text-[11px] font-bold text-stone-500 uppercase tracking-wide mb-2">เพิ่ม/แก้ราคาวัสดุ</div>
                              <div className="flex gap-2">
                                <select value={newMaterialId} onChange={(e) => setNewMaterialId(e.target.value)} className="text-xs border border-stone-300 rounded-lg px-2 py-1.5 bg-white flex-1">
                                  <option value="">เลือกวัสดุ...</option>
                                  {p.materials.length > 0 && (
                                    <optgroup label="มีราคาแล้ว — แก้ไข">
                                      {p.materials.map((m) => <option key={m.material_type_id} value={m.material_type_id}>{m.name} (ปัจจุบัน {m.price.toLocaleString()}฿)</option>)}
                                    </optgroup>
                                  )}
                                  {unpriced.length > 0 && (
                                    <optgroup label="ยังไม่มีราคา">
                                      {unpriced.map((mt) => <option key={mt.id} value={mt.id}>{mt.name}</option>)}
                                    </optgroup>
                                  )}
                                </select>
                                <input value={newPrice} onChange={(e) => setNewPrice(e.target.value)} placeholder="ราคา/คิว" className="w-24 text-xs border border-stone-300 rounded-lg px-2 py-1.5" />
                                <button onClick={() => saveMaterialPrice(p.id)} disabled={saving || !newMaterialId || !newPrice.trim()} className="text-xs font-medium px-3 py-1.5 rounded-lg bg-emerald-600 text-white disabled:opacity-40">บันทึก</button>
                              </div>
                            </div>
                          </div>

                          <div className="mt-4 pt-4 border-t border-amber-200/60">
                            <div className="text-[11px] font-bold text-stone-500 uppercase tracking-wide mb-2">ขอราคาผ่าน LINE (Outbound RFQ)</div>
                            {!p.line_user_id ? (
                              <div className="text-xs text-stone-400 italic">บ่อนี้ยังไม่ได้เชื่อมบัญชี LINE — ส่งขอราคาอัตโนมัติไม่ได้</div>
                            ) : (
                              <>
                                {quoteMessage && <div className="text-xs text-stone-600 bg-white border border-stone-200 rounded-lg px-3 py-2 mb-2">{quoteMessage}</div>}
                                <div className="flex gap-2">
                                  <select value={quoteMaterialId} onChange={(e) => setQuoteMaterialId(e.target.value)} className="text-xs border border-stone-300 rounded-lg px-2 py-1.5 bg-white flex-1">
                                    <option value="">เลือกวัสดุที่จะถามราคา...</option>
                                    {materialTypes.map((mt) => <option key={mt.id} value={mt.id}>{mt.name}</option>)}
                                  </select>
                                  <input value={quoteQty} onChange={(e) => setQuoteQty(e.target.value)} placeholder="จำนวนคิว (ไม่บังคับ)" className="w-36 text-xs border border-stone-300 rounded-lg px-2 py-1.5" />
                                  <button
                                    onClick={() => sendPriceRequest(p.id)}
                                    disabled={quoteSending || !quoteMaterialId}
                                    className="text-xs font-medium px-3 py-1.5 rounded-lg bg-sky-600 text-white disabled:opacity-40"
                                  >
                                    {quoteSending ? "กำลังส่ง..." : "ส่งขอราคา"}
                                  </button>
                                </div>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
