"use client"

/**
 * BizTable — ตารางข้อมูลธุรกิจ "ใช้ร่วมกัน" ของ Business Workspace ใหม่ (STEP 4)
 *
 * ทำได้: ค้นหา · กรอง · เพิ่มแถว · แก้ไข · บันทึกลง Supabase (ผ่าน API เดิมที่ผู้เรียกส่งมา)
 *        ตรวจสิทธิ์ (canEdit) · แสดง Error จริง · รีเฟรช · เลื่อนแนวนอน · หัวคอลัมน์ตรึง
 * ไม่ทำ: ไม่เรียกฐานข้อมูลตรง · ไม่มีข้อมูลตัวอย่าง · ไม่สร้าง API ใหม่
 */
import { useMemo, useState, type ReactNode } from "react"

export interface BizColumn<T> {
  key: string
  label: string
  /** คอลัมน์/API จริงที่ช่องนี้เชื่อม (แสดงใต้หัวคอลัมน์เป็นหลักฐาน) */
  binds: string
  width?: string
  render?: (row: T) => ReactNode
  editable?: {
    type: "text" | "number" | "select"
    options?: { value: string; label: string }[]
    /** เติมค่าเดิมของแถวนี้ตอนเปิดโหมดแก้ไข (ไม่ส่ง = ช่องว่าง เหมือนเดิม) */
    value?: (row: T) => string
  }
}

interface Props<T> {
  columns: BizColumn<T>[]
  rows: T[]
  getKey: (row: T) => string
  /** ข้อความสำหรับค้นหา (ถ้าไม่ส่ง ใช้ค่าทุกคอลัมน์ที่ render เป็น string) */
  searchText?: (row: T) => string
  busy?: boolean
  error?: string | null
  canEdit: boolean
  /** ค่าที่ผู้ใช้กำลังแก้: `${key}:${column}` → ค่าใหม่ (ช่อง editable เท่านั้น) */
  editing: Record<string, string> | null
  onEditingChange: (patch: Record<string, string> | null) => void
  onSave: (key: string) => void
  onRefresh: () => void
  /** ยังไม่มี API สร้างจริง → ส่ง null แล้วตารางแสดงสถานะจริงแทนปุ่มกด */
  onAdd: (() => void) | null
  addUnavailableReason?: string
  search: string
  onSearchChange: (v: string) => void
  filters?: { label: string; value: string; options: { value: string; label: string }[]; accessor: (row: T) => string }
  onFilterChange?: (v: string) => void
  emptyText?: string
  /** แผงย่อยใต้แถวที่กำลังเปิด (ใช้สำหรับแก้ไขราคา/รายละเอียด) — ไม่สร้าง tab ใหม่ */
  renderExpanded?: (row: T) => ReactNode
}

export default function BizTable<T>(props: Props<T>) {
  const { columns, rows, getKey, searchText, busy, error, canEdit, editing, onEditingChange, onSave, onRefresh, onAdd, addUnavailableReason, search, onSearchChange, filters, onFilterChange, emptyText, renderExpanded } = props
  const [openKey, setOpenKey] = useState<string | null>(null)

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter((r) => {
      if (q) {
        const hay = (searchText ? searchText(r) : [getKey(r), ...columns.map((c) => c.render?.(r) ?? "")].join(" ")).toLowerCase()
        if (!hay.includes(q)) return false
      }
      if (filters && filters.value && filters.accessor(r) !== filters.value) return false
      return true
    })
  }, [rows, columns, getKey, searchText, search, filters])

  return (
    <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 p-3 border-b border-stone-200">
        <input value={search} onChange={(e) => onSearchChange(e.target.value)} placeholder="ค้นหา..." className="flex-1 min-w-[180px] text-sm border border-stone-300 rounded-lg px-3 py-2" />
        {filters && (
          <select value={filters.value} onChange={(e) => onFilterChange?.(e.target.value)} className="text-sm border border-stone-300 rounded-lg px-3 py-2 bg-white">
            <option value="">{filters.label}</option>
            {filters.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        )}
        <button type="button" onClick={onRefresh} disabled={busy} className="text-sm px-3 py-2 rounded-lg border border-stone-300 hover:bg-stone-50 disabled:opacity-50">
          {busy ? "กำลังโหลด..." : "รีเฟรช"}
        </button>
        {onAdd ? (
          <button type="button" onClick={onAdd} disabled={busy} className="text-sm px-3 py-2 rounded-lg bg-emerald-600 text-white disabled:opacity-50">เพิ่มแถว</button>
        ) : (
          <span className="text-[11px] text-stone-400 max-w-[280px]" title={addUnavailableReason}>เพิ่มแถว: {addUnavailableReason ?? "ยังไม่รองรับ"}</span>
        )}
        {!canEdit && <span className="text-[11px] text-amber-700 border border-amber-200 rounded px-2 py-1">สิทธิ์: อ่านอย่างเดียว</span>}
      </div>

      {error && <div className="m-3 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{error}</div>}

      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[720px]">
          <thead>
            <tr className="border-b border-stone-200">
              {columns.map((c) => (
                <th key={c.key} style={{ width: c.width }} className="sticky top-0 bg-stone-50 z-10 text-left font-bold uppercase text-[11px] tracking-wide px-3 py-2.5 whitespace-nowrap">
                  {c.label}
                  <div className="text-[10px] font-normal text-stone-400 normal-case truncate max-w-[220px]" title={c.binds}>{c.binds}</div>
                </th>
              ))}
              <th className="sticky top-0 bg-stone-50 z-10 px-3 py-2.5"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {visible.length === 0 && (
              <tr><td colSpan={columns.length + 1} className="text-center text-stone-400 py-8">{busy ? "กำลังโหลด..." : (emptyText ?? "ไม่มีข้อมูล")}</td></tr>
            )}
            {visible.map((row) => {
              const key = getKey(row)
              const isOpen = openKey === key
              const dirty = isOpen && editing !== null && Object.keys(editing).some((k) => k.startsWith(`${key}:`))
              return (
                <tr key={key} className="hover:bg-stone-50 align-top">
                  {columns.map((c) => (
                    <td key={c.key} className="px-3 py-2.5 whitespace-nowrap">
                      {isOpen && c.editable && canEdit ? (
                        c.editable.type === "select" ? (
                          <select
                            value={editing?.[`${key}:${c.key}`] ?? c.editable.value?.(row) ?? ""}
                            onChange={(e) => onEditingChange({ ...(editing ?? {}), [`${key}:${c.key}`]: e.target.value })}
                            className="text-xs border border-stone-300 rounded px-2 py-1 bg-white"
                          >
                            {(c.editable.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                        ) : (
                          <input
                            value={editing?.[`${key}:${c.key}`] ?? c.editable.value?.(row) ?? ""}
                            onChange={(e) => onEditingChange({ ...(editing ?? {}), [`${key}:${c.key}`]: e.target.value })}
                            type={c.editable.type}
                            className="w-28 text-xs border border-stone-300 rounded px-2 py-1"
                          />
                        )
                      ) : (
                        c.render?.(row) ?? "—"
                      )}
                    </td>
                  ))}
                  <td className="px-3 py-2.5 text-right whitespace-nowrap">
                    {!canEdit ? (
                      <span className="text-[11px] text-stone-300">ดูอย่างเดียว</span>
                    ) : !isOpen ? (
                      <button type="button" onClick={() => { setOpenKey(key); onEditingChange(null) }} className="text-[11px] px-2.5 py-1 rounded-lg border border-amber-200 text-amber-700 hover:bg-amber-50">แก้ไข</button>
                    ) : (
                      <span className="flex gap-1 justify-end">
                        <button type="button" onClick={() => { onSave(key); setOpenKey(null) }} disabled={!dirty} className="text-[11px] px-2.5 py-1 rounded-lg bg-emerald-600 text-white disabled:opacity-40">บันทึก</button>
                        <button type="button" onClick={() => { setOpenKey(null); onEditingChange(null) }} className="text-[11px] px-2.5 py-1 rounded-lg border border-stone-300">ปิด</button>
                      </span>
                    )}
                  </td>
                </tr>
              )
            })}
            {visible.map((row) => {
              const key = getKey(row)
              if (openKey !== key || !renderExpanded) return null
              return (
                <tr key={`${key}-expanded`} className="bg-amber-50/40">
                  <td colSpan={columns.length + 1} className="px-3 py-3">{renderExpanded(row)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="px-3 py-2 text-[11px] text-stone-400 border-t border-stone-200">
        แสดง {visible.length} / {rows.length} แถว · หัวคอลัมน์ตรึงไว้ · เลื่อนแนวนอนได้
      </div>
    </div>
  )
}
