/**
 * PUT /api/admin/provider-settings/[providerId] — save one provider card:
 * metadata (display_name / environment / sort_order) and/or credential fields
 * (config vs secret split by the registry — unknown keys REFUSED).
 *
 * Flow: UI → authenticated admin route (requireAuth ADMIN_TIER) → policy
 * stays server-side in the Connect contract's create gate (this route only
 * ever UPDATES an existing connector — first-time Connect with its approval
 * step stays on POST /api/admin/connectors, never duplicated here) →
 * credential authority gateway/connectors.updateConnector (secrets stay in
 * connectors.secret, service-role-only) → metadata DB → audit (audit_logs via
 * logConnectorLifecycleEvent for secret writes + provider_credential_events
 * for every change). Responses are redacted — a saved secret never comes back.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { supabaseAdmin } from "@/services/supabase/queries";
import { getConnectorById, updateConnector, redactConnector, findConnectorIdByProvider } from "@/gateway/connectors";
import { logConnectorLifecycleEvent } from "@/core/connector-loader";
import type { ConnectorRecord } from "@/core/connector-loader";
import {
  insertEvent,
  isEnvironment,
  loadSettings,
  splitFieldsByRequirements,
  upsertSettings,
} from "../_lib/providerCredentialMeta";

type Params = { params: Promise<{ providerId: string }> };

export async function PUT(req: NextRequest, { params }: Params) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  const { providerId } = await params;

  try {
    const body = (await req.json().catch(() => ({}))) as {
      display_name?: unknown;
      environment?: unknown;
      sort_order?: unknown;
      fields?: Record<string, unknown>;
    };
    const db = supabaseAdmin();

    const settingsPatch: { display_name?: string; environment?: "local" | "staging" | "production"; sort_order?: number } = {};
    if (body.display_name !== undefined) {
      const v = String(body.display_name).trim();
      if (v.length > 80) return NextResponse.json({ ok: false, code: "INVALID_DISPLAY_NAME" }, { status: 400 });
      settingsPatch.display_name = v;
    }
    if (body.environment !== undefined) {
      if (!isEnvironment(body.environment)) {
        return NextResponse.json({ ok: false, code: "INVALID_ENVIRONMENT" }, { status: 400 });
      }
      settingsPatch.environment = body.environment;
    }
    if (body.sort_order !== undefined) {
      const n = Number(body.sort_order);
      if (!Number.isInteger(n) || n < 0 || n > 99999) return NextResponse.json({ ok: false, code: "INVALID_SORT_ORDER" }, { status: 400 });
      settingsPatch.sort_order = n;
    }

    const hasFields = body.fields !== undefined && body.fields !== null && Object.keys(body.fields).length > 0;
    const hasSettingsPatch = Object.keys(settingsPatch).length > 0;
    if (!hasFields && !hasSettingsPatch) {
      return NextResponse.json({ ok: false, code: "EMPTY_PATCH" }, { status: 400 });
    }

    let connector: ConnectorRecord | null = null;
    let lifecycleLogged = false;
    let eventLogged = false;
    let fieldKeys: string[] = [];

    if (hasFields) {
      // Locate THIS provider's connector — config.provider is the declared
      // provider identity (createConnector stores it; never guessed).
      const id = await findConnectorIdByProvider(providerId);
      if (!id) {
        return NextResponse.json(
          { ok: false, code: "NO_CONNECTOR", error: "ยังไม่มี connector ของ provider นี้ — เชื่อมต่อครั้งแรกผ่าน Setup Provider (หน้า Connectors)" },
          { status: 404 },
        );
      }
      const split = await splitFieldsByRequirements(db, providerId, body.fields!);
      fieldKeys = [...split.keys.config, ...split.keys.secret];
      if (fieldKeys.length > 0) {
        connector = await updateConnector(id, {
          ...(Object.keys(split.config).length > 0 ? { config: split.config } : {}),
          ...(Object.keys(split.secret).length > 0 ? { secret: split.secret } : {}),
        });
        if (split.keys.secret.length > 0) {
          // audit_logs — field NAMES only, never a value.
          await logConnectorLifecycleEvent(db, id, "secret_saved", {
            note: `keys=[${split.keys.secret.join(",")}]`,
            actorUserId: auth.id,
          });
          lifecycleLogged = true;
        }
        eventLogged = await insertEvent(db, {
          provider_id: providerId,
          connector_id: id,
          action: "save",
          field_keys: fieldKeys,
          detail: { config_keys: split.keys.config, secret_key_count: split.keys.secret.length },
          actor: auth.email,
        });
      }
    }

    let settingsRow: unknown = null;
    if (hasSettingsPatch) {
      const before = await loadSettings(db);
      const prev = before.rows.find((r) => r.provider_id === providerId);
      settingsRow = await upsertSettings(db, providerId, settingsPatch);
      const logged = await insertEvent(db, {
        provider_id: providerId,
        action: "settings_changed",
        detail: {
          changed_keys: Object.keys(settingsPatch),
          previous: prev ? { display_name: prev.display_name, environment: prev.environment, sort_order: prev.sort_order } : null,
        },
        actor: auth.email,
      });
      eventLogged = logged || eventLogged;
    }

    return NextResponse.json({
      ok: true,
      connector: connector ? redactConnector(connector) : null,
      settings: settingsRow,
      audit: { lifecycle_logged: lifecycleLogged, event_logged: eventLogged },
      field_keys: fieldKeys, // NAMES only
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const code = (err as { code?: string }).code;
    if (code === "UNKNOWN_CREDENTIAL_KEY") return NextResponse.json({ ok: false, code, error: msg }, { status: 400 });
    if (code === "AMBIGUOUS_CONNECTOR") return NextResponse.json({ ok: false, code, error: msg }, { status: 409 });
    if (code === "REQUIREMENTS_MISSING" || code === "META_TABLES_MISSING") {
      return NextResponse.json({ ok: false, code, error: msg }, { status: 409 });
    }
    console.error("[provider-settings] save failed:", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

