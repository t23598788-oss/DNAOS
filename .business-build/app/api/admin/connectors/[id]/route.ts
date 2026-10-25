/**
 * GET    /api/admin/connectors/[id] — one Connector
 * PATCH  /api/admin/connectors/[id] — update name/config/secret
 * DELETE /api/admin/connectors/[id] — remove Connector
 */

import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { supabaseAdmin } from "@/services/supabase/queries"
import { getConnectorById, updateConnector, deleteConnector, redactConnector } from "@/gateway/connectors"
import { logConnectorLifecycleEvent } from "@/core/connector-loader"
import { assertProviderMutationAllowed, insertEvent } from "../../provider-settings/_lib/providerCredentialMeta"

type Params = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth
  const { id } = await params

  const connector = await getConnectorById(id)
  if (!connector) return NextResponse.json({ error: "ไม่พบ Connector นี้" }, { status: 404 })
  return NextResponse.json({ connector: redactConnector(connector) })
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth
  const { id } = await params

  try {
    const body = await req.json().catch(() => ({}))
    const connector = await updateConnector(id, {
      name: body.name,
      config: body.config,
      secret: body.secret,
    })
    return NextResponse.json({ connector: redactConnector(connector) })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth
  const { id } = await params

  try {
    const existing = await getConnectorById(id)
    if (!existing) return NextResponse.json({ error: "ไม่พบ Connector นี้" }, { status: 404 })

    // Destructive disconnect gate (Connections & Credentials PHASE 10): a
    // connector that DECLARES a provider inherits that provider's environment
    // gate — production/unknown requires an approved
    // connector.disconnect.requested proposal in the ONE approval store.
    // Generic (provider-less) connectors keep the legacy behaviour. A decision
    // reversal is a code change with evidence, never a silent path removal.
    const provider = ((existing.config as Record<string, unknown> | null)?.provider as string | undefined) ?? null
    if (provider) {
      const gate = await assertProviderMutationAllowed(supabaseAdmin(), provider, "disconnect")
      if (!gate.allowed) {
        return NextResponse.json(
          { ok: false, code: "OWNER_APPROVAL_REQUIRED", environment: gate.environment, proposal_id: gate.proposal_id ?? null, proposal_status: gate.proposal_status ?? "not_requested" },
          { status: 403 },
        )
      }
    }

    await deleteConnector(id)
    // audit_logs (actor_user_id) + provider_credential_events (actor email) —
    // names/metadata only, never a secret value.
    await logConnectorLifecycleEvent(supabaseAdmin(), id, "disconnected", {
      note: provider ? `provider=${provider}` : "generic connector",
      actorUserId: auth.id,
    })
    if (provider) {
      await insertEvent(supabaseAdmin(), {
        provider_id: provider,
        connector_id: null,
        action: "disconnect",
        field_keys: [],
        detail: { connector_name: existing.name, auth_type: existing.auth_type },
        actor: auth.email,
      })
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
