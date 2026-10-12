// patch236: material.list data-driven filter+sources+semantic type — node (utf8 safe)
import { readFileSync, writeFileSync } from "node:fs"
const p = "/Users/tam/Desktop/ระบบธุรกิจ/dna-os-maincheck/engines/validation/dispatcher.ts"
let s = readFileSync(p, "utf8")
const old = `  "material.list":    async () => getMaterialTypes(),`
const neu = `  // DNA-000236: data-driven — filter จาก payload (ไม่ hardcode ชื่อวัสดุ) + sources/ราคาจาก pit_materials จริง
  "material.list": async (p) => {
    const base = await getMaterialTypes()
    const nameFilter = typeof p.name === "string" ? p.name.trim() : null
    const filtered = nameFilter ? base.filter((m: { name: string }) => m.name.includes(nameFilter)) : base
    const links = await supabaseAdmin().from("pit_materials").select("material_type_id, price, pit_profiles!inner(name, deleted_at)").is("deleted_at", null).is("pit_profiles.deleted_at", null)
    if (links.error) throw new Error("query error: " + links.error.message)
    type Link = { material_type_id: string; price: number; pit_profiles: { name: string } }
    const rows = (links.data ?? []) as unknown as Link[]
    const materials = filtered.map((m: { id: string; name: string; density_ton_per_cbm?: number }) => {
      const src = rows.filter((l) => l.material_type_id === m.id)
      const prices = src.map((x) => Number(x.price)).filter((n) => n > 0)
      return { result_type: "MATERIAL", name: m.name, density_ton_per_cbm: m.density_ton_per_cbm ?? null, sources: src.map((x) => x.pit_profiles?.name).filter(Boolean), price_min: prices.length ? Math.min(...prices) : null, price_max: prices.length ? Math.max(...prices) : null }
    })
    return { result_type: "MATERIAL_LIST", total: materials.length, filtered_by: nameFilter ?? null, materials }
  },`
if (s.includes(old)) { s = s.replace(old, neu); writeFileSync(p, s); console.log("material.list upgraded") }
else console.log(s.includes("DNA-000236") ? "already" : "MISMATCH")
