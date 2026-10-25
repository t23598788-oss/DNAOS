/**
 * POST /api/admin/provider-settings/[providerId]/rotate — PHASE 6.15.
 *
 * Rotate flow, in order:
 *   1. old-version metadata read (version + field key names — never values)
 *   2. Owner-approval gate on production/unknown environment
 *      (assertProviderMutationAllowed → the ONE proposal store)
 *   3. write the NEW secret(s) through gateway/connectors.updateConnector
 *      (the existing credential authority — connectors.secret)
 *   4. verify with the canonical test (gateway/connectors.runConnectorTest —
 *      the same call /api/admin/connectors/[id]/test uses; test logic is NOT
 *      re-implemented here)
 *   5a. PASS → bump credential_version, last_rotated_at, last_verified_at,
 *       audit_logs 'rotated' + provider_credential_events 'rotate'
 *   5b. FAIL → RESTORE the previous secret (the old credential is never
 *       destroyed), re-test to re-establish status, audit 'rotate_failed',
 *       answer 422 ROTATE_VERIFY_FAILED with restored:true
 *
 * No secret value is echoed in any response, log, or audit row — only key
 * names, versions, and test results.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { supabaseAdmin } from "@/services/supabase/queries";
import { getConnectorById, updateConnector, runConnectorTest, redactConnector, findConnectorIdByProvider } from "@/gateway/connectors";
import { logConnectorLifecycleEvent } from "@/core/connector-loader";
import {
  assertProviderMutationAllowed,
  insertEvent,
  loadSettings,
  splitFieldsByRequirements,
  upsertSettings,
} from "../../_lib/providerCredentialMeta";

type Params = { params: Promise<{ providerId: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  const { providerId } = await params;

  try {
    const body = (await req.json().catch(() => ({}))) as { fields?: Record<string, unknown> };
    if (!body.fields || Object.keys(body.fields).length === 0) {
      return NextResponse.json({ ok: false, code: "EMPTY_FIELDS" }, { status: 400 });
    }

    const db = supabaseAdmin();
    // Rotate handles SECRETS only — config edits belong to PUT.
    const split = await splitFieldsByRequirements(db, providerId, body.fields);
    if (split.keys.config.length > 0 || split.keys.secret.length === 0) {
      return NextResponse.json({ ok: false, code: "ROTATE_SECRET_ONLY" }, { status: 400 });
    }

    const connectorId = await findConnectorIdByProvider(providerId);
    if (!connectorId) {
      return NextResponse.json({ ok: false, code: "NO_CONNECTOR", error: "ยังไม่มี connector ให้หมุนเวียน" }, { status: 404 });
    }

    // 2. Owner Approval policy เดิม (production / unknown env = fail closed).
    const gate = await assertProviderMutationAllowed(db, providerId, "rotate");
    if (!gate.allowed) {
      return NextResponse.json(
        { ok: false, code: "OWNER_APPROVAL_REQUIRED", environment: gate.environment, proposal_id: gate.proposal_id ?? null, proposal_status: gate.proposal_status ?? "not_requested" },
        { status: 403 },
      );
    }

    const settingsRows = await loadSettings(db);
    const settingsRow = settingsRows.rows.find((r) => r.provider_id === providerId);
    const prevVersion = settingsRow?.credential_version ?? 0;

    // 1/3. old secret snapshot stays in SERVER MEMORY only; new values go in.
    const current = await getConnectorById(connectorId);
    if (!current) return NextResponse.json({ ok: false, code: "NO_CONNECTOR" }, { status: 404 });
    const oldSecret = { ...(current.secret as Record<string, unknown>) };

    const updated = await updateConnector(connectorId, { secret: split.secret });

    // 4. canonical verify — existing tester, no second test path.
    const tested = await runConnectorTest(connectorId);
    const now = new Date().toISOString();

    if (tested.status === "connected") {
      // 5a. PASS → switch metadata to the new version.
      const row = await upsertSettings(db, providerId, {
        credential_version: prevVersion + 1,
        last_rotated_at: now,
        last_verified_at: now,
        last_test_status: "pass",
        connector_id: connectorId,
      });
      await logConnectorLifecycleEvent(db, connectorId, "rotated", {
        note: `keys=[${split.keys.secret.join(",")}] version=${prevVersion + 1}`,
        actorUserId: auth.id,
      });
      const eventLogged = await insertEvent(db, {
        provider_id: providerId,
        connector_id: connectorId,
        action: "rotate",
        field_keys: split.keys.secret,
        version: prevVersion + 1,
        detail: { previous_version: prevVersion, verify: "pass", approval_gate: gate.environment },
        actor: auth.email,
      });
      const after = await getConnectorById(connectorId);
      return NextResponse.json({
        ok: true,
        verified: true,
        connector: after ? redactConnector(after) : null,
        settings: row,
        audit: { lifecycle_logged: true, event_logged: eventLogged },
      });
    }

    // 5b. FAIL → restore the OLD credential first, then re-test to restate status.
    await updateConnector(connectorId, { secret: oldSecret });
    const restoreTest = await runConnectorTest(connectorId);
    const restorePassed = restoreTest.status === "connected";
    const restoreTime = new Date().toISOString();
    const row = await upsertSettings(db, providerId, {
      last_test_status: restorePassed ? "pass" : "fail",
      ...(restorePassed ? { last_verified_at: restoreTime, connector_id: connectorId } : {}),
    });
    await logConnectorLifecycleEvent(db, connectorId, "rotate_failed", {
      note: `keys=[${split.keys.secret.join(",")}] restored=${restorePassed ? "verified" : "unverified"} error=${tested.last_error ?? "unknown"}`,
      actorUserId: auth.id,
    });
    const eventLogged = await insertEvent(db, {
      provider_id: providerId,
      connector_id: connectorId,
      action: "rotate_failed",
      field_keys: split.keys.secret,
      version: prevVersion,
      detail: { previous_version: prevVersion, verify: "fail", restored: true, restore_test: restorePassed ? "pass" : "fail" },
      actor: auth.email,
      result: "restored",
    });
    return NextResponse.json(
      {
        ok: false,
        code: "ROTATE_VERIFY_FAILED",
        restored: true,
        restore_verified: restorePassed,
        error: tested.last_error ?? "test failed",
        settings: row,
        audit: { lifecycle_logged: true, event_logged: eventLogged },
      },
      { status: 422 },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const code = (err as { code?: string }).code;
    if (code === "UNKNOWN_CREDENTIAL_KEY" || code === "REQUIREMENTS_MISSING" || code === "META_TABLES_MISSING") {
      return NextResponse.json({ ok: false, code, error: msg }, { status: code === "UNKNOWN_CREDENTIAL_KEY" ? 400 : 409 });
    }
    console.error("[provider-settings] rotate failed:", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

