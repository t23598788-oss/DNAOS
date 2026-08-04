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

const RESULT_COLOR: Record<CheckResult["result"], string> = {
  pass: "#1e9e5a",
  warning: "#c98a12",
  fail: "#c9312b",
};

export default function DevLoopDashboard() {
  const [events, setEvents] = useState<EvidenceEvent[]>([]);
  const [checks, setChecks] = useState<CheckResult[]>([]);
  const [proposals, setProposals] = useState<RegistryProposal[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    const client = createBrowserSupabase();
    const [{ data: e }, { data: c }, { data: p }] = await Promise.all([
      client.from("dev_loop_evidence_events").select("*").order("occurred_at", { ascending: false }).limit(30),
      client.from("dev_loop_check_results").select("*").order("checked_at", { ascending: false }).limit(30),
      client.from("dev_loop_registry_proposals").select("*").order("proposed_at", { ascending: false }).limit(30),
    ]);
    setEvents((e as EvidenceEvent[]) ?? []);
    setChecks((c as CheckResult[]) ?? []);
    setProposals((p as RegistryProposal[]) ?? []);
  }, []);

  useEffect(() => {
    void loadAll();
    const client = createBrowserSupabase();
    const channel = client
      .channel("dev-loop-pipeline")
      .on("postgres_changes", { event: "*", schema: "public", table: "dev_loop_evidence_events" }, () => void loadAll())
      .on("postgres_changes", { event: "*", schema: "public", table: "dev_loop_check_results" }, () => void loadAll())
      .on("postgres_changes", { event: "*", schema: "public", table: "dev_loop_registry_proposals" }, () => void loadAll())
      .subscribe();

    return () => {
      void client.removeChannel(channel);
    };
  }, [loadAll]);

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
      <p style={{ color: "#666", marginBottom: 24 }}>
        ไฟล์เปลี่ยน → หลักฐาน → วิเคราะห์ผลกระทบ → ข้อเสนอ registry (ต้องอนุมัติ) — real-time
      </p>

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
