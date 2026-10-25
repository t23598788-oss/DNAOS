"use client";

/**
 * Realtime client for the Dev Loop pipeline. Subscribes to
 * dev_loop_evidence_events / dev_loop_check_results / dev_loop_registry_proposals
 * via Supabase Realtime (postgres_changes — same pattern as
 * app/admin/relationships/workspace.tsx's line-events channel). Reads use
 * the browser client directly (RLS: authenticated can select, see
 * supabase/migrations/20260805000001_dev_loop_pipeline.sql); the Approve/
 * Reject buttons post to /api/admin/dev-loop/approve, which is the only
 * thing allowed to write — never a direct client-side update.
 */
import { useEffect, useState, useCallback } from "react";
import { createBrowserSupabase } from "@/services/supabase/browser";
import DevLoopVoiceAlerts from "@/components/admin/DevLoopVoiceAlerts";

interface EvidenceEvent {
  id: string;
  session_id: string;
  path: string;
  event_type: "add" | "change" | "unlink";
  content_hash: string | null;
  diff_summary: string | null;
  occurred_at: string;
}

interface CheckResult {
  id: string;
  evidence_event_id: string;
  session_id: string;
  path: string;
  result: "pass" | "warning" | "fail";
  reason: string;
  dependents: string[];
  checked_at: string;
}

interface RegistryProposal {
  id: string;
  path: string;
  target_registry: string;
  patch: Record<string, unknown>;
  status: "pending" | "approved" | "rejected";
  proposed_at: string;
  decided_by: string | null;
  decided_at: string | null;
}

interface DevLoopSession {
  id: string;
  owner: string | null;
  status: "open" | "closed";
  started_at: string;
  closed_at: string | null;
}

type WatcherStatus = "WATCHER_RUNNING" | "WATCHER_STOPPED" | "STALE";

// No heartbeat table exists — this reads only what scripts/watch-registry.ts
// already writes for real: dev_loop_sessions.status (open until the process
// gets a clean Ctrl+C, engines/workspace/devLoopSession.ts's closeSession())
// and the latest evidence event's occurred_at. STALE_MS is an honest
// inference, not a certainty: a session left "open" with no evidence for
// this long likely means the local process died without closing it (killed,
// laptop slept, etc) — never presented as live data past this point.
const STALE_MS = 15 * 60 * 1000;

function computeWatcherStatus(session: DevLoopSession | null, latestEvidenceAt: string | null): { status: WatcherStatus; lastActivityAt: string | null } {
  const lastActivityAt = latestEvidenceAt ?? session?.started_at ?? null;
  if (!session || session.status === "closed") {
    return { status: "WATCHER_STOPPED", lastActivityAt };
  }
  if (lastActivityAt && Date.now() - new Date(lastActivityAt).getTime() > STALE_MS) {
    return { status: "STALE", lastActivityAt };
  }
  return { status: "WATCHER_RUNNING", lastActivityAt };
}

const RESULT_COLOR: Record<CheckResult["result"], string> = {
  pass: "#1e9e5a",
  warning: "#c98a12",
  fail: "#c9312b",
};

export default function DevLoopDashboard() {
  const [events, setEvents] = useState<EvidenceEvent[]>([]);
  const [checks, setChecks] = useState<CheckResult[]>([]);
  const [proposals, setProposals] = useState<RegistryProposal[]>([]);
  const [session, setSession] = useState<DevLoopSession | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    const client = createBrowserSupabase();
    const [{ data: e }, { data: c }, { data: p }, { data: s }] = await Promise.all([
      client.from("dev_loop_evidence_events").select("*").order("occurred_at", { ascending: false }).limit(30),
      client.from("dev_loop_check_results").select("*").order("checked_at", { ascending: false }).limit(30),
      client.from("dev_loop_registry_proposals").select("*").order("proposed_at", { ascending: false }).limit(30),
      client.from("dev_loop_sessions").select("*").order("started_at", { ascending: false }).limit(1),
    ]);
    setEvents((e as EvidenceEvent[]) ?? []);
    setChecks((c as CheckResult[]) ?? []);
    setProposals((p as RegistryProposal[]) ?? []);
    setSession((s?.[0] as DevLoopSession) ?? null);
  }, []);

  useEffect(() => {
    void loadAll();
    const client = createBrowserSupabase();
    const channel = client
      .channel("dev-loop-pipeline")
      .on("postgres_changes", { event: "*", schema: "public", table: "dev_loop_evidence_events" }, () => void loadAll())
      .on("postgres_changes", { event: "*", schema: "public", table: "dev_loop_check_results" }, () => void loadAll())
      .on("postgres_changes", { event: "*", schema: "public", table: "dev_loop_registry_proposals" }, () => void loadAll())
      .on("postgres_changes", { event: "*", schema: "public", table: "dev_loop_sessions" }, () => void loadAll())
      .subscribe();

    // Re-derive STALE on a plain timer too — no new event fires when a
    // watcher silently dies, so without this the badge would only update on
    // the next real DB write (which, for a dead process, is never).
    const staleCheckInterval = setInterval(() => setSession((s) => (s ? { ...s } : s)), 30_000);

    return () => {
      void client.removeChannel(channel);
      clearInterval(staleCheckInterval);
    };
  }, [loadAll]);

  const { status: watcherStatus, lastActivityAt } = computeWatcherStatus(session, events[0]?.occurred_at ?? null);

  async function decide(id: string, decision: "approved" | "rejected") {
    setBusyId(id);
    try {
      const res = await fetch("/api/admin/dev-loop/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, decision }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        alert(body.error ?? "approve failed");
      }
      await loadAll();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div style={{ padding: 24, fontFamily: "system-ui, sans-serif", maxWidth: 1100, margin: "0 auto" }}>
      <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 4 }}>Dev Loop Pipeline</h1>
      <p style={{ color: "#666", marginBottom: 16 }}>
        ไฟล์เปลี่ยน → หลักฐาน → วิเคราะห์ผลกระทบ → ข้อเสนอ registry (ต้องอนุมัติ)
      </p>

      <WatcherStatusBanner status={watcherStatus} lastActivityAt={lastActivityAt} session={session} />

      <DevLoopVoiceAlerts />

      <Section title={`ข้อเสนอ Registry ที่รออนุมัติ (${proposals.filter((p) => p.status === "pending").length})`}>
        {proposals.length === 0 && <Empty text="ยังไม่มีข้อเสนอ" />}
        {proposals.map((p) => (
          <div key={p.id} style={row}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 500 }}>{p.path}</div>
              <div style={{ fontSize: 12, color: "#888" }}>
                → {p.target_registry} · {new Date(p.proposed_at).toLocaleString("th-TH")}
              </div>
              <pre style={{ fontSize: 11, background: "#f6f6f6", padding: 8, borderRadius: 4, overflowX: "auto", marginTop: 6 }}>
                {JSON.stringify(p.patch, null, 2)}
              </pre>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <StatusBadge status={p.status} />
              {p.status === "pending" && (
                <>
                  <button disabled={busyId === p.id} onClick={() => decide(p.id, "approved")} style={btn("#1e9e5a")}>
                    อนุมัติ
                  </button>
                  <button disabled={busyId === p.id} onClick={() => decide(p.id, "rejected")} style={btn("#c9312b")}>
                    ปฏิเสธ
                  </button>
                </>
              )}
              {p.status !== "pending" && p.decided_by && (
                <span style={{ fontSize: 11, color: "#888" }}>โดย {p.decided_by}</span>
              )}
            </div>
          </div>
        ))}
      </Section>

      <Section title="ผลตรวจ Impact Analyzer">
        {checks.length === 0 && <Empty text="ยังไม่มีผลตรวจ" />}
        {checks.map((c) => (
          <div key={c.id} style={row}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 500 }}>{c.path}</div>
              <div style={{ fontSize: 12, color: "#888" }}>{c.reason}</div>
              {c.dependents.length > 0 && (
                <div style={{ fontSize: 11, color: "#888" }}>dependents: {c.dependents.join(", ")}</div>
              )}
            </div>
            <span style={{ ...badge, background: RESULT_COLOR[c.result] }}>{c.result.toUpperCase()}</span>
          </div>
        ))}
      </Section>

      <Section title="ไฟล์ที่เปลี่ยน (Evidence)">
        {events.length === 0 && <Empty text="ยังไม่มีเหตุการณ์ — รัน npm run watch" />}
        {events.map((e) => (
          <div key={e.id} style={row}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 500 }}>{e.path}</div>
              <div style={{ fontSize: 12, color: "#888" }}>
                {e.event_type} · {e.content_hash?.slice(0, 10) ?? "—"} · {new Date(e.occurred_at).toLocaleString("th-TH")}
              </div>
            </div>
          </div>
        ))}
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 32 }}>
      <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>{title}</h2>
      <div style={{ border: "1px solid #e5e5e5", borderRadius: 8 }}>{children}</div>
    </section>
  );
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.round(ms / 60000);
  if (min < 1) return "เมื่อครู่นี้";
  if (min < 60) return `${min} นาทีที่แล้ว`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} ชั่วโมงที่แล้ว`;
  return `${Math.round(hr / 24)} วันที่แล้ว`;
}

function WatcherStatusBanner({
  status,
  lastActivityAt,
  session,
}: {
  status: "WATCHER_RUNNING" | "WATCHER_STOPPED" | "STALE";
  lastActivityAt: string | null;
  session: { id: string; owner: string | null; started_at: string; closed_at: string | null } | null;
}) {
  const copy: Record<typeof status, { label: string; color: string; detail: string }> = {
    WATCHER_RUNNING: {
      label: "WATCHER_RUNNING",
      color: "#1e9e5a",
      detail: `session เปิดอยู่ (${session?.owner ?? "ไม่ทราบเจ้าของ"}, เริ่ม ${session ? timeAgo(session.started_at) : "-"})${lastActivityAt ? ` · activity ล่าสุด ${timeAgo(lastActivityAt)}` : ""}`,
    },
    STALE: {
      label: "STALE",
      color: "#c98a12",
      detail: `session ระบุว่า "open" แต่ไม่มี evidence event ใหม่มา ${lastActivityAt ? timeAgo(lastActivityAt) : "นาน"}แล้ว — process ในเครื่องอาจถูกปิดโดยไม่ได้กด Ctrl+C (เช่น เครื่องหลับ/ถูก kill) ข้อมูลด้านล่างเป็นข้อมูลเก่า ไม่ใช่ real-time`,
    },
    WATCHER_STOPPED: {
      label: "WATCHER_STOPPED",
      color: "#6b6b6b",
      detail: session
        ? `session ล่าสุดปิดแล้ว (${session.closed_at ? timeAgo(session.closed_at) : "-"}) — รัน \`npm run watch\` ในเครื่องเฮียเพื่อเริ่มใหม่`
        : `ยังไม่เคยรัน npm run watch เลย — ข้อมูลด้านล่างว่างเปล่าเพราะยังไม่มี session ใดๆ`,
    },
  };
  const c = copy[status];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderRadius: 8, marginBottom: 20, background: `${c.color}15`, border: `1px solid ${c.color}55` }}>
      <span style={{ width: 8, height: 8, borderRadius: "50%", background: c.color, flexShrink: 0 }} />
      <div>
        <span style={{ fontWeight: 700, fontSize: 12, color: c.color, letterSpacing: 0.3 }}>{c.label}</span>
        <span style={{ fontSize: 12, color: "#666", marginLeft: 8 }}>{c.detail}</span>
      </div>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div style={{ padding: 16, color: "#999", fontSize: 13 }}>{text}</div>;
}

function StatusBadge({ status }: { status: RegistryProposal["status"] }) {
  const color = status === "pending" ? "#c98a12" : status === "approved" ? "#1e9e5a" : "#c9312b";
  return <span style={{ ...badge, background: color }}>{status.toUpperCase()}</span>;
}

const row: React.CSSProperties = {
  display: "flex",
  gap: 12,
  alignItems: "flex-start",
  padding: 12,
  borderBottom: "1px solid #f0f0f0",
};

const badge: React.CSSProperties = {
  color: "white",
  fontSize: 11,
  fontWeight: 600,
  padding: "2px 8px",
  borderRadius: 999,
  whiteSpace: "nowrap",
};

function btn(color: string): React.CSSProperties {
  return {
    background: color,
    color: "white",
    border: "none",
    borderRadius: 6,
    padding: "6px 12px",
    fontSize: 12,
    cursor: "pointer",
  };
}
