"use client";

import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import type { ConnectorRecord } from "@/core/connector-loader";

/**
 * SystemConfigCenter — fixed-shell (no page scroll), category-drilldown
 * layout, applying the owner's Owner Dashboard principle to the Settings
 * node: sidebar categories are fixed, only the active panel scrolls
 * (overflow: auto), header + status bar never move. Real data from
 * /api/admin/system-config + /api/admin/connectors; anything without a
 * real backend renders "Not integrated" with the real reason — never
 * fabricated as connected.
 */

type CategoryId = "ai" | "plugins" | "runtime" | "infrastructure" | "business" | "domains" | "security";

const CATEGORIES: { id: CategoryId; label: string }[] = [
  { id: "ai", label: "AI Models" },
  { id: "plugins", label: "Plugins & Connections" },
  { id: "runtime", label: "Runtime & Automation" },
  { id: "infrastructure", label: "Infrastructure" },
  { id: "business", label: "Business" },
  { id: "domains", label: "Domains" },
  { id: "security", label: "Security & Users" },
];

function StatusDot({ ok, unknown }: { ok: boolean; unknown?: boolean }) {
  const color = unknown ? "bg-stone-300" : ok ? "bg-emerald-500" : "bg-red-400";
  return <span className={`inline-block w-1.5 h-1.5 rounded-full ${color}`} />;
}

function NotIntegrated({ reason }: { reason: string }) {
  return (
    <div className="text-[11px] text-stone-400 bg-stone-50 border border-dashed border-stone-200 rounded-lg px-3 py-2">
      <span className="font-medium text-stone-500">ยังไม่เชื่อมต่อ</span> — {reason}
    </div>
  );
}

interface AiModelEntry {
  id: string;
  name: string;
  integrated: boolean;
  configured?: boolean;
  env_var?: string;
  reason?: string;
}

interface NotIntegratedField {
  integrated: false;
  reason: string;
}

interface SystemConfigData {
  connectors: ConnectorRecord[];
  automation: { available: string[]; not_implemented: Record<string, string> };
  ai_models: AiModelEntry[];
  infrastructure: {
    database: unknown;
    database_checked_at: string | null;
    storage: NotIntegratedField;
    gpu: NotIntegratedField;
    servers: NotIntegratedField;
  };
  business: NotIntegratedField;
  domains: NotIntegratedField;
}

function Row({ label, right, sub }: { label: string; right?: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5 border-b border-stone-100 last:border-0">
      <div className="min-w-0">
        <div className="text-sm text-stone-700">{label}</div>
        {sub && <div className="text-[11px] text-stone-400 mt-0.5">{sub}</div>}
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </div>
  );
}

export default function SystemConfigCenter() {
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const initialTab = CATEGORIES.some((c) => c.id === tabParam) ? (tabParam as CategoryId) : "ai";
  const [active, setActive] = useState<CategoryId>(initialTab);
  const [data, setData] = useState<SystemConfigData | null>(null);
  const [connectors, setConnectors] = useState<ConnectorRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [runningKey, setRunningKey] = useState<string | null>(null);
  const [runOutput, setRunOutput] = useState<{ key: string; ok: boolean; output: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [cfgRes, connRes] = await Promise.all([
        fetch("/api/admin/system-config"),
        fetch("/api/admin/connectors"),
      ]);
      setData(await cfgRes.json());
      const connData = await connRes.json();
      setConnectors(connData.connectors ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function runAutomation(key: string) {
    setRunningKey(key);
    setRunOutput(null);
    try {
      const res = await fetch("/api/admin/workspace/automation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: key }),
      });
      const body = await res.json();
      setRunOutput({ key, ok: res.ok && body.exit_code === 0, output: body.output ?? body.error ?? "" });
    } finally {
      setRunningKey(null);
    }
  }

  async function testConnector(id: string) {
    await fetch(`/api/admin/connectors/${id}/test`, { method: "POST" });
    load();
  }

  async function toggleConnector(c: ConnectorRecord) {
    await fetch(`/api/admin/connectors/${c.id}/enable`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !c.enabled }),
    });
    load();
  }

  return (
    // Fixed shell: header lives outside this component; this fills the rest
    // of the viewport and never itself scrolls. Only the workspace panel
    // (right column) scrolls.
    <div className="flex" style={{ height: "calc(100vh - 65px)" }}>
      <nav className="w-52 shrink-0 border-r border-stone-200 bg-white py-3 overflow-hidden">
        {CATEGORIES.map((c) => (
          <button
            key={c.id}
            onClick={() => setActive(c.id)}
            className={`w-full text-left px-4 py-2 text-[13px] transition ${
              active === c.id ? "bg-stone-900 text-white font-medium" : "text-stone-600 hover:bg-stone-50"
            }`}
          >
            {c.label}
          </button>
        ))}
      </nav>

      <div className="flex-1 overflow-y-auto p-6 min-w-0">
        {loading || !data ? (
          <div className="text-sm text-stone-400">กำลังโหลด…</div>
        ) : active === "ai" ? (
          <div className="max-w-xl">
            <h2 className="text-sm font-semibold text-stone-800 mb-3">AI Models</h2>
            <div className="bg-white border border-stone-200 rounded-xl px-4">
              {data.ai_models.map((m) => (
                <Row
                  key={m.id}
                  label={m.name}
                  sub={
                    !m.integrated ? undefined :
                    m.configured ? m.env_var :
                    `ยังไม่ได้เชื่อม — ตั้งค่า ${m.env_var} ที่ .env.local (เครื่อง dev) หรือ Environment Variables บน Vercel (production) แล้ว restart`
                  }
                  right={
                    !m.integrated ? (
                      <span className="text-[11px] text-stone-400">ยังไม่เชื่อมต่อ</span>
                    ) : (
                      <span className="text-[11px] flex items-center gap-1.5 text-stone-500">
                        <StatusDot ok={!!m.configured} /> {m.configured ? "Configured" : "Env var missing"}
                      </span>
                    )
                  }
                />
              ))}
            </div>
            {data.ai_models.filter((m) => !m.integrated).map((m) => (
              <div key={m.id} className="mt-2"><NotIntegrated reason={`${m.name}: ${m.reason}`} /></div>
            ))}
          </div>
        ) : active === "plugins" ? (
          <div className="max-w-2xl">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-stone-800">Plugins & Connections</h2>
              <a href="/admin/connectors" className="text-[11px] px-2.5 py-1 rounded-lg bg-stone-900 text-white hover:bg-stone-800">+ เพิ่ม Connector</a>
            </div>
            {connectors.length === 0 ? (
              <div className="text-sm text-stone-400 py-8 text-center border border-dashed border-stone-200 rounded-xl">ยังไม่มี Connector — กด &quot;เพิ่ม Connector&quot;</div>
            ) : (
              <div className="bg-white border border-stone-200 rounded-xl px-4">
                {connectors.map((c) => (
                  <Row
                    key={c.id}
                    label={c.name}
                    sub={c.auth_type}
                    right={
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] flex items-center gap-1.5 text-stone-500">
                          <StatusDot ok={c.status === "connected"} unknown={c.status === "disconnected"} /> {c.status}
                        </span>
                        <button onClick={() => testConnector(c.id)} className="text-[11px] px-2 py-1 rounded border border-stone-200 hover:bg-stone-50">ทดสอบ</button>
                        <button onClick={() => toggleConnector(c)} className={`text-[11px] px-2 py-1 rounded ${c.enabled ? "border border-stone-200 hover:bg-stone-50" : "bg-sky-600 text-white hover:bg-sky-700"}`}>
                          {c.enabled ? "ปิดใช้งาน" : "Enable"}
                        </button>
                      </div>
                    }
                  />
                ))}
              </div>
            )}
          </div>
        ) : active === "runtime" ? (
          <div className="max-w-xl">
            <h2 className="text-sm font-semibold text-stone-800 mb-3">Runtime & Automation</h2>
            <div className="bg-white border border-stone-200 rounded-xl px-4">
              {data.automation.available.map((key: string) => (
                <Row
                  key={key}
                  label={key}
                  right={
                    <button
                      onClick={() => runAutomation(key)}
                      disabled={runningKey === key}
                      className="text-[11px] px-2.5 py-1 rounded border border-stone-200 hover:bg-stone-50 disabled:opacity-40"
                    >
                      {runningKey === key ? "กำลังรัน…" : "Run"}
                    </button>
                  }
                />
              ))}
            </div>
            {Object.entries(data.automation.not_implemented).map(([k, reason]) => (
              <div key={k} className="mt-2"><NotIntegrated reason={`${k}: ${reason as string}`} /></div>
            ))}
            {runOutput && (
              <pre className={`mt-3 text-[11px] p-3 rounded-lg overflow-auto max-h-64 ${runOutput.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"}`}>
                {runOutput.output}
              </pre>
            )}
          </div>
        ) : active === "infrastructure" ? (
          <div className="max-w-xl">
            <h2 className="text-sm font-semibold text-stone-800 mb-3">Infrastructure</h2>
            <div className="bg-white border border-stone-200 rounded-xl px-4">
              <Row
                label="Database (Supabase)"
                sub={data.infrastructure.database_checked_at ? new Date(data.infrastructure.database_checked_at).toLocaleString("th-TH") : "ยังไม่มีข้อมูล"}
                right={<span className="text-[11px] flex items-center gap-1.5 text-stone-500"><StatusDot ok={!!data.infrastructure.database} unknown={!data.infrastructure.database} /> {data.infrastructure.database ? "OK" : "Unknown"}</span>}
              />
            </div>
            <div className="mt-2 space-y-2">
              <NotIntegrated reason={`Storage: ${data.infrastructure.storage.reason}`} />
              <NotIntegrated reason={`GPU: ${data.infrastructure.gpu.reason}`} />
              <NotIntegrated reason={`Servers: ${data.infrastructure.servers.reason}`} />
            </div>
          </div>
        ) : active === "business" ? (
          <div className="max-w-xl">
            <h2 className="text-sm font-semibold text-stone-800 mb-3">Business</h2>
            <NotIntegrated reason={data.business.reason} />
          </div>
        ) : active === "domains" ? (
          <div className="max-w-xl">
            <h2 className="text-sm font-semibold text-stone-800 mb-3">Domains</h2>
            <NotIntegrated reason={data.domains.reason} />
          </div>
        ) : (
          <div className="max-w-xl">
            <h2 className="text-sm font-semibold text-stone-800 mb-3">Security & Users</h2>
            <div className="bg-white border border-stone-200 rounded-xl px-4">
              <Row label="Users & Roles" sub="role assignment (super_admin เท่านั้น)" right={<a href="/admin/users" className="text-[11px] px-2.5 py-1 rounded border border-stone-200 hover:bg-stone-50">เปิด</a>} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
