'use client'

// Contact Settings Popup (owner, 2026-07-18, refactored same day into a
// generic tree-renderer): "ทุกหมวดใช้โครงสร้างเดียวกัน...ถ้าวันหลังเพิ่มโมดูล
// ใหม่ ไม่ต้องแก้ Contact Settings แค่ Register หมวดใหม่" — this component
// reads registry/contact-settings-categories.ts and renders whatever tree
// is declared there. Adding a module's settings later means adding one
// entry to that registry, never touching this file.

import { useState, useEffect, useCallback } from "react"
import { X, ChevronLeft, ChevronRight } from "lucide-react"
import { CONTACT_SETTINGS_CATEGORIES, childrenOf, findCategory, type CategoryNode } from "@/registry/contact-settings-categories"

interface LineProfile {
  line_user_id: string
  display_name: string | null
  role: string | null
  company_id: string | null
  department: string | null
  trust_level: string | null
  notes: string | null
  permissions: Record<string, Record<string, unknown>>
  companies: { id: string; name: string } | null
}

// profile-target fields read/write these top-level LineProfile fields
// directly rather than the nested `permissions` bag.
const PROFILE_FIELD_MAP: Record<string, keyof LineProfile> = {
  displayName: "display_name",
  department: "department",
  role: "role",
  trustLevel: "trust_level",
  notes: "notes",
}

export default function ContactSettingsModal({ lineUserId, onClose }: { lineUserId: string; onClose: () => void }) {
  const [profile, setProfile] = useState<LineProfile | null>(null)
  const [path, setPath] = useState<string[]>([]) // breadcrumb of category keys, e.g. ["automation", "automation.invoice"]
  const [draft, setDraft] = useState<Record<string, unknown>>({})
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/line-profiles/${lineUserId}`)
    const data = await res.json()
    setProfile(data.profile)
  }, [lineUserId])

  useEffect(() => { load() }, [load])

  const currentKey = path.length ? path[path.length - 1] : null
  const currentCategory = currentKey ? findCategory(currentKey) : null
  const listing = childrenOf(currentKey) // if currentCategory has children, show them; a category with fields+no children is a leaf form
  const isLeaf = currentCategory ? !CONTACT_SETTINGS_CATEGORIES.some((c) => c.parent === currentCategory.key) : false

  function enter(key: string) {
    setPath((p) => [...p, key])
    setDraft({})
  }

  function back() {
    setPath((p) => p.slice(0, -1))
    setDraft({})
  }

  function fieldValue(cat: CategoryNode, field: { key: string }): unknown {
    if (!profile) return ""
    if (cat.target === "profile") {
      const col = PROFILE_FIELD_MAP[field.key]
      return col ? (profile[col] as unknown) ?? "" : ""
    }
    return profile.permissions?.[cat.key]?.[field.key] ?? false
  }

  async function save(cat: CategoryNode) {
    if (!profile) return
    setSaving(true)
    // The API merges `permissions` one level deep only (existing[cat.key] is
    // REPLACED wholesale, not deep-merged) — so a save must send this
    // category's full current state (existing fields + this edit), not just
    // the changed field, or unedited fields in the same category would
    // silently vanish.
    const body: Record<string, unknown> =
      cat.target === "profile"
        ? Object.fromEntries(Object.entries(draft).filter(([, v]) => v !== undefined))
        : { permissions: { [cat.key]: { ...(profile.permissions?.[cat.key] ?? {}), ...draft } } }

    const res = await fetch(`/api/admin/line-profiles/${lineUserId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    const data = await res.json()
    setSaving(false)
    if (data.profile) {
      setProfile((prev) => (prev ? { ...prev, ...data.profile } : prev))
      back()
    }
  }

  if (!profile) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div
        className="w-[360px] max-h-[520px] bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-stone-100 shrink-0">
          <div className="flex items-center gap-2">
            {path.length > 0 && (
              <button onClick={back} className="text-stone-400 hover:text-stone-700 transition">
                <ChevronLeft size={16} />
              </button>
            )}
            <span className="font-semibold text-sm text-stone-800">
              {currentCategory ? currentCategory.label : "Contact Settings"}
            </span>
          </div>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-700 transition">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* A category with children (root menu, or a parent like
              "Automation") shows a list; drilling into a leaf shows its
              field form. */}
          {(!currentCategory || !isLeaf) && listing.length > 0 && (
            <div className="py-1">
              {listing.map((c) => (
                <button
                  key={c.key}
                  onClick={() => enter(c.key)}
                  className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-stone-50 transition text-left"
                >
                  <span className="text-sm text-stone-700">
                    {c.label}
                    {!c.built && <span className="ml-1.5 text-[9px] text-stone-300 font-normal">(เร็ว ๆ นี้)</span>}
                  </span>
                  <ChevronRight size={14} className="text-stone-300" />
                </button>
              ))}
            </div>
          )}

          {currentCategory && isLeaf && currentCategory.built && (
            <div className="p-4 space-y-3">
              {(currentCategory.fields ?? []).map((field) => (
                <FieldControl
                  key={field.key}
                  field={field}
                  value={draft[field.key] ?? fieldValue(currentCategory, field)}
                  onChange={(v) => setDraft((d) => ({ ...d, [field.key]: v }))}
                />
              ))}
              {currentCategory.key === "role" && profile.companies && (
                <div className="text-[11px] text-stone-400">บริษัทที่จับคู่: {profile.companies.name}</div>
              )}
              <button
                disabled={saving}
                onClick={() => save(currentCategory)}
                className="w-full text-sm font-semibold py-2 rounded-lg bg-stone-800 text-white hover:bg-stone-900 transition disabled:opacity-50"
              >
                บันทึก
              </button>
            </div>
          )}

          {currentCategory && isLeaf && !currentCategory.built && (
            <div className="p-6 text-center text-xs text-stone-400">
              หมวดนี้ยังไม่มีข้อมูลรองรับใน DB วันนี้ — ยังไม่ได้สร้าง ไม่ใช่ของที่ถูกซ่อนไว้
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function FieldControl({
  field, value, onChange,
}: { field: { key: string; label: string; type: string; options?: { value: string; label: string }[] }; value: unknown; onChange: (v: unknown) => void }) {
  if (field.type === "boolean") {
    return (
      <label className="flex items-center gap-2.5 py-1 text-sm text-stone-700 cursor-pointer">
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
          className="rounded border-stone-300"
        />
        {field.label}
      </label>
    )
  }
  if (field.type === "select") {
    return (
      <label className="block">
        <span className="text-[11px] text-stone-500">{field.label}</span>
        <select
          className="mt-1 w-full text-sm border border-stone-200 rounded-lg px-3 py-2 bg-white"
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
        >
          {(field.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>
    )
  }
  if (field.type === "textarea") {
    return (
      <label className="block">
        <span className="text-[11px] text-stone-500">{field.label}</span>
        <textarea
          rows={5}
          className="mt-1 w-full text-sm border border-stone-200 rounded-lg px-3 py-2"
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
        />
      </label>
    )
  }
  return (
    <label className="block">
      <span className="text-[11px] text-stone-500">{field.label}</span>
      <input
        className="mt-1 w-full text-sm border border-stone-200 rounded-lg px-3 py-2"
        value={(value as string) ?? ""}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  )
}
