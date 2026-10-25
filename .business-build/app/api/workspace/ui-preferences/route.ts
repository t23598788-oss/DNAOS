/**
 * WORKSPACE APPEARANCE PREFERENCES — per-account appearance + shortcuts
 *
 * WHY THIS ROUTE EXISTS
 *   The workspace shell (public/material-workspace) needs appearance values that
 *   belong to ONE user, not to the company. The existing company settings
 *   (/api/admin/settings → app_configs) are company-wide and must not be
 *   overwritten with personal UI values. There is no per-user settings table,
 *   and this mission explicitly forbids creating a new database/schema.
 *
 *   So this route reuses the EXISTING app_configs key-value store, namespaced by
 *   the signed-in user's own id: `workspace-ui:<userId>`. No new table, column,
 *   auth path, or writer. The user id comes from getAuthedUser(), the same
 *   session resolver used everywhere else.
 *
 * BOUNDARIES
 *   Presentation only: the five standard themes + the six custom controls, and
 *   the user's shortcut list. It never reads or writes business rows, documents,
 *   permissions, connection registry, or company profile values.
 *
 *   Old records from the previous appearance experiment are tolerated: unknown
 *   fields are ignored, and missing values fall back to Clear Glass.
 */

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { getAccessToken, getAuthedUser } from "@/core/auth/session"

const KEY_PREFIX = "workspace-ui:"
const MAX_SHORTCUTS = 20

const PRESETS = ["clear", "light", "dark", "tinted", "auto", "custom"] as const
const MODES = ["light", "dark", "auto"] as const
const SHORTCUT_KINDS = ["route", "external"] as const
const ICONS = [
  "apps",
  "chat",
  "stock",
  "finance",
  "document",
  "jobs",
  "partners",
  "debt",
  "gear",
  "company",
  "expense",
  "camera",
  "globe",
  "map",
] as const

type Preset = (typeof PRESETS)[number]
type Mode = (typeof MODES)[number]
type ShortcutKind = (typeof SHORTCUT_KINDS)[number]

interface ThemePreferences {
  preset: Preset
  mode: Mode
  tone: string
  opacity: number
  blur: number
  radius: number
  fontSize: number
  iconSize: number
}

interface ShortcutPreferences {
  id: string
  label: string
  kind: ShortcutKind
  value: string
  icon: string
  logo?: string
  provider?: boolean
}

export interface WorkspaceUiPreferences {
  theme: ThemePreferences
  shortcuts: ShortcutPreferences[]
}

const DEFAULTS: WorkspaceUiPreferences = {
  theme: {
    preset: "clear",
    mode: "light",
    tone: "#e6e0d6",
    opacity: 78,
    blur: 8,
    radius: 14,
    fontSize: 13,
    iconSize: 20,
  },
  shortcuts: [],
}

function str(value: unknown, max: number, fallback = ""): string {
  if (typeof value !== "string") return fallback
  const trimmed = value.trim()
  return trimmed.length > 0 && trimmed.length <= max ? trimmed : fallback
}

function color(value: unknown, fallback: string): string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : fallback
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.round(value)))
}

function sanitizeTheme(input: unknown): ThemePreferences {
  const raw = (input && typeof input === "object" ? input : {}) as Record<string, unknown>
  return {
    preset: PRESETS.includes(raw.preset as Preset) ? (raw.preset as Preset) : DEFAULTS.theme.preset,
    mode: MODES.includes(raw.mode as Mode)
      ? (raw.mode as Mode)
      : raw.preset === "dark"
        ? "dark"
        : raw.preset === "auto" || raw.preset === "custom"
          ? "auto"
          : "light",
    tone: color(raw.tone, DEFAULTS.theme.tone),
    opacity: clampNumber(raw.opacity, 30, 100, DEFAULTS.theme.opacity),
    blur: clampNumber(raw.blur, 0, 24, DEFAULTS.theme.blur),
    radius: clampNumber(raw.radius, 0, 28, DEFAULTS.theme.radius),
    fontSize: clampNumber(raw.fontSize, 12, 18, DEFAULTS.theme.fontSize),
    iconSize: clampNumber(raw.iconSize, 14, 28, DEFAULTS.theme.iconSize),
  }
}

function sanitizeShortcuts(input: unknown): ShortcutPreferences[] {
  if (!Array.isArray(input)) return []
  const seen = new Set<string>()
  const out: ShortcutPreferences[] = []
  for (const entry of input) {
    if (!entry || typeof entry !== "object") continue
    const raw = entry as Record<string, unknown>
    const id = str(raw.id, 64)
    if (!id || !/^[a-z0-9-]+$/i.test(id) || seen.has(id)) continue
    const kind = SHORTCUT_KINDS.includes(raw.kind as ShortcutKind) ? (raw.kind as ShortcutKind) : null
    if (!kind) continue
    const value = str(raw.value, 500)
    if (!value) continue
    if (kind === "route" && (!value.startsWith("/") || value.startsWith("//"))) continue
    if (kind === "external" && !/^https?:\/\//i.test(value)) continue
    const label = str(raw.label, 60, value).slice(0, 60)
    const icon = ICONS.includes(raw.icon as (typeof ICONS)[number]) ? (raw.icon as string) : "globe"
    // Provider shortcuts keep their real supplied logo. The client never invents
    // or recolors a provider mark.
    const provider = raw.provider === true
    const rawLogo = str(raw.logo, 300)
    const logo = provider && rawLogo.startsWith("/brand/providers/") && !rawLogo.includes("..") ? rawLogo : undefined
    out.push({ id, label, kind, value, icon, ...(logo ? { logo } : {}), ...(provider ? { provider: true } : {}) })
    seen.add(id)
    if (out.length >= MAX_SHORTCUTS) break
  }
  return out
}

function sanitizePreferences(input: unknown): WorkspaceUiPreferences {
  const raw = (input && typeof input === "object" ? input : {}) as Record<string, unknown>
  return {
    theme: sanitizeTheme(raw.theme),
    shortcuts: sanitizeShortcuts(raw.shortcuts),
  }
}

function parseStored(data: string | null | undefined): WorkspaceUiPreferences | null {
  if (!data) return null
  try {
    return sanitizePreferences(JSON.parse(data))
  } catch {
    return null
  }
}

function keyFor(userId: string): string {
  return `${KEY_PREFIX}${userId}`
}

// Use the same user-scoped Supabase client pattern as company-settings.ts /
// ide-settings.ts so app_configs RLS checks the real signed-in user instead of
// a service-role bypass. No new table and no new storage system.
async function userScopedClient() {
  const token = await getAccessToken()
  if (!token) return null
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } },
  )
}

export async function GET() {
  const user = await getAuthedUser()
  if (!user) return NextResponse.json({ error: "AUTH_REQUIRED" }, { status: 401 })
  const db = await userScopedClient()
  if (!db) return NextResponse.json({ error: "AUTH_REQUIRED" }, { status: 401 })

  const { data, error } = await db
    .from("app_configs")
    .select("data")
    .eq("title", keyFor(user.id))
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({
    userId: user.id,
    preferences: parseStored(data?.data) ?? DEFAULTS,
    stored: Boolean(data?.data),
  })
}

export async function PUT(req: NextRequest) {
  const user = await getAuthedUser()
  if (!user) return NextResponse.json({ error: "AUTH_REQUIRED" }, { status: 401 })

  const body = await req.json().catch(() => null)
  const preferences = sanitizePreferences(body?.preferences)
  const db = await userScopedClient()
  if (!db) return NextResponse.json({ error: "AUTH_REQUIRED" }, { status: 401 })

  const { error } = await db
    .from("app_configs")
    .upsert(
      { title: keyFor(user.id), data: JSON.stringify(preferences), updated_at: new Date().toISOString() },
      { onConflict: "title" },
    )

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, preferences })
}
