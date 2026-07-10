'use client'

import { useState, useEffect, useMemo } from "react"
import Link from "next/link"

interface PitMaterial {
  name: string
  price: number
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
}

export default function PitsPage() {
  const [pits, setPits] = useState<Pit[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<"" | "active" | "inactive">("")
  const [priceFilter, setPriceFilter] = useState<"" | "yes" | "no">("")
  const [sortKey, setSortKey] = useState<"name" | "province" | "materials">("name")

  useEffect(() => {
    fetch("/api/admin/pits")
      .then((r) => r.json())
      .then((d) => setPits(d.pits ?? []))
      .finally(() => setLoading(false))
  }, [])

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
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {loading && <tr><td colSpan={5} className="text-center text-stone-500 py-8 animate-pulse">โหลด...</td></tr>}
              {!loading && filtered.length === 0 && <tr><td colSpan={5} className="text-center text-stone-500 py-8">ไม่พบบ่อที่ตรงเงื่อนไข</td></tr>}
              {filtered.map((p) => (
                <tr key={p.id} className="hover:bg-stone-50 transition">
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
                      <span className="text-stone-700 text-xs">
                        {p.materials.map((m) => `${m.name} (${m.price.toLocaleString()}฿)`).join(", ")}
                      </span>
                    ) : (
                      <span className="text-stone-400 italic text-xs">ยังไม่มีราคา</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${p.active ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-stone-100 text-stone-500 border border-stone-200"}`}>
                      {p.active ? "ใช้งานอยู่" : "ปิด/ลบแล้ว"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
