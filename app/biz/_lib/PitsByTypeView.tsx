"use client"

/**
 * PitsByTypeView — มุมมอง "บ่อ/แพล้นท์ ตามประเภทกิจการ" บนตารางกลาง (BizTable)
 * ใช้ API เดิมทุกประการ: GET /api/admin/pits (อ่าน) · PATCH /api/admin/pits/[id] (เขียน GPS + ประเภท)
 * ไม่มี endpoint ใหม่ · ไม่มีข้อมูลตัวอย่าง · ไม่เรียกฐานข้อมูลตรง
 */
import { useCallback, useEffect, useMemo, useState } from "react"
import BizTable, { type BizColumn } from "./BizTable"

interface PitRow {
  id: string
  name: string
  province: string | null
  lat: number | null
  lng: number | null
  materials: { name: string; price: number }[]
  active: boolean
  facility_type_id: string | null
  business_type: string
  business_type_label: string
  type_source: string
}

interface FacilityType { id: string; code: string; name: string; name_th: string | null }

export default function PitsByTypeView({ typeCodes, title }: { typeCodes: string[]; title: string }) {
  const [rows, setRows] = useState<PitRow[]>([])
  const [facilityTypes, setFacilityTypes] = useState<FacilityType[]>([])
  const [materialTypes, setMaterialTypes] = useState<{ id: string; name: string }[]>([])
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState("")
  const [editing, setEditing] = useState<Record<string, string> | null>(null)
  const [savingKey, setSavingKey] = useState<string | null>(null)
  // เพิ่มบ่อ/แพล้นท์ใหม่ — POST /api/admin/pits (เส้นทางเขียนใหม่ใน route เดิม 2026-10-13)
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState("")
  const [newAddress, setNewAddress] = useState("")
  const [newTypeId, setNewTypeId] = useState("")
  const [newLat, setNewLat] = useState("")
  const [newLng, setNewLng] = useState("")
  const [addBusy, setAddBusy] = useState(false)
  const [addMsg, setAddMsg] = useState<string | null>(null)
  // แก้ไขราคาวัสดุผ่าน API เดิม POST /api/admin/pits/[pitId]/materials (upsert)
  const [pricePitId, setPricePitId] = useState<string | null>(null)
  const [priceMaterialId, setPriceMaterialId] = useState("")
  const [priceValue, setPriceValue] = useState("")
  const [priceBusy, setPriceBusy] = useState(false)
  const [priceMsg, setPriceMsg] = useState<string | null>(null)

  const load = useCallback(() => {
    // ตอน mount ไม่ setState แบบ sync (busy เริ่ม true อยู่แล้ว) —
    // ค่า busy/err ทั้งหมดตั้งใน callback ของ fetch เพื่อให้ผ่าน react-hooks/set-state-in-effect
    fetch("/api/admin/pits")
      .then(async (r) => {
        const d = await r.json()
        if (!r.ok) throw new Error((d as { error?: string }).error ?? `HTTP ${r.status}`)
        setError(null)
        setRows((d.pits ?? []) as PitRow[])
        setFacilityTypes((d.facilityTypes ?? []) as FacilityType[])
        setMaterialTypes((d.materialTypes ?? []) as { id: string; name: string }[])
      })
      .catch((e: Error) => setError(`โหลดข้อมูลไม่สำเร็จ: ${e.message}`))
      .finally(() => setBusy(false))
  }, [])

  /** รีเฟรชจากปุ่ม/หลังบันทึก — แสดงสถานะกำลังโหลดด้วย (เรียกจาก event handler จึงตั้ง busy ได้) */
  const refresh = useCallback(() => {
    setBusy(true)
    setError(null)
    load()
  }, [load])

  useEffect(() => { load() }, [load])

  const sectionRows = useMemo(() => rows.filter((r) => typeCodes.includes(r.business_type)), [rows, typeCodes])

  const typeOptions = useMemo(
    () => [{ value: "", label: "ยังไม่ระบุ" }, ...facilityTypes.map((f) => ({ value: f.id, label: `${f.name_th || f.name} (${f.code})` }))],
    [facilityTypes],
  )

  const columns: BizColumn<PitRow>[] = useMemo(() => [
    { key: "name", label: "ชื่อบ่อ/แพล้นท์", binds: "pit_profiles.pit_name", width: "240px", render: (r) => <span className="font-semibold text-stone-900">{r.name}</span> },
    {
      key: "type", label: "ประเภทกิจการ", binds: "pit_profiles.facility_type_id → facility_types.id", width: "220px",
      editable: { type: "select", options: typeOptions, value: (r) => r.facility_type_id ?? "" },
      render: (r) => (<span>{r.business_type_label}<span className="ml-1 text-[10px] text-stone-400">{r.type_source === "STORED" ? "· บันทึกจริง" : r.type_source === "INFERRED" ? "· อนุมาน" : "· ไม่มีหลักฐาน"}</span></span>),
    },
    { key: "province", label: "จังหวัด", binds: "pit_profiles.address (แยก จ.)", width: "110px", render: (r) => r.province ?? "—" },
    { key: "lat", label: "ละติจูด", binds: "pit_profiles.latitude", width: "130px", editable: { type: "number", value: (r) => (r.lat != null ? String(r.lat) : "") }, render: (r) => (r.lat != null ? <span className="tabular-nums">{r.lat.toFixed(4)}</span> : <span className="text-stone-400">—</span>) },
    { key: "lng", label: "ลองจิจูด", binds: "pit_profiles.longitude", width: "130px", editable: { type: "number", value: (r) => (r.lng != null ? String(r.lng) : "") }, render: (r) => (r.lng != null ? <span className="tabular-nums">{r.lng.toFixed(4)}</span> : <span className="text-stone-400">—</span>) },
    {
      key: "materials", label: "วัสดุที่ผูกราคา", binds: "pit_materials ⋈ material_types (price)", width: "240px",
      render: (r) => (r.materials.length ? <span className="text-xs">{r.materials.map((m) => `${m.name} (${m.price.toLocaleString()}฿)`).join(", ")}</span> : <span className="text-stone-400 italic text-xs">ยังไม่มีราคา</span>),
    },
    {
      key: "status", label: "สถานะ", binds: "pit_profiles.deleted_at", width: "110px",
      render: (r) => (<span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${r.active ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-stone-100 text-stone-500 border border-stone-200"}`}>{r.active ? "ใช้งานอยู่" : "ปิด/ลบแล้ว"}</span>),
    },
  ], [typeOptions])

  /**
   * บันทึกราคาวัสดุ — เรียก POST /api/admin/pits/[pitId]/materials "เดิม" (upsert ฝั่ง server)
   * หน่วยราคา = บาท/คิว ตามหลักฐานจริง (engines/quote-price.ts quantityUnit "คิว" ·
   * request-quote ถาม "ราคาต่อคิว" · app/admin/pits placeholder "ราคา/คิว" ·
   * คอลัมน์ pit_materials.price เป็น numeric ไม่มีคอลัมน์หน่วย)
   * ห้ามแปลงหน่วยเป็นตันโดยการแก้ป้าย — การเปลี่ยนหน่วยคือขอบเขต pricing engine
   */
  const savePrice = async (pitId: string) => {
    if (!priceMaterialId || !priceValue.trim()) { setPriceMsg("เลือกวัสดุและกรอกราคาก่อน"); return }
    const price = Number(priceValue)
    if (!Number.isFinite(price) || price <= 0) { setPriceMsg("ราคาต้องเป็นตัวเลขมากกว่า 0"); return }
    setPriceBusy(true)
    setPriceMsg(null)
    try {
      const res = await fetch(`/api/admin/pits/${pitId}/materials`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ material_type_id: priceMaterialId, price }),
      })
      const d = await res.json().catch(() => ({} as { error?: string }))
      if (!res.ok) throw new Error(d.error ?? `HTTP ${res.status}`)
      setPriceMaterialId("")
      setPriceValue("")
      setPriceMsg("บันทึกราคาแล้ว (หน่วย บาท/คิว)")
      refresh()
    } catch (e) {
      setPriceMsg(`บันทึกราคาไม่สำเร็จ: ${(e as Error).message}`)
    } finally {
      setPriceBusy(false)
    }
  }

  const handleSave = async (key: string) => {
    if (!editing) return
    const body: Record<string, unknown> = {}
    // PATCH ต้องส่ง latitude+longitude พร้อมกัน — ถ้าผู้ใช้แก้แค่ช่องเดียว เติมอีกช่องจากค่าเดิมของแถว
    const row = rows.find((r) => r.id === key)
    const lat = editing[`${key}:lat`]
    const lng = editing[`${key}:lng`]
    if (lat !== undefined || lng !== undefined) {
      const latFinal = lat ?? (row?.lat != null ? String(row.lat) : "")
      const lngFinal = lng ?? (row?.lng != null ? String(row.lng) : "")
      if (!latFinal.trim() || !lngFinal.trim()) {
        setError("พิกัดต้องระบุทั้งละติจูดและลองจิจูด (ค่าใดค่าหนึ่งว่างและไม่มีค่าเดิมให้เติม)")
        return
      }
      body.latitude = Number(latFinal)
      body.longitude = Number(lngFinal)
    }
    const typeId = editing[`${key}:type`]
    if (typeId !== undefined) body.facility_type_id = typeId === "" ? null : typeId
    if (Object.keys(body).length === 0) { setError("ไม่มีการแก้ไขที่จะบันทึก"); return }

    setSavingKey(key)
    setError(null)
    try {
      const res = await fetch(`/api/admin/pits/${key}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const d = await res.json().catch(() => ({} as { error?: string }))
      if (!res.ok) throw new Error(d.error ?? `HTTP ${res.status}`)
      setEditing(null)
      refresh()
    } catch (e) {
      setError(`บันทึกไม่สำเร็จ: ${(e as Error).message}`)
    } finally {
      setSavingKey(null)
    }
  }

  /**
   * เพิ่มบ่อ/แพล้นท์ใหม่ — POST /api/admin/pits (เส้นทางเขียนที่เพิ่มใน route เดิม)
   * บันทึกลง pit_profiles โดยตรงผ่าน API ชุดเดียวกับการอ่าน/แก้ไข (ไม่มี endpoint แยกใหม่)
   */
  const handleAdd = async () => {
    const name = newName.trim()
    if (!name) { setAddMsg("ต้องระบุชื่อบ่อ/แพล้นท์"); return }
    const body: Record<string, unknown> = { pit_name: name }
    if (newAddress.trim()) body.address = newAddress.trim()
    if (newTypeId) body.facility_type_id = newTypeId
    if (newLat.trim() || newLng.trim()) {
      if (!newLat.trim() || !newLng.trim()) { setAddMsg("กรอกพิกัดทั้งละติจูดและลองจิจูด หรือปล่อยว่างทั้งคู่"); return }
      body.latitude = Number(newLat)
      body.longitude = Number(newLng)
    }
    setAddBusy(true)
    setAddMsg(null)
    try {
      const res = await fetch("/api/admin/pits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const d = await res.json().catch(() => ({} as { error?: string; pit?: { pit_name?: string } }))
      if (!res.ok) throw new Error(d.error ?? `HTTP ${res.status}`)
      setAdding(false)
      setNewName("")
      setNewAddress("")
      setNewTypeId("")
      setNewLat("")
      setNewLng("")
      setAddMsg(`เพิ่ม "${d.pit?.pit_name ?? name}" แล้ว`)
      refresh()
    } catch (e) {
      setAddMsg(`เพิ่มไม่สำเร็จ: ${(e as Error).message}`)
    } finally {
      setAddBusy(false)
    }
  }

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-xl font-bold text-stone-900">{title}</h1>
        <p className="text-xs text-stone-500 mt-1">
          ข้อมูลจริงจาก <code>pit_profiles</code> ⋈ <code>facility_types</code> ⋈ <code>pit_materials</code> ผ่าน API เดิม ·
          เพิ่มบ่อใหม่ · แก้พิกัด GPS และประเภทกิจการ · <b>คลิกแถวเพื่อดู/แก้ราคาวัสดุ</b> (บาท/คิว ผ่าน POST เดิม) ·
          หัวคอลัมน์ตรึง · เลื่อนแนวนอนได้
        </p>
      </div>

      {adding && (
        <div className="bg-white rounded-xl border border-emerald-200 p-4 space-y-3">
          <div className="text-sm font-semibold text-stone-900">เพิ่มบ่อ/แพล้นท์ใหม่</div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={newName}
              onChange={(e) => { setNewName(e.target.value); setAddMsg(null) }}
              placeholder="ชื่อบ่อ/แพล้นท์ *"
              className="w-64 text-sm border border-stone-300 rounded-lg px-3 py-2"
            />
            <select
              value={newTypeId}
              onChange={(e) => setNewTypeId(e.target.value)}
              className="text-sm border border-stone-300 rounded-lg px-3 py-2 bg-white"
            >
              <option value="">— ประเภทกิจการ (ไม่ระบุก็ได้) —</option>
              {facilityTypes.map((f) => <option key={f.id} value={f.id}>{f.name_th || f.name} ({f.code})</option>)}
            </select>
            <input
              value={newAddress}
              onChange={(e) => setNewAddress(e.target.value)}
              placeholder="ที่อยู่ (เช่น ม.5 ต.บางบ่อ อ.บางบ่อ จ.สมุทรปราการ)"
              className="w-80 text-sm border border-stone-300 rounded-lg px-3 py-2"
            />
            <input
              value={newLat}
              onChange={(e) => { setNewLat(e.target.value); setAddMsg(null) }}
              inputMode="decimal"
              placeholder="ละติจูด (ว่างได้)"
              className="w-36 text-sm border border-stone-300 rounded-lg px-3 py-2"
            />
            <input
              value={newLng}
              onChange={(e) => { setNewLng(e.target.value); setAddMsg(null) }}
              inputMode="decimal"
              placeholder="ลองจิจูด (ว่างได้)"
              className="w-36 text-sm border border-stone-300 rounded-lg px-3 py-2"
            />
            <button
              type="button"
              onClick={handleAdd}
              disabled={addBusy}
              className="text-sm bg-emerald-600 text-white rounded-lg px-4 py-2 disabled:opacity-50"
            >
              {addBusy ? "กำลังบันทึก…" : "บันทึกลงระบบ"}
            </button>
            <button
              type="button"
              onClick={() => { setAdding(false); setAddMsg(null) }}
              className="text-sm border border-stone-300 rounded-lg px-3 py-2"
            >
              ยกเลิก
            </button>
          </div>
          <div className="text-[11px] text-stone-500">
            เขียนผ่าน POST /api/admin/pits → <code>pit_profiles</code> (ตารางเดิม) · ชื่อบังคับ · GPS กรอกทั้งคู่หรือปล่อยว่างทั้งคู่ ·
            ถ้าเลือกประเภทไว้ แถวใหม่จะแสดงในกลุ่มประเภทนี้ทันทีหลังรีเฟรช
          </div>
          {addMsg && <div className="text-xs text-stone-700">{addMsg}</div>}
        </div>
      )}

      <BizTable<PitRow>
        columns={columns}
        rows={sectionRows}
        getKey={(r) => r.id}
        searchText={(r) => `${r.name} ${r.province ?? ""} ${r.business_type_label}`}
        busy={busy || savingKey !== null}
        error={error}
        canEdit
        editing={editing}
        onEditingChange={setEditing}
        onSave={handleSave}
        onRefresh={refresh}
        onAdd={() => { setAdding(true); setAddMsg(null) }}
        search={search}
        onSearchChange={setSearch}
        filters={{
          label: "ทุกสถานะ",
          value: statusFilter,
          options: [{ value: "active", label: "ใช้งานอยู่" }, { value: "inactive", label: "ปิด/ลบแล้ว" }],
          accessor: (r) => (r.active ? "active" : "inactive"),
        }}
        onFilterChange={setStatusFilter}
        emptyText="ไม่พบบ่อ/แพล้นท์ในกลุ่มนี้"
        renderExpanded={(r) => (
          <div className="space-y-2">
            <div className="text-xs font-semibold text-stone-700">
              ราคาที่ผูกกับบ่อนี้ ⋈ <code>pit_materials</code>
              <span className="ml-2 font-normal text-stone-500">หน่วยที่ระบบใช้จริง = <b>บาท/คิว</b> (ไม่แปลงหน่วยเป็นตัน)</span>
            </div>
            {r.materials.length === 0 ? (
              <p className="text-xs text-stone-500">ยังไม่มีวัสดุผูกกับบ่อนี้</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {r.materials.map((m) => (
                  <span key={m.name} className="text-xs bg-white border border-stone-200 rounded-lg px-2 py-1">
                    {m.name} = <b>{Number(m.price).toLocaleString("th-TH")}</b> บาท/คิว
                  </span>
                ))}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <select
                value={pricePitId === r.id ? priceMaterialId : ""}
                onChange={(e) => { setPricePitId(r.id); setPriceMaterialId(e.target.value); setPriceMsg(null) }}
                className="text-xs border border-stone-300 rounded-lg px-2 py-1.5 bg-white"
              >
                <option value="">— เลือกวัสดุ —</option>
                {materialTypes.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
              <input
                value={pricePitId === r.id ? priceValue : ""}
                onChange={(e) => { setPricePitId(r.id); setPriceValue(e.target.value); setPriceMsg(null) }}
                inputMode="decimal"
                placeholder="ราคา/คิว"
                className="w-28 text-xs border border-stone-300 rounded-lg px-2 py-1.5"
              />
              <button
                type="button"
                onClick={() => savePrice(r.id)}
                disabled={priceBusy}
                className="text-xs bg-emerald-600 text-white rounded-lg px-3 py-1.5 disabled:opacity-50"
              >
                {priceBusy ? "กำลังบันทึก…" : "บันทึกราคา"}
              </button>
              <span className="text-[11px] text-stone-500">
                เขียนผ่าน POST /api/admin/pits/{r.id}/materials เดิม (upsert) · ราคาต่อคิวเท่านั้น
              </span>
              {priceMsg && <span className="text-[11px] text-stone-700">{priceMsg}</span>}
            </div>
          </div>
        )}
      />
    </div>
  )
}
