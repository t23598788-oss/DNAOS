"use client"
// DNA-000238: Admin material master — READ-ONLY (canonical authority = material_types เดิม)
// CREATE/EDIT/ARCHIVE = BLOCKED (ไม่มี canonical writer — ไม่สร้าง writer ใหม่โดยไม่ได้รับอนุมัติ)
import { useEffect, useState } from "react"
type Src = { pit_name: string; latitude: string | number | null; longitude: string | number | null; price: number | null }
type Mat = { id: string; name: string; density_ton_per_cbm: number | null; status: string; sources: Src[]; price_min: number | null; price_max: number | null }
export default function AdminMaterialsPage() {
  const [rows, setRows] = useState<Mat[]>([]); const [q, setQ] = useState(""); const [onlyActive, setOnlyActive] = useState(true); const [err, setErr] = useState<string | null>(null)
  useEffect(() => { fetch("/api/admin/materials").then((r) => r.json()).then((d) => setRows(d.materials ?? [])).catch(() => setErr("โหลดข้อมูลไม่สำเร็จ")) }, [])
  const filtered = rows.filter((m) => (!onlyActive || m.status === "ACTIVE") && (!q || m.name.includes(q)))
  if (err) return <div className="p-6 text-red-600">{err}</div>
  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">คลังวัสดุ (master data)</h1>
        <span className="text-xs text-stone-500">ใช้งาน {rows.filter((r) => r.status === "ACTIVE").length} รายการ · เขียน/แก้ไข = BLOCKED (รอ canonical writer)</span>
      </div>
      <div className="flex gap-3">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นชื่อวัสดุ…" className="border rounded px-3 py-1.5 text-sm w-64" />
        <label className="text-sm flex items-center gap-1"><input type="checkbox" checked={onlyActive} onChange={(e) => setOnlyActive(e.target.checked)} /> เฉพาะที่ยังใช้งาน</label>
      </div>
      <table className="w-full text-sm border">
        <thead><tr className="bg-stone-100 text-left"><th className="p-2">วัสดุ</th><th className="p-2">ความหนาแน่น</th><th className="p-2">แหล่ง (ราคา/หน่วย)</th><th className="p-2">ช่วงราคา</th><th className="p-2">สถานะ</th></tr></thead>
        <tbody>
          {filtered.map((m) => (
            <tr key={m.id} className="border-t align-top">
              <td className="p-2 font-medium">{m.name}</td>
              <td className="p-2">{m.density_ton_per_cbm != null ? `${m.density_ton_per_cbm} ตัน/ลบ.ม.` : "—"}</td>
              <td className="p-2">{m.sources.length ? m.sources.map((s, i) => <div key={i}>{s.pit_name}{s.price != null ? ` · ${s.price.toLocaleString("th-TH")} ฿` : ""}</div>) : "—"}</td>
              <td className="p-2">{m.price_min != null ? `${m.price_min.toLocaleString("th-TH")}–${m.price_max?.toLocaleString("th-TH")} ฿` : "—"}</td>
              <td className="p-2">{m.status === "ACTIVE" ? <span className="text-teal-600">ใช้งาน</span> : <span className="text-stone-400">เก็บถาวร</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!filtered.length && <p className="text-stone-500 text-sm">ไม่พบวัสดุที่ตรงเงื่อนไข</p>}
    </div>
  )
}
