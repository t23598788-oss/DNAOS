"use client";

/**
 * Connections & Credentials board — THE shared provider-card renderer.
 *
 * Mounted by BOTH /admin/settings (section "Connections & Credentials") and
 * /admin/line-customers (tab "API & Credentials Management") — ONE component,
 * ONE data source (GET /api/admin/provider-settings), never two settings
 * systems. Schema-driven: every form row renders from
 * provider_credential_requirements rows (field_label / field_kind / required /
 * help_text / scope) — adding Google/Shopee later = adding registry rows, the
 * box appears by itself; no provider-specific form code exists here.
 *
 * Secrets: password inputs are WRITE-ONLY. State only ever holds the boolean
 * "Configured" flag from the redacted payload (redactConnector turns every
 * secret value into `true`), so no secret value can exist in this component,
 * in any API response it sees, or in React state/devtools.
 *
 * First-time Connect (create + contract approval + discovery) stays on the
 * existing /admin/connectors lifecycle screen — Setup Provider links there
 * with ?provider=<id> preselected. This board maintains credentials, order,
 * environment, verification, rotation, and disconnect.
 */
import { useCallback, useEffect, useMemo, useState } from "react";

interface Req {
  provider_id: string;
  credential_key: string;
  field_label: string;
  field_kind: "secret" | "text" | "readonly";
  required: boolean;
  is_secret: boolean;
  scope: string;
  sort_order: number;
  help_text: string;
}

interface SettingsRow {
  provider_id: string;
  display_name: string;
  environment: "local" | "staging" | "production";
  sort_order: number | null;
  credential_version: number;
  last_verified_at: string | null;
  last_test_status: "pass" | "fail" | null;
  last_rotated_at: string | null;
  connector_id: string | null;
}

interface ConnectorView {
  id: string;
  name: string;
  auth_type: string;
  status: string;
  enabled: boolean;
  config: Record<string, unknown>;
  secret: Record<string, boolean>; // redacted: key present => true
  last_checked_at: string | null;
  last_error: string | null;
}

interface ProposalView {
  id: string;
  status: string;
  capability: string;
  proposed_at: string;
}

interface BoardData {
  requirements: Req[];
  settings: SettingsRow[];
  events: Record<string, unknown>[];
  connectors: ConnectorView[];
  providers: { provider_id: string; connection_status: string }[];
  contracts: string[];
  mutation_proposals: Record<string, { rotate?: ProposalView; disconnect?: ProposalView }>;
  unowned_connectors: { id: string; name: string; auth_type: string }[];
  migrated: boolean;
}

interface Box {
  providerId: string;
  title: string;
  settings?: SettingsRow;
  reqs: Req[];
  connector?: ConnectorView;
  providerStatus?: string;
  hasContract: boolean;
  proposals?: { rotate?: ProposalView; disconnect?: ProposalView };
  latestEvent?: { action: string; created_at: string };
}

const STATUS_STYLE: Record<string, string> = {
  connected: "bg-emerald-50 text-emerald-700 border-emerald-200",
  connecting: "bg-amber-50 text-amber-700 border-amber-200",
  error: "bg-red-50 text-red-700 border-red-200",
  disconnected: "bg-stone-100 text-stone-600 border-stone-200",
};

function fmt(ts: string | null | undefined): string {
  if (!ts) return "—";
  try {
    return new Date(ts).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return "—";
  }
}

export function ConnectionsCredentialsBoard() {
  const [data, setData] = useState<BoardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // providerId -> credential_key -> typed value (write-only; secrets never prefill)
  const [drafts, setDrafts] = useState<Record<string, Record<string, string>>>({});
  const [envDraft, setEnvDraft] = useState<Record<string, string>>({});
  const [rotateOpen, setRotateOpen] = useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/provider-settings", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? `${res.status}`);
      setData(json as BoardData);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const note = useCallback((providerId: string, msg: string) => {
    setNotes((n) => ({ ...n, [providerId]: msg }));
    setTimeout(() => setNotes((n) => (n[providerId] === msg ? { ...n, [providerId]: "" } : n)), 8000);
  }, []);

  /** Provider universe = settings ∪ requirements ∪ contracts ∪ declared
   *  connectors, ordered BY THE DB (settings.sort_order, nulls last) — the
   *  order is never hardcoded here (PHASE 9). */
  const boxes: Box[] = useMemo(() => {
    if (!data) return [];
    const universe = new Set<string>();
    for (const s of data.settings) universe.add(s.provider_id);
    for (const r of data.requirements) universe.add(r.provider_id);
    for (const c of data.contracts) universe.add(c);
    for (const c of data.connectors) {
      const p = c.config?.provider;
      if (typeof p === "string" && p) universe.add(p);
    }
    const orderOf = (id: string) => data.settings.find((s) => s.provider_id === id)?.sort_order ?? null;
    const sorted = [...universe].sort((a, b) => {
      const oa = orderOf(a);
      const ob = orderOf(b);
      if (oa !== null && ob !== null) return oa - ob;
      if (oa !== null) return -1;
      if (ob !== null) return 1;
      return a.localeCompare(b);
    });
    return sorted.map((providerId) => {
      const settings = data.settings.find((s) => s.provider_id === providerId);
      const reqs = data.requirements.filter((r) => r.provider_id === providerId);
      const connector = data.connectors.find((c) => c.config?.provider === providerId);
      const latestEvent = data.events.find((e) => e.provider_id === providerId);
      return {
        providerId,
        title: settings?.display_name || providerId,
        settings,
        reqs,
        connector,
        providerStatus: data.providers.find((p) => p.provider_id === providerId)?.connection_status,
        hasContract: data.contracts.includes(providerId),
        proposals: data.mutation_proposals[providerId],
        latestEvent: latestEvent
          ? { action: String(latestEvent.action ?? ""), created_at: String(latestEvent.created_at ?? "") }
          : undefined,
      };
    });
  }, [data]);

  const setDraft = (providerId: string, key: string, value: string) => {
    setDrafts((d) => ({ ...d, [providerId]: { ...(d[providerId] ?? {}), [key]: value } }));
  };

  const dirtyFields = (providerId: string): Record<string, string> => {
    const d = drafts[providerId] ?? {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(d)) if (v.length > 0) out[k] = v;
    return out;
  };

  async function saveProvider(b: Box) {
    const p = b.providerId;
    setBusy(`save:${p}`);
    try {
      const body: Record<string, unknown> = {};
      const fields = dirtyFields(p);
      if (Object.keys(fields).length > 0) body.fields = fields;
      const env = envDraft[p];
      if (env && env !== b.settings?.environment) body.environment = env;
      if (Object.keys(body).length === 0) {
        note(p, "ยังไม่มีอะไรเปลี่ยน");
        return;
      }
      const res = await fetch(`/api/admin/provider-settings/${p}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        const hint = json.code === "NO_CONNECTOR" ? " — เปิด Setup Provider เพื่อเชื่อมต่อครั้งแรก" : "";
        note(p, `บันทึกไม่สำเร็จ: ${json.error ?? json.code ?? res.status}${hint}`);
        return;
      }
      note(p, `บันทึกแล้ว${json.field_keys?.length ? ` (${json.field_keys.join(", ")}${json.audit?.lifecycle_logged ? " · audit ✓" : ""})` : ""}`);
      setDrafts((d) => ({ ...d, [p]: {} }));
      await load();
    } catch (e) {
      note(p, `บันทึกไม่สำเร็จ: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(null);
    }
  }

  /** Test = the EXISTING canonical test route (no test logic lives in this UI). */
  async function testProvider(b: Box): Promise<boolean> {
    const p = b.providerId;
    if (!b.connector) return false;
    setBusy(`test:${p}`);
    try {
      const res = await fetch(`/api/admin/connectors/${b.connector.id}/test`, { method: "POST" });
      const json = await res.json().catch(() => ({}));
      const ok = res.ok && json.connector?.status === "connected";
      note(p, ok ? `Test ผ่าน ✓ (${fmt(json.connector?.last_checked_at)})` : `Test ไม่ผ่าน: ${json.connector?.last_error ?? json.error ?? res.status}`);
      return ok;
    } catch (e) {
      note(p, `Test ไม่สำเร็จ: ${e instanceof Error ? e.message : e}`);
      return false;
    } finally {
      setBusy(null);
    }
  }

  /** PHASE 8 "Verify All" — loops the SAME canonical test for every connector. */
  async function verifyAll() {
    setBusy("verify-all");
    let pass = 0;
    let fail = 0;
    for (const b of boxes) {
      if (!b.connector) continue;
      const ok = await testProvider(b);
      if (ok) pass += 1;
      else fail += 1;
    }
    setBusy(null);
    note("_all", `Verify All เสร็จ: ${pass} ผ่าน / ${fail} ไม่ผ่าน`);
    await load();
  }

  async function rotateProvider(b: Box) {
    const p = b.providerId;
    const secretKeys = b.reqs.filter((r) => r.is_secret || r.field_kind === "secret").map((r) => r.credential_key);
    const fields: Record<string, string> = {};
    for (const k of secretKeys) {
      const v = (drafts[p] ?? {})[k];
      if (v && v.length > 0) fields[k] = v;
    }
    if (Object.keys(fields).length === 0) {
      note(p, "พิมพ์ค่าใหม่ในช่อง secret ก่อนกด Rotate");
      return;
    }
    setBusy(`rotate:${p}`);
    try {
      const res = await fetch(`/api/admin/provider-settings/${p}/rotate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.status === 403 && json.code === "OWNER_APPROVAL_REQUIRED") {
        note(p, "production — ต้องขออนุมัติก่อนหมุนเวียน (กด 'ขออนุมัติ Rotate')");
        setRotateOpen((r) => ({ ...r, [p]: false }));
        return;
      }
      if (json.ok) {
        note(p, `Rotate สำเร็จ · verify ผ่าน ✓ · v${json.settings?.credential_version}`);
      } else if (json.code === "ROTATE_VERIFY_FAILED") {
        note(p, `Verify ไม่ผ่าน — ค่าเดิมถูกกู้คืนแล้ว (restore verified: ${json.restore_verified ? "✓" : "✗"})`);
      } else {
        note(p, `Rotate ไม่สำเร็จ: ${json.error ?? json.code ?? res.status}`);
      }
      setDrafts((d) => ({ ...d, [p]: {} }));
      setRotateOpen((r) => ({ ...r, [p]: false }));
      await load();
    } catch (e) {
      note(p, `Rotate ไม่สำเร็จ: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(null);
    }
  }

  async function toggleEnabled(b: Box) {
    const p = b.providerId;
    if (!b.connector) return;
    setBusy(`enable:${p}`);
    try {
      const res = await fetch(`/api/admin/connectors/${b.connector.id}/enable`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !b.connector.enabled }),
      });
      const json = await res.json().catch(() => ({}));
      note(p, res.ok ? (json.connector?.enabled ? "เปิดใช้งานแล้ว ✓ (human click — ไม่มี auto-enable)" : "ปิดการใช้งานแล้ว") : `ทำไม่สำเร็จ: ${json.error ?? res.status}`);
      await load();
    } finally {
      setBusy(null);
    }
  }

  /** Owner Approval request (rotate / disconnect) — same propose channel,
   *  same decide route as every other proposal in the system. */
  async function requestApproval(b: Box, kind: "rotate" | "disconnect") {
    const p = b.providerId;
    setBusy(`approve-req:${p}`);
    try {
      const res = await fetch(`/api/admin/provider-settings/${p}/request-approval`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind }),
      });
      const json = await res.json().catch(() => ({}));
      note(p, res.ok && json.ok ? `ส่งคำขออนุมัติ ${kind} แล้ว — กด "อนุมัติ (Owner)" เพื่อยืนยัน` : `ขออนุมัติไม่สำเร็จ: ${json.error ?? res.status}`);
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function approveProposal(b: Box, proposalId: string) {
    const p = b.providerId;
    setBusy(`approve:${p}`);
    try {
      const res = await fetch(`/api/gateway/proposals/${proposalId}/decide`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision: "approved" }),
      });
      const json = await res.json().catch(() => ({}));
      note(p, res.ok && json.ok ? "อนุมัติแล้ว ✓ — ทำรายการต่อได้เลย" : `อนุมัติไม่สำเร็จ: ${json.error ?? res.status}`);
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function disconnectProvider(b: Box) {
    const p = b.providerId;
    if (!b.connector) return;
    setBusy(`disconnect:${p}`);
    try {
      const res = await fetch(`/api/admin/connectors/${b.connector.id}`, { method: "DELETE" });
      const json = await res.json().catch(() => ({}));
      if (res.status === 403 && json.code === "OWNER_APPROVAL_REQUIRED") {
        note(p, "production — ต้องขออนุมัติก่อน Disconnect (กด 'ขออนุมัติ Disconnect')");
        return;
      }
      note(p, res.ok ? "Disconnect แล้ว · audit ✓" : `Disconnect ไม่สำเร็จ: ${json.error ?? res.status}`);
      await load();
    } catch (e) {
      note(p, `Disconnect ไม่สำเร็จ: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(null);
    }
  }

  /** PHASE 9 — reorder = swap with neighbour, then renumber positions back to
   *  the DB. The UI reads the order from settings.sort_order; nothing local. */
  async function moveBox(index: number, dir: -1 | 1) {
    if (!data) return;
    const target = index + dir;
    if (target < 0 || target >= boxes.length) return;
    const ids = boxes.map((b) => b.providerId);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    setBusy("sort");
    try {
      for (let i = 0; i < ids.length; i += 1) {
        await fetch(`/api/admin/provider-settings/${ids[i]}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sort_order: (i + 1) * 10 }),
        });
      }
      await load();
    } finally {
      setBusy(null);
    }
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        โหลดข้อมูลไม่สำเร็จ: {error}{" "}
        <button type="button" onClick={() => void load()} className="underline">
          ลองใหม่
        </button>
      </div>
    );
  }
  if (!data) {
    return <div className="rounded-xl border border-stone-200 bg-white p-6 text-sm text-stone-500">กำลังโหลด Connections &amp; Credentials…</div>;
  }

  const isProd = (b: Box) => (envDraft[b.providerId] ?? b.settings?.environment ?? "production") === "production";

  return (
    <div className="space-y-4">
      {!data.migrated && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
          ตาราง metadata (provider_credential_requirements / provider_connection_settings / provider_credential_events)
          ยังไม่ถูก apply บนฐานข้อมูลนี้ — รัน migration <span className="font-mono">20260924000001_provider_credential_settings</span> ก่อนใช้ฟอร์ม/จัดลำดับ
        </div>
      )}
      {data.unowned_connectors.length > 0 && (
        <div className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-[12px] text-stone-600">
          Connector ที่ไม่ได้ประกาศ provider (จัดการที่หน้า Connectors): {data.unowned_connectors.map((c) => c.name).join(" · ")}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12px] text-stone-500">
          {boxes.length} providers · ฟอร์ม render จาก provider_credential_requirements (registry เดียว) · ค่ารหัสจริงอยู่ที่
          credential authority ของ Connect — หน้านี้เห็นเฉพาะสถานะ
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void verifyAll()}
            disabled={busy !== null}
            className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-xs hover:bg-stone-50 disabled:opacity-40"
          >
            {busy === "verify-all" ? "กำลัง Verify ทุกตัว…" : "Verify All"}
          </button>
          <a href="/admin/connectors" className="rounded-lg border border-stone-800 bg-stone-800 px-3 py-1.5 text-xs text-white hover:bg-stone-700">
            + Add Provider
          </a>
        </div>
      </div>
      {notes._all && <div className="rounded-lg bg-stone-100 px-3 py-2 text-xs text-stone-700">{notes._all}</div>}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {boxes.map((b, idx) => {
          const p = b.providerId;
          const conn = b.connector;
          const connected = conn?.status === "connected";
          const pillText = conn
            ? connected
              ? conn.enabled
                ? "Connected"
                : "Connected · disabled"
              : conn.status
            : b.providerStatus === "connected"
              ? "Connected (source)"
              : "Not Connected";
          const pillStyle =
            STATUS_STYLE[conn?.status ?? (b.providerStatus === "connected" ? "connected" : "disconnected")] ?? STATUS_STYLE.disconnected;
          const env = envDraft[p] ?? b.settings?.environment ?? "production";
          const envChanged = env !== (b.settings?.environment ?? "production");
          const fields = dirtyFields(p);
          const canSave = Object.keys(fields).length > 0 || envChanged;
          const rotateProp = b.proposals?.rotate;
          const discProp = b.proposals?.disconnect;
          return (
            <section key={p} className="flex flex-col rounded-xl border border-stone-200 bg-white p-4 connector-card">
              <header className="mb-3 flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-center gap-1.5">
                  <button
                    type="button"
                    aria-label="เลื่อนขึ้น"
                    onClick={() => void moveBox(idx, -1)}
                    disabled={busy !== null || !data.migrated}
                    title={!data.migrated ? "ต้อง apply migration ก่อน" : "เลื่อนขึ้น"}
                    className="rounded border border-stone-200 px-1 text-[10px] text-stone-500 hover:bg-stone-50 disabled:opacity-30"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    aria-label="เลื่อนลง"
                    onClick={() => void moveBox(idx, 1)}
                    disabled={busy !== null || !data.migrated}
                    title={!data.migrated ? "ต้อง apply migration ก่อน" : "เลื่อนลง"}
                    className="rounded border border-stone-200 px-1 text-[10px] text-stone-500 hover:bg-stone-50 disabled:opacity-30"
                  >
                    ↓
                  </button>
                  <img
                    src={`/brands/${({ line: "line", github: "github", supabase: "supabase", google: "google", deepseek: "deepseek", kbank: "kbank", kobchat: "kobchat", "kob-chat": "kobchat" }[p.toLowerCase()] ?? "supabase")}.svg`}
                    alt=""
                    className="h-5 w-5 shrink-0 rounded"
                    onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                  />
                  <h3 className="truncate text-sm font-semibold text-stone-800">{b.title}</h3>
                  <span className="font-mono text-[10px] text-stone-400">{p}</span>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${pillStyle}`}>{pillText}</span>
                  <span className="rounded border border-stone-200 bg-stone-50 px-1.5 py-0.5 text-[10px] text-stone-500">
                    {b.settings?.environment ?? "production"}
                  </span>
                </div>
              </header>

              {!conn ? (
                <div className="mt-3">
                  <a
                    href={`/admin/connectors?provider=${encodeURIComponent(p)}`}
                    className="inline-flex items-center rounded-lg bg-stone-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-stone-800"
                  >
                    Setup Provider
                  </a>
                  <p className="mt-1.5 text-[10px] text-stone-400">
                    ยังไม่มี connector — กด Setup Provider เพื่อเชื่อมต่อครั้งแรก (Connect → Register → Test → Enable)
                  </p>
                </div>
              ) : (
                <>
                  <div className="mt-3 flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => setExpanded((e) => ({ ...e, [p]: !e[p] }))}
                      className="rounded-lg border border-stone-300 bg-white px-2.5 py-1 text-[11px] text-stone-700 hover:bg-stone-50"
                    >
                      {expanded[p] ? "ซ่อนการตั้งค่า" : "จัดการ / ตั้งค่า"}
                    </button>
                    <span className="text-[10px] text-stone-400">env: {env}</span>
                  </div>
                  {expanded[p] && (
                    <>
              <div className="mt-3 flex items-center gap-2">
                <label className="text-[11px] text-stone-500">Environment</label>
                <select
                  value={env}
                  onChange={(e) => setEnvDraft((d) => ({ ...d, [p]: e.target.value }))}
                  className="rounded border border-stone-200 bg-white px-1.5 py-0.5 text-[10px] text-stone-600"
                  aria-label="environment"
                >
                  <option value="local">local</option>
                  <option value="staging">staging</option>
                  <option value="production">production</option>
                </select>
              </div>
              {/* ── Fields render 100% FROM the registry rows ── */}
              <div className="space-y-2.5">
                {b.reqs.length === 0 && (
                  <p className="rounded-lg border border-dashed border-stone-200 bg-stone-50 px-3 py-2 text-[11px] text-stone-500">
                    ยังไม่มี credential requirements สำหรับ provider นี้ — เพิ่มแถวใน
                    <span className="font-mono"> provider_credential_requirements</span> แล้วกล่อง/ฟอร์มจะขึ้นให้เอง (ไม่ต้องเขียนฟอร์มแยก)
                  </p>
                )}
                {b.reqs.map((r) => {
                  const isSecret = r.is_secret || r.field_kind === "secret";
                  const configured =
                    conn?.secret?.[r.credential_key] === true ||
                    (conn?.config?.[r.credential_key] !== undefined && String(conn.config[r.credential_key]) !== "");
                  const draftVal = drafts[p]?.[r.credential_key] ?? "";
                  return (
                    <div key={r.credential_key}>
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <label className="text-[11px] font-semibold text-stone-600" htmlFor={`${p}-${r.credential_key}`}>
                          {r.field_label} {r.required && <span className="text-red-500">*</span>}
                          {!r.required && <span className="font-normal text-stone-400">(optional)</span>}
                        </label>
                        <span className="flex items-center gap-1">
                          {r.scope && <span className="rounded bg-stone-100 px-1 py-0.5 font-mono text-[9px] text-stone-500">scope: {r.scope}</span>}
                          {isSecret && configured && (
                            <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[9px] font-medium text-emerald-700">Configured</span>
                          )}
                        </span>
                      </div>
                      {r.field_kind === "readonly" ? (
                        <div className="truncate rounded-lg border border-stone-100 bg-stone-50 px-3 py-1.5 font-mono text-[11px] text-stone-500">
                          {conn?.config?.[r.credential_key] !== undefined ? String(conn.config[r.credential_key]) : "—"}
                        </div>
                      ) : isSecret ? (
                        <input
                          id={`${p}-${r.credential_key}`}
                          type="password"
                          autoComplete="new-password"
                          value={draftVal}
                          disabled={!conn || busy !== null}
                          onChange={(e) => setDraft(p, r.credential_key, e.target.value)}
                          placeholder={configured ? "••••••  ตั้งแล้ว — พิมพ์ใหม่เพื่อแทนที่" : "ยังไม่ได้ตั้ง"}
                          className="w-full rounded-lg border border-stone-200 px-3 py-1.5 text-xs focus:border-stone-400 focus:outline-none disabled:bg-stone-50"
                        />
                      ) : (
                        <input
                          id={`${p}-${r.credential_key}`}
                          type="text"
                          value={draftVal || (conn?.config?.[r.credential_key] !== undefined ? String(conn.config[r.credential_key]) : "")}
                          disabled={!conn || busy !== null}
                          onChange={(e) => setDraft(p, r.credential_key, e.target.value)}
                          placeholder={r.help_text ? r.help_text.slice(0, 60) : r.credential_key}
                          className="w-full rounded-lg border border-stone-200 px-3 py-1.5 text-xs focus:border-stone-400 focus:outline-none disabled:bg-stone-50"
                        />
                      )}
                      {r.help_text && <p className="mt-0.5 text-[10px] leading-snug text-stone-400">{r.help_text}</p>}
                    </div>
                  );
                })}
              </div>

              {/* ── Owner Approval chips (production destructive ops, PHASE 10) ── */}
              {conn && isProd(b) && (
                <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[10px]">
                  <span className="text-stone-400">production:</span>
                  {b.proposals?.rotate?.status === "approved" ? (
                    <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-700">✓ Rotate approved</span>
                  ) : b.proposals?.rotate?.status === "pending" ? (
                    <button
                      type="button"
                      onClick={() => void approveProposal(b, b.proposals!.rotate!.id)}
                      disabled={busy !== null}
                      className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-800 hover:bg-amber-200 disabled:opacity-50"
                    >
                      Rotate รออนุมัติ — อนุมัติ (Owner)
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void requestApproval(b, "rotate")}
                      disabled={busy !== null}
                      className="rounded border border-stone-200 px-1.5 py-0.5 text-stone-500 hover:bg-stone-50 disabled:opacity-50"
                    >
                      ขออนุมัติ Rotate
                    </button>
                  )}
                  {b.proposals?.disconnect?.status === "approved" ? (
                    <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-700">✓ Disconnect approved</span>
                  ) : b.proposals?.disconnect?.status === "pending" ? (
                    <button
                      type="button"
                      onClick={() => void approveProposal(b, b.proposals!.disconnect!.id)}
                      disabled={busy !== null}
                      className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-800 hover:bg-amber-200 disabled:opacity-50"
                    >
                      Disconnect รออนุมัติ — อนุมัติ (Owner)
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void requestApproval(b, "disconnect")}
                      disabled={busy !== null}
                      className="rounded border border-stone-200 px-1.5 py-0.5 text-stone-500 hover:bg-stone-50 disabled:opacity-50"
                    >
                      ขออนุมัติ Disconnect
                    </button>
                  )}
                </div>
              )}

              {/* ── Status facts: verified / rotated / version / audit ── */}
              <div className="mt-3 space-y-0.5 border-t border-stone-100 pt-2 text-[10px] text-stone-500">
                <div>
                  Last verified: <span className="text-stone-700">{fmt(b.settings?.last_verified_at)}</span>
                  {b.settings?.last_test_status && (
                    <span className={b.settings.last_test_status === "pass" ? " text-emerald-600" : " text-red-600"}>
                      {" · test "}
                      {b.settings.last_test_status}
                    </span>
                  )}
                  {" · Last rotated: "}
                  <span className="text-stone-700">{fmt(b.settings?.last_rotated_at)}</span>
                  {" · v"}
                  <span className="font-mono">{b.settings?.credential_version ?? 0}</span>
                </div>
                <div>
                  audit:{" "}
                  {b.latestEvent ? (
                    <span className="text-stone-700">
                      {b.latestEvent.action} · {fmt(b.latestEvent.created_at)}
                    </span>
                  ) : (
                    "—"
                  )}
                  {conn?.last_checked_at && <span> · last checked {fmt(conn.last_checked_at)}</span>}
                </div>
                {conn?.status === "error" && conn.last_error && <div className="text-red-600">test error: {conn.last_error}</div>}
              </div>

              {/* ── Actions ── */}
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => void saveProvider(b)}
                  disabled={!canSave || busy !== null}
                  className="rounded-lg bg-stone-800 px-2.5 py-1 text-[11px] text-white hover:bg-stone-700 disabled:opacity-40"
                >
                  {busy === `save:${p}` ? "กำลังบันทึก…" : "Save"}
                </button>
                {conn && (
                  <button
                    type="button"
                    onClick={() => void testProvider(b)}
                    disabled={busy !== null}
                    className="rounded-lg border border-stone-300 px-2.5 py-1 text-[11px] hover:bg-stone-50 disabled:opacity-40"
                  >
                    {busy === `test:${p}` ? "กำลัง Test…" : "Test Connection"}
                  </button>
                )}
                {conn && b.reqs.some((r) => r.is_secret || r.field_kind === "secret") && (
                  <button
                    type="button"
                    onClick={() => (rotateOpen[p] ? void rotateProvider(b) : setRotateOpen((r) => ({ ...r, [p]: true })))}
                    disabled={busy !== null}
                    className="rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1 text-[11px] text-amber-800 hover:bg-amber-100 disabled:opacity-40"
                    title="ค่าใหม่จะถูก verify ก่อนสลับ — ถ้า verify ไม่ผ่าน ค่าเดิมถูกกู้คืนอัตโนมัติ"
                  >
                    {rotateOpen[p] ? "ยืนยัน Rotate (verify ก่อนสลับ)" : "Rotate Secret"}
                  </button>
                )}
                {conn && (
                  <button
                    type="button"
                    onClick={() => void toggleEnabled(b)}
                    disabled={busy !== null || (!conn.enabled && conn.status !== "connected")}
                    className="rounded-lg border border-stone-300 px-2.5 py-1 text-[11px] hover:bg-stone-50 disabled:opacity-40"
                    title={!conn.enabled && conn.status !== "connected" ? "ต้อง Test ให้ผ่านก่อนถึง Enable ได้" : undefined}
                  >
                    {conn.enabled ? "Disable" : "Enable"}
                  </button>
                )}
                {conn && (
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm(`Disconnect ${b.title}?`)) void disconnectProvider(b);
                    }}
                    disabled={busy !== null}
                    className="rounded-lg border border-red-200 px-2.5 py-1 text-[11px] text-red-600 hover:bg-red-50 disabled:opacity-40"
                  >
                    Disconnect
                  </button>
                )}
                <a
                  href={`/admin/connectors?provider=${encodeURIComponent(p)}`}
                  className="rounded-lg border border-stone-300 px-2.5 py-1 text-[11px] text-stone-600 hover:bg-stone-50"
                  title="เปิดหน้า Connectors เดิมเพื่อ Connect/Discover/จัดการ lifecycle"
                >
                  Setup Provider ↗
                </a>
              </div>
              {rotateOpen[p] && (
                <p className="mt-1.5 text-[10px] text-amber-700">
                  พิมพ์ค่าใหม่ในช่อง secret ด้านบน แล้วกดยืนยัน — ระบบเขียนค่าใหม่ → verify → สลับเมื่อผ่าน (ไม่ผ่าน = ค่าเดิมยังอยู่)
                </p>
              )}
              {!conn && (
                <p className="mt-1.5 text-[10px] text-stone-400">
                  ยังไม่มี connector — ฟอร์มปิดอยู่ กด &quot;Setup Provider&quot; เพื่อเชื่อมต่อครั้งแรกผ่าน lifecycle เดิม
                </p>
              )}

                    </>
                  )}
                </>
              )}
              {notes[p] && <p className="mt-2 rounded-lg bg-stone-100 px-2 py-1.5 text-[10px] text-stone-700">{notes[p]}</p>}
            </section>
          );
        })}
      </div>
    </div>
  );
}




