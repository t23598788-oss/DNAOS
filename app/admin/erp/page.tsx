// แดชบอร์ด ERP Brain Core — สถานะระบบ, ออร์แกน, สถิติสินค้า, จัดการสินค้า
'use client'

import { useEffect, useState, useCallback } from "react"

interface Organ {
  key: string
  label_th: string
  purpose_th: string
  heart: boolean
  status: "available" | "partial" | "unavailable"
  sources: { table: string; count: number | null }[]
  routes: string[]
  writers: string[]
}

interface BrainSnapshot {
  health: "healthy" | "partial" | "disconnected"
  health_score: number
  coverage: {
    organs_total: number
    organs_available: number
    organs_partial: number
    organs_unavailable: number
    sources_total: number
    sources_available: number
    sources_missing: number
  }
  organs: Organ[]
  missing_sources: string[]
  stats?: {
    product_catalog?: {
      business_profiles: number
      catalogs: number
      products_total: number
      products_available: number
      products_out_of_stock: number
      products_custom_order: number
      media_showcases: number
      price_min: number | null
      price_max: number | null
      price_avg: number | null
    }
  }
  note: string
}

interface Product {
  id: string
  catalog_id: string | null
  business_id: string
  name: string
  specs: Record<string, unknown>
  price: number | string | null
  status: string
  created_at: string
}

interface BusinessProfile {
  id: string
  company_name: string
  business_type: string | null
  verified_status: boolean
  channel_origin: string | null
  created_at: string
}

const STATUS_LABEL: Record<string, string> = {
  AVAILABLE: "พร้อมขาย",
  OUT_OF_STOCK: "หมด",
  CUSTOM_ORDER: "สั่งทำ",
}

export default function ErpBrainPage() {
  const [brain, setBrain] = useState<BrainSnapshot | null>(null)
  const [products, setProducts] = useState<Product[]>([])
  const [profiles, setProfiles] = useState<BusinessProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  // create product form
  const [newName, setNewName] = useState("")
  const [newBusinessId, setNewBusinessId] = useState("")
  const [newPrice, setNewPrice] = useState("")
  const [newStatus, setNewStatus] = useState("AVAILABLE")
  const [savingProduct, setSavingProduct] = useState(false)

  // create profile form
  const [newCompanyName, setNewCompanyName] = useState("")
  const [newBusinessType, setNewBusinessType] = useState("")
  const [newChannelOrigin, setNewChannelOrigin] = useState("")
  const [savingProfile, setSavingProfile] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [brainRes, prodRes, profRes] = await Promise.all([
        fetch("/api/admin/erp/brain"),
        fetch("/api/admin/erp/products"),
        fetch("/api/admin/erp/business-profiles"),
      ])
      if (!brainRes.ok) {
        const d = await brainRes.json().catch(() => ({}))
        throw new Error(d.error ?? `brain ${brainRes.status}`)
      }
      const brainData = await brainRes.json()
      const prodData = await prodRes.json().catch(() => ({}))
      const profData = await profRes.json().catch(() => ({}))
      setBrain(brainData)
      setProducts(prodData.products ?? [])
      setProfiles(profData.business_profiles ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : "โหลดไม่สำเร็จ")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const createProfile = async () => {
    if (!newCompanyName.trim()) return
    setSavingProfile(true)
    setNotice(null)
    try {
      const res = await fetch("/api/admin/erp/business-profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company_name: newCompanyName.trim(),
          business_type: newBusinessType.trim() || null,
          channel_origin: newChannelOrigin.trim() || null,
        }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) { setNotice(d.error ?? "สร้างโปรไฟล์ไม่สำเร็จ"); return }
      setNewCompanyName("")
      setNewBusinessType("")
      setNewChannelOrigin("")
      setNotice("สร้างโปรไฟล์ธุรกิจแล้ว")
      await load()
    } finally {
      setSavingProfile(false)
    }
  }

  const createProduct = async () => {
    if (!newName.trim() || !newBusinessId) return
    setSavingProduct(true)
    setNotice(null)
    try {
      const res = await fetch("/api/admin/erp/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName.trim(),
          business_id: newBusinessId,
          price: newPrice.trim() ? Number(newPrice) : null,
          status: newStatus,
        }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) { setNotice(d.error ?? "เพิ่มสินค้าไม่สำเร็จ"); return }
      setNewName("")
      setNewPrice("")
      setNotice("เพิ่มสินค้าแล้ว")
      await load()
    } finally {
      setSavingProduct(false)
    }
  }

  const deleteProduct = async (id: string) => {
    if (!confirm("ลบสินค้านี้?")) return
    const res = await fetch(`/api/admin/erp/products/${id}`, { method: "DELETE" })
    const d = await res.json().catch(() => ({}))
    if (!res.ok) { setNotice(d.error ?? "ลบไม่สำเร็จ"); return }
    setNotice("ลบสินค้าแล้ว")
    await load()
  }

  const updateStatus = async (id: string, status: string) => {
    const res = await fetch(`/api/admin/erp/products/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    })
    const d = await res.json().catch(() => ({}))
    if (!res.ok) { setNotice(d.error ?? "อัปเดตไม่สำเร็จ"); return }
    await load()
  }

  const pc = brain?.stats?.product_catalog

  return (
    <div className="min-h-screen bg-stone-50">
      <div className="bg-white border-b border-stone-200 px-6 py-3">
        <h1 className="text-base font-bold text-stone-900">🧠 ERP Brain Core</h1>
        <p className="text-xs text-stone-600 mt-0.5">
          แกนกลางประมวลผล ERP — สถานะระบบ, สินค้า, โปรไฟล์ธุรกิจ และออร์แกนทั้งหมดในหน้าจอเดียว
        </p>
      </div>

      <div className="p-6 space-y-6">
        {error && (
          <div className="text-sm bg-rose-50 border border-rose-200 text-rose-800 rounded-lg px-4 py-3">{error}</div>
        )}
        {notice && (
          <div className="text-sm bg-sky-50 border border-sky-200 text-sky-900 rounded-lg px-4 py-3">{notice}</div>
        )}

        {/* Health overview */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-white rounded-xl border border-stone-200 px-4 py-3">
            <div className="text-2xl font-bold text-stone-900 tabular-nums">
              {loading ? "—" : brain?.health_score ?? 0}%
            </div>
            <div className="text-xs text-stone-500 mt-0.5">Health Score</div>
          </div>
          <div className="bg-white rounded-xl border border-stone-200 px-4 py-3">
            <div className="text-2xl font-bold text-emerald-700 tabular-nums">
              {loading ? "—" : brain?.coverage.organs_available ?? 0}/{brain?.coverage.organs_total ?? 0}
            </div>
            <div className="text-xs text-stone-500 mt-0.5">ออร์แกนพร้อม</div>
          </div>
          <div className="bg-white rounded-xl border border-stone-200 px-4 py-3">
            <div className="text-2xl font-bold text-stone-900 tabular-nums">
              {loading ? "—" : pc?.products_total ?? 0}
            </div>
            <div className="text-xs text-stone-500 mt-0.5">สินค้าทั้งหมด</div>
          </div>
          <div className="bg-white rounded-xl border border-stone-200 px-4 py-3">
            <div className="text-2xl font-bold text-amber-700 tabular-nums">
              {loading ? "—" : pc?.business_profiles ?? 0}
            </div>
            <div className="text-xs text-stone-500 mt-0.5">โปรไฟล์ธุรกิจ</div>
          </div>
        </div>

        {/* Product catalog stats */}
        {pc && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-white rounded-xl border border-stone-200 px-4 py-3">
              <div className="text-lg font-bold text-emerald-700 tabular-nums">{pc.products_available}</div>
              <div className="text-xs text-stone-500 mt-0.5">พร้อมขาย</div>
            </div>
            <div className="bg-white rounded-xl border border-stone-200 px-4 py-3">
              <div className="text-lg font-bold text-rose-700 tabular-nums">{pc.products_out_of_stock}</div>
              <div className="text-xs text-stone-500 mt-0.5">หมด</div>
            </div>
            <div className="bg-white rounded-xl border border-stone-200 px-4 py-3">
              <div className="text-lg font-bold text-stone-900 tabular-nums">{pc.products_custom_order}</div>
              <div className="text-xs text-stone-500 mt-0.5">สั่งทำ</div>
            </div>
            <div className="bg-white rounded-xl border border-stone-200 px-4 py-3">
              <div className="text-lg font-bold text-stone-900 tabular-nums">
                {pc.price_min != null ? pc.price_min.toLocaleString() : "—"} – {pc.price_max != null ? pc.price_max.toLocaleString() : "—"}
              </div>
              <div className="text-xs text-stone-500 mt-0.5">ช่วงราคา (฿)</div>
            </div>
          </div>
        )}

        {/* Organ grid */}
        <div>
          <div className="text-xs font-bold text-stone-500 uppercase tracking-wide mb-2">ออร์แกน ERP</div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {(brain?.organs ?? []).map((o) => (
              <div key={o.key} className="bg-white rounded-xl border border-stone-200 px-4 py-3">
                <div className="flex items-center justify-between">
                  <div className="font-semibold text-stone-900 text-sm">{o.label_th}</div>
                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                      o.status === "available"
                        ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                        : o.status === "partial"
                          ? "bg-amber-50 text-amber-700 border-amber-200"
                          : "bg-rose-50 text-rose-700 border-rose-200"
                    }`}
                  >
                    {o.status}
                  </span>
                </div>
                <div className="text-xs text-stone-500 mt-1">{o.purpose_th}</div>
                <div className="text-[10px] text-stone-400 mt-2">
                  {o.sources.map((s) => `${s.table}: ${s.count ?? "—"}`).join(" · ")}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Create business profile */}
        <div className="bg-white rounded-xl border border-stone-200 p-4 space-y-3">
          <div className="text-xs font-bold text-stone-500 uppercase tracking-wide">เพิ่มโปรไฟล์ธุรกิจ</div>
          <div className="flex flex-wrap gap-2">
            <input value={newCompanyName} onChange={(e) => setNewCompanyName(e.target.value)} placeholder="ชื่อบริษัท/ร้าน" className="flex-1 min-w-[200px] text-sm border border-stone-300 rounded-lg px-3 py-2" />
            <input value={newBusinessType} onChange={(e) => setNewBusinessType(e.target.value)} placeholder="ประเภท (เช่น CONSTRUCTION_MATERIALS)" className="flex-1 min-w-[200px] text-sm border border-stone-300 rounded-lg px-3 py-2" />
            <input value={newChannelOrigin} onChange={(e) => setNewChannelOrigin(e.target.value)} placeholder="ช่องทาง (FACEBOOK/LINE)" className="w-40 text-sm border border-stone-300 rounded-lg px-3 py-2" />
            <button onClick={createProfile} disabled={savingProfile || !newCompanyName.trim()} className="text-sm font-medium px-4 py-2 rounded-lg bg-stone-800 text-white disabled:opacity-40">
              {savingProfile ? "กำลังบันทึก..." : "เพิ่ม"}
            </button>
          </div>
        </div>

        {/* Create product */}
        <div className="bg-white rounded-xl border border-stone-200 p-4 space-y-3">
          <div className="text-xs font-bold text-stone-500 uppercase tracking-wide">เพิ่มสินค้า</div>
          <div className="flex flex-wrap gap-2">
            <select value={newBusinessId} onChange={(e) => setNewBusinessId(e.target.value)} className="text-sm border border-stone-300 rounded-lg px-3 py-2 bg-white min-w-[220px]">
              <option value="">เลือกโปรไฟล์ธุรกิจ...</option>
              {profiles.map((p) => <option key={p.id} value={p.id}>{p.company_name}</option>)}
            </select>
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="ชื่อสินค้า" className="flex-1 min-w-[200px] text-sm border border-stone-300 rounded-lg px-3 py-2" />
            <input value={newPrice} onChange={(e) => setNewPrice(e.target.value)} placeholder="ราคา (฿)" className="w-28 text-sm border border-stone-300 rounded-lg px-3 py-2" />
            <select value={newStatus} onChange={(e) => setNewStatus(e.target.value)} className="text-sm border border-stone-300 rounded-lg px-3 py-2 bg-white">
              <option value="AVAILABLE">พร้อมขาย</option>
              <option value="OUT_OF_STOCK">หมด</option>
              <option value="CUSTOM_ORDER">สั่งทำ</option>
            </select>
            <button onClick={createProduct} disabled={savingProduct || !newName.trim() || !newBusinessId} className="text-sm font-medium px-4 py-2 rounded-lg bg-emerald-600 text-white disabled:opacity-40">
              {savingProduct ? "กำลังบันทึก..." : "เพิ่มสินค้า"}
            </button>
          </div>
        </div>

        {/* Products table */}
        <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-stone-200 bg-stone-50 text-stone-700">
                <th className="text-left font-bold uppercase tracking-wide px-4 py-2.5">สินค้า</th>
                <th className="text-left font-bold uppercase tracking-wide px-3 py-2.5">โปรไฟล์</th>
                <th className="text-right font-bold uppercase tracking-wide px-3 py-2.5">ราคา</th>
                <th className="text-left font-bold uppercase tracking-wide px-3 py-2.5">สถานะ</th>
                <th className="px-3 py-2.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {loading && <tr><td colSpan={5} className="text-center text-stone-500 py-8 animate-pulse">โหลด...</td></tr>}
              {!loading && products.length === 0 && <tr><td colSpan={5} className="text-center text-stone-500 py-8">ยังไม่มีสินค้า</td></tr>}
              {products.map((p) => {
                const profile = profiles.find((pr) => pr.id === p.business_id)
                return (
                  <tr key={p.id} className="hover:bg-stone-50 transition">
                    <td className="px-4 py-3 font-semibold text-stone-900">{p.name}</td>
                    <td className="px-3 py-3 text-stone-700 text-xs">{profile?.company_name ?? p.business_id}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{p.price != null ? Number(p.price).toLocaleString() : "—"}</td>
                    <td className="px-3 py-3">
                      <select
                        value={p.status}
                        onChange={(e) => updateStatus(p.id, e.target.value)}
                        className="text-xs border border-stone-300 rounded-lg px-2 py-1 bg-white"
                      >
                        <option value="AVAILABLE">พร้อมขาย</option>
                        <option value="OUT_OF_STOCK">หมด</option>
                        <option value="CUSTOM_ORDER">สั่งทำ</option>
                      </select>
                    </td>
                    <td className="px-3 py-3 text-right">
                      <button onClick={() => deleteProduct(p.id)} className="text-[11px] font-medium px-2.5 py-1 rounded-lg border border-rose-200 text-rose-700 hover:bg-rose-50 transition">
                        ลบ
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {brain?.note && (
          <div className="text-xs text-stone-400 border-t border-stone-200 pt-3">{brain.note}</div>
        )}
      </div>
    </div>
  )
}
